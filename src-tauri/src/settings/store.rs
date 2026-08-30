//! The single source of truth for settings.
//!
//! Loading is infallible by construction: the worst outcome is defaults plus
//! a recorded reason. An application that will not start because its
//! preferences file is malformed has turned a cosmetic problem into an outage.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, RwLock};

use serde_json::Value;

use crate::error::{RiffError, RiffResult};
use crate::paths::AppPaths;
use crate::settings::migrate;
use crate::settings::model::{self, Appearance, General, Onboarding, Practice, Settings};
use crate::storage::atomic::write_atomic;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Section {
    General,
    Appearance,
    Onboarding,
    Practice,
}

#[derive(Debug)]
pub enum LoadOutcome {
    /// No file existed; defaults are in memory and pending a write.
    Fresh,
    Loaded,
    Migrated {
        from: u32,
    },
    /// The file could not be read — either it is not JSON, or it is JSON that
    /// the model cannot understand. `Some` means it was renamed aside and
    /// defaults may be written; `None` means it could not be moved, so Riff
    /// must leave the user's file alone.
    Recovered {
        quarantined: Option<PathBuf>,
    },
}

pub struct SettingsStore {
    paths: AppPaths,
    state: RwLock<Settings>,
    last_written: Mutex<Option<Vec<u8>>>,
    /// Bumped by every mutation. A flush clears the dirty state only if this
    /// has not moved since it took its snapshot, so a change that lands while
    /// a write is in flight is not lost — a plain boolean would drop it.
    revision: AtomicU64,
    flushed: AtomicU64,
    /// Set when the file on disk is unreadable AND could not be moved aside.
    /// Writing would destroy data we failed to preserve.
    write_blocked: AtomicBool,
    writes: AtomicUsize,
}

impl SettingsStore {
    pub fn load(paths: AppPaths) -> (Self, LoadOutcome) {
        let file = paths.settings_file();
        let (settings, outcome) = match std::fs::read(&file) {
            Err(_) => (Settings::default(), LoadOutcome::Fresh),
            Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
                Err(err) => {
                    tracing::error!(%err, path = %file.display(), "settings file is unreadable");
                    let quarantined = quarantine(&file);
                    (Settings::default(), LoadOutcome::Recovered { quarantined })
                }
                Ok(mut document) => {
                    let found = document.get("version").and_then(Value::as_u64).unwrap_or(0);
                    if found < u64::from(model::CURRENT_VERSION) {
                        backup_before_migration(&file, found as u32);
                    } else if found > u64::from(model::CURRENT_VERSION) {
                        // Load it, preserve it, keep writing — but say so once,
                        // because a downgrade is the likeliest cause and the
                        // user should know which direction the mismatch runs.
                        tracing::warn!(
                            found,
                            current = model::CURRENT_VERSION,
                            "settings were written by a newer version of Riff; unknown keys are preserved"
                        );
                    }
                    let migrated_from = migrate::run(&mut document);
                    let (settings, defaulted) = model::read(document);
                    if defaulted.is_empty() {
                        match migrated_from {
                            Some(from) => (settings, LoadOutcome::Migrated { from }),
                            None => (settings, LoadOutcome::Loaded),
                        }
                    } else {
                        // Parsing and deserialising are two different failures
                        // and only one of them used to be protected. A file
                        // Riff cannot *understand* gets the same treatment as
                        // one it cannot parse: kept, reported, never
                        // overwritten in place. Without this, one wrong type
                        // reverted every setting, wiped `onboarding` — so
                        // first run returned — and let the next ordinary
                        // change write pure defaults over the original.
                        tracing::error!(
                            ?defaulted,
                            path = %file.display(),
                            "settings could not be read in full"
                        );
                        let quarantined = quarantine(&file);
                        (settings, LoadOutcome::Recovered { quarantined })
                    }
                }
            },
        };

        // Anything but a clean load leaves something to write. The one
        // exception is a corrupt file we could not move aside: writing then
        // would destroy the very bytes quarantine failed to preserve.
        let blocked = matches!(outcome, LoadOutcome::Recovered { quarantined: None });
        let dirty = !matches!(outcome, LoadOutcome::Loaded) && !blocked;
        let store = Self {
            paths,
            state: RwLock::new(settings),
            last_written: Mutex::new(None),
            revision: AtomicU64::new(u64::from(dirty)),
            flushed: AtomicU64::new(0),
            write_blocked: AtomicBool::new(blocked),
            writes: AtomicUsize::new(0),
        };
        (store, outcome)
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn get(&self) -> Settings {
        self.read().clone()
    }

    pub fn write_count(&self) -> usize {
        self.writes.load(Ordering::Relaxed)
    }

    pub fn last_written_bytes(&self) -> Option<Vec<u8>> {
        self.last_written.lock().ok().and_then(|g| g.clone())
    }

    pub fn patch(&self, patch: &Value) -> RiffResult<Settings> {
        let next = crate::settings::patch::apply(&self.read(), patch)?;
        self.replace(next.clone());
        Ok(next)
    }

    pub fn reset(&self, section: Option<Section>) -> RiffResult<Settings> {
        let mut next = self.read().clone();
        match section {
            Some(Section::General) => next.general = General::default(),
            Some(Section::Appearance) => next.appearance = Appearance::default(),
            Some(Section::Onboarding) => next.onboarding = Onboarding::default(),
            Some(Section::Practice) => next.practice = Practice::default(),
            // "Everything" means preferences. Onboarding completion is not a
            // preference, and replaying first run is its own explicit action.
            // `practice` is not a preference either, but it *is* included:
            // leaving three pop-out windows open across a reset that claims to
            // put Riff back how it started would be a reset that lied.
            None => {
                next.general = General::default();
                next.appearance = Appearance::default();
                next.practice = Practice::default();
            }
        }
        self.replace(next.clone());
        Ok(next)
    }

    /// Replaces the whole document, used by the file watcher on an external
    /// edit. Deliberately does NOT mark the store dirty — the disk already
    /// holds this content — and records the bytes as ours so the same event
    /// arriving twice does not reload twice.
    pub fn adopt(&self, settings: Settings, bytes: Vec<u8>) {
        if let Ok(mut guard) = self.state.write() {
            *guard = settings;
        }
        if let Ok(mut guard) = self.last_written.lock() {
            *guard = Some(bytes);
        }
    }

    pub fn is_dirty(&self) -> bool {
        !self.write_blocked.load(Ordering::SeqCst)
            && self.revision.load(Ordering::SeqCst) != self.flushed.load(Ordering::SeqCst)
    }

    pub fn flush_if_dirty(&self) -> RiffResult<()> {
        if self.write_blocked.load(Ordering::SeqCst) {
            return Err(RiffError::Denied {
                what: "settings.json could not be read or moved aside; refusing to overwrite it"
                    .to_owned(),
            });
        }
        if !self.is_dirty() {
            return Ok(());
        }

        // Snapshot the revision BEFORE serialising. A patch that lands while
        // this write is in flight leaves revision ahead of the snapshot, so
        // the store stays dirty and the change is written by the next flush
        // instead of being silently dropped.
        let snapshot = self.revision.load(Ordering::SeqCst);
        let bytes =
            serde_json::to_vec_pretty(&*self.read()).map_err(|e| RiffError::Validation {
                field: "settings".to_owned(),
                reason: e.to_string(),
            })?;
        let path = self.paths.settings_file();

        // Cleared only on success. A failed write leaves the store dirty so
        // the next change retries, and leaves memory untouched so the
        // interface never lies about what the user chose.
        write_atomic(&path, &bytes).map_err(|e| RiffError::io(&path, &e))?;

        if let Ok(mut guard) = self.last_written.lock() {
            *guard = Some(bytes);
        }
        self.writes.fetch_add(1, Ordering::Relaxed);
        self.flushed.store(snapshot, Ordering::SeqCst);
        Ok(())
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, Settings> {
        self.state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn replace(&self, next: Settings) {
        if let Ok(mut guard) = self.state.write() {
            *guard = next;
        }
        self.revision.fetch_add(1, Ordering::SeqCst);
    }
}

/// Moves the unreadable file aside. Returns `None` if it could not be moved,
/// which is the signal that Riff must NOT write over it.
///
/// `rename` rather than copy-and-overwrite: a copy leaves the original in
/// place to be overwritten by the next flush, so if the copy silently failed
/// the user would lose the file entirely. Rename either moves it or does not.
fn quarantine(path: &std::path::Path) -> Option<PathBuf> {
    let target = path.with_extension(format!("json.corrupt-{}", stamp()));
    match std::fs::rename(path, &target) {
        Ok(()) => Some(target),
        Err(err) => {
            tracing::error!(%err, path = %path.display(), "could not quarantine the unreadable settings file; it will be left untouched");
            None
        }
    }
}

/// Copies the pre-migration document aside before the chain runs, so a
/// migration bug is recoverable rather than terminal.
fn backup_before_migration(path: &std::path::Path, from: u32) {
    let target = path.with_extension(format!("json.bak-v{from}"));
    if let Err(err) = std::fs::copy(path, &target) {
        tracing::error!(%err, "could not back up settings before migrating");
    }
}

fn stamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_owned())
        .replace(':', "-")
}

/// Implemented by any store `FlushScheduler` coalesces writes for.
/// `workspace::WorkspaceStore` is the second implementation — see plan 15
/// Task 3 — and shares this rather than reimplementing debouncing, which is
/// the part that used to be wrong.
pub trait Flushable: Send + Sync + 'static {
    fn flush_if_dirty(&self) -> RiffResult<()>;
}

impl Flushable for SettingsStore {
    fn flush_if_dirty(&self) -> RiffResult<()> {
        SettingsStore::flush_if_dirty(self)
    }
}

/// Coalesces writes. Every mutation calls `notify()`; the worker waits for a
/// quiet period before flushing, so a slider drag is one `fsync` rather than
/// forty.
///
/// The scheduling lives here rather than in the command layer because the
/// command layer would have to reimplement it per command, and because a
/// write failure has to be reported from wherever the write actually happens.
///
/// Generic over `T: Flushable` rather than fixed to `SettingsStore`, so
/// `FlushScheduler<SettingsStore>` and `FlushScheduler<WorkspaceStore>` are
/// two distinct types — which is what lets Tauri `.manage()` one of each: a
/// non-generic `FlushScheduler` would let a second `.manage()` call silently
/// replace the first, since Tauri's state map holds one value per type.
pub struct FlushScheduler<T> {
    tx: std::sync::mpsc::Sender<()>,
    _store: std::marker::PhantomData<T>,
}

impl<T: Flushable> FlushScheduler<T> {
    pub fn spawn<F>(store: std::sync::Arc<T>, delay: std::time::Duration, on_error: F) -> Self
    where
        F: Fn(RiffError) + Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::Builder::new()
            .name("riff-flush".into())
            .spawn(move || {
                // One error per failure *cause*, not one per attempt: a
                // read-only config directory would otherwise raise a toast on
                // every keystroke.
                let mut reported: Option<String> = None;
                while rx.recv().is_ok() {
                    // Drain the burst: keep resetting the timer while changes
                    // keep arriving.
                    while rx.recv_timeout(delay).is_ok() {}
                    match store.flush_if_dirty() {
                        Ok(()) => reported = None,
                        Err(err) => {
                            let cause = err.to_string();
                            if reported.as_deref() != Some(cause.as_str()) {
                                reported = Some(cause);
                                on_error(err);
                            }
                        }
                    }
                }
            })
            .ok();
        Self {
            tx,
            _store: std::marker::PhantomData,
        }
    }

    pub fn notify(&self) {
        let _ = self.tx.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::model::Theme;
    use serde_json::json;

    fn store() -> (SettingsStore, LoadOutcome, tempfile::TempDir) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let paths = crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.path().join("config")),
                data: Some(tmp.path().join("data")),
            },
        )
        .expect("overrides supply both roots");
        crate::paths::ensure_dirs(&paths).expect("dirs");
        let (s, outcome) = SettingsStore::load(paths);
        (s, outcome, tmp)
    }

    #[test]
    fn a_missing_file_yields_defaults_and_writes_them_so_the_user_can_find_it() {
        let (s, outcome, _tmp) = store();
        assert!(matches!(outcome, LoadOutcome::Fresh));
        s.flush_if_dirty().expect("flush");
        assert!(
            s.paths().settings_file().is_file(),
            "the file must exist to be editable"
        );
        assert_eq!(s.get().appearance.theme, Theme::Dark);
    }

    #[test]
    fn a_corrupt_file_is_quarantined_and_never_overwritten() {
        let (s, _outcome, _tmp) = store();
        let path = s.paths().settings_file();
        std::fs::write(&path, b"{ this is not json").expect("write garbage");

        let (reloaded, outcome) = SettingsStore::load(s.paths().clone());
        let LoadOutcome::Recovered {
            quarantined: Some(quarantined),
        } = outcome
        else {
            panic!("expected Recovered with a quarantine path, got {outcome:?}");
        };
        assert!(quarantined.is_file(), "the user's bad file must be kept");
        assert_eq!(
            std::fs::read(&quarantined).expect("read"),
            b"{ this is not json",
            "quarantined content must be byte-identical"
        );
        assert!(
            !path.is_file(),
            "quarantine must MOVE the file, not copy it — a copy leaves the original \
             to be overwritten by the next flush, so a failed copy loses it entirely"
        );
        assert_eq!(reloaded.get().appearance.theme, Theme::Dark);
    }

    /// One wrong *type* on one plain field. `lenient` covers unrecognised
    /// enum values and `UiScale` clamps out-of-range numbers; nothing covered
    /// this, so `from_value` failed, every setting silently reverted, and the
    /// file was reported as `Loaded` — no toast, no quarantine, and the next
    /// ordinary change overwrote it with pure defaults.
    const ONE_WRONG_TYPE: &[u8] = br#"{
  "version": 1,
  "general": { "confirmOnQuit": "true", "startupRoute": "last-used" },
  "appearance": { "theme": "light", "uiScale": 1.25 },
  "onboarding": { "completedAt": "2026-01-01T00:00:00Z" }
}"#;

    #[test]
    fn a_file_that_parses_but_does_not_deserialise_is_quarantined_like_one_that_does_not_parse() {
        // Invariant 1 covers a file Riff failed to *understand*, not only one
        // it failed to parse. Parsing and deserialising are two failures and
        // only one of them was protected.
        let (s, _outcome, _tmp) = store();
        let path = s.paths().settings_file();
        std::fs::write(&path, ONE_WRONG_TYPE).expect("seed");

        let (_reloaded, outcome) = SettingsStore::load(s.paths().clone());
        let LoadOutcome::Recovered {
            quarantined: Some(kept),
        } = outcome
        else {
            panic!("expected Recovered with a quarantine path, got {outcome:?}");
        };
        assert_eq!(
            std::fs::read(&kept).expect("read"),
            ONE_WRONG_TYPE,
            "the user's file must be kept byte for byte"
        );
        assert!(
            !path.is_file(),
            "quarantine must MOVE the file, not copy it"
        );
    }

    #[test]
    fn a_wrong_type_in_one_section_does_not_cost_the_others() {
        let (s, _outcome, _tmp) = store();
        std::fs::write(s.paths().settings_file(), ONE_WRONG_TYPE).expect("seed");

        let (reloaded, _outcome) = SettingsStore::load(s.paths().clone());
        let after = reloaded.get();
        assert_eq!(after.appearance.theme, Theme::Light, "appearance is intact");
        assert_eq!(after.appearance.ui_scale.get(), 1.25);
        assert!(
            !after.general.confirm_on_quit,
            "the section that could not be read is the only casualty"
        );
        assert_eq!(
            after.general.startup_route,
            crate::settings::model::StartupRoute::Practice,
            "and it goes to defaults whole, rather than half-read"
        );
    }

    #[test]
    fn a_defaulted_load_never_silently_replays_first_run() {
        // Being dropped back into the welcome wizard is the most visible
        // symptom of this bug, and `completedAt` is not a preference.
        let (s, _outcome, _tmp) = store();
        std::fs::write(s.paths().settings_file(), ONE_WRONG_TYPE).expect("seed");
        let (reloaded, _) = SettingsStore::load(s.paths().clone());
        assert_eq!(
            reloaded.get().onboarding.completed_at.as_deref(),
            Some("2026-01-01T00:00:00Z")
        );

        // And when `onboarding` is itself the unreadable section.
        let (s, _outcome, _tmp) = store();
        std::fs::write(
            s.paths().settings_file(),
            br#"{"version":1,"onboarding":{"completedAt":"2026-01-01T00:00:00Z","version":"one"}}"#,
        )
        .expect("seed");
        let (reloaded, _) = SettingsStore::load(s.paths().clone());
        assert_eq!(
            reloaded.get().onboarding.completed_at.as_deref(),
            Some("2026-01-01T00:00:00Z"),
            "first run must not return because a sibling field was mistyped"
        );
    }

    #[test]
    fn the_users_file_is_never_overwritten_before_it_has_been_kept() {
        let (s, _outcome, _tmp) = store();
        std::fs::write(s.paths().settings_file(), ONE_WRONG_TYPE).expect("seed");

        let (reloaded, outcome) = SettingsStore::load(s.paths().clone());
        // The next ordinary setting change is what used to destroy it.
        reloaded
            .patch(&json!({ "appearance": { "density": "compact" } }))
            .expect("patch");
        reloaded.flush_if_dirty().expect("flush");

        let LoadOutcome::Recovered {
            quarantined: Some(kept),
        } = outcome
        else {
            panic!("expected the file to have been kept, got {outcome:?}");
        };
        assert_eq!(
            std::fs::read(&kept).expect("read"),
            ONE_WRONG_TYPE,
            "the write must land somewhere the original is not"
        );
    }

    #[test]
    fn a_file_that_cannot_be_quarantined_is_never_overwritten() {
        use std::os::unix::fs::PermissionsExt;
        let (s, _outcome, _tmp) = store();
        let path = s.paths().settings_file();
        std::fs::write(&path, b"{ this is not json").expect("write garbage");

        let dir = s.paths().config_dir.clone();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("chmod");
        let (blocked, outcome) = SettingsStore::load(s.paths().clone());
        let flushed = blocked.flush_if_dirty();
        let still_there = std::fs::read(&path).expect("read");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("restore");

        assert!(matches!(
            outcome,
            LoadOutcome::Recovered { quarantined: None }
        ));
        assert!(flushed.is_err(), "writing must be refused, not attempted");
        assert_eq!(
            still_there, b"{ this is not json",
            "invariant 1: never overwrite what we failed to parse"
        );
    }

    #[test]
    fn migrating_leaves_a_versioned_backup_behind() {
        let (s, _outcome, _tmp) = store();
        std::fs::write(
            s.paths().settings_file(),
            br#"{"version":0,"appearance":{"theme":"light"}}"#,
        )
        .expect("seed");

        let (_reloaded, _outcome) = SettingsStore::load(s.paths().clone());
        assert!(
            s.paths().config_dir.join("settings.json.bak-v0").is_file(),
            "a migration bug must be recoverable, not terminal"
        );
    }

    #[test]
    fn a_change_landing_during_a_flush_is_not_lost() {
        use std::sync::Arc;
        let (s, _outcome, _tmp) = store();
        let s = Arc::new(s);

        let writer = {
            let s = Arc::clone(&s);
            std::thread::spawn(move || {
                for i in 0..200 {
                    s.patch(&json!({ "general": { "lastRoute": format!("/r{i}") } }))
                        .expect("patch");
                }
            })
        };
        for _ in 0..200 {
            let _ = s.flush_if_dirty();
        }
        writer.join().expect("writer thread");
        s.flush_if_dirty().expect("final flush");

        let on_disk: serde_json::Value =
            serde_json::from_slice(&std::fs::read(s.paths().settings_file()).expect("read"))
                .expect("json");
        assert_eq!(
            on_disk["general"]["lastRoute"],
            s.get().general.last_route,
            "the last change must reach disk; a plain dirty flag drops the one that \
             lands between serialising and clearing it"
        );
    }

    #[test]
    fn a_patch_survives_a_reload() {
        let (s, _outcome, _tmp) = store();
        s.patch(&json!({ "appearance": { "theme": "light" } }))
            .expect("patch");
        s.flush_if_dirty().expect("flush");

        let (reloaded, outcome) = SettingsStore::load(s.paths().clone());
        assert!(matches!(outcome, LoadOutcome::Loaded));
        assert_eq!(reloaded.get().appearance.theme, Theme::Light);
    }

    #[test]
    fn several_patches_coalesce_into_one_write() {
        let (s, _outcome, _tmp) = store();
        let before = s.write_count();
        s.patch(&json!({ "appearance": { "theme": "light" } }))
            .expect("one");
        s.patch(&json!({ "appearance": { "density": "compact" } }))
            .expect("two");
        s.patch(&json!({ "general": { "confirmOnQuit": true } }))
            .expect("three");
        s.flush_if_dirty().expect("flush");
        assert_eq!(
            s.write_count() - before,
            1,
            "dragging a slider must not write forty times"
        );
    }

    #[test]
    fn flushing_when_clean_writes_nothing() {
        let (s, _outcome, _tmp) = store();
        s.flush_if_dirty().expect("initial");
        let after_first = s.write_count();
        s.flush_if_dirty().expect("second");
        assert_eq!(s.write_count(), after_first);
    }

    #[test]
    fn reset_all_preserves_onboarding_completion() {
        let (s, _outcome, _tmp) = store();
        s.patch(&json!({
            "appearance": { "theme": "light" },
            "onboarding": { "completedAt": "2026-08-28T10:00:00Z" }
        }))
        .expect("patch");

        let after = s.reset(None).expect("reset");
        assert_eq!(
            after.appearance.theme,
            Theme::Dark,
            "appearance returns to defaults"
        );
        assert_eq!(
            after.onboarding.completed_at.as_deref(),
            Some("2026-08-28T10:00:00Z"),
            "resetting preferences is not a request to redo first run"
        );
    }

    #[test]
    fn resetting_everything_docks_every_pane_back() {
        // A reset that leaves three pop-out windows open while writing
        // `poppedOut: []` to the file is a reset that lied. The windows are
        // closed by `practice::sync_windows`; this is the half that decides.
        let (s, _outcome, _tmp) = store();
        s.patch(&json!({ "practice": { "poppedOut": ["score", "video"] } }))
            .expect("patch");
        let after = s.reset(None).expect("reset");
        assert!(after.practice.popped_out.is_empty());
    }

    #[test]
    fn resetting_the_practice_section_leaves_the_other_sections_alone() {
        let (s, _outcome, _tmp) = store();
        s.patch(&json!({
            "appearance": { "theme": "light" },
            "practice": { "poppedOut": ["audio"] }
        }))
        .expect("patch");
        let after = s.reset(Some(Section::Practice)).expect("reset");
        assert!(after.practice.popped_out.is_empty());
        assert_eq!(after.appearance.theme, Theme::Light);
    }

    #[test]
    fn resetting_the_onboarding_section_is_how_first_run_is_replayed() {
        let (s, _outcome, _tmp) = store();
        s.patch(&json!({ "onboarding": { "completedAt": "2026-08-28T10:00:00Z" } }))
            .expect("patch");
        let after = s.reset(Some(Section::Onboarding)).expect("reset");
        assert!(after.onboarding.completed_at.is_none());
    }

    #[test]
    fn a_failed_write_keeps_in_memory_state_and_reports_the_error() {
        use std::os::unix::fs::PermissionsExt;
        let (s, _outcome, _tmp) = store();
        s.flush_if_dirty().expect("initial write");

        let dir = s.paths().config_dir.clone();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("chmod");
        s.patch(&json!({ "appearance": { "theme": "light" } }))
            .expect("patch applies in memory");
        let result = s.flush_if_dirty();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("restore");

        assert!(result.is_err(), "the failure must be reported");
        assert_eq!(
            s.get().appearance.theme,
            Theme::Light,
            "the user's choice must not be silently reverted in the interface"
        );
    }

    #[test]
    fn unknown_keys_in_the_file_survive_a_patch_and_flush() {
        let (s, _outcome, _tmp) = store();
        std::fs::write(
            s.paths().settings_file(),
            br#"{"version":1,"futureFeature":{"enabled":true}}"#,
        )
        .expect("seed");

        let (reloaded, _) = SettingsStore::load(s.paths().clone());
        reloaded
            .patch(&json!({ "appearance": { "theme": "light" } }))
            .expect("patch");
        reloaded.flush_if_dirty().expect("flush");

        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(reloaded.paths().settings_file()).expect("read"))
                .expect("valid json");
        assert_eq!(written["futureFeature"]["enabled"], true);
        assert_eq!(written["appearance"]["theme"], "light");
    }

    #[test]
    fn last_written_bytes_match_the_file_for_watcher_self_suppression() {
        let (s, _outcome, _tmp) = store();
        s.flush_if_dirty().expect("flush");
        let on_disk = std::fs::read(s.paths().settings_file()).expect("read");
        assert_eq!(s.last_written_bytes().as_deref(), Some(on_disk.as_slice()));
    }

    use std::time::Duration;

    #[test]
    fn a_burst_of_changes_produces_one_write() {
        let (s, _outcome, _tmp) = store();
        let s = std::sync::Arc::new(s);
        let scheduler =
            FlushScheduler::spawn(std::sync::Arc::clone(&s), Duration::from_millis(30), |_| {});

        // Forty steps of a slider drag.
        for i in 0..40 {
            s.patch(&json!({ "appearance": { "uiScale": 1.0 + (i as f64) * 0.01 } }))
                .expect("patch");
            scheduler.notify();
        }
        // Poll rather than fixed sleep: the worker thread may be delayed
        // under load (e.g. GHA with 140 tests in parallel) so a 200 ms
        // sleep can expire before the 30 ms quiet period + flush, or
        // before the thread has even started and the 40 notifies are
        // coalesced correctly but not yet flushed. Polling with a
        // generous timeout makes the assertion deterministic.
        let deadline = std::time::Instant::now() + Duration::from_millis(1000);
        while s.write_count() != 1 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }

        assert_eq!(
            s.write_count(),
            1,
            "a drag must coalesce into one write, not forty"
        );
    }

    #[test]
    fn a_change_after_the_window_closes_writes_again() {
        let (s, _outcome, _tmp) = store();
        let s = std::sync::Arc::new(s);
        let scheduler =
            FlushScheduler::spawn(std::sync::Arc::clone(&s), Duration::from_millis(30), |_| {});

        s.patch(&json!({ "appearance": { "theme": "light" } }))
            .expect("one");
        scheduler.notify();
        // Wait for the first burst to flush before starting the second,
        // otherwise a slow worker startup (e.g. 250 ms on a loaded CI
        // runner) queues both notifies before the first recv and they
        // coalesce into one write (1 vs 2). See the reproduction in
        // /tmp/test_scheduler.rs.
        let deadline = std::time::Instant::now() + Duration::from_millis(1000);
        while s.write_count() != 1 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        s.patch(&json!({ "appearance": { "density": "compact" } }))
            .expect("two");
        scheduler.notify();
        let deadline = std::time::Instant::now() + Duration::from_millis(1000);
        while s.write_count() != 2 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }

        assert_eq!(
            s.write_count(),
            2,
            "coalescing must not swallow later changes"
        );
    }

    #[test]
    fn a_write_failure_is_reported_once_per_flush_not_once_per_change() {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::atomic::{AtomicUsize, Ordering};

        static REPORTS: AtomicUsize = AtomicUsize::new(0);
        REPORTS.store(0, Ordering::SeqCst);

        let (s, _outcome, _tmp) = store();
        let s = std::sync::Arc::new(s);
        s.flush_if_dirty().expect("initial write");

        let dir = s.paths().config_dir.clone();
        let scheduler =
            FlushScheduler::spawn(std::sync::Arc::clone(&s), Duration::from_millis(30), |_| {
                REPORTS.fetch_add(1, Ordering::SeqCst);
            });

        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("chmod");
        for _ in 0..10 {
            s.patch(&json!({ "appearance": { "theme": "light" } }))
                .expect("patch");
            scheduler.notify();
        }
        let deadline = std::time::Instant::now() + Duration::from_millis(1000);
        while REPORTS.load(Ordering::SeqCst) != 1 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("restore");

        assert_eq!(
            REPORTS.load(Ordering::SeqCst),
            1,
            "one toast per failure, not one per keystroke"
        );
    }
}

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
use crate::settings::model::{self, Appearance, General, Onboarding, Settings};
use crate::storage::atomic::write_atomic;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Section {
    General,
    Appearance,
    Onboarding,
}

#[derive(Debug)]
pub enum LoadOutcome {
    /// No file existed; defaults are in memory and pending a write.
    Fresh,
    Loaded,
    Migrated {
        from: u32,
    },
    /// The file could not be parsed and was renamed aside.
    /// The file could not be parsed. `Some` means it was renamed aside and
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
                    let settings =
                        serde_json::from_value::<Settings>(document).unwrap_or_else(|err| {
                            tracing::warn!(%err, "settings did not deserialise; using defaults");
                            Settings::default()
                        });
                    match migrated_from {
                        Some(from) => (settings, LoadOutcome::Migrated { from }),
                        None => (settings, LoadOutcome::Loaded),
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
            // "Everything" means preferences. Onboarding completion is not a
            // preference, and replaying first run is its own explicit action.
            None => {
                next.general = General::default();
                next.appearance = Appearance::default();
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
}

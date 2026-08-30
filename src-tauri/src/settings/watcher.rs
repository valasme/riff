//! Live reload of hand edits to `settings.json`.
//!
//! `notify` reports events for the whole directory, so two filters are
//! load-bearing. Without the filename match, regenerating
//! `settings.schema.json` or leaving a `settings.json.corrupt-*` file behind
//! would trigger a reload on every launch. Without the byte comparison, our
//! own flush would bounce back through the watcher and re-enter the store.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use crate::settings::migrate::{self, MigrationStep};
use crate::settings::model::{self, Settings};
use crate::settings::store::SettingsStore;

/// How long to let an unreadable file settle before calling it a finished
/// edit. An editor saving truncates the file and then writes it, so the
/// truncated read is normal — and indistinguishable from a hand edit that is
/// genuinely wrong until the file stops moving.
const SETTLE: Duration = Duration::from_millis(300);

/// What a change to `settings.json` turned out to mean.
#[derive(Debug)]
pub enum Reaction {
    /// Adopt these and tell every window.
    Reload(Box<Settings>),
    /// The file stopped changing and still cannot be read: an edit that did
    /// nothing. `detail` says what could not be read.
    ///
    /// This used to be logged at `debug` and nothing else, on the assumption
    /// that every unreadable read was an editor mid-save — so a genuinely
    /// invalid hand edit produced no feedback at all, and the next in-app
    /// change overwrote it. `settings.json` is a documented editing surface;
    /// an edit that did nothing has to say so.
    Invalid { detail: String },
    /// A half-written save, or our own write coming back. Say nothing.
    Ignore,
}

/// Decides what a change means. `reread` returns what the file holds after a
/// short settle, and is called only when the bytes do not make sense —
/// comparing bytes rather than mtime, because an editor that truncates and
/// rewrites inside one clock tick looks untouched.
pub fn react(bytes: &[u8], reread: impl FnOnce() -> Option<Vec<u8>>) -> Reaction {
    react_with(bytes, migrate::STEPS, reread)
}

/// Takes the step table for the same reason `migrate::run_with` does: at
/// schema version 1 there are no migrations, so nothing would exercise the
/// call otherwise.
fn react_with(
    bytes: &[u8],
    steps: &[MigrationStep],
    reread: impl FnOnce() -> Option<Vec<u8>>,
) -> Reaction {
    let mut document = match serde_json::from_slice::<serde_json::Value>(bytes) {
        Ok(document) => document,
        Err(err) => return unreadable(bytes, err.to_string(), reread),
    };
    // The load path migrates before reading. Without the same call here, a
    // hand edit that also lowered `version` was read raw against the current
    // model — and then adopted, so the migration never ran at all.
    migrate::run_with(&mut document, steps);
    let (settings, defaulted) = model::read(document);
    if defaulted.is_empty() {
        Reaction::Reload(Box::new(settings))
    } else {
        unreadable(bytes, defaulted.join(", "), reread)
    }
}

fn unreadable(bytes: &[u8], detail: String, reread: impl FnOnce() -> Option<Vec<u8>>) -> Reaction {
    if reread().as_deref() == Some(bytes) {
        Reaction::Invalid { detail }
    } else {
        Reaction::Ignore
    }
}

pub fn should_reload(
    event_path: &Path,
    settings_path: &Path,
    new_bytes: &[u8],
    last_written: Option<&[u8]>,
) -> bool {
    if event_path.file_name() != settings_path.file_name() {
        return false;
    }
    last_written != Some(new_bytes)
}

/// Watches the config directory and calls `on_change` with the reloaded
/// settings, or `on_invalid` when an edit finished and still could not be
/// read. The returned watcher must be kept alive; dropping it stops watching.
pub fn spawn<F, G>(
    store: Arc<SettingsStore>,
    on_change: F,
    on_invalid: G,
) -> notify::Result<RecommendedWatcher>
where
    F: Fn(Settings) + Send + 'static,
    G: Fn(String) + Send + 'static,
{
    let settings_path = store.paths().settings_file();
    let config_dir = store.paths().config_dir.clone();

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        for path in &event.paths {
            let Ok(bytes) = std::fs::read(path) else {
                continue;
            };
            if !should_reload(
                path,
                &settings_path,
                &bytes,
                store.last_written_bytes().as_deref(),
            ) {
                continue;
            }
            // Blocking the notify thread for the settle is deliberate: it
            // only happens on the failure path, and the editor's real write
            // arrives as its own event immediately afterwards.
            let reaction = react(&bytes, || {
                std::thread::sleep(SETTLE);
                std::fs::read(path).ok()
            });
            match reaction {
                Reaction::Reload(settings) => {
                    tracing::info!("settings changed on disk; reloading");
                    store.adopt((*settings).clone(), bytes.clone());
                    on_change(*settings);
                }
                Reaction::Invalid { detail } => {
                    tracing::warn!(%detail, "a hand edit to settings.json could not be read");
                    on_invalid(detail);
                }
                Reaction::Ignore => {
                    tracing::debug!("ignoring an unparseable intermediate write");
                }
            }
        }
    })?;

    watcher.configure(notify::Config::default().with_poll_interval(Duration::from_millis(300)))?;
    watcher.watch(&config_dir, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    const SETTINGS: &str = "/cfg/settings.json";

    /// Valid JSON whose `confirmOnQuit` is a string. The file is finished —
    /// nothing more is coming — and it is still wrong.
    const FINISHED_AND_WRONG: &[u8] = br#"{"version":1,"general":{"confirmOnQuit":"true"}}"#;

    #[test]
    fn an_invalid_hand_edit_is_reported_rather_than_ignored() {
        let reaction = react(FINISHED_AND_WRONG, || Some(FINISHED_AND_WRONG.to_vec()));
        let Reaction::Invalid { detail } = reaction else {
            panic!("expected the edit to be reported, got {reaction:?}");
        };
        assert!(
            detail.contains("general"),
            "the toast has to name what could not be read: {detail}"
        );
    }

    #[test]
    fn a_half_written_save_is_still_ignored() {
        // The editor truncated the file and has not finished writing it. By
        // the time the settle is over the real content has landed, so the
        // bytes differ and this event means nothing.
        let truncated = br#"{"version":1,"general":{"confir"#;
        let reaction = react(truncated, || Some(FINISHED_AND_WRONG.to_vec()));
        assert!(
            matches!(reaction, Reaction::Ignore),
            "got {reaction:?}; an editor mid-save must stay silent"
        );
    }

    #[test]
    fn a_finished_edit_that_is_not_json_at_all_is_reported_too() {
        let broken = b"{ this is not json";
        let reaction = react(broken, || Some(broken.to_vec()));
        assert!(
            matches!(reaction, Reaction::Invalid { .. }),
            "got {reaction:?}"
        );
    }

    #[test]
    fn a_readable_edit_is_adopted() {
        let reaction = react(br#"{"version":1,"appearance":{"theme":"light"}}"#, || {
            panic!("a readable file must not be re-read")
        });
        let Reaction::Reload(settings) = reaction else {
            panic!("expected a reload, got {reaction:?}");
        };
        assert_eq!(
            settings.appearance.theme,
            crate::settings::model::Theme::Light
        );
    }

    #[test]
    fn a_hand_edit_that_lowers_the_version_is_migrated_rather_than_read_raw() {
        static STEPS: &[MigrationStep] = &[MigrationStep {
            from: 0,
            to: 1,
            apply: |document| {
                document["appearance"] = serde_json::json!({ "theme": "light" });
            },
        }];
        let reaction = react_with(br#"{"version":0}"#, STEPS, || None);
        let Reaction::Reload(settings) = reaction else {
            panic!("expected a reload, got {reaction:?}");
        };
        assert_eq!(
            settings.appearance.theme,
            crate::settings::model::Theme::Light,
            "the step must run before the document is read"
        );
        assert_eq!(settings.version, 1);
    }

    #[test]
    fn reloads_on_a_genuine_external_edit() {
        assert!(should_reload(
            Path::new(SETTINGS),
            Path::new(SETTINGS),
            b"{\"version\":1}",
            Some(b"{\"version\":1,\"old\":true}"),
        ));
    }

    #[test]
    fn ignores_our_own_write() {
        let ours = b"{\"version\":1}";
        assert!(!should_reload(
            Path::new(SETTINGS),
            Path::new(SETTINGS),
            ours,
            Some(ours)
        ));
    }

    #[test]
    fn ignores_the_schema_file_regenerated_on_every_launch() {
        assert!(!should_reload(
            Path::new("/cfg/settings.schema.json"),
            Path::new(SETTINGS),
            b"{}",
            None,
        ));
    }

    #[test]
    fn ignores_quarantined_files_left_beside_the_real_one() {
        assert!(!should_reload(
            Path::new("/cfg/settings.json.corrupt-2026-08-28T10-00-00Z"),
            Path::new(SETTINGS),
            b"{}",
            None,
        ));
    }

    #[test]
    fn reloads_when_we_have_never_written_anything() {
        assert!(should_reload(
            Path::new(SETTINGS),
            Path::new(SETTINGS),
            b"{}",
            None
        ));
    }
}

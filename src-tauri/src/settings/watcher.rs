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

use crate::settings::model::Settings;
use crate::settings::store::SettingsStore;

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
/// settings. The returned watcher must be kept alive; dropping it stops
/// watching.
pub fn spawn<F>(store: Arc<SettingsStore>, on_change: F) -> notify::Result<RecommendedWatcher>
where
    F: Fn(Settings) + Send + 'static,
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
            match serde_json::from_slice::<Settings>(&bytes) {
                Ok(settings) => {
                    tracing::info!("settings changed on disk; reloading");
                    store.adopt(settings.clone(), bytes.clone());
                    on_change(settings);
                }
                Err(err) => {
                    // A half-written file during an editor save is normal.
                    // Ignore it; the editor's final write will land shortly.
                    tracing::debug!(%err, "ignoring an unparseable intermediate write");
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

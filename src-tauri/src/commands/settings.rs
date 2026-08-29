//! Settings commands.
//!
//! Neither import nor export accepts a path from the frontend. The native
//! picker is opened here, in Rust, so no filesystem path is ever chosen by,
//! passed through, or visible to the webview — the same rule `open_path`
//! follows. This is also why the webview needs no `dialog` capability.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tauri_plugin_dialog::DialogExt;

use crate::error::{RiffError, RiffResult};
use crate::settings::model::Settings;
use crate::settings::store::{FlushScheduler, Section, SettingsStore};

#[tauri::command]
pub fn settings_get(store: tauri::State<'_, Arc<SettingsStore>>) -> Settings {
    store.get()
}

/// A VALIDATION failure returns `Err` — nothing was applied, so the caller
/// should roll back. A WRITE failure does not: the value is applied in memory
/// and the interface must keep showing it, or the interface is lying about
/// what the user chose. The write failure is reported out-of-band so a toast
/// can explain it while the setting stays applied and retries on next change.
#[tauri::command]
pub fn settings_patch(
    patch: Value,
    store: tauri::State<'_, Arc<SettingsStore>>,
    scheduler: tauri::State<'_, Arc<FlushScheduler>>,
) -> RiffResult<Settings> {
    let next = store.patch(&patch)?;
    schedule_write(&scheduler);
    Ok(next)
}

#[tauri::command]
pub fn settings_reset(
    section: Option<Section>,
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<SettingsStore>>,
    scheduler: tauri::State<'_, Arc<FlushScheduler>>,
) -> RiffResult<Settings> {
    let next = store.reset(section)?;
    schedule_write(&scheduler);
    // The reset emptied `practice.poppedOut`; the windows have to follow it.
    // Leaving three of them open over a file that says none are out is a
    // reset that lied about what it did.
    if let Err(err) = crate::practice::sync_windows(&app) {
        tracing::error!(%err, "panes could not be docked back after a reset");
    }
    Ok(next)
}

/// Schedules a write instead of performing one. Flushing synchronously here
/// would defeat the coalescing in Plan 03 Task 8 entirely — a UI-scale drag
/// is forty patches, and forty `fsync`ed atomic writes is not what §4.4
/// describes. The scheduler reports its own failures, once per cause.
fn schedule_write(scheduler: &FlushScheduler) {
    scheduler.notify();
}

#[tauri::command]
pub async fn settings_export(
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<SettingsStore>>,
) -> RiffResult<Option<PathBuf>> {
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name("riff-settings.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    export_to(&store, &target)?;
    Ok(Some(target))
}

#[tauri::command]
pub async fn settings_import(
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<SettingsStore>>,
) -> RiffResult<Option<Settings>> {
    let Some(source) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    Ok(Some(import_from(&store, &source)?))
}

pub fn export_to(store: &SettingsStore, target: &Path) -> RiffResult<()> {
    let bytes = serde_json::to_vec_pretty(&store.get()).map_err(|e| RiffError::Validation {
        field: "settings".to_owned(),
        reason: e.to_string(),
    })?;
    crate::storage::atomic::write_atomic(target, &bytes).map_err(|e| RiffError::io(target, &e))
}

pub fn import_from(store: &SettingsStore, source: &Path) -> RiffResult<Settings> {
    let bytes = std::fs::read(source).map_err(|e| RiffError::io(source, &e))?;
    let mut document: Value =
        serde_json::from_slice(&bytes).map_err(|e| RiffError::parse(source, &e))?;

    crate::settings::migrate::run(&mut document);

    // Neither of these is a preference, and neither is importable.
    // Onboarding: someone else's exported settings must not drop this user
    // back into a first-run wizard. Practice: which panes were in their own
    // windows is a fact about one machine's monitors, which is the entire
    // premise of the feature — carrying it across is carrying the wrong half.
    if let Some(object) = document.as_object_mut() {
        object.remove("onboarding");
        object.remove("practice");
    }

    let next = store.patch(&document)?;
    if let Err(err) = store.flush_if_dirty() {
        tracing::error!(%err, "imported settings could not be written");
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> (std::sync::Arc<SettingsStore>, tempfile::TempDir) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let paths = crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.path().join("config")),
                data: Some(tmp.path().join("data")),
            },
        )
        .expect("roots");
        crate::paths::ensure_dirs(&paths).expect("dirs");
        let (s, _) = SettingsStore::load(paths);
        (std::sync::Arc::new(s), tmp)
    }

    #[test]
    fn import_from_a_path_keeps_existing_onboarding_completion() {
        let (s, tmp) = store();
        s.patch(&json!({ "onboarding": { "completedAt": "2026-08-28T10:00:00Z" } }))
            .expect("patch");

        let incoming = tmp.path().join("exported.json");
        std::fs::write(
            &incoming,
            br#"{"version":1,"appearance":{"theme":"light"}}"#,
        )
        .expect("write");

        let result = import_from(&s, &incoming).expect("import");
        assert_eq!(
            result.appearance.theme,
            crate::settings::model::Theme::Light
        );
        assert_eq!(
            result.onboarding.completed_at.as_deref(),
            Some("2026-08-28T10:00:00Z"),
            "importing preferences must not restart first run"
        );
    }

    #[test]
    fn import_does_not_carry_someone_elses_popped_out_panes() {
        // Which panes were in their own windows describes one machine's
        // monitors. Importing it would open windows this machine has nowhere
        // to put, and silently move panes the user never touched.
        let (s, tmp) = store();
        let incoming = tmp.path().join("exported.json");
        std::fs::write(
            &incoming,
            br#"{"version":1,"practice":{"poppedOut":["score","video"]}}"#,
        )
        .expect("write");

        let result = import_from(&s, &incoming).expect("import");
        assert!(result.practice.popped_out.is_empty());
    }

    #[test]
    fn import_rejects_a_malformed_file_without_changing_anything() {
        let (s, tmp) = store();
        let before = s.get();
        let bad = tmp.path().join("bad.json");
        std::fs::write(&bad, b"not json at all").expect("write");

        let err = import_from(&s, &bad).expect_err("must reject");
        assert!(matches!(err, RiffError::Parse { .. }));
        assert_eq!(
            s.get(),
            before,
            "a rejected import must leave state untouched"
        );
    }

    #[test]
    fn export_writes_the_current_document() {
        let (s, tmp) = store();
        s.patch(&json!({ "appearance": { "density": "compact" } }))
            .expect("patch");
        let target = tmp.path().join("out.json");
        export_to(&s, &target).expect("export");

        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&target).expect("read")).expect("json");
        assert_eq!(written["appearance"]["density"], "compact");
    }
}

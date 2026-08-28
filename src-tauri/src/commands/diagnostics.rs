//! Export, from the GUI. Opens the save dialog in Rust and writes the same
//! bundle `riff logs export` writes — one format, one code path.

use tauri_plugin_dialog::DialogExt;

use crate::error::{RiffError, RiffResult};

#[tauri::command]
pub async fn diagnostics_export(
    app: tauri::AppHandle,
    store: tauri::State<'_, std::sync::Arc<crate::settings::store::SettingsStore>>,
) -> RiffResult<Option<std::path::PathBuf>> {
    let stamp = crate::logging::now_stamp();
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(format!("riff-diagnostics-{stamp}.txt"))
        .add_filter("Text", &["txt"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };

    let text = crate::diagnostics::current_bundle(store.paths());
    std::fs::write(&target, text).map_err(|e| RiffError::io(&target, &e))?;
    Ok(Some(target))
}

/// Mirrors `src/lib/ipc/types.ts`'s `LogLevel`. Lowercase, not kebab-case:
/// every variant here is already one word, so the two forms coincide, but
/// lowercase is what the constant is named for.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

/// The frontend's only way onto disk. Without this, a React crash before any
/// Rust command runs leaves no trace anywhere a bug report can find.
#[tauri::command]
pub fn log_write(level: LogLevel, message: String, context: Option<serde_json::Value>) {
    match level {
        LogLevel::Error => tracing::error!(target: "frontend", ?context, "{message}"),
        LogLevel::Warn => tracing::warn!(target: "frontend", ?context, "{message}"),
        LogLevel::Info => tracing::info!(target: "frontend", ?context, "{message}"),
        LogLevel::Debug => tracing::debug!(target: "frontend", ?context, "{message}"),
        LogLevel::Trace => tracing::trace!(target: "frontend", ?context, "{message}"),
    }
}

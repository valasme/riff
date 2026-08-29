//! Pop-out window commands.
//!
//! The pane is an enum, exactly as `PathKind` and `ExternalLink` are: no
//! label, no URL and no path crosses from the webview, so a compromised
//! frontend cannot ask for a window onto something Riff did not build.
//!
//! Every one of these returns the whole set rather than an acknowledgement.
//! The caller is mirroring state it does not own, and a reply saying only
//! "done" would leave it guessing at what became of the other two panes.

use std::sync::Arc;

use crate::error::RiffResult;
use crate::practice;
use crate::settings::model::Pane;
use crate::settings::store::SettingsStore;

#[tauri::command]
pub fn practice_state(store: tauri::State<'_, Arc<SettingsStore>>) -> Vec<Pane> {
    practice::popped_out(&store)
}

#[tauri::command]
pub fn practice_pop_out(pane: Pane, app: tauri::AppHandle) -> RiffResult<Vec<Pane>> {
    practice::pop_out(&app, pane)
}

#[tauri::command]
pub fn practice_dock_back(pane: Pane, app: tauri::AppHandle) -> RiffResult<Vec<Pane>> {
    practice::dock_back(&app, pane)
}

#[tauri::command]
pub fn practice_dock_all(app: tauri::AppHandle) -> RiffResult<Vec<Pane>> {
    practice::dock_all(&app)
}

#[tauri::command]
pub fn practice_focus(pane: Pane, app: tauri::AppHandle) -> RiffResult<()> {
    practice::focus(&app, pane)
}

/// What the last session left in its own windows. Already cleared from the
/// file by the time anything can call this, so the answer is an offer rather
/// than a promise.
#[tauri::command]
pub fn practice_pending_reopen(pending: tauri::State<'_, practice::PendingReopen>) -> Vec<Pane> {
    pending.0.clone()
}

#[tauri::command]
pub fn practice_reopen(app: tauri::AppHandle) -> RiffResult<Vec<Pane>> {
    practice::reopen(&app)
}

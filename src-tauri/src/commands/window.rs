//! Custom title bar controls.

use crate::error::{RiffError, RiffResult};

fn denied(e: tauri::Error) -> RiffError {
    RiffError::Denied {
        what: e.to_string(),
    }
}

#[tauri::command]
pub fn window_minimize(window: tauri::WebviewWindow) -> RiffResult<()> {
    window.minimize().map_err(denied)
}

#[tauri::command]
pub fn window_toggle_maximize(window: tauri::WebviewWindow) -> RiffResult<()> {
    if window.is_maximized().map_err(denied)? {
        window.unmaximize().map_err(denied)
    } else {
        window.maximize().map_err(denied)
    }
}

#[tauri::command]
pub fn window_close(window: tauri::WebviewWindow) -> RiffResult<()> {
    window.close().map_err(denied)
}

/// Completes a quit the user confirmed. `window_close` fires the
/// `CloseRequested` handler, which asks again when `confirmOnQuit` is set;
/// this bypasses that once.
#[tauri::command]
pub fn window_quit_confirmed(window: tauri::WebviewWindow) -> RiffResult<()> {
    use tauri::Manager;
    window
        .state::<crate::QuitApproved>()
        .0
        .store(true, std::sync::atomic::Ordering::SeqCst);
    window.close().map_err(denied)
}

/// Returns the decoration state the window ACTUALLY has afterwards.
///
/// Under Wayland the compositor owns decorations and may ignore the request
/// outright — Hyprland does. The caller compares the returned value with what
/// it asked for and reverts its own setting if they differ, rather than
/// leaving the user with no title bar at all and a switch claiming otherwise.
#[tauri::command]
pub fn window_set_decorations(enabled: bool, window: tauri::WebviewWindow) -> RiffResult<bool> {
    window.set_decorations(enabled).map_err(denied)?;
    window.is_decorated().map_err(denied)
}

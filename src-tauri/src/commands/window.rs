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

#[tauri::command]
pub fn window_start_dragging(window: tauri::WebviewWindow) -> RiffResult<()> {
    window.start_dragging().map_err(denied)
}

/// Completes a quit the user confirmed. `window_close` fires the
/// `CloseRequested` handler, which asks again when `confirmOnQuit` is set;
/// this bypasses that once.
///
/// It closes MAIN, not the calling window. From main those are the same
/// thing; from a pop-out they are not, and "Quit Riff" chosen in a pop-out
/// that merely docked its own pane back would be a mislabelled action —
/// which is the whole reason that dialog exists.
#[tauri::command]
pub fn window_quit_confirmed(window: tauri::WebviewWindow) -> RiffResult<()> {
    use tauri::Manager;
    window
        .state::<crate::QuitApproved>()
        .0
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let target = window
        .get_webview_window(crate::practice::MAIN)
        .unwrap_or(window);
    target.close().map_err(denied)
}

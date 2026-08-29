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

/// Returns the decoration state the window ACTUALLY has afterwards.
///
/// Under Wayland the compositor owns decorations and may ignore the request
/// outright — Hyprland does. The caller compares the returned value with what
/// it asked for and reverts its own setting if they differ, rather than
/// leaving the user with no title bar at all and a switch claiming otherwise.
///
/// Applied to EVERY window, not only the caller. The title bar style is an
/// application preference, and a pop-out left with Riff's own bar while main
/// wears the system's is one window disagreeing with the setting that
/// produced it. `settings://changed` cannot carry this: it fires only for
/// external edits to the file, not for a patch from the settings screen.
#[tauri::command]
pub fn window_set_decorations(enabled: bool, window: tauri::WebviewWindow) -> RiffResult<bool> {
    use tauri::Manager;
    for other in window.webview_windows().values() {
        if other.label() != window.label() {
            let _ = other.set_decorations(enabled);
        }
    }
    window.set_decorations(enabled).map_err(denied)?;
    window.is_decorated().map_err(denied)
}

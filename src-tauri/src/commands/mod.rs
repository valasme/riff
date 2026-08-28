pub mod app;
pub mod diagnostics;
pub mod settings;
pub mod window;

/// Every command Riff exposes. Adding one here is the only way it becomes
/// callable, which makes this list the audit surface.
#[macro_export]
macro_rules! riff_handlers {
    () => {
        tauri::generate_handler![
            $crate::commands::app::app_info,
            $crate::commands::app::app_ready,
            $crate::commands::app::open_external,
            $crate::commands::app::open_path,
            $crate::commands::app::paths_get,
            $crate::commands::diagnostics::diagnostics_export,
            $crate::commands::diagnostics::log_write,
            $crate::commands::settings::settings_export,
            $crate::commands::settings::settings_get,
            $crate::commands::settings::settings_import,
            $crate::commands::settings::settings_patch,
            $crate::commands::settings::settings_reset,
            $crate::commands::window::window_close,
            $crate::commands::window::window_quit_confirmed,
            $crate::commands::window::window_minimize,
            $crate::commands::window::window_set_decorations,
            $crate::commands::window::window_toggle_maximize,
        ]
    };
}

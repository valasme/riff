pub mod commands;
pub mod error;
pub mod logging;
pub mod paths;
pub mod settings;
pub mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("tauri failed to start");
}

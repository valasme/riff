pub mod bootstrap;
pub mod commands;
pub mod diagnostics;
pub mod error;
pub mod logging;
pub mod paths;
pub mod settings;
pub mod storage;

use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use crate::settings::store::{LoadOutcome, SettingsStore};

/// How long to wait for the frontend to signal readiness before showing the
/// window regardless. Without this, a crash in React before its first effect
/// leaves the user staring at nothing, with no window to read the error in.
const REVEAL_WATCHDOG: Duration = Duration::from_secs(3);

/// Set once the user has confirmed quitting, so the second close attempt
/// passes straight through instead of asking again forever.
pub struct QuitApproved(pub std::sync::atomic::AtomicBool);

/// Set once during `setup`, so the panic notifier can reach a window without
/// threading a handle through the panic hook.
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Fails loudly. `eprintln!` alone is invisible when Riff is launched from a
/// desktop entry, which is how almost everyone launches it — the application
/// would simply never appear, with no way to find out why. `rfd` is already
/// in the tree as `tauri-plugin-dialog`'s own backend, and it needs no Tauri
/// application, which is the point: this runs before one exists.
fn fatal(message: &str) -> ! {
    eprintln!("riff: {message}");
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Riff cannot start")
        .set_description(message)
        .show();
    std::process::exit(1);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Paths, before anything can need them.
    let paths = match paths::resolve(
        &paths::XdgRoots::from_system(),
        &paths::PathOverrides::from_env(),
    ) {
        Ok(paths) => paths,
        Err(err) => {
            fatal(&err.to_string());
        }
    };
    if let Err(err) = paths::ensure_dirs(&paths) {
        fatal(&format!("cannot create data directories: {err}"));
    }

    // 2. Logging, so a startup failure still leaves a trail. One directory
    //    per launch; `latest` points at it.
    let boot = std::time::Instant::now();
    let session = logging::start_session(&paths, "info");
    logging::install_panic_hook(&session.dir);
    tracing::info!(
        phase = "paths",
        elapsed_ms = boot.elapsed().as_millis() as u64,
        "boot"
    );
    // The best-effort notification Plan 02 deferred to here. Non-blocking on
    // purpose: a blocking dialog raised from a panic on the GTK main thread
    // can deadlock, turning a crash report into a hang. The hook already
    // logged unconditionally; this is a courtesy on top.
    logging::set_panic_notifier(|message| {
        use tauri_plugin_dialog::DialogExt;
        if let Some(app) = APP_HANDLE.get() {
            app.dialog()
                .message(message)
                .title("Riff crashed")
                .show(|_| {});
        }
    });

    // 3. Settings, BEFORE the Tauri builder exists — the bootstrap script
    //    needs them as a string at plugin-registration time.
    let (store, outcome) = SettingsStore::load(paths.clone());
    match &outcome {
        LoadOutcome::Fresh => tracing::info!("no settings file; starting from defaults"),
        LoadOutcome::Loaded => tracing::info!("settings loaded"),
        LoadOutcome::Migrated { from } => tracing::info!(from, "settings migrated"),
        LoadOutcome::Recovered {
            quarantined: Some(path),
        } => {
            tracing::error!(path = %path.display(), "settings recovered from a corrupt file");
        }
        LoadOutcome::Recovered { quarantined: None } => {
            tracing::error!(
                "settings file is corrupt and could not be quarantined; refusing to write"
            );
        }
    }
    let store = Arc::new(store);
    if let Err(err) = store.flush_if_dirty() {
        tracing::error!(%err, "could not write initial settings");
    }
    if let Err(err) = settings::schema::write(&paths) {
        tracing::warn!(%err, "could not write settings.schema.json");
    }

    tracing::info!(
        phase = "settings",
        elapsed_ms = boot.elapsed().as_millis() as u64,
        "boot"
    );

    let payload = bootstrap::Bootstrap {
        settings: store.get(),
        paths: paths.clone(),
        app_info: commands::app::app_info(),
        recovered_from: match &outcome {
            LoadOutcome::Recovered { quarantined } => quarantined.clone(),
            _ => None,
        },
    };

    let mut builder = tauri::Builder::default()
        // single-instance must be registered first, per its documentation.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(bootstrap::init(&payload))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // The setting decides whether geometry is remembered at all. Registering
    // the plugin unconditionally would leave `restoreWindowState` as a switch
    // that persists perfectly and changes nothing.
    if store.get().general.restore_window_state {
        use tauri_plugin_window_state::StateFlags;
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                // NOT StateFlags::all(), which is the default. `all()` includes
                // VISIBLE and DECORATIONS: on restore the plugin would call
                // show() before React has painted, reintroducing the flash of
                // unthemed content §3.1 exists to make impossible — on every
                // launch after the first — and would make the state file a
                // second owner of `appearance.titleBar`.
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        );
    }

    // 250 ms of quiet before a write, so a slider drag is one fsync (§4.4).
    // Failures are reported once per cause, not once per keystroke.
    let scheduler = Arc::new(settings::store::FlushScheduler::spawn(
        Arc::clone(&store),
        Duration::from_millis(250),
        |err| {
            use tauri::Emitter;
            tracing::error!(%err, "settings could not be written");
            // APP_HANDLE is set in `setup`; a failure before then is still
            // logged, which is the part that must never be lost.
            if let Some(app) = APP_HANDLE.get() {
                let _ = app.emit("settings://write-failed", &err);
            }
        },
    ));

    builder
        .manage(Arc::clone(&store))
        .manage(Arc::clone(&scheduler))
        .manage(QuitApproved(std::sync::atomic::AtomicBool::new(false)))
        // Honours `confirmOnQuit`. Without this the setting is decorative.
        .on_window_event({
            let store = Arc::clone(&store);
            move |window, event| {
                let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                    return;
                };
                if !store.get().general.confirm_on_quit {
                    return;
                }
                if window
                    .state::<QuitApproved>()
                    .0
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    return;
                }
                api.prevent_close();
                use tauri::Emitter;
                let _ = window.emit("app://confirm-quit", ());
            }
        })
        .setup({
            let store = Arc::clone(&store);
            move |app| {
                let handle = app.handle().clone();
                let watcher = settings::watcher::spawn(Arc::clone(&store), move |settings| {
                    use tauri::Emitter;
                    let _ = handle.emit("settings://changed", settings);
                });
                match watcher {
                    // Held for the process lifetime; dropping it stops watching.
                    Ok(watcher) => {
                        app.manage(watcher);
                    }
                    Err(err) => tracing::warn!(%err, "external settings edits will not be noticed"),
                }

                let _ = APP_HANDLE.set(app.handle().clone());
                tracing::info!(
                    phase = "setup",
                    elapsed_ms = boot.elapsed().as_millis() as u64,
                    "boot"
                );

                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(REVEAL_WATCHDOG);
                    if let Some(window) = handle.get_webview_window("main") {
                        if !window.is_visible().unwrap_or(false) {
                            tracing::warn!("frontend never signalled readiness; revealing anyway");
                            let _ = window.show();
                        }
                    }
                });
                Ok(())
            }
        })
        .invoke_handler(riff_handlers!())
        .build(tauri::generate_context!())
        .expect("tauri failed to start")
        .run(move |_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Synchronous, not scheduled: waiting 250 ms to save on exit
                // is waiting 250 ms too long.
                if let Err(err) = store.flush_if_dirty() {
                    tracing::error!(%err, "settings could not be saved on exit");
                }
                // The last line of a healthy session. If it is absent, the
                // run crashed — which makes triage a single `tail -1`.
                tracing::info!("shutdown complete");
            }
        });
}

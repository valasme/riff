pub mod bootstrap;
pub mod cli;
pub mod commands;
pub mod diagnostics;
pub mod error;
pub mod instance;
pub mod logging;
pub mod paths;
pub mod practice;
pub mod settings;
pub mod storage;
pub mod workspace;

use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use crate::settings::model::Pane;
use crate::settings::store::{LoadOutcome, SettingsStore};

/// How long to wait for the frontend to signal readiness before showing the
/// window regardless. Without this, a crash in React before its first effect
/// leaves the user staring at nothing, with no window to read the error in.
const REVEAL_WATCHDOG: Duration = Duration::from_secs(3);

/// Set once the user has confirmed quitting, so the second close attempt
/// passes straight through instead of asking again forever.
pub struct QuitApproved(pub std::sync::atomic::AtomicBool);

/// Reveals a window whose frontend never signalled readiness.
///
/// One per window rather than one for `main`: a pop-out is created long after
/// startup and needs the same guarantee, and it is the window most likely to
/// be created while something else is already wrong.
pub fn spawn_reveal_watchdog(handle: tauri::AppHandle, label: String) {
    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_WATCHDOG);
        if let Some(window) = handle.get_webview_window(&label) {
            if !window.is_visible().unwrap_or(false) {
                tracing::warn!(
                    label,
                    "frontend never signalled readiness; revealing anyway"
                );
                // The last line of defence against an invisible application.
                // If even this fails there is no window to report it in, so
                // the log is the whole of it.
                if let Err(err) = window.show() {
                    tracing::error!(%err, label, "could not reveal the window");
                }
            }
        }
    });
}

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

/// Everything the boot sequence leaves on disk, and the instance name that
/// entitled this process to leave it.
///
/// Held together in one value because they share one lifetime: dropping the
/// session truncates the log, and dropping the instance hands Riff's name to
/// the next launch while this window is still on screen.
pub struct Boot {
    pub instance: instance::Instance,
    pub session: logging::Session,
    pub store: Arc<SettingsStore>,
    pub outcome: LoadOutcome,
    pub pending_reopen: Vec<Pane>,
    pub workspace: Arc<workspace::WorkspaceStore>,
    pub pending_score: Option<workspace::Score>,
}

/// Steps 2 to 4 of §3.1, behind the one question that decides whether any of
/// them may happen.
///
/// Extracted from `run` so that ordering is a test rather than a reading of
/// the source: `a_second_launch_leaves_the_popped_out_set_alone` calls this
/// twice against one scratch config, and moving anything below the gate above
/// it turns that test red. Every line here writes something a live Riff is
/// still using.
pub fn start(paths: &crate::paths::AppPaths) -> Result<Boot, instance::AlreadyRunning> {
    // 2. Am I the only Riff? Nothing below this line may run in a process
    //    that is about to exit — every one of those lines writes something
    //    the live instance is still using.
    let instance = instance::acquire(paths)?;

    // 3a. Logging, so a startup failure still leaves a trail. One directory
    //     per launch; `latest` points at it.
    let session = logging::start_session(paths, "info");
    logging::install_panic_hook(&session.dir);

    // 3b. Settings, BEFORE the Tauri builder exists — the bootstrap script
    //     needs them as a string at plugin-registration time.
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
    // Before the first flush, so the clear rides along with it: the panes the
    // last session left in their own windows are read out and removed from
    // the file, and the frontend is offered them once.
    let pending_reopen = practice::take_pending_reopen(&store);
    if let Err(err) = store.flush_if_dirty() {
        tracing::error!(%err, "could not write initial settings");
    }
    // Lets `riff repair`, run from another terminal, warn that it may race
    // with a session that is already live rather than fixing things blind.
    if let Err(err) = std::fs::write(cli::pid_file(paths), std::process::id().to_string()) {
        // Not fatal, but `riff repair` silently stops warning that it may be
        // racing a live session — which is exactly when it matters.
        tracing::warn!(%err, "could not write riff.pid");
    }
    if let Err(err) = settings::schema::write(paths) {
        tracing::warn!(%err, "could not write settings.schema.json");
    }

    // 3c. The workspace, on the same "read once, clear immediately" shape as
    // the popped-out set above. `workspace.json` is derived state with no
    // watcher and no quarantine — see ADR 0004 — so there is no outcome to
    // match on here the way settings has one.
    let workspace = workspace::WorkspaceStore::load(paths.clone());
    let pending_score = workspace::take_pending_reopen(&workspace);
    if let Err(err) = workspace.flush_if_dirty() {
        tracing::error!(%err, "could not write the initial workspace");
    }
    let workspace = Arc::new(workspace);

    Ok(Boot {
        instance,
        session,
        store,
        outcome,
        pending_reopen,
        workspace,
        pending_score,
    })
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
    let boot = std::time::Instant::now();

    // 2. The CLI, before anything else that could need a window. Argument
    //    parsing, health checks and repair need no GTK, no webview and no
    //    display, so `riff doctor` works over SSH on a machine whose window
    //    will not open. That is exactly when somebody runs it — and it is why
    //    the CLI runs before the single-instance gate below rather than after
    //    it: `riff --help` typed while Riff is open must print, not raise the
    //    window and exit. Given no subcommand, `dispatch` touches nothing and
    //    returns; given one, it exits. Either way nothing is written here by
    //    accident.
    let cli = <cli::Cli as clap::Parser>::parse();
    if let Some(code) = cli::dispatch(&cli, &paths) {
        std::process::exit(code);
    }

    // 3. Everything that touches disk, behind "am I the only Riff?" — see
    //    docs/adr/0002. A second launch used to clear `practice.poppedOut`
    //    and flush it (which closed the live instance's pop-out windows),
    //    take the `latest` symlink and overwrite `riff.pid`, all before
    //    discovering it was about to exit.
    let Ok(started) = start(&paths) else {
        // Riff is already open. Raise that window and go, having changed
        // nothing. This replaces tauri-plugin-single-instance, whose
        // equivalent branch ran from inside `.build()` — far too late.
        instance::request_focus(&paths);
        std::process::exit(0);
    };
    let Boot {
        instance,
        session: _session,
        store,
        outcome,
        pending_reopen,
        workspace,
        pending_score,
    } = started;
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

    tracing::info!(
        phase = "settings",
        elapsed_ms = boot.elapsed().as_millis() as u64,
        "boot"
    );

    let payload = bootstrap::Bootstrap {
        settings: store.get(),
        paths: paths.clone(),
        app_info: commands::app::app_info(),
        recovery: bootstrap::Recovery::of(&outcome, &paths),
    };

    let mut builder = tauri::Builder::default()
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
            //
            // `emit_to`, not `emit`, for the same reason `app://confirm-quit`
            // is targeted: `emit` broadcasts to every webview, so one failed
            // write raised three identical toasts with pop-outs open — and a
            // pop-out is one pane with no settings interface to explain it in.
            if let Some(app) = APP_HANDLE.get() {
                let _ = app.emit_to(practice::MAIN, "settings://write-failed", &err);
            }
        },
    ));

    // No `emit_to` on failure the way settings has one: losing "which page
    // you were on" is a much smaller thing to lose than a preference, and
    // there is no settings panel for workspace state to explain itself in.
    // The log line is what a bug report needs; a toast for this would be
    // noise for a value nobody remembers choosing.
    let workspace_scheduler = Arc::new(settings::store::FlushScheduler::spawn(
        Arc::clone(&workspace),
        Duration::from_millis(250),
        |err| tracing::error!(%err, "workspace could not be written"),
    ));

    builder
        .manage(Arc::clone(&store))
        .manage(Arc::clone(&scheduler))
        .manage(Arc::clone(&workspace))
        .manage(Arc::clone(&workspace_scheduler))
        .manage(workspace::PendingReopen(pending_score))
        .manage(QuitApproved(std::sync::atomic::AtomicBool::new(false)))
        .manage(practice::ShuttingDown(std::sync::atomic::AtomicBool::new(
            false,
        )))
        .manage(practice::PendingReopen(pending_reopen))
        // Honours `confirmOnQuit`. Without this the setting is decorative.
        .on_window_event({
            let store = Arc::clone(&store);
            move |window, event| {
                let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                    return;
                };
                let app = window.app_handle();

                // Every window raises this. A pop-out's `×` means "dock this
                // pane back", so it must reach neither the quit confirmation
                // — which would ask "Really quit?" over a dock-back — nor the
                // shutdown below.
                if !practice::quit_confirmation_applies_to(window.label()) {
                    practice::on_popout_closed(app, window.label());
                    return;
                }

                if store.get().general.confirm_on_quit
                    && !window
                        .state::<QuitApproved>()
                        .0
                        .load(std::sync::atomic::Ordering::SeqCst)
                {
                    use tauri::Emitter;
                    // `emit_to`, not `emit`. `emit` broadcasts to every
                    // webview, so with pop-outs open one quit would raise
                    // three modals — and two of them in windows that cannot
                    // quit anything.
                    //
                    // Asked *before* the close is prevented, and only
                    // prevented if the question got through. Preventing it
                    // regardless left a window that could not be closed at
                    // all whenever the emit failed: no dialog to answer, and
                    // the × doing nothing forever.
                    match window.emit_to(window.label(), "app://confirm-quit", ()) {
                        Ok(()) => {
                            api.prevent_close();
                            return;
                        }
                        Err(err) => tracing::error!(
                            %err,
                            "could not ask for quit confirmation; quitting rather than \
                             leaving a window that cannot be closed"
                        ),
                    }
                }

                // Main is going, so Riff is going. Left alone the pop-outs
                // would outlive the only window that can bring them back, and
                // the process would never exit because windows remain.
                practice::close_every_popout(app);
            }
        })
        .setup({
            let store = Arc::clone(&store);
            move |app| {
                let handle = app.handle().clone();
                let invalid_handle = app.handle().clone();
                let watcher = settings::watcher::spawn(
                    Arc::clone(&store),
                    move |settings| {
                        use tauri::Emitter;
                        if let Err(err) = handle.emit("settings://changed", settings) {
                            tracing::error!(%err, "could not announce a settings change; the \
                                                   interface will show stale values");
                        }
                        // A hand edit is as good a way to move a pane as the
                        // button is. Without this, editing `practice.poppedOut`
                        // in a text editor changes the file and nothing else,
                        // which makes the file a liar about the running windows.
                        if let Err(err) = practice::sync_windows(&handle) {
                            tracing::error!(%err, "could not follow a hand edit to the popped-out set");
                        }
                    },
                    move |detail| {
                        use tauri::Emitter;
                        // `emit_to`, not `emit`: a pop-out is one pane with no
                        // settings interface to explain a bad hand edit in.
                        let _ =
                            invalid_handle.emit_to(practice::MAIN, "settings://edit-invalid", detail);
                    },
                );
                match watcher {
                    // Held for the process lifetime; dropping it stops watching.
                    Ok(watcher) => {
                        app.manage(watcher);
                    }
                    Err(err) => tracing::warn!(%err, "external settings edits will not be noticed"),
                }

                // Further launches. `instance` is managed rather than dropped
                // here: the kernel holds Riff's name only for as long as the
                // listener lives, so dropping it at the end of `setup` would
                // hand the name to the next launch while this window is still
                // on screen.
                {
                    let handle = app.handle().clone();
                    instance.serve(move || {
                        if let Some(window) = handle.get_webview_window(practice::MAIN) {
                            let _ = window.unminimize();
                            if let Err(err) = window.set_focus() {
                                // The second launch has already exited. All
                                // the user sees is that nothing happened.
                                tracing::warn!(%err, "could not raise the window for a \
                                                      second launch");
                            }
                        }
                    });
                }
                app.manage(instance);

                let _ = APP_HANDLE.set(app.handle().clone());
                tracing::info!(
                    phase = "setup",
                    elapsed_ms = boot.elapsed().as_millis() as u64,
                    "boot"
                );

                spawn_reveal_watchdog(app.handle().clone(), practice::MAIN.to_owned());
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
                if let Err(err) = workspace.flush_if_dirty() {
                    tracing::error!(%err, "workspace could not be saved on exit");
                }
                if let Err(err) = std::fs::remove_file(cli::pid_file(store.paths())) {
                    // A pid file left behind makes `riff repair` warn about a
                    // process that is already gone.
                    tracing::warn!(%err, "could not remove riff.pid");
                }
                // The last line of a healthy session. If it is absent, the
                // run crashed — which makes triage a single `tail -1`.
                tracing::info!("shutdown complete");
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> (crate::paths::AppPaths, tempfile::TempDir) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let paths = crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.path().join("config")),
                data: Some(tmp.path().join("data")),
            },
        )
        .expect("overrides supply both roots");
        crate::paths::ensure_dirs(&paths).expect("dirs");
        (paths, tmp)
    }

    fn popped_out_on_disk(paths: &crate::paths::AppPaths) -> serde_json::Value {
        let bytes = std::fs::read(paths.settings_file()).expect("settings.json");
        let document: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
        document["practice"]["poppedOut"].clone()
    }

    #[test]
    fn a_second_launch_leaves_the_popped_out_set_alone() {
        // The live instance has two panes in windows of their own. A second
        // launch that reaches `take_pending_reopen` clears the set and
        // flushes it — and the live instance's watcher obeys the write, so
        // both windows close. The second process never even got a window.
        let _lock = logging::session_lock();
        let (paths, _tmp) = scratch();
        let live = start(&paths).expect("the first launch boots");
        live.store
            .patch(&serde_json::json!({ "practice": { "poppedOut": ["score", "video"] } }))
            .expect("pop two panes out");
        live.store.flush_if_dirty().expect("flush");

        assert!(start(&paths).is_err(), "the second launch must not boot");
        assert_eq!(
            popped_out_on_disk(&paths),
            serde_json::json!(["score", "video"]),
            "a doomed second process must not close the live one's windows"
        );
    }

    #[test]
    fn a_second_launch_does_not_move_the_latest_symlink() {
        let _lock = logging::session_lock();
        let (paths, _tmp) = scratch();
        let live = start(&paths).expect("the first launch boots");
        let latest = paths.log_dir.join("latest");
        let live_session = std::fs::read_link(&latest).expect("latest points at the live session");
        assert_eq!(live_session, live.session.dir);

        assert!(start(&paths).is_err());
        assert_eq!(
            std::fs::read_link(&latest).expect("latest"),
            live_session,
            "`tail -f .../logs/latest/riff.log` must follow the Riff that is on screen"
        );
    }

    #[test]
    fn a_second_launch_does_not_overwrite_the_pid_of_the_running_instance() {
        let _lock = logging::session_lock();
        let (paths, _tmp) = scratch();
        let _live = start(&paths).expect("the first launch boots");
        let pid_file = cli::pid_file(&paths);
        assert_eq!(
            std::fs::read_to_string(&pid_file).expect("riff.pid"),
            std::process::id().to_string()
        );

        // Both launches share this test process's pid, so the write has to be
        // made visible: take the file away and see whether the doomed launch
        // puts one back. In a real second process it puts back a pid that
        // dies seconds later, and `riff repair` believes it.
        std::fs::remove_file(&pid_file).expect("remove");
        assert!(start(&paths).is_err());
        assert!(
            !pid_file.exists(),
            "`riff repair` must warn about the Riff that is running, not a pid that died"
        );
    }

    #[test]
    fn a_second_launch_does_not_spend_one_of_the_ten_retained_log_sessions() {
        let _lock = logging::session_lock();
        let (paths, _tmp) = scratch();
        let _live = start(&paths).expect("the first launch boots");
        let sessions = || {
            std::fs::read_dir(&paths.log_dir)
                .expect("logs")
                .filter_map(Result::ok)
                .filter(|e| e.path().is_dir() && e.file_name() != "latest")
                .count()
        };
        let before = sessions();

        assert!(start(&paths).is_err());
        assert_eq!(
            sessions(),
            before,
            "a three-line log from a process that never reached setup must not \
             evict the session that explains the bug"
        );
    }
}

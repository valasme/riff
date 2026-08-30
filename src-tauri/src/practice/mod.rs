//! Which practice panes are in windows of their own, and the windows that
//! realise it.
//!
//! Rust owns this set. That is not symmetry with the settings store for its
//! own sake — it is forced: a compositor can destroy a pop-out window without
//! the webview ever hearing about it (`hyprctl dispatch killactive`, a window
//! rule, a session ending). Rust learns from `CloseRequested`; nothing in
//! JavaScript does. The webview mirrors the set through
//! `practice://panes-changed`, one way, alongside `settings://changed`.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{RiffError, RiffResult};
use crate::settings::model::{Pane, TitleBar};
use crate::settings::store::{FlushScheduler, SettingsStore};

/// The window that always exists, and the only one that can quit Riff.
pub const MAIN: &str = "main";

/// Matched by the `popout-*` glob in `capabilities/default.json`. Changing it
/// without changing that file leaves the new windows with no IPC at all.
const POPOUT_PREFIX: &str = "popout-";

pub const PANES_CHANGED: &str = "practice://panes-changed";

/// The panes that were in their own windows when Riff last exited, read once
/// at startup and then cleared from the file.
///
/// Clearing at launch rather than when the user answers is what makes the
/// offer happen exactly once: ignoring the prompt, or quitting before it is
/// answered, or crashing, all leave nothing behind to re-offer.
pub struct PendingReopen(pub Vec<Pane>);

/// Set while the main window is on its way out. Closing main closes the
/// pop-outs, and each of those raises `CloseRequested` — which is the same
/// path a dock-back takes, so without this flag shutting down would record
/// three dock-backs and write `poppedOut: []`, destroying the very state the
/// next launch is supposed to offer back.
pub struct ShuttingDown(pub AtomicBool);

impl Pane {
    pub fn slug(self) -> &'static str {
        match self {
            Self::Score => "score",
            Self::Video => "video",
            Self::Audio => "audio",
        }
    }

    pub fn window_label(self) -> String {
        format!("{POPOUT_PREFIX}{}", self.slug())
    }

    /// The OS window title, so three Riff windows are distinguishable in a
    /// task switcher and addressable by a compositor rule.
    ///
    /// English, in Rust, breaking the `t()` rule the frontend follows — and
    /// forced to: `core:window:default` grants `allow-title` but not
    /// `allow-set-title`, so translating this means widening the webview's
    /// permissions, which invariant 6 forbids. It also has to be right in the
    /// task switcher before React exists. `cli.rs` and `fatal()` already hold
    /// English for the same reason: i18n cannot reach them.
    pub fn window_title(self) -> &'static str {
        match self {
            Self::Score => "Riff — Score",
            Self::Video => "Riff — Video",
            Self::Audio => "Riff — Audio",
        }
    }
}

/// `Some` only for a pop-out window. `main` is not a pane.
pub fn pane_for_window(label: &str) -> Option<Pane> {
    let slug = label.strip_prefix(POPOUT_PREFIX)?;
    Pane::ALL.into_iter().find(|p| p.slug() == slug)
}

/// The quit confirmation belongs to `main` alone. The `on_window_event`
/// handler fires for every window, so without this a pop-out's `×` — which
/// means "dock this pane back" — would raise "Really quit?".
pub fn quit_confirmation_applies_to(label: &str) -> bool {
    label == MAIN
}

pub fn popped_out(store: &SettingsStore) -> Vec<Pane> {
    store.get().practice.popped_out
}

/// Writes the set through the ordinary settings path, so it is coalesced by
/// the same 250 ms scheduler as everything else and flushed on exit.
fn record(
    store: &SettingsStore,
    scheduler: &FlushScheduler,
    panes: Vec<Pane>,
) -> RiffResult<Vec<Pane>> {
    let next = store.patch(&serde_json::json!({ "practice": { "poppedOut": panes } }))?;
    scheduler.notify();
    Ok(next.practice.popped_out)
}

/// Reads the set the last session left behind and clears it from the file in
/// the same breath.
///
/// Clearing here rather than when the prompt is answered is what makes the
/// offer happen exactly once: ignoring it, quitting before answering, or
/// crashing all leave nothing to re-offer. A prompt that returns every launch
/// until obeyed is a prompt that should have been a setting.
pub fn take_pending_reopen(store: &SettingsStore) -> Vec<Pane> {
    let pending = popped_out(store);
    if !pending.is_empty() {
        if let Err(err) = store.patch(&serde_json::json!({ "practice": { "poppedOut": [] } })) {
            tracing::error!(%err, "could not clear the popped-out set");
        }
    }
    pending
}

/// Canonical order, not insertion order: the chip strip reads left to right
/// in the same order the grid does, and a stable order means popping the same
/// two panes in either sequence produces one identical file rather than two.
pub fn record_popped_out(
    store: &SettingsStore,
    scheduler: &FlushScheduler,
    pane: Pane,
) -> RiffResult<Vec<Pane>> {
    let current = popped_out(store);
    if current.contains(&pane) {
        return Ok(current);
    }
    let next = Pane::ALL
        .into_iter()
        .filter(|p| *p == pane || current.contains(p))
        .collect();
    record(store, scheduler, next)
}

pub fn record_docked_back(
    store: &SettingsStore,
    scheduler: &FlushScheduler,
    pane: Pane,
) -> RiffResult<Vec<Pane>> {
    let current = popped_out(store);
    if !current.contains(&pane) {
        return Ok(current);
    }
    let next = current.into_iter().filter(|p| *p != pane).collect();
    record(store, scheduler, next)
}

/// Opens the window for a pane, hidden, and repeats §3.1's reveal dance in
/// full: created `visible: false`, revealed by its own `app_ready()`, forced
/// visible by its own watchdog. A pop-out created visible would show one
/// frame of unthemed white — the exact thing §3.1 exists to make impossible —
/// and one whose React throws must still produce a window to read the error
/// in.
fn open_window(app: &AppHandle, pane: Pane) -> RiffResult<()> {
    let decorated = matches!(
        app.state::<std::sync::Arc<SettingsStore>>()
            .get()
            .appearance
            .title_bar,
        TitleBar::System
    );

    // The hash is deliberate. Riff routes on hash history because the asset
    // protocol serves no SPA fallback, so this is the same URL the main
    // window would navigate to — `Url::join` keeps the fragment intact.
    let url = WebviewUrl::App(format!("index.html#/popout/{}", pane.slug()).into());

    WebviewWindowBuilder::new(app, pane.window_label(), url)
        .title(pane.window_title())
        .inner_size(720.0, 800.0)
        .min_inner_size(360.0, 320.0)
        .decorations(decorated)
        .visible(false)
        .background_color(tauri::webview::Color(0x24, 0x24, 0x24, 0xff))
        .build()
        .map_err(|e| RiffError::Denied {
            what: e.to_string(),
        })?;

    crate::spawn_reveal_watchdog(app.clone(), pane.window_label());
    Ok(())
}

/// Tells every window the set changed. One way, Rust → webview.
fn broadcast(app: &AppHandle, panes: &[Pane]) {
    if let Err(err) = app.emit(PANES_CHANGED, panes) {
        tracing::warn!(%err, "could not announce the popped-out set");
    }
}

fn store_of(app: &AppHandle) -> std::sync::Arc<SettingsStore> {
    std::sync::Arc::clone(&app.state::<std::sync::Arc<SettingsStore>>())
}

fn scheduler_of(app: &AppHandle) -> std::sync::Arc<FlushScheduler> {
    std::sync::Arc::clone(&app.state::<std::sync::Arc<FlushScheduler>>())
}

/// Makes the windows match the set, in both directions.
///
/// One function rather than an open path and a close path, because three
/// different callers need reconciliation rather than an instruction:
/// `settings_reset` empties the set and only then asks for the windows to
/// follow, an import replaces the whole document, and a hand edit to
/// `settings.json` arrives through the watcher with no idea what changed.
///
/// Building a window here is safe from any thread on Linux. The deadlock
/// Tauri documents for synchronous commands and event handlers is a WebView2
/// issue, and Riff does not run on Windows.
pub fn sync_windows(app: &AppHandle) -> RiffResult<Vec<Pane>> {
    let wanted = popped_out(&store_of(app));
    let (actual, failures) = reconcile(
        &wanted,
        |pane| app.get_webview_window(&pane.window_label()).is_some(),
        |pane| open_window(app, pane),
        |pane| match app.get_webview_window(&pane.window_label()) {
            None => Ok(()),
            Some(window) => window.close().map_err(|e| RiffError::Denied {
                what: e.to_string(),
            }),
        },
    );

    // Written back before the broadcast, so the file, the compositor and the
    // frontend all describe the same three panes. `pop_out` records the set
    // *before* reconciling, so without this a failed window build left the
    // file claiming a pane was out, no window, the grid still showing it
    // docked, and the next launch offering to reopen a pane that never left.
    if actual != wanted {
        record(&store_of(app), &scheduler_of(app), actual.clone())?;
    }
    broadcast(app, &actual);

    if failures.is_empty() {
        Ok(actual)
    } else {
        Err(RiffError::Denied {
            what: failures.join("; "),
        })
    }
}

/// Decides and performs the whole reconciliation, and reports what actually
/// happened rather than stopping at the first thing that did not.
///
/// Split out from `sync_windows` because deciding is pure and acting needs a
/// compositor: this is the half worth testing, and the half that used to be
/// wrong. Returns the set that exists afterwards — a pane whose window could
/// not be built comes out of it, a pane whose window refused to close goes
/// back into it — alongside every failure, so the caller can report them all
/// and still leave the world consistent.
fn reconcile(
    wanted: &[Pane],
    is_open: impl Fn(Pane) -> bool,
    open: impl Fn(Pane) -> RiffResult<()>,
    close: impl Fn(Pane) -> RiffResult<()>,
) -> (Vec<Pane>, Vec<String>) {
    let mut actual = Vec::new();
    let mut failures = Vec::new();

    for pane in Pane::ALL {
        let out = match (wanted.contains(&pane), is_open(pane)) {
            (true, false) => match open(pane) {
                Ok(()) => true,
                Err(err) => {
                    failures.push(format!("{}: {err}", pane.slug()));
                    false
                }
            },
            (false, true) => match close(pane) {
                Ok(()) => false,
                Err(err) => {
                    failures.push(format!("{}: {err}", pane.slug()));
                    // Still on screen, so still out. Recording it as docked
                    // would hide a window the user can see from the chip
                    // strip, which is the only way back to one that has
                    // drifted behind another application.
                    true
                }
            },
            (already, _) => already,
        };
        if out {
            actual.push(pane);
        }
    }

    (actual, failures)
}

pub fn pop_out(app: &AppHandle, pane: Pane) -> RiffResult<Vec<Pane>> {
    record_popped_out(&store_of(app), &scheduler_of(app), pane)?;
    let panes = sync_windows(app)?;
    // Already out and merely asked for again: the palette command and the
    // pane button both mean "put this pane in front of me". Not fatal — the
    // pane *is* out — but pressing "pop out" and seeing nothing come forward
    // is worth a line in the log.
    if let Err(err) = focus(app, pane) {
        tracing::warn!(%err, pane = pane.slug(), "could not raise the pane window");
    }
    Ok(panes)
}

/// Records first, then closes. The window's `CloseRequested` will record the
/// same dock-back a second time, which is a no-op — and that redundancy is
/// the point: a compositor destroying the window is heard by nothing else, so
/// the handler cannot be the path only one caller takes.
pub fn dock_back(app: &AppHandle, pane: Pane) -> RiffResult<Vec<Pane>> {
    record_docked_back(&store_of(app), &scheduler_of(app), pane)?;
    sync_windows(app)
}

pub fn dock_all(app: &AppHandle) -> RiffResult<Vec<Pane>> {
    for pane in popped_out(&store_of(app)) {
        record_docked_back(&store_of(app), &scheduler_of(app), pane)?;
    }
    sync_windows(app)
}

pub fn focus(app: &AppHandle, pane: Pane) -> RiffResult<()> {
    let Some(window) = app.get_webview_window(&pane.window_label()) else {
        return Err(RiffError::NotFound {
            what: pane.window_label(),
        });
    };
    let _ = window.unminimize();
    window.set_focus().map_err(|e| RiffError::Denied {
        what: e.to_string(),
    })
}

/// Reopens what the last session left out. Used by the launch prompt only.
pub fn reopen(app: &AppHandle) -> RiffResult<Vec<Pane>> {
    for pane in app.state::<PendingReopen>().0.clone() {
        record_popped_out(&store_of(app), &scheduler_of(app), pane)?;
    }
    sync_windows(app)
}

/// Called when a pop-out window announces it is closing — by the user's `×`,
/// by `Alt+F4`, or by a compositor that never asked. All three mean the same
/// thing: the pane comes back to the grid.
pub fn on_popout_closed(app: &AppHandle, label: &str) {
    let Some(pane) = pane_for_window(label) else {
        return;
    };
    // Riff is on its way out and these windows are being closed *for* the
    // user, not *by* them. Recording here would write `poppedOut: []` and
    // destroy the state the next launch offers back.
    if app.state::<ShuttingDown>().0.load(Ordering::SeqCst) {
        return;
    }
    match record_docked_back(&store_of(app), &scheduler_of(app), pane) {
        Ok(panes) => broadcast(app, &panes),
        Err(err) => tracing::error!(%err, "could not record a dock-back"),
    }
}

/// Closing the main window quits Riff, taking the pop-outs with it. Without
/// this they stay open with no way back to a grid, and the process never
/// exits because windows remain.
pub fn close_every_popout(app: &AppHandle) {
    app.state::<ShuttingDown>().0.store(true, Ordering::SeqCst);
    for pane in Pane::ALL {
        if let Some(window) = app.get_webview_window(&pane.window_label()) {
            // A pop-out that refuses to close keeps the process alive after
            // main has gone — a Riff with no window and no way to quit it.
            if let Err(err) = window.close() {
                tracing::error!(%err, pane = pane.slug(), "could not close a pop-out on shutdown");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::store::SettingsStore;
    use std::sync::Arc;
    use std::time::Duration;

    fn fixture() -> (Arc<SettingsStore>, Arc<FlushScheduler>, tempfile::TempDir) {
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
        let (store, _) = SettingsStore::load(paths);
        let store = Arc::new(store);
        let scheduler = Arc::new(FlushScheduler::spawn(
            Arc::clone(&store),
            Duration::from_millis(1),
            |_| {},
        ));
        (store, scheduler, tmp)
    }

    fn denied(what: &str) -> RiffError {
        RiffError::Denied {
            what: what.to_owned(),
        }
    }

    #[test]
    fn a_pane_whose_window_cannot_be_built_does_not_strand_the_other_two() {
        // `open_window(app, pane)?` returned on the first failure, skipping
        // the remaining panes *and* the broadcast. A reconciler that stops at
        // the first problem leaves the world half-corrected.
        let attempted = std::cell::RefCell::new(Vec::new());
        let (actual, failures) = reconcile(
            &[Pane::Score, Pane::Video, Pane::Audio],
            |_| false,
            |pane| {
                attempted.borrow_mut().push(pane);
                if pane == Pane::Video {
                    Err(denied("the compositor refused a window"))
                } else {
                    Ok(())
                }
            },
            |_| Ok(()),
        );

        assert_eq!(
            *attempted.borrow(),
            Pane::ALL.to_vec(),
            "every pane is attempted, whatever the one before it did"
        );
        assert_eq!(
            actual,
            vec![Pane::Score, Pane::Audio],
            "the pane with no window comes out of the set"
        );
        assert_eq!(failures.len(), 1, "and the failure is still reported");
    }

    #[test]
    fn the_set_and_the_windows_agree_after_a_failed_reconcile() {
        // A window that refuses to close leaves the pane both docked and
        // open. Recording it as docked would leave the file claiming a window
        // that is on screen does not exist — and the chip strip, which is the
        // only way back to a pop-out that has drifted behind something else,
        // would not draw it.
        let (actual, failures) = reconcile(
            &[],
            |pane| pane == Pane::Audio,
            |_| Ok(()),
            |_| Err(denied("the window would not close")),
        );

        assert_eq!(actual, vec![Pane::Audio]);
        assert_eq!(failures.len(), 1);
    }

    #[test]
    fn a_reconcile_with_nothing_to_do_reports_the_set_unchanged() {
        let (actual, failures) = reconcile(
            &[Pane::Score],
            |pane| pane == Pane::Score,
            |_| panic!("nothing to open"),
            |_| panic!("nothing to close"),
        );
        assert_eq!(actual, vec![Pane::Score]);
        assert!(failures.is_empty());
    }

    #[test]
    fn a_pane_and_its_window_label_round_trip() {
        for pane in Pane::ALL {
            assert_eq!(pane_for_window(&pane.window_label()), Some(pane));
        }
    }

    /// `slug` writes it twice: once here and once as `#[serde(rename_all)]` on
    /// the enum. They must stay the same word, because the webview sends the
    /// serde spelling to `practice_pop_out` while Rust builds the window label
    /// and the `#/popout/{slug}` URL from this one — drift would open a window
    /// at a route React does not have. Single-word variants make them agree
    /// today; a two-word pane would not.
    #[test]
    fn a_slug_is_the_name_the_settings_file_and_the_webview_already_use() {
        for pane in Pane::ALL {
            let serialised = serde_json::to_value(pane).expect("a pane serialises");
            assert_eq!(serialised, serde_json::json!(pane.slug()));
        }
    }

    #[test]
    fn the_main_window_is_not_a_pane() {
        // `pane_for_window` decides whether a `CloseRequested` is a dock-back
        // or a quit. Answering `Some` for main would fold the whole
        // application into a grid cell.
        assert_eq!(pane_for_window(MAIN), None);
        assert_eq!(pane_for_window("popout-"), None);
        assert_eq!(pane_for_window("popout-metronome"), None);
    }

    #[test]
    fn the_quit_confirmation_belongs_to_the_main_window_alone() {
        assert!(quit_confirmation_applies_to(MAIN));
        for pane in Pane::ALL {
            assert!(!quit_confirmation_applies_to(&pane.window_label()));
        }
    }

    #[test]
    fn a_popped_out_pane_is_recorded_and_persisted() {
        let (store, scheduler, _tmp) = fixture();
        let after = record_popped_out(&store, &scheduler, Pane::Video).expect("records");
        assert_eq!(after, vec![Pane::Video]);
        store.flush_if_dirty().expect("flush");

        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(store.paths().settings_file()).expect("read"))
                .expect("json");
        assert_eq!(written["practice"]["poppedOut"][0], "video");
    }

    #[test]
    fn closing_a_popout_window_docks_the_pane_back() {
        // The two halves the `CloseRequested` handler composes: the label
        // identifies the pane, and the pane leaves the set. The handler
        // wiring itself needs a compositor and is walked by hand.
        let (store, scheduler, _tmp) = fixture();
        record_popped_out(&store, &scheduler, Pane::Score).expect("records");
        record_popped_out(&store, &scheduler, Pane::Audio).expect("records");

        let closed = pane_for_window("popout-score").expect("a pop-out label");
        let after = record_docked_back(&store, &scheduler, closed).expect("docks");
        assert_eq!(after, vec![Pane::Audio]);
    }

    #[test]
    fn the_set_is_held_in_canonical_order_whichever_way_it_was_filled() {
        let (a, sa, _ta) = fixture();
        record_popped_out(&a, &sa, Pane::Audio).expect("records");
        let first = record_popped_out(&a, &sa, Pane::Score).expect("records");

        let (b, sb, _tb) = fixture();
        record_popped_out(&b, &sb, Pane::Score).expect("records");
        let second = record_popped_out(&b, &sb, Pane::Audio).expect("records");

        assert_eq!(first, vec![Pane::Score, Pane::Audio]);
        assert_eq!(first, second, "the file must not depend on the click order");
    }

    #[test]
    fn popping_out_a_pane_that_is_already_out_writes_nothing() {
        let (store, scheduler, _tmp) = fixture();
        record_popped_out(&store, &scheduler, Pane::Score).expect("records");
        store.flush_if_dirty().expect("flush");
        let writes = store.write_count();

        let after = record_popped_out(&store, &scheduler, Pane::Score).expect("records");
        assert_eq!(after, vec![Pane::Score]);
        store.flush_if_dirty().expect("flush");
        assert_eq!(
            store.write_count(),
            writes,
            "a redundant pop-out must not cost an fsync"
        );
    }

    #[test]
    fn the_popped_out_set_is_taken_and_cleared_at_launch() {
        // The offer must be made exactly once. Clearing when the user answers
        // would re-offer forever to anyone who ignores the toast, or who is
        // killed before answering it.
        let (store, scheduler, _tmp) = fixture();
        record_popped_out(&store, &scheduler, Pane::Score).expect("records");
        record_popped_out(&store, &scheduler, Pane::Video).expect("records");

        assert_eq!(
            take_pending_reopen(&store),
            vec![Pane::Score, Pane::Video],
            "the first read returns what the last session left out"
        );
        assert!(popped_out(&store).is_empty());
        assert!(
            take_pending_reopen(&store).is_empty(),
            "a second launch has nothing left to offer"
        );
    }

    #[test]
    fn docking_back_a_pane_that_is_already_in_the_grid_is_a_no_op() {
        // The path a compositor kill takes when Riff already knew: the window
        // is gone, `CloseRequested` arrives, and the pane is not in the set.
        let (store, scheduler, _tmp) = fixture();
        let after = record_docked_back(&store, &scheduler, Pane::Video).expect("docks");
        assert!(after.is_empty());
    }
}

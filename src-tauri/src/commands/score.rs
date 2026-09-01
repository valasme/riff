//! Score commands.
//!
//! No caller-supplied path or URL crosses IPC — the picker opens in Rust, as
//! `settings_import` already does, and `WindowEvent::DragDrop` in `lib.rs`
//! delivers a drop the same way. `score_bytes` is the one command
//! `ipc_shapes.rs` cannot guard, because `tauri::ipc::Response` has no serde
//! representation; `score_bytes_answers_with_raw_bytes_not_json` below is
//! what stands in for it.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::error::{RiffError, RiffResult};
use crate::practice;
use crate::settings::model::Pane;
use crate::settings::store::FlushScheduler;
use crate::workspace::{
    OpenScore, OpenScoreRecord, PendingReopen, Score, ScoreGeneration, View, WorkspaceStore,
};

/// Broadcast, not targeted — see the design spec §3: every window needs to
/// know *whether* a score is open, because the palette's `available?`
/// depends on it in both `main` and `popout-score`, and only the window
/// hosting the pane ever mounts a viewer, so a broadcast cannot cause a
/// second load. `app://confirm-quit` is targeted for the opposite reason.
pub const SCORE_CHANGED: &str = "score://changed";

#[tauri::command]
pub async fn score_open(app: AppHandle) -> RiffResult<Option<OpenScore>> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .pick_file(move |picked| {
            let _ = sender.blocking_send(picked);
        });
    let picked = receiver
        .recv()
        .await
        .ok_or_else(|| RiffError::ScoreInfrastructure {
            operation: "receiving the native score picker result".to_owned(),
        })?;
    let Some(path) = picked.and_then(|file| file.into_path().ok()) else {
        return Ok(None);
    };
    open_at(app, path).await.map(Some)
}

/// `tauri::ipc::Response::new(Vec<u8>)` — `ipc-protocol.js` decodes any
/// non-JSON content type with `.arrayBuffer()`, so this arrives in
/// TypeScript as a real `ArrayBuffer`, not base64 or an array of numbers.
/// See ADR 0003.
///
/// Re-reads from disk on every call rather than caching the bytes anywhere:
/// one copy of a potentially enormous file lives in memory at a time — in the
/// worker, once pdf.js has it — and a score deleted while open fails honestly
/// here instead of succeeding from a stale cache.
#[tauri::command]
pub async fn score_bytes(
    generation: ScoreGeneration,
    workspace: tauri::State<'_, Arc<WorkspaceStore>>,
) -> RiffResult<tauri::ipc::Response> {
    let path = workspace.path_for(&generation)?;
    let bytes = crate::score::read_bytes(path).await?;
    workspace.path_for(&generation)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn score_close(
    app: AppHandle,
    generation: ScoreGeneration,
    workspace: tauri::State<'_, Arc<WorkspaceStore>>,
    scheduler: tauri::State<'_, Arc<FlushScheduler<WorkspaceStore>>>,
) -> bool {
    if !workspace.close(&generation) {
        return false;
    }
    scheduler.notify();
    broadcast(&app, None);
    true
}

#[tauri::command]
pub fn score_state(workspace: tauri::State<'_, Arc<WorkspaceStore>>) -> Option<OpenScore> {
    workspace.active().map(|active| active.as_open_score())
}

/// Unlike `settings_patch`, this replaces the view wholesale rather than deep
/// merging a partial value: the view is six small fields the frontend always
/// holds in full already (spec §2 — it stays local to the viewer component),
/// so there is nothing a partial patch would save that a plain value does
/// not already give for free. No throttle here either — only the disk write
/// is coalesced, by the scheduler below. Page-number granularity means this
/// fires on ordinary page turns, and throttling the command itself is what
/// would reopen the pop-out staleness race the coalesced write already
/// closes.
#[tauri::command]
pub fn score_view_patch(
    generation: ScoreGeneration,
    view: View,
    app: AppHandle,
    workspace: tauri::State<'_, Arc<WorkspaceStore>>,
    scheduler: tauri::State<'_, Arc<FlushScheduler<WorkspaceStore>>>,
) -> RiffResult<View> {
    let next = workspace.replace_view(&generation, view)?;
    scheduler.notify();
    let open = workspace
        .active()
        .ok_or_else(|| RiffError::NotFound {
            what: "no score is open".to_owned(),
        })?
        .as_open_score();
    broadcast(&app, Some(&open));
    Ok(next)
}

/// What the last session left open. Already cleared from the file by the
/// time anything can call this, so the answer is an offer rather than a
/// promise — the same contract `practice_pending_reopen` has.
#[tauri::command]
pub fn score_pending_reopen(pending: tauri::State<'_, PendingReopen>) -> Option<Score> {
    pending.0.as_ref().map(OpenScoreRecord::as_score)
}

#[tauri::command]
pub async fn score_reopen(
    app: AppHandle,
    workspace: tauri::State<'_, Arc<WorkspaceStore>>,
    scheduler: tauri::State<'_, Arc<FlushScheduler<WorkspaceStore>>>,
    pending: tauri::State<'_, PendingReopen>,
) -> RiffResult<Option<OpenScore>> {
    let Some(mut record) = pending.0.clone() else {
        return Ok(None);
    };
    // Re-validated, not trusted: the file may have moved or changed since
    // last session, and spec §9 is explicit that the offer is made from the
    // recorded path without stat-ing it first — a move is reported here, at
    // the moment of use, rather than guessed at when the offer was drawn.
    let file = crate::score::preflight(record.path.clone()).await?;
    record.size = file.size;
    let ticket = app.state::<crate::score::ScoreCoordinator>().begin();
    let open = app
        .state::<crate::score::ScoreCoordinator>()
        .commit(ticket, || {
            let active = workspace.activate(record.clone());
            let open = active.as_open_score();
            broadcast(&app, Some(&open));
            Ok(open)
        })?;
    scheduler.notify();
    Ok(Some(open))
}

/// Shared by `score_open` and the drag-and-drop handler in `lib.rs` — the two
/// ways a path reaches Rust without ever crossing IPC.
pub async fn open_at(app: AppHandle, path: PathBuf) -> RiffResult<OpenScore> {
    let file = crate::score::preflight(path).await?;
    let workspace = app.state::<Arc<WorkspaceStore>>();
    let scheduler = app.state::<Arc<FlushScheduler<WorkspaceStore>>>();
    let name = file.name;
    let size = file.size;
    // Basename and byte count, never the directory: `riff.log` is in the
    // diagnostics bundle and `$HOME` redaction does not hide a filename.
    tracing::info!(name, size, "score opened");

    let record = OpenScoreRecord {
        path: file.path,
        name,
        size,
        view: View::default(),
        unknown: serde_json::Map::new(),
    };
    let ticket = app.state::<crate::score::ScoreCoordinator>().begin();
    let open = app
        .state::<crate::score::ScoreCoordinator>()
        .commit(ticket, || {
            let active = workspace.activate(record.clone());
            let open = active.as_open_score();
            broadcast(&app, Some(&open));
            Ok(open)
        })?;
    scheduler.notify();
    focus_score_host(&app);
    Ok(open)
}

fn broadcast(app: &AppHandle, open: Option<&OpenScore>) {
    if let Err(err) = app.emit(SCORE_CHANGED, open) {
        tracing::warn!(%err, "could not announce that the score changed");
    }
}

/// Only `main` and the Score pop-out ever open a dropped score. Tauri hands
/// Rust a drop position in physical pixels, and Rust has no way to know
/// where the Score pane sits inside `main`'s grid — so routing is by window,
/// and every other window, including Video's and Audio's pop-outs, ignores
/// the drop outright.
pub fn accepts_drop(label: &str) -> bool {
    label == practice::MAIN || label == Pane::Score.window_label()
}

/// The first `.pdf` in a multi-file drop wins; everything else in the drop
/// is ignored rather than queued, because Riff has no tabs and no way to
/// open more than one score at a time.
pub fn first_pdf(paths: &[PathBuf]) -> Option<PathBuf> {
    paths
        .iter()
        .find(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
        })
        .cloned()
}

/// The score opens where the Score pane is, not where the drop landed
/// (design spec §3): if the pane is popped out, its window comes forward
/// through the same mechanism `practice_focus` uses; if it is docked, there
/// is no `popout-score` window to raise, so `main` is focused instead.
fn focus_score_host(app: &AppHandle) {
    if practice::focus(app, Pane::Score).is_ok() {
        return;
    }
    if let Some(window) = app.get_webview_window(practice::MAIN) {
        let _ = window.unminimize();
        if let Err(err) = window.set_focus() {
            tracing::warn!(%err, "could not focus the main window after opening a score");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn score_bytes_answers_with_raw_bytes_not_json() {
        // `tauri::ipc::Response` has no serde representation, so
        // `ipc_shapes.rs` cannot see this command at all — this test is what
        // stands in for the drift guard on this one command.
        use tauri::ipc::{InvokeResponseBody, IpcResponse, Response};
        let response = Response::new(vec![b'%', b'P', b'D', b'F']);
        match IpcResponse::body(response) {
            Ok(InvokeResponseBody::Raw(bytes)) => assert_eq!(bytes, vec![b'%', b'P', b'D', b'F']),
            other => panic!("expected raw bytes, got {other:?}"),
        }
    }

    #[test]
    fn a_score_path_never_crosses_ipc_outbound_either() {
        // Invariant 5 does not stop at "inbound": a `path` key on anything
        // the webview receives would hand a compromised renderer a
        // filesystem layout it has no other way to see.
        let open = OpenScore {
            generation: ScoreGeneration(String::new()),
            score: Score {
                name: "sonata.pdf".into(),
                size: 42,
            },
            view: View::default(),
        };
        let json = serde_json::to_value(&open).expect("serialises");
        assert!(
            !json.to_string().contains("path"),
            "OpenScore must never carry a filesystem path: {json}"
        );
    }

    #[test]
    fn only_main_and_the_score_popout_accept_a_drop() {
        assert!(accepts_drop(practice::MAIN));
        assert!(accepts_drop(&Pane::Score.window_label()));
        assert!(!accepts_drop(&Pane::Video.window_label()));
        assert!(!accepts_drop(&Pane::Audio.window_label()));
    }

    #[test]
    fn a_non_pdf_drop_is_ignored() {
        assert_eq!(first_pdf(&[PathBuf::from("photo.png")]), None);
        assert_eq!(first_pdf(&[]), None);
    }

    #[test]
    fn the_first_pdf_in_a_multi_file_drop_wins() {
        let paths = vec![
            PathBuf::from("cover.png"),
            PathBuf::from("sonata.pdf"),
            PathBuf::from("second.pdf"),
        ];
        assert_eq!(first_pdf(&paths), Some(PathBuf::from("sonata.pdf")));
    }

    #[test]
    fn a_pdf_extension_is_matched_case_insensitively() {
        assert_eq!(
            first_pdf(&[PathBuf::from("SONATA.PDF")]),
            Some(PathBuf::from("SONATA.PDF"))
        );
    }
}

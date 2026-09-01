//! The open score and its view: `workspace.json`, in the data directory.
//!
//! Deliberately simpler than `SettingsStore`. `settings.json` is user-authored
//! config, published as a schema and safe to hand-edit — invariant 1 exists to
//! protect exactly that file. `workspace.json` is derived state nobody wrote
//! by hand: a parse failure costs nothing but "which score was open", so it is
//! discarded and logged rather than quarantined, and the file has no watcher —
//! see ADR 0004 for why the two files are not one.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::{RiffError, RiffResult};
use crate::paths::AppPaths;
use crate::settings::store::Flushable;
use crate::storage::atomic::write_atomic;

/// Continuous or one page at a time. Named for what the toolbar offers, not
/// for pdf.js's four-way `ScrollMode` enum — Riff exposes two of its values,
/// so this is its own type rather than a re-export.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ScrollMode {
    #[default]
    Continuous,
    Page,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SpreadMode {
    #[default]
    None,
    Odd,
    Even,
}

/// Free zoom leaves the fit mode rather than fighting it (spec §6), so both
/// live in one value: either a fit mode, or the numeric scale free zoom
/// chose.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum Scale {
    #[default]
    FitWidth,
    FitPage,
    Custom {
        value: f32,
    },
}

/// Degrees, always one of 0/90/180/270. pdf.js's own `pagesRotation` setter
/// throws on anything that is not an integer multiple of 90 — normalising on
/// the way in, the way `UiScale` clamps, is what keeps a hand-edited
/// `workspace.json` from turning a restore into an uncaught exception in the
/// pane instead of a slightly odd rotation.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, JsonSchema)]
pub struct Rotation(u16);

impl Rotation {
    pub fn new(degrees: i32) -> Self {
        let rounded = ((f64::from(degrees) / 90.0).round() as i32).wrapping_mul(90);
        let normalized = ((rounded % 360) + 360) % 360;
        Self(normalized as u16)
    }

    pub fn get(self) -> u16 {
        self.0
    }
}

impl<'de> Deserialize<'de> for Rotation {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        Ok(serde_json::from_value::<i32>(raw)
            .map(Self::new)
            .unwrap_or_default())
    }
}

/// The six values spec §6.4 names: page, scale, rotation, spread, scroll
/// mode and auto-scroll speed. These are what a pane popping out carries with
/// it and what a reopen offer restores. Whether auto-scroll is running and
/// whether a page is pinned are deliberately NOT here — both always start
/// off, because a score that began scrolling the moment it reopened would be
/// alarming rather than helpful, and a pin is something you do to practise a
/// passage now, not a property of the score.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct View {
    pub page: u32,
    pub scale: Scale,
    pub rotation: Rotation,
    pub spread: SpreadMode,
    pub scroll_mode: ScrollMode,
    /// Pages per minute, meaningful in both scroll modes (spec §6.3): a
    /// scroll speed in `ScrollMode::Continuous`, a page-turn interval of
    /// `60 / speed` seconds in `ScrollMode::Page`. Not clamped here to [0.1,
    /// 10] the way the slider is — an out-of-range value from a hand edit
    /// changes how fast the score moves, not whether the pane crashes, which
    /// is the bar `Rotation` above is held to and this is not.
    pub auto_scroll_speed: f32,
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
}

impl Default for View {
    fn default() -> Self {
        Self {
            page: 1,
            scale: Scale::default(),
            rotation: Rotation::default(),
            spread: SpreadMode::default(),
            scroll_mode: ScrollMode::default(),
            auto_scroll_speed: 1.0,
            unknown: serde_json::Map::new(),
        }
    }
}

impl View {
    pub(crate) fn canonicalized(mut self) -> Self {
        self.page = self.page.max(1);
        self.scale = match self.scale {
            Scale::Custom { value } if value.is_finite() => Scale::Custom {
                value: value.clamp(0.1, 25.0),
            },
            Scale::Custom { .. } => Scale::FitWidth,
            value => value,
        };
        self.rotation = Rotation::new(i32::from(self.rotation.get()));
        self.auto_scroll_speed = if self.auto_scroll_speed.is_finite() {
            self.auto_scroll_speed.clamp(0.1, 10.0)
        } else {
            1.0
        };
        self
    }
}

/// What the frontend is told about the open score. Never the path — no
/// caller-supplied path or URL crosses IPC, and that rule does not stop at
/// "inbound"; outbound is how a compromised renderer would learn a
/// filesystem layout it has no other way to see (invariant 5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenScore {
    pub generation: ScoreGeneration,
    pub score: Score,
    pub view: View,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct ScoreGeneration(pub String);

/// The on-disk shape. `path` lives here and nowhere the webview can reach —
/// see `Score` above.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct OpenScoreRecord {
    pub path: PathBuf,
    /// Cached at open time, not re-stat-ed. `score_bytes` re-reads the file's
    /// *content* on every call — see Task 4 — but a name and a byte count
    /// used only to label a toast or a log line are not worth a `stat` on
    /// every `score_state` read, and Task 13's reopen offer is built from
    /// exactly this cached pair without touching the filesystem first.
    pub name: String,
    pub size: u64,
    #[serde(deserialize_with = "deserialize_persisted_view")]
    pub view: View,
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
}

impl OpenScoreRecord {
    pub fn as_score(&self) -> Score {
        Score {
            name: self.name.clone(),
            size: self.size,
        }
    }

    pub fn as_open_score(&self) -> OpenScore {
        OpenScore {
            generation: ScoreGeneration(String::new()),
            score: self.as_score(),
            view: self.view.clone(),
        }
    }
}

impl ActiveScore {
    pub fn as_open_score(&self) -> OpenScore {
        OpenScore {
            generation: self.generation.clone(),
            score: self.record.as_score(),
            view: self.record.view.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub open: Option<OpenScoreRecord>,
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
}

/// The score the last session left open, read once at launch and cleared
/// from the file in the same breath — the exact shape of
/// `practice::PendingReopen`, and for the same reason: the offer must happen
/// exactly once whether or not it is answered.
///
/// The full record, path included, not just `Score` — `score_reopen` needs
/// the path to actually reopen the file. `score_pending_reopen` is what
/// narrows this to a `Score` before it reaches the webview.
pub struct PendingReopen(pub Option<OpenScoreRecord>);

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ActiveScore {
    pub generation: ScoreGeneration,
    pub record: OpenScoreRecord,
}

#[derive(Clone, Debug)]
struct WorkspaceState {
    file: WorkspaceFile,
    generation: Option<ScoreGeneration>,
}

pub struct WorkspaceStore {
    paths: AppPaths,
    state: RwLock<WorkspaceState>,
    revision: AtomicU64,
    flushed: AtomicU64,
    writes: AtomicUsize,
    next_generation: AtomicU64,
}

impl WorkspaceStore {
    pub fn load(paths: AppPaths) -> Self {
        let file = paths.workspace_file();
        let workspace = match std::fs::read(&file) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => WorkspaceFile::default(),
            Err(error) => {
                tracing::warn!(path = %file.display(), kind = ?error.kind(), %error, "workspace could not be read; starting empty");
                WorkspaceFile::default()
            }
            Ok(bytes) => serde_json::from_slice::<WorkspaceFile>(&bytes).unwrap_or_else(|err| {
                tracing::warn!(
                    %err,
                    path = %file.display(),
                    "workspace.json is unreadable; starting with no score open"
                );
                WorkspaceFile::default()
            }),
        };
        let workspace = workspace.canonicalized();
        Self {
            paths,
            state: RwLock::new(WorkspaceState {
                file: workspace,
                generation: None,
            }),
            revision: AtomicU64::new(0),
            flushed: AtomicU64::new(0),
            writes: AtomicUsize::new(0),
            next_generation: AtomicU64::new(0),
        }
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn get(&self) -> WorkspaceFile {
        read_lock(&self.state).file.clone()
    }

    pub fn write_count(&self) -> usize {
        self.writes.load(Ordering::Relaxed)
    }

    /// Replaces the open score wholesale — used when one opens, closes, or is
    /// restored wholesale by a reopen.
    pub fn set_open(&self, open: Option<OpenScoreRecord>) {
        match open {
            Some(record) => {
                self.activate(record);
            }
            None => {
                let mut state = write_lock(&self.state);
                state.file.open = None;
                state.generation = None;
                self.revision.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    pub(crate) fn activate(&self, record: OpenScoreRecord) -> ActiveScore {
        let mut state = write_lock(&self.state);
        let generation = ScoreGeneration(format!(
            "g{}",
            self.next_generation.fetch_add(1, Ordering::Relaxed) + 1
        ));
        state.file.open = Some(record.clone());
        state.generation = Some(generation.clone());
        self.revision.fetch_add(1, Ordering::Release);
        ActiveScore { generation, record }
    }

    pub(crate) fn active(&self) -> Option<ActiveScore> {
        let state = read_lock(&self.state);
        Some(ActiveScore {
            generation: state.generation.clone()?,
            record: state.file.open.clone()?,
        })
    }

    pub(crate) fn path_for(&self, generation: &ScoreGeneration) -> RiffResult<PathBuf> {
        let state = read_lock(&self.state);
        if state.generation.as_ref() != Some(generation) {
            return Err(RiffError::ScoreStale);
        }
        state
            .file
            .open
            .as_ref()
            .map(|record| record.path.clone())
            .ok_or_else(|| RiffError::NotFound {
                what: "no score is open".to_owned(),
            })
    }

    pub(crate) fn replace_view(
        &self,
        generation: &ScoreGeneration,
        view: View,
    ) -> RiffResult<View> {
        let mut state = write_lock(&self.state);
        if state.generation.as_ref() != Some(generation) {
            return Err(RiffError::ScoreStale);
        }
        let view = view.canonicalized();
        state
            .file
            .open
            .as_mut()
            .ok_or_else(|| RiffError::NotFound {
                what: "no score is open".to_owned(),
            })?
            .view = view.clone();
        self.revision.fetch_add(1, Ordering::Release);
        Ok(view)
    }

    pub(crate) fn close(&self, generation: &ScoreGeneration) -> bool {
        let mut state = write_lock(&self.state);
        if state.generation.as_ref() != Some(generation) {
            return false;
        }
        state.file.open = None;
        state.generation = None;
        self.revision.fetch_add(1, Ordering::Release);
        true
    }

    /// Applies a change to the current view. `Err(NotFound)` if nothing is
    /// open — the caller asked to move a page in a workspace with no score,
    /// which is a bug in the caller, not a state worth silently ignoring.
    pub fn patch_view(&self, f: impl FnOnce(&mut View)) -> RiffResult<View> {
        let mut state = write_lock(&self.state);
        let Some(record) = state.file.open.as_mut() else {
            return Err(RiffError::NotFound {
                what: "no score is open".to_owned(),
            });
        };
        f(&mut record.view);
        let view = record.view.clone().canonicalized();
        record.view = view.clone();
        self.revision.fetch_add(1, Ordering::SeqCst);
        Ok(view)
    }

    pub fn is_dirty(&self) -> bool {
        self.revision.load(Ordering::SeqCst) != self.flushed.load(Ordering::SeqCst)
    }

    pub fn flush_if_dirty(&self) -> RiffResult<()> {
        if !self.is_dirty() {
            return Ok(());
        }
        let snapshot = self.revision.load(Ordering::SeqCst);
        let bytes = serde_json::to_vec_pretty(&read_lock(&self.state).file).map_err(|e| {
            RiffError::Validation {
                field: "workspace".to_owned(),
                reason: e.to_string(),
            }
        })?;
        let path = self.paths.workspace_file();
        write_atomic(&path, &bytes).map_err(|e| RiffError::io(&path, &e))?;
        self.writes.fetch_add(1, Ordering::Relaxed);
        self.flushed.store(snapshot, Ordering::SeqCst);
        Ok(())
    }
}

fn read_lock<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(PoisonError::into_inner)
}

fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(PoisonError::into_inner)
}

impl WorkspaceFile {
    fn canonicalized(mut self) -> Self {
        if let Some(open) = self.open.as_mut() {
            open.view = open.view.clone().canonicalized();
        }
        self
    }
}

fn deserialize_persisted_view<'de, D>(deserializer: D) -> Result<View, D::Error>
where
    D: Deserializer<'de>,
{
    let mut value = serde_json::Value::deserialize(deserializer)?;
    let mut view = View::default();
    let Some(object) = value.as_object_mut() else {
        return Ok(view);
    };
    if let Some(raw) = object.remove("page") {
        if let Ok(parsed) = serde_json::from_value(raw) {
            view.page = parsed;
        }
    }
    if let Some(raw) = object.remove("scale") {
        if let Ok(parsed) = serde_json::from_value(raw) {
            view.scale = parsed;
        }
    }
    if let Some(raw) = object.remove("rotation") {
        if let Ok(parsed) = serde_json::from_value(raw) {
            view.rotation = parsed;
        }
    }
    if let Some(raw) = object.remove("spread") {
        if let Ok(parsed) = serde_json::from_value(raw) {
            view.spread = parsed;
        }
    }
    if let Some(raw) = object.remove("scrollMode") {
        if let Ok(parsed) = serde_json::from_value(raw) {
            view.scroll_mode = parsed;
        }
    }
    if let Some(raw) = object.remove("autoScrollSpeed") {
        if let Ok(parsed) = serde_json::from_value(raw) {
            view.auto_scroll_speed = parsed;
        }
    }
    view.unknown = object.clone();
    Ok(view.canonicalized())
}

impl Flushable for WorkspaceStore {
    fn flush_if_dirty(&self) -> RiffResult<()> {
        WorkspaceStore::flush_if_dirty(self)
    }
}

/// Reads the score the last session left open and clears it from the file in
/// the same breath, exactly as `practice::take_pending_reopen` does for the
/// popped-out set — see that function's doc comment for why clearing here,
/// rather than when the prompt is answered, is what makes the offer happen
/// exactly once.
pub fn take_pending_reopen(store: &WorkspaceStore) -> Option<OpenScoreRecord> {
    let current = store.get().open;
    if current.is_some() {
        store.set_open(None);
    }
    current
}

fn basename(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// Reads a candidate score off disk and classifies the ways it can fail to
/// open, shared by `score_open`, the drag-and-drop handler and `score_reopen`
/// so the three cannot drift into three different sets of error codes.
///
/// Not a PDF parser — Riff added no new crate for this (plan 15's Tech
/// Stack). PDF.js remains authoritative for encryption and unsupported PDF
/// structures; this helper only performs the legacy header and tail checks.
pub fn read_and_validate(path: &Path) -> RiffResult<Vec<u8>> {
    let bytes = std::fs::read(path).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            RiffError::ScoreMissing {
                name: basename(path),
            }
        } else {
            RiffError::ScoreUnreadable {
                reason: err.to_string(),
            }
        }
    })?;
    if !bytes.starts_with(b"%PDF-") {
        return Err(RiffError::ScoreUnreadable {
            reason: "the file does not start with a %PDF header".to_owned(),
        });
    }
    // Every complete PDF ends with `%%EOF`, however many incremental updates
    // came before it — so a file missing one near its tail was cut off
    // somewhere Rust does not need to locate exactly. Only the last 2 KB are
    // searched: `%%EOF` sits at the very end by construction, and a search
    // over the whole file would cost real time on a large scan for no
    // stronger a guarantee.
    let tail_len = bytes.len().min(2048);
    if !contains(&bytes[bytes.len() - tail_len..], b"%%EOF") {
        return Err(RiffError::ScoreUnreadable {
            reason: "the file has no %%EOF marker; it may be truncated".to_owned(),
        });
    }
    // Compatibility path for the pre-hardening fixture command. New score
    // opens use `score::preflight`, where PDF.js owns encryption detection.
    if contains(&bytes, b"/Encrypt") {
        return Err(RiffError::ScoreEncrypted);
    }
    Ok(bytes)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> (AppPaths, tempfile::TempDir) {
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
        (paths, tmp)
    }

    fn record(name: &str) -> OpenScoreRecord {
        OpenScoreRecord {
            path: PathBuf::from(format!("/scores/{name}")),
            name: name.to_owned(),
            size: 42,
            view: View {
                page: 3,
                ..View::default()
            },
            unknown: serde_json::Map::new(),
        }
    }

    #[test]
    fn a_fresh_workspace_has_no_score_open() {
        let (paths, _tmp) = scratch();
        let store = WorkspaceStore::load(paths);
        assert!(store.get().open.is_none());
        assert!(!store.is_dirty(), "nothing to write until a score opens");
    }

    #[test]
    fn a_corrupt_workspace_file_is_discarded_and_never_quarantined() {
        let (paths, _tmp) = scratch();
        std::fs::write(paths.workspace_file(), b"{ not json").expect("seed garbage");

        let store = WorkspaceStore::load(paths.clone());
        assert!(
            store.get().open.is_none(),
            "a file Riff cannot read costs only 'which score was open'"
        );
        let siblings: Vec<_> = std::fs::read_dir(paths.data_dir)
            .expect("data dir")
            .filter_map(Result::ok)
            .map(|e| e.file_name())
            .collect();
        assert!(
            !siblings
                .iter()
                .any(|name| name.to_string_lossy().contains("corrupt")),
            "workspace.json is derived state, not user-authored — ADR 0004 says it is \
             discarded, never quarantined"
        );
    }

    #[test]
    fn opening_a_score_is_recorded_and_persisted() {
        let (paths, _tmp) = scratch();
        let store = WorkspaceStore::load(paths.clone());
        store.set_open(Some(record("sonata.pdf")));
        store.flush_if_dirty().expect("flush");

        let reloaded = WorkspaceStore::load(paths);
        let open = reloaded.get().open.expect("score recorded");
        assert_eq!(open.name, "sonata.pdf");
        assert_eq!(open.view.page, 3);
    }

    #[test]
    fn activating_rotates_a_session_generation_without_persisting_it() {
        let (paths, _tmp) = scratch();
        let store = WorkspaceStore::load(paths);
        let first = store.activate(record("sonata.pdf"));
        let second = store.activate(record("sonata.pdf"));
        assert_ne!(first.generation, second.generation);
        assert_eq!(
            store.path_for(&first.generation),
            Err(RiffError::ScoreStale)
        );
        assert_eq!(store.active(), Some(second.clone()));
        store.flush_if_dirty().expect("flush");
        let json = std::fs::read_to_string(store.paths().workspace_file()).expect("workspace");
        assert!(!json.contains("generation"));
        assert!(json.contains("sonata.pdf"));
    }

    #[test]
    fn patch_view_rejects_stale_and_returns_a_canonical_view() {
        let (paths, _tmp) = scratch();
        let store = WorkspaceStore::load(paths);
        let stale = store.activate(record("first.pdf"));
        let current = store.activate(record("second.pdf"));
        let malformed = View {
            page: 0,
            scale: Scale::Custom {
                value: f32::INFINITY,
            },
            rotation: Rotation::new(450),
            scroll_mode: ScrollMode::Continuous,
            spread: SpreadMode::None,
            auto_scroll_speed: f32::NAN,
            unknown: serde_json::Map::new(),
        };
        assert_eq!(
            store.replace_view(&stale.generation, malformed.clone()),
            Err(RiffError::ScoreStale)
        );
        let actual = store
            .replace_view(&current.generation, malformed)
            .expect("canonical view");
        assert_eq!(actual.page, 1);
        assert_eq!(actual.scale, Scale::FitWidth);
        assert_eq!(actual.rotation, Rotation::new(90));
        assert_eq!(actual.auto_scroll_speed, 1.0);
    }

    #[test]
    fn a_poisoned_workspace_lock_recovers_the_last_value() {
        use std::sync::Arc;
        use std::thread;
        let (paths, _tmp) = scratch();
        let store = Arc::new(WorkspaceStore::load(paths));
        let crashing = Arc::clone(&store);
        let _ = thread::spawn(move || {
            let _guard = crashing.state.write().expect("lock");
            panic!("poison workspace lock");
        })
        .join();
        let open = store.activate(record("recovered.pdf"));
        assert_eq!(store.active(), Some(open));
    }

    #[test]
    fn an_unknown_persisted_view_enum_does_not_discard_the_score() {
        let (paths, _tmp) = scratch();
        std::fs::write(
            paths.workspace_file(),
            br#"{"open":{"path":"/scores/kept.pdf","name":"kept.pdf","size":42,"view":{"page":7,"spread":"future-spread","scrollMode":"page","futureViewKey":true}}}"#,
        ).expect("seed");
        let store = WorkspaceStore::load(paths);
        let open = store.get().open.expect("open");
        assert_eq!(open.name, "kept.pdf");
        assert_eq!(open.view.page, 7);
        assert_eq!(open.view.spread, SpreadMode::None);
        assert_eq!(open.view.scroll_mode, ScrollMode::Page);
        assert_eq!(open.view.unknown["futureViewKey"], true);
    }

    #[test]
    fn the_open_score_is_taken_and_cleared_at_launch_so_the_offer_happens_once() {
        let (paths, _tmp) = scratch();
        let store = WorkspaceStore::load(paths);
        store.set_open(Some(record("sonata.pdf")));

        let pending = take_pending_reopen(&store).expect("a score was open");
        assert_eq!(pending.name, "sonata.pdf");
        assert_eq!(
            pending.path,
            PathBuf::from("/scores/sonata.pdf"),
            "score_reopen needs the path back, not just the display name"
        );
        assert!(store.get().open.is_none());
        assert!(
            take_pending_reopen(&store).is_none(),
            "a second launch has nothing left to offer"
        );
    }

    #[test]
    fn unknown_workspace_keys_survive_a_round_trip() {
        let (paths, _tmp) = scratch();
        std::fs::write(
            paths.workspace_file(),
            br#"{"open":{"path":"/s.pdf","name":"s.pdf","size":1,"view":{"page":1},"futureKey":"kept"},"anotherFutureKey":true}"#,
        )
        .expect("seed");

        let store = WorkspaceStore::load(paths);
        store.flush_if_dirty().expect(
            "dirty is false, so this is a no-op, proving nothing was lost by never having to write",
        );
        let raw: serde_json::Value =
            serde_json::from_slice(&std::fs::read(store.paths().workspace_file()).expect("read"))
                .expect("json");
        assert_eq!(raw["anotherFutureKey"], true);
        assert_eq!(raw["open"]["futureKey"], "kept");
    }

    #[test]
    fn a_failed_workspace_write_never_discards_the_open_score() {
        use std::os::unix::fs::PermissionsExt;
        let (paths, _tmp) = scratch();
        let store = WorkspaceStore::load(paths.clone());
        store.set_open(Some(record("sonata.pdf")));

        std::fs::set_permissions(&paths.data_dir, std::fs::Permissions::from_mode(0o500))
            .expect("chmod");
        let result = store.flush_if_dirty();
        std::fs::set_permissions(&paths.data_dir, std::fs::Permissions::from_mode(0o700))
            .expect("restore");

        assert!(result.is_err());
        assert_eq!(
            store.get().open.map(|o| o.name),
            Some("sonata.pdf".to_owned()),
            "a failed disk write must not revert what the interface already showed"
        );
    }

    #[test]
    fn patch_view_fails_with_no_score_open_rather_than_silently_doing_nothing() {
        let (paths, _tmp) = scratch();
        let store = WorkspaceStore::load(paths);
        let err = store.patch_view(|v| v.page = 5).expect_err("nothing open");
        assert!(matches!(err, RiffError::NotFound { .. }));
    }

    #[test]
    fn patch_view_changes_only_the_view() {
        let (paths, _tmp) = scratch();
        let store = WorkspaceStore::load(paths);
        store.set_open(Some(record("sonata.pdf")));
        let view = store.patch_view(|v| v.page = 9).expect("patches");
        assert_eq!(view.page, 9);
        assert_eq!(store.get().open.expect("open").name, "sonata.pdf");
    }

    #[test]
    fn rotation_normalises_any_multiple_of_ninety_and_defaults_otherwise() {
        assert_eq!(Rotation::new(90).get(), 90);
        assert_eq!(Rotation::new(450).get(), 90);
        assert_eq!(Rotation::new(-90).get(), 270);
        assert_eq!(Rotation::new(0).get(), 0);
    }

    #[test]
    fn rotation_deserialises_a_non_multiple_of_ninety_to_the_nearest_step() {
        let r: Rotation = serde_json::from_str("100").expect("deserialises rather than failing");
        assert_eq!(r.get(), 90);
    }

    #[test]
    fn every_score_error_has_a_reason_a_user_can_act_on() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let missing = tmp.path().join("gone.pdf");
        assert!(matches!(
            read_and_validate(&missing),
            Err(RiffError::ScoreMissing { .. })
        ));

        let not_pdf = tmp.path().join("not-a-pdf.pdf");
        std::fs::write(&not_pdf, b"just text").expect("write");
        assert!(matches!(
            read_and_validate(&not_pdf),
            Err(RiffError::ScoreUnreadable { .. })
        ));

        let truncated = tmp.path().join("truncated.pdf");
        std::fs::write(&truncated, b"%PDF-1.7\nnever finished").expect("write");
        assert!(matches!(
            read_and_validate(&truncated),
            Err(RiffError::ScoreUnreadable { .. })
        ));

        let ok = tmp.path().join("ok.pdf");
        std::fs::write(&ok, b"%PDF-1.7\n...\n%%EOF").expect("write");
        assert!(read_and_validate(&ok).is_ok());
    }

    #[test]
    fn a_missing_score_names_the_file_not_the_directory() {
        // Basenames only, never a directory — `riff.log` sits in the
        // diagnostics bundle and `$HOME` redaction does not hide a filename.
        let tmp = tempfile::tempdir().expect("tempdir");
        let missing = tmp.path().join("private-folder-name").join("piece.pdf");
        match read_and_validate(&missing) {
            Err(RiffError::ScoreMissing { name }) => assert_eq!(name, "piece.pdf"),
            other => panic!("expected ScoreMissing, got {other:?}"),
        }
    }
}

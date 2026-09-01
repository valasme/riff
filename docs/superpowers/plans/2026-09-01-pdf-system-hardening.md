# PDF System Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Riff's existing PDF score architecture race-safe, recoverable, responsive, cross-window correct, accessible, and backed by a measured WebKitGTK compatibility floor without weakening its zero-network or bytes-over-IPC security boundaries.

**Architecture:** Keep PDF.js in the score-hosting webview and keep filesystem paths inside Rust. Add an in-memory generation token to every active score, move file work off the UI thread, target commands/open failures to the Score host while broadcasting mirrored state, and centralize frontend score state in one Zustand store. Load the PDF runtime lazily only after a WebKit compatibility preflight, then drive a generation-scoped viewer state machine whose ready state begins at first page paint.

**Tech Stack:** Rust, Tauri 2, React 19, TypeScript, Zustand, Vitest, Testing Library, PDF.js, Vite, Python 3 with PyGObject/WebKit2GTK for the native harness.

**Spec:** [`docs/superpowers/specs/2026-09-01-pdf-system-hardening-design.md`](../specs/2026-09-01-pdf-system-hardening-design.md)

## Global Constraints

- Preserve `core:default` as the only Tauri capability and preserve the CSP. Do not add shell, filesystem, dialog, HTTP, or URL-opening permissions.
- Never serialize a score path or send one to JavaScript. The frontend receives metadata, view state, byte responses, generation tokens, and typed errors only.
- Keep every handwritten IPC type and command synchronized across Rust, TypeScript, `src-tauri/tests/fixtures/ipc-shapes.json`, and `src-tauri/tests/ipc_shapes.rs`.
- Keep `score://changed` as the deliberate all-webview state broadcast. Target `score://command` and `score://open-failed` to the canonical Score host derived from `practice.poppedOut`.
- Treat `ScoreStale` as normal concurrency control. It must not create a toast, error panel, log report, or retry loop.
- Keep persisted workspace JSON backward compatible. Generation tokens exist for one application process only and are never persisted.
- Use TDD within each task: add the stated test, observe the stated failure, implement the minimum change, and rerun the focused test before moving on.
- Use `apply_patch` for source edits. Preserve unrelated working-tree changes.
- Run the task's focused verification before its commit. Run the complete repository gates in Task 16.

## File and Responsibility Map

| Area | Files | Responsibility after this plan |
| --- | --- | --- |
| Workspace state | `src-tauri/src/workspace/mod.rs`, `src-tauri/src/error.rs` | Persist score metadata/view, keep active generation in memory, canonicalize views, reject stale mutations |
| Score service | `src-tauri/src/score/mod.rs`, `src-tauri/src/lib.rs` | Bounded PDF preflight, blocking I/O isolation, newest-open-wins tickets |
| Score IPC | `src-tauri/src/commands/score.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/practice/mod.rs` | Generation-aware commands and host-targeted events |
| IPC contract | `src/lib/ipc/types.ts`, `src/lib/ipc/index.ts`, `src-tauri/tests/ipc_shapes.rs`, `src-tauri/tests/fixtures/ipc-shapes.json` | Exact Rust/TypeScript contract and representative JSON shapes |
| Frontend state | `src/stores/score.ts`, `src/routes/__root.tsx` | Listener-first score subscription, picker/reopen/close actions, operation failures |
| Viewer surface | `src/features/practice/PracticePane.tsx`, `src/features/practice/score/ScoreSurface.tsx` | Lazy score bundle, explicit loading/slow/ready/failure recovery states |
| PDF runtime | `src/features/practice/score/loadPdfRuntime.ts`, `src/features/practice/score/pdfRuntime.ts` | WebKit preflight, dynamic PDF.js import, one worker per viewer attempt |
| PDF controller | `src/features/practice/score/ScoreViewer.tsx` | Generation-scoped bytes/load/render lifecycle and cleanup |
| Interaction | `src/features/practice/score/ScoreToolbar.tsx`, `ScoreSearch.tsx`, `useAutoScroll.ts`, `src/features/keybindings/keymap.ts`, `src/features/keybindings/chord.ts` | Overflow access, search UX, bounded animation, conflict-free keyboard routing |
| Styling | `src/features/practice/score/score.css` | Layered PDF.js CSS and container-query toolbar behavior |
| Native test harness | `scripts/score-harness/*`, `scripts/score-webkit-harness.py`, `scripts/generate-long-score.mjs`, `scripts/generate-link-score.mjs` | Exercise the real score view inside the installed WebKit2GTK runtime |
| Evidence/docs | `docs/measurements/2026-09-01-pdf-system-hardening.md`, ADRs, `CLAUDE.md`, `README.md` | Record measured compatibility, package/security/performance evidence, and durable invariants |

---

## Task 1: Make Workspace State Generation-Aware and Canonical

**Files:**

- Modify: `src-tauri/src/workspace/mod.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src/lib/ipc/types.ts`
- Modify: `src/locales/en/errors.json`
- Test: `src-tauri/src/workspace/mod.rs`
- Test: `src-tauri/tests/ipc_shapes.rs`
- Modify: `src-tauri/tests/fixtures/ipc-shapes.json`

**Interfaces:**

```rust
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct ScoreGeneration(String);

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ActiveScore {
    pub generation: ScoreGeneration,
    pub record: OpenScoreRecord,
}

pub fn activate(&self, record: OpenScoreRecord) -> ActiveScore;
pub fn active(&self) -> Option<ActiveScore>;
pub fn path_for(&self, generation: &ScoreGeneration) -> RiffResult<PathBuf>;
pub fn replace_view(&self, generation: &ScoreGeneration, view: View) -> RiffResult<View>;
pub fn close(&self, generation: &ScoreGeneration) -> bool;
```

- [ ] **Step 1: Add failing tests for generations, stale access, view canonicalization, poison recovery, and non-persistence.**

Add `use std::fs;` to the existing workspace test module, then add these cases using its `scratch()` and `record(name)` helpers:

```rust
#[test]
fn activating_rotates_a_session_generation_without_persisting_it() {
    let (paths, _tmp) = scratch();
    let store = WorkspaceStore::load(paths);
    let first = store.activate(record("sonata.pdf"));
    let second = store.activate(record("sonata.pdf"));
    assert_ne!(first.generation, second.generation);
    assert_eq!(store.path_for(&first.generation), Err(RiffError::ScoreStale));
    assert_eq!(store.active(), Some(second.clone()));
    store.flush_if_dirty().unwrap();
    let json = fs::read_to_string(store.paths().workspace_file()).unwrap();
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
        scale: Scale::Custom { value: f32::INFINITY },
        rotation: Rotation::new(450),
        scroll_mode: ScrollMode::Continuous,
        spread: SpreadMode::None,
        auto_scroll_speed: f32::NAN,
        unknown: serde_json::Map::new(),
    };
    assert_eq!(store.replace_view(&stale.generation, malformed.clone()), Err(RiffError::ScoreStale));
    let actual = store.replace_view(&current.generation, malformed).unwrap();
    assert_eq!(actual.page, 1);
    assert_eq!(actual.scale, Scale::FitWidth);
    assert_eq!(actual.rotation, Rotation::new(90));
    assert_eq!(actual.auto_scroll_speed, 1.0);
}

#[test]
fn a_poisoned_workspace_lock_recovers_the_last_value() {
    let (paths, _tmp) = scratch();
    let store = Arc::new(WorkspaceStore::load(paths));
    let crashing = Arc::clone(&store);
    let _ = thread::spawn(move || {
        let _guard = crashing.state.write().unwrap();
        panic!("poison workspace lock");
    }).join();
    let open = store.activate(record("recovered.pdf"));
    assert_eq!(store.active(), Some(open));
}

#[test]
fn an_unknown_persisted_view_enum_does_not_discard_the_score() {
    let (paths, _tmp) = scratch();
    fs::write(
        paths.workspace_file(),
        br#"{"open":{"path":"/scores/kept.pdf","name":"kept.pdf","size":42,"view":{"page":7,"spread":"future-spread","scrollMode":"page","futureViewKey":true}}}"#,
    ).unwrap();
    let store = WorkspaceStore::load(paths);
    let open = store.get().open.unwrap();
    assert_eq!(open.name, "kept.pdf");
    assert_eq!(open.view.page, 7);
    assert_eq!(open.view.spread, SpreadMode::None);
    assert_eq!(open.view.scroll_mode, ScrollMode::Page);
    assert_eq!(open.view.unknown["futureViewKey"], true);
}
```

Add `ScoreStale` to Rust and `{ code: "score-stale" }` to the TypeScript `RiffError` union. Add its non-empty fallback to `errors.json` and the Rust locale-coverage loop, then regenerate the representative error fixture. `ActiveScore` is Rust-only and must not appear in the IPC fixture; Task 3 adds generation to the public `OpenScore` atomically with all frontend fixtures and command signatures.

- [ ] **Step 2: Run the focused tests and confirm the missing API failures.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --test ipc_shapes -- --nocapture
```

Expected: compilation fails for the generation-aware methods and `RiffError::ScoreStale`; after Rust compiles, the fixture test fails until the shape is synchronized.

- [ ] **Step 3: Implement the in-memory state envelope and canonicalization.**

```rust
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

fn read_lock<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(PoisonError::into_inner)
}

fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(PoisonError::into_inner)
}
```

Implement the final generation-aware methods without clone/replace races:

```rust
pub fn activate(&self, record: OpenScoreRecord) -> ActiveScore {
    let mut state = write_lock(&self.state);
    let generation = ScoreGeneration(format!(
        "g{}",
        self.next_generation.fetch_add(1, Ordering::Relaxed) + 1,
    ));
    state.file.open = Some(record.clone());
    state.generation = Some(generation.clone());
    self.revision.fetch_add(1, Ordering::Release);
    ActiveScore { generation, record }
}

pub fn active(&self) -> Option<ActiveScore> {
    let state = read_lock(&self.state);
    Some(ActiveScore {
        generation: state.generation.clone()?,
        record: state.file.open.clone()?,
    })
}

pub fn path_for(&self, generation: &ScoreGeneration) -> RiffResult<PathBuf> {
    let state = read_lock(&self.state);
    if state.generation.as_ref() != Some(generation) {
        return Err(RiffError::ScoreStale);
    }
    state.file.open.as_ref().map(|record| record.path.clone()).ok_or_else(|| {
        RiffError::NotFound { what: "no score is open".to_owned() }
    })
}

pub fn replace_view(&self, generation: &ScoreGeneration, view: View) -> RiffResult<View> {
    let mut state = write_lock(&self.state);
    if state.generation.as_ref() != Some(generation) {
        return Err(RiffError::ScoreStale);
    }
    let view = view.canonicalized();
    state.file.open.as_mut().ok_or_else(|| RiffError::NotFound {
        what: "no score is open".to_owned(),
    })?.view = view.clone();
    self.revision.fetch_add(1, Ordering::Release);
    Ok(view)
}

pub fn close(&self, generation: &ScoreGeneration) -> bool {
    let mut state = write_lock(&self.state);
    if state.generation.as_ref() != Some(generation) {
        return false;
    }
    state.file.open = None;
    state.generation = None;
    self.revision.fetch_add(1, Ordering::Release);
    true
}
```

Create generations as `g1`, `g2`, and higher using `fetch_add`. Serialize only `WorkspaceState.file`. Canonicalize on workspace load and on every patch:

```rust
impl View {
    fn canonicalized(mut self) -> Self {
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
```

Keep `View`'s IPC deserializer strict. On `OpenScoreRecord.view` only, add `#[serde(deserialize_with = "deserialize_persisted_view")]`. That function first deserializes a `serde_json::Value`, starts from `View::default()`, and independently attempts `page`, `scale`, `rotation`, `spread`, `scrollMode`, and `autoScrollSpeed` with `serde_json::from_value`. A failed field keeps only that field's default. Remove those six keys from the object, preserve the remainder in `View.unknown`, and return `view.canonicalized()`. Thus an unknown persisted enum cannot discard the path/name/other view fields, while an unknown enum received over IPC still rejects as a validation error.

Change workspace loading so `io::ErrorKind::NotFound` alone is a silent empty workspace. Every other read error logs the workspace path, error kind, and message before returning an empty in-memory workspace. Do not quarantine derived workspace state.

Check a generation and mutate under the same write guard. Keep the existing `set_open` and closure-based `patch_view` as `pub(crate)` compatibility wrappers for the still-old score commands in this one commit: `set_open(Some(record))` delegates to `activate`, `set_open(None)` clears the current record/generation, and old `patch_view` mutates the active record. Task 3 removes both wrappers after moving every command to `activate`, `close`, and `replace_view`.

Add the unit variant `ScoreStale` to the existing `RiffError` enum; with the existing adjacent tagging it serializes as `{"code":"score-stale"}`. Add `Clone` and `PartialEq` to the enum derives so cancellation can be tested without string matching. Preserve unknown persisted fields.

- [ ] **Step 4: Verify and commit.**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml workspace -- --nocapture
RIFF_UPDATE_FIXTURES=1 cargo test --manifest-path src-tauri/Cargo.toml --test ipc_shapes
cargo test --manifest-path src-tauri/Cargo.toml --test ipc_shapes -- --nocapture
pnpm typecheck
git add src-tauri/src/workspace/mod.rs src-tauri/src/error.rs src/lib/ipc/types.ts src/locales/en/errors.json src-tauri/tests/ipc_shapes.rs src-tauri/tests/fixtures/ipc-shapes.json
git commit -m "feat(score): make workspace state generation-aware"
```

---

## Task 2: Isolate Score File I/O and Make PDF Preflight Bounded

**Files:**

- Create: `src-tauri/src/score/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/score/mod.rs`

**Interfaces:**

```rust
pub struct ScoreCoordinator;
pub struct OpenTicket(u64);
pub struct ScoreFile { pub path: PathBuf, pub name: String, pub size: u64 }
pub async fn preflight(path: PathBuf) -> RiffResult<ScoreFile>;
pub async fn read_bytes(path: PathBuf) -> RiffResult<Vec<u8>>;
```

- [ ] **Step 1: Add failing tests for newest-open-wins and bounded inspection.**

```rust
struct Counted {
    inner: Cursor<Vec<u8>>,
    reads: Rc<Cell<usize>>,
}

impl Counted {
    fn new(bytes: Vec<u8>, reads: Rc<Cell<usize>>) -> Self {
        Self { inner: Cursor::new(bytes), reads }
    }
}

impl Read for Counted {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(buffer)?;
        self.reads.set(self.reads.get() + count);
        Ok(count)
    }
}

impl Seek for Counted {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.inner.seek(position)
    }
}

#[test]
fn coordinator_commits_only_the_latest_open_ticket() {
    let coordinator = ScoreCoordinator::default();
    let first = coordinator.begin();
    let second = coordinator.begin();
    let mut committed = Vec::new();
    assert_eq!(
        coordinator.commit(first, || { committed.push("first"); Ok(()) }),
        Err(RiffError::ScoreStale)
    );
    coordinator.commit(second, || { committed.push("second"); Ok(()) }).unwrap();
    assert_eq!(committed, ["second"]);
}

#[test]
fn inspect_reads_only_the_header_and_tail_of_a_large_pdf() {
    let mut bytes = b"junk\n%PDF-1.7\n".to_vec();
    bytes.resize(2 * 1024 * 1024, b'0');
    bytes.extend_from_slice(b"\nstartxref\n12\n%%EOF\n");
    let reads = Rc::new(Cell::new(0));
    let mut reader = Counted::new(bytes.clone(), Rc::clone(&reads));
    inspect(&mut reader, bytes.len() as u64).unwrap();
    assert!(reads.get() <= 3_072, "read {} bytes", reads.get());
}

#[test]
fn inspect_accepts_a_header_within_the_first_kibibyte() {
    let mut bytes = vec![b' '; 700];
    bytes.extend_from_slice(b"%PDF-1.4\n%%EOF\n");
    inspect(&mut Cursor::new(bytes.clone()), bytes.len() as u64).unwrap();
}

#[test]
fn inspect_does_not_treat_an_unrelated_encrypt_literal_as_encryption() {
    let bytes = b"%PDF-1.7\n1 0 obj << /Note (/Encrypt) >> endobj\n%%EOF\n".to_vec();
    inspect(&mut Cursor::new(bytes.clone()), bytes.len() as u64).unwrap();
}

#[test]
fn both_filesystem_entry_points_use_the_blocking_pool() {
    let source = include_str!("mod.rs");
    assert_eq!(source.matches("tauri::async_runtime::spawn_blocking").count(), 2);
}
```

- [ ] **Step 2: Run the test and observe the missing module/API failure.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml score::tests -- --nocapture
```

- [ ] **Step 3: Implement the linearizable coordinator, bounded reader, and blocking bridge.**

```rust
#[derive(Default)]
pub struct ScoreCoordinator(Mutex<CoordinatorState>);

#[derive(Default)]
struct CoordinatorState {
    next_ticket: u64,
    latest_ticket: u64,
}

impl ScoreCoordinator {
    pub fn begin(&self) -> OpenTicket {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        state.next_ticket += 1;
        state.latest_ticket = state.next_ticket;
        OpenTicket(state.latest_ticket)
    }

    pub fn commit<T>(
        &self,
        ticket: OpenTicket,
        operation: impl FnOnce() -> RiffResult<T>,
    ) -> RiffResult<T> {
        let state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.latest_ticket != ticket.0 {
            return Err(RiffError::ScoreStale);
        }
        let result = operation();
        drop(state);
        result
    }
}

fn inspect<R: Read + Seek>(reader: &mut R, size: u64) -> RiffResult<()> {
    let mut header = vec![0; size.min(1_024) as usize];
    reader.read_exact(&mut header).map_err(|error| RiffError::ScoreUnreadable {
        reason: error.to_string(),
    })?;
    if !header.windows(5).any(|window| window == b"%PDF-") {
        return Err(RiffError::ScoreUnreadable {
            reason: "no PDF header in the first 1024 bytes".to_owned(),
        });
    }
    let tail_size = size.min(2_048);
    reader.seek(SeekFrom::End(-(tail_size as i64))).map_err(|error| {
        RiffError::ScoreUnreadable { reason: error.to_string() }
    })?;
    let mut tail = vec![0; tail_size as usize];
    reader.read_exact(&mut tail).map_err(|error| RiffError::ScoreUnreadable {
        reason: error.to_string(),
    })?;
    if !tail.windows(5).any(|window| window == b"%%EOF") {
        return Err(RiffError::ScoreUnreadable {
            reason: "no PDF end marker in the final 2048 bytes".to_owned(),
        });
    }
    Ok(())
}
```

`preflight` and `read_bytes` must wrap all `File`, metadata, and `fs::read` work in `tauri::async_runtime::spawn_blocking`. Map errors without exposing a path:

```rust
fn score_io(name: &str, error: &io::Error) -> RiffError {
    match error.kind() {
        io::ErrorKind::NotFound => RiffError::ScoreMissing { name: name.to_owned() },
        io::ErrorKind::PermissionDenied => RiffError::Denied {
            what: "reading the selected score".to_owned(),
        },
        _ => RiffError::ScoreUnreadable { reason: error.to_string() },
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("Score.pdf")
        .to_owned()
}

pub async fn preflight(path: PathBuf) -> RiffResult<ScoreFile> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = display_name(&path);
        let mut file = File::open(&path).map_err(|error| score_io(&name, &error))?;
        let size = file.metadata().map_err(|error| score_io(&name, &error))?.len();
        inspect(&mut file, size)?;
        Ok(ScoreFile { path, name, size })
    })
    .await
    .map_err(|_| RiffError::ScoreUnreadable {
        reason: "score I/O task did not complete".to_owned(),
    })?
}

pub async fn read_bytes(path: PathBuf) -> RiffResult<Vec<u8>> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = display_name(&path);
        fs::read(&path).map_err(|error| score_io(&name, &error))
    })
    .await
    .map_err(|_| RiffError::ScoreUnreadable {
        reason: "score I/O task did not complete".to_owned(),
    })?
}
```

Map a blocking-task join failure to `ScoreUnreadable { reason: "score I/O task did not complete" }`. Do not scan for `/Encrypt`; PDF.js is authoritative for encryption and unsupported object structures. Register `mod score;` and manage one `ScoreCoordinator::default()` in the Tauri builder. Keep the old `workspace::read_and_validate` for the existing commands in this intermediate commit; Task 3 removes it immediately after every caller is moved to this module.

- [ ] **Step 4: Verify and commit.**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml score::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/score/mod.rs src-tauri/src/lib.rs
git commit -m "refactor(score): isolate asynchronous file loading"
```

---

## Task 3: Replace Score IPC With Generation-Aware Commands and Targeted Events

**Files:**

- Modify: `src-tauri/src/commands/score.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/practice/mod.rs`
- Modify: `src-tauri/src/workspace/mod.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/ipc/types.ts`
- Modify: `src/lib/ipc/index.ts`
- Modify: `src/locales/en/errors.json`
- Test: `src-tauri/src/commands/score.rs`
- Test: `src-tauri/tests/event_targets.rs`
- Test: `src-tauri/tests/ipc_shapes.rs`
- Modify: `src-tauri/tests/fixtures/ipc-shapes.json`
- Modify: `src/features/keybindings/keymap.test.ts`
- Modify: `src/features/practice/PracticePane.test.tsx`
- Modify: `src/features/practice/score/ScoreViewer.test.tsx`

**Interfaces:**

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ScoreCommand {
    Page { delta: i8 },
    Zoom { direction: i8 },
    Fit,
    Rotate,
    Spread,
    ScrollMode,
    Search,
    AutoScroll,
    Speed { delta: i8 },
    Pin,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreCommandEvent {
    pub generation: ScoreGeneration,
    pub command: ScoreCommand,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenScore {
    pub generation: ScoreGeneration,
    pub score: Score,
    pub view: View,
}
```

- [ ] **Step 1: Add failing serialization and event-target tests.**

```rust
#[test]
fn score_command_shape_matches_typescript() {
    assert_eq!(
        serde_json::to_value(ScoreCommand::Speed { delta: -1 }).unwrap(),
        json!({ "kind": "speed", "delta": -1 })
    );
    assert_eq!(
        serde_json::to_value(ScoreCommand::Fit).unwrap(),
        json!({ "kind": "fit" })
    );
}

#[test]
fn score_command_rejects_non_unit_deltas() {
    assert!(ScoreCommand::Page { delta: 2 }.validate().is_err());
    assert!(ScoreCommand::Zoom { direction: 0 }.validate().is_err());
    assert!(ScoreCommand::Speed { delta: -2 }.validate().is_err());
}
```

Extend `event_targets.rs` with:

```rust
fn score() -> String {
    squashed(include_str!("../src/commands/score.rs"))
}

#[test]
fn score_commands_and_open_failures_are_targeted_but_state_is_broadcast() {
    let source = score();
    assert!(source.contains(r#"emit_to(&host, "score://command""#));
    assert!(source.contains(r#"emit_to(&host, "score://open-failed""#));
    assert!(source.contains("app.emit(SCORE_CHANGED"));
}

#[test]
fn workspace_write_failure_is_targeted_to_main() {
    assert!(lib().contains(r#"emit_to(practice::MAIN, "workspace://write-failed""#));
}

#[test]
fn drop_handling_schedules_async_work_instead_of_reading_in_the_window_callback() {
    assert!(lib().contains("tauri::async_runtime::spawn(async move"));
}
```

Extend the IPC fixture with every `ScoreCommand` variant, `ScoreCommandEvent`, `ScoreGeneration`, `ScoreStale`, and generation-bearing `OpenScore`.
Add `ScoreInfrastructure { operation: String }`, serialized as `score-infrastructure`, to Rust/TypeScript, the fixture, locale coverage, and `errors.json`. It is reserved for a closed native-picker channel, missing target window, or event-delivery failure; ordinary file permission remains `denied`.

- [ ] **Step 2: Run the focused tests and observe the old seam failures.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test ipc_shapes -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --test event_targets -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml commands::score::tests -- --nocapture
```

- [ ] **Step 3: Add a canonical score-host helper and async open pipeline.**

```rust
pub fn score_host(store: &SettingsStore) -> String {
    if popped_out(store).contains(&Pane::Score) {
        Pane::Score.window_label()
    } else {
        MAIN.to_owned()
    }
}
```

Every targeted score producer resolves this immediately before emitting. Keep `score://changed` as the all-webview state broadcast. Use one open helper; the coordinator lock covers activation and its broadcast, so an overtaken request cannot publish after a newer one:

```rust
async fn open_path(
    app: AppHandle,
    path: PathBuf,
    view: Option<View>,
    ticket: OpenTicket,
) -> RiffResult<OpenScore> {
    let file = score::preflight(path).await?;
    let record = OpenScoreRecord {
        path: file.path,
        name: file.name,
        size: file.size,
        view: view.unwrap_or_default(),
        unknown: serde_json::Map::new(),
    };
    let open = app.state::<ScoreCoordinator>().commit(ticket, || {
        let active = app.state::<Arc<WorkspaceStore>>().activate(record);
        let open = active.as_open_score();
        app.emit(SCORE_CHANGED, Some(&open)).map_err(|error| RiffError::ScoreInfrastructure {
            operation: format!("announcing score://changed: {error}"),
        })?;
        Ok(open)
    })?;
    app.state::<Arc<FlushScheduler<WorkspaceStore>>>().notify();
    focus_score_host(&app);
    Ok(open)
}

fn report_open_failure(app: &AppHandle, error: &RiffError) -> RiffResult<()> {
    if matches!(error, RiffError::ScoreStale | RiffError::ScoreInfrastructure { .. }) {
        return Ok(());
    }
    let host = practice::score_host(&app.state::<Arc<SettingsStore>>());
    if app.get_webview_window(&host).is_none() {
        return Err(RiffError::ScoreInfrastructure {
            operation: format!("reporting score://open-failed to missing window {host}"),
        });
    }
    app.emit_to(&host, "score://open-failed", error).map_err(|emit_error| RiffError::ScoreInfrastructure {
        operation: format!("reporting score://open-failed: {emit_error}"),
    })
}

async fn open_and_report(
    app: AppHandle,
    path: PathBuf,
    view: Option<View>,
    ticket: OpenTicket,
) -> RiffResult<OpenScore> {
    let result = open_path(app.clone(), path, view, ticket).await;
    if let Err(error) = &result {
        if !matches!(error, RiffError::ScoreStale) {
            tracing::warn!(%error, "score open failed");
        }
        if let Err(report_error) = report_open_failure(&app, error) {
            tracing::error!(%report_error, "score open failure could not reach its host");
            return Err(report_error);
        }
    }
    result
}
```

Picker, drop, and reopen each call `coordinator.begin()` after obtaining a concrete path. The picker must use the non-blocking callback API bridged through Tauri's async channel:

```rust
let (sender, mut receiver) = tauri::async_runtime::channel(1);
app.dialog().file().add_filter("PDF", &["pdf"]).pick_file(move |picked| {
    let _ = sender.blocking_send(picked);
});
let picked = receiver.recv().await.ok_or_else(|| RiffError::ScoreInfrastructure {
    operation: "receiving the native score picker result".to_owned(),
})?;
let Some(path) = picked.and_then(|file| file.into_path().ok()) else {
    return Ok(None);
};
let ticket = app.state::<ScoreCoordinator>().begin();
```

Picker and reopen return `open_and_report` directly. The drop callback clones the app/path into `tauri::async_runtime::spawn` and returns immediately, then awaits `open_and_report` inside the spawned future. The helper logs every non-stale failure once and logs event-delivery failure separately, so the drop future does not add a duplicate log.

- [ ] **Step 4: Make all document operations generation-aware.**

```rust
#[tauri::command]
pub async fn score_bytes(
    generation: ScoreGeneration,
    workspace: State<'_, Arc<WorkspaceStore>>,
) -> RiffResult<Response> {
    let path = workspace.path_for(&generation)?;
    let bytes = score::read_bytes(path).await.map_err(|error| {
        tracing::warn!(%error, "score bytes could not be read");
        error
    })?;
    workspace.path_for(&generation)?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn score_command(
    app: AppHandle,
    generation: ScoreGeneration,
    command: ScoreCommand,
) -> RiffResult<()> {
    command.validate()?;
    app.state::<Arc<WorkspaceStore>>().path_for(&generation)?;
    let host = practice::score_host(&app.state::<Arc<SettingsStore>>());
    if app.get_webview_window(&host).is_none() {
        return Err(RiffError::ScoreInfrastructure {
            operation: format!("delivering score://command to missing window {host}"),
        });
    }
    app.emit_to(&host, "score://command", ScoreCommandEvent { generation, command })
        .map_err(|error| RiffError::ScoreInfrastructure {
            operation: format!("delivering score://command: {error}"),
        })
}
```

`ScoreCommand::validate` accepts only `-1` or `1` for page delta, zoom direction, and speed delta. It returns the existing `Validation { field: "scoreCommand", reason: "delta must be -1 or 1" }` for any other value before resolving or emitting to a window.

Add `ActiveScore::as_open_score()` to combine its generation with `record.as_score()` and the canonical view without the path. `score_close(generation)` returns `bool` and emits `score://changed` with `null` only when it closed the active generation. `score_view_patch(generation, view)` calls `workspace.replace_view`, schedules persistence, broadcasts the resulting current `OpenScore` to every webview, and returns the canonical view. That broadcast keeps a not-yet-hosting webview current so pop-out/dock-back starts from the latest page. `score_state()` maps `workspace.active()` through `as_open_score`. Map a failed changed broadcast to `ScoreInfrastructure`.

Remove Task 1's compatibility `set_open` and closure-based `patch_view` after all command call sites are migrated. Remove `workspace::read_and_validate` and move its missing/not-PDF/truncated tests into `score::tests`; delete the obsolete `/Encrypt` classification test because encryption now belongs to PDF.js.

Change pending reopen to `Mutex<Option<OpenScoreRecord>>` and call a synchronous `take_pending_score` helper before the first await. Add a unit test that seeds one record, calls the helper twice, receives the record once, and receives `None` the second time. A repeated reopen returns `NotFound { what: "no score is pending reopen" }`; an overtaken reopen returns `ScoreStale` without restoring the consumed record. `score_pending_reopen` takes the same poison-recovering lock and returns only display-safe metadata.

- [ ] **Step 5: Update the four IPC surfaces atomically.**

In TypeScript add `type ScoreGeneration = string`, add `generation` to `OpenScore`, move `ScoreCommand` from the feature-local emitter into `ipc/types.ts`, and replace the wrappers with:

```ts
export type ScoreCommand =
  | { kind: "page"; delta: 1 | -1 }
  | { kind: "zoom"; direction: 1 | -1 }
  | { kind: "fit" }
  | { kind: "rotate" }
  | { kind: "spread" }
  | { kind: "scrollMode" }
  | { kind: "search" }
  | { kind: "autoScroll" }
  | { kind: "speed"; delta: 1 | -1 }
  | { kind: "pin" };
```

Replace the wrappers with:

```ts
scoreBytes: (generation: ScoreGeneration) => invoke<ArrayBuffer>("score_bytes", { generation }),
scoreClose: (generation: ScoreGeneration) => invoke<boolean>("score_close", { generation }),
scoreViewPatch: (generation: ScoreGeneration, view: View) =>
  invoke<View>("score_view_patch", { generation, view }),
scoreCommand: (generation: ScoreGeneration, command: ScoreCommand) =>
  invoke<void>("score_command", { generation, command }),
scoreOpen: () => invoke<OpenScore | null>("score_open"),
scoreState: () => invoke<OpenScore | null>("score_state"),
scorePendingReopen: () => invoke<Score | null>("score_pending_reopen"),
scoreReopen: () => invoke<OpenScore>("score_reopen"),
```

Synchronize Rust, TypeScript, the JSON fixture, and `ipc_shapes.rs` in one edit.
Add `generation: "g1"` to typed `OpenScore` constants in `keymap.test.ts`, `PracticePane.test.tsx`, and `ScoreViewer.test.tsx`.

- [ ] **Step 6: Target debounced workspace write failures to main.**

Keep the scheduler's same-error suppression and reset-after-success behavior. Replace its workspace error callback with `emit_to("main", "workspace://write-failed", &error)`, and log only an event-delivery failure.

- [ ] **Step 7: Verify and commit.**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml commands::score::tests -- --nocapture
RIFF_UPDATE_FIXTURES=1 cargo test --manifest-path src-tauri/Cargo.toml --test ipc_shapes
cargo test --manifest-path src-tauri/Cargo.toml --test ipc_shapes -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --test event_targets -- --nocapture
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm typecheck
git add src-tauri/src/commands/score.rs src-tauri/src/commands/mod.rs src-tauri/src/practice/mod.rs src-tauri/src/workspace/mod.rs src-tauri/src/error.rs src-tauri/src/lib.rs src/lib/ipc/types.ts src/lib/ipc/index.ts src/locales/en/errors.json src-tauri/tests/event_targets.rs src-tauri/tests/ipc_shapes.rs src-tauri/tests/fixtures/ipc-shapes.json src/features/keybindings/keymap.test.ts src/features/practice/PracticePane.test.tsx src/features/practice/score/ScoreViewer.test.tsx
git commit -m "feat(score): route generation-aware score IPC"
```

---

## Task 4: Centralize Frontend Score State With Listener-First Ordering

**Files:**

- Create: `src/stores/score.ts`
- Create: `src/stores/score.test.ts`
- Delete: `src/features/practice/score/useOpenScore.ts`
- Modify: `src/routes/__root.tsx`
- Modify: `src/features/practice/PracticePane.tsx`
- Modify: `src/features/practice/score/scoreError.ts`
- Create: `src/features/practice/score/scoreError.test.ts`

**Interface:**

```ts
type ScoreState = {
  initialised: boolean;
  open: OpenScore | null;
  operationError: RiffError | null;
  subscribe: () => Promise<() => void>;
  openFromPicker: () => Promise<void>;
  reopen: () => Promise<void>;
  close: (generation: ScoreGeneration) => Promise<void>;
  adoptView: (generation: ScoreGeneration, view: View) => void;
  clearOperationError: () => void;
};
```

- [ ] **Step 1: Add failing store tests for the startup race and error policy.**

Mock `listen` so tests can capture handlers and mock `scoreState` with a deferred promise:

```ts
it("lets a changed event win over a stale startup snapshot", async () => {
  const seed = deferred<OpenScore | null>();
  vi.mocked(ipc.scoreState).mockReturnValue(seed.promise);
  const subscribe = useScore.getState().subscribe();
  await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));
  await emitCaptured("score://changed", SECOND_SCORE);
  seed.resolve(FIRST_SCORE);
  const unsubscribe = await subscribe;
  expect(useScore.getState().open).toEqual(SECOND_SCORE);
  unsubscribe();
});

it("suppresses stale command failures", async () => {
  vi.mocked(ipc.scoreClose).mockRejectedValue({ code: "score-stale" });
  await useScore.getState().close(FIRST_SCORE.generation);
  expect(useScore.getState().operationError).toBeNull();
  expect(toast.error).not.toHaveBeenCalled();
});

it("shows an open failure in the empty surface but toasts it over an active score", async () => {
  await useScore.getState().subscribe();
  await emitCaptured("score://open-failed", {
    code: "score-unreadable",
    details: { reason: "bad cross-reference" },
  });
  expect(useScore.getState().operationError).toEqual({
    code: "score-unreadable",
    details: { reason: "bad cross-reference" },
  });
  useScore.setState({ open: FIRST_SCORE, operationError: null });
  await emitCaptured("score://open-failed", { code: "score-encrypted" });
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(useScore.getState().operationError).toBeNull();
});

it("shares one listener installation until the last subscriber releases it", async () => {
  const first = await useScore.getState().subscribe();
  const second = await useScore.getState().subscribe();
  expect(listen).toHaveBeenCalledTimes(2);
  first();
  expect(unlistenChanged).not.toHaveBeenCalled();
  second();
  expect(unlistenChanged).toHaveBeenCalledOnce();
  expect(unlistenFailed).toHaveBeenCalledOnce();
});

it("reports score infrastructure failures from the initiating window", async () => {
  const error = {
    code: "score-infrastructure",
    details: { operation: "reporting score://open-failed" },
  } as const;
  vi.mocked(ipc.scoreOpen).mockRejectedValue(error);
  await useScore.getState().openFromPicker();
  expect(reportFailure).toHaveBeenCalledWith(error, "opening a score");
});

it("does not duplicate a normal preflight error presented in another score host", async () => {
  vi.mocked(ipc.scoreOpen).mockRejectedValue({
    code: "denied",
    details: { what: "reading the selected score" },
  });
  await useScore.getState().openFromPicker();
  expect(reportFailure).not.toHaveBeenCalled();
});

it("leaves the skeleton state and reports when event subscription fails", async () => {
  vi.mocked(listen).mockRejectedValueOnce(new Error("event plugin unavailable"));
  vi.mocked(ipc.scoreState).mockResolvedValue(null);
  const release = await useScore.getState().subscribe();
  expect(useScore.getState()).toMatchObject({
    initialised: true,
    operationError: {
      code: "score-infrastructure",
      details: { operation: "subscribing to score events" },
    },
  });
  expect(reportFailure).toHaveBeenCalled();
  release();
});
```

- [ ] **Step 2: Run the store test and observe the missing store.**

```bash
pnpm vitest run src/stores/score.test.ts
```

- [ ] **Step 3: Implement one ref-counted, listener-first subscription with a sequence guard.**

Keep a module-level installation promise, release function, and reference count so React StrictMode and a fast remount cannot duplicate listeners or tear down a listener still in use. Reset the installation promise only when the final release has run.

```ts
let installation: Promise<() => void> | null = null;
let subscriberCount = 0;

async function acquireSubscription(): Promise<() => void> {
  subscriberCount += 1;
  installation ??= installScoreSubscription();
  try {
    const uninstall = await installation;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      subscriberCount -= 1;
      if (subscriberCount === 0) {
        uninstall();
        installation = null;
      }
    };
  } catch (error) {
    subscriberCount -= 1;
    if (subscriberCount === 0) installation = null;
    throw error;
  }
}

async function installScoreSubscription(): Promise<() => void> {
  let eventSequence = 0;
  const unlisteners: Array<() => void> = [];
  let listenerError: unknown;
  try {
    unlisteners.push(await listen<OpenScore | null>("score://changed", ({ payload }) => {
      eventSequence += 1;
      useScore.setState({ initialised: true, open: payload, operationError: null });
    }));
    unlisteners.push(await listen<RiffError>("score://open-failed", ({ payload }) => {
      if (payload.code === "score-stale") return;
      if (useScore.getState().open) {
        toast.error(scoreErrorMessage(payload, (key, options) => i18n.t(key, options)));
        return;
      }
      useScore.setState({ initialised: true, operationError: payload });
    }));
  } catch (error) {
    for (const unlisten of unlisteners) unlisten();
    unlisteners.length = 0;
    listenerError = error;
  }
  const sequenceBeforeSeed = eventSequence;
  try {
    const snapshot = await ipc.scoreState();
    if (eventSequence === sequenceBeforeSeed) {
      useScore.setState({
        initialised: true,
        open: snapshot,
        operationError: listenerError && !snapshot
          ? { code: "score-infrastructure", details: { operation: "subscribing to score events" } }
          : null,
      });
    }
  } catch (error) {
    useScore.setState({
      initialised: true,
      operationError: {
        code: "score-infrastructure",
        details: {
          operation: listenerError ? "subscribing to score events" : "reading score state",
        },
      },
    });
    reportFailure(error, "reading score state");
  }
  if (listenerError) reportFailure(listenerError, "subscribing to score events");
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

subscribe: acquireSubscription,
```

Add `isScoreStale(error)` and `isScoreInfrastructure(error)` beside the existing `scoreErrorMessage` helper. Picker/reopen catch handling is exact: suppress stale; call `reportFailure` for `score-infrastructure` or a non-`RiffError`; suppress any other typed rejection because Rust successfully emitted the matching `score://open-failed` to the current Score host, which may be another webview. Wrap close with the stale helper and report every other close failure. Adopt a non-null picker/reopen return immediately, and when `scoreClose` returns `true`, set `open` to null immediately; the later `score://changed` broadcast is idempotent confirmation for this webview and synchronization for all others. Do not clear the active score before a replacement has succeeded.

Both `openFromPicker` and `reopen` clear `operationError` before invoking. A picker cancellation returns null and leaves the active score unchanged; it does not create an error. `clearOperationError` changes only that field.

`adoptView` replaces only `open.view` when the supplied generation is still current. A stale response is ignored. This is the initiating viewer's immediate command-result adoption; Rust's later `score://changed` broadcast confirms it and updates the other webviews.

Add direct helper tests asserting only `{ code: "score-stale" }` is stale, only `{ code: "score-infrastructure", details: { operation: "test" } }` is infrastructure, and missing/unreadable/encrypted/stale/infrastructure all resolve non-empty locale messages.

- [ ] **Step 4: Subscribe once per webview and remove duplicate score state.**

Call `useScore.getState().subscribe()` in the root route's mount effect. Guard its asynchronous release so an unmount before installation completes immediately releases the acquired reference; report an installation rejection with `reportFailure` rather than leaving an unhandled promise. Replace `useOpenScore` consumers with selectors from `useScore`. Delete the hook only after `rg "useOpenScore" src` returns no matches. `PracticePane` receives or selects the same `open` value; it must not keep a second error/open state.

```ts
useEffect(() => {
  let disposed = false;
  let release: (() => void) | undefined;
  void useScore.getState().subscribe().then((unsubscribe) => {
    if (disposed) unsubscribe();
    else release = unsubscribe;
  }).catch((error: unknown) => reportFailure(error, "subscribing to score state"));
  return () => {
    disposed = true;
    release?.();
  };
}, []);
```

- [ ] **Step 5: Verify and commit.**

```bash
pnpm vitest run src/stores/score.test.ts src/features/practice/score/scoreError.test.ts src/routes/-__root.test.tsx src/features/practice/PracticePane.test.tsx
pnpm typecheck
git add src/stores/score.ts src/stores/score.test.ts src/routes/__root.tsx src/features/practice/PracticePane.tsx src/features/practice/score/scoreError.ts src/features/practice/score/scoreError.test.ts
git rm src/features/practice/score/useOpenScore.ts
git commit -m "refactor(score): centralize frontend score state"
```

---

## Task 5: Add a Recoverable Score Surface and Lazy Practice Bundle

**Files:**

- Create: `src/features/practice/score/ScoreSurface.tsx`
- Create: `src/features/practice/score/ScoreSurface.test.tsx`
- Modify: `src/features/practice/PracticePane.tsx`
- Modify: `src/features/practice/PracticePane.test.tsx`
- Modify: `src/features/practice/score/scoreError.ts`
- Modify: `src/locales/en/common.json`
- Modify: `src/locales/en/errors.json`

**Interface:**

Define this in `scoreError.ts` so the viewer and surface share it without importing each other's components:

```ts
export type ScoreLoadFailure =
  | { kind: "riff"; error: RiffError }
  | { kind: "unsupportedWebkit"; installed: string; required: string }
  | { kind: "renderer"; details: string };
```

- [ ] **Step 1: Add failing surface tests for the 10-second threshold and every recovery action.**

```tsx
it("keeps the viewer mounted and offers recovery after ten seconds", async () => {
  vi.useFakeTimers();
  render(<ScoreSurface open={OPEN_SCORE} />);
  expect(screen.getByTestId("score-viewer")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByRole("status")).toHaveTextContent("Taking longer than expected");
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Open another score" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Close score" })).toBeEnabled();
  expect(screen.getByTestId("score-viewer")).toBeInTheDocument();
});

it("remounts only the current generation when retry is pressed", async () => {
  render(<ScoreSurface open={OPEN_SCORE} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByTestId("score-viewer")).toHaveAttribute("data-attempt", "1");
});
```

Also test renderer failure copy, unsupported-WebKit copy, typed Riff errors, open-another calling the store, and close passing `open.generation`.

- [ ] **Step 2: Run the focused UI tests and observe the missing surface.**

```bash
pnpm vitest run src/features/practice/score/ScoreSurface.test.tsx src/features/practice/PracticePane.test.tsx
```

- [ ] **Step 3: Implement the explicit surface state machine.**

`ScoreSurface` owns `{ attempt, phase, failure }`, resets them on `open.generation`, starts a 10-second timer for each attempt, and renders `ScoreViewer` with `key={`${open.generation}:${attempt}`}`. The viewer callbacks are:

```ts
type ScoreViewerCallbacks = {
  onFirstPagePaint: () => void;
  onFailure: (failure: ScoreLoadFailure) => void;
};
```

The slow state is an overlay/status adjacent to the still-mounted viewer. A terminal failure replaces the viewer with an error panel. Missing/unreadable/encrypted and unknown PDF.js failures show Retry, Open another, and Close; worker start/transient renderer failures show Retry and Close; unsupported WebKit shows installed/required versions and Close only; stale never renders. Retry increments `attempt`; open another invokes the score store picker; close passes the active generation. Unknown failures put technical details in a collapsed disclosure. Include one polite live region for phase changes.

- [ ] **Step 4: Lazy-load the score surface from `PracticePane`.**

```tsx
const ScoreSurface = lazy(() =>
  import("./score/ScoreSurface").then((module) => ({ default: module.ScoreSurface })),
);
```

While `initialised` is false, render the score skeleton rather than the empty state. Once initialised, render the lazy surface only when `open` exists, inside `Suspense` with the same skeleton. When no score is open, show the store's preflight `operationError` with Open another and Dismiss actions or the normal empty state; Rust does not retain a failed picker/drop path, so this surface must not promise a retry it cannot perform. There must be no static import of `ScoreViewer`, `pdfjs-dist`, or `pdfRuntime` in `PracticePane`.

- [ ] **Step 5: Add concrete localized copy.**

Add messages for loading, slow loading, retry, open another, close, unsupported WebKit with installed/required interpolation, renderer initialization, unreadable, encrypted, missing, `score-stale` fallback, and the non-fatal workspace/open operation messages. Every rendered error panel must present the actions assigned in Step 3.

- [ ] **Step 6: Verify and commit.**

```bash
pnpm vitest run src/features/practice/score/ScoreSurface.test.tsx src/features/practice/PracticePane.test.tsx
pnpm typecheck
git add src/features/practice/score/ScoreSurface.tsx src/features/practice/score/ScoreSurface.test.tsx src/features/practice/PracticePane.tsx src/features/practice/PracticePane.test.tsx src/features/practice/score/scoreError.ts src/locales/en/common.json src/locales/en/errors.json
git commit -m "feat(score): add recoverable score loading states"
```

---

## Task 6: Gate and Dynamically Load One PDF.js Runtime

**Files:**

- Create: `src/features/practice/score/loadPdfRuntime.ts`
- Create: `src/features/practice/score/loadPdfRuntime.test.ts`
- Rename: `src/features/practice/score/pdfjs.ts` to `src/features/practice/score/pdfRuntime.ts`
- Modify: `src/features/practice/score/pdfRuntime.ts`
- Modify: `src/features/practice/score/ScoreViewer.tsx`
- Modify: `src/features/practice/score/webkitVersion.ts`

**Interfaces:**

```ts
export class UnsupportedWebKitError extends Error {
  constructor(public installed: string, public required: string, options?: ErrorOptions) {
    super("Unsupported WebKitGTK", options);
  }
}

export async function loadPdfRuntime(
  installed: string | undefined,
  importer: () => Promise<PdfRuntime> = () => import("./pdfRuntime"),
): Promise<PdfRuntime>;
```

- [ ] **Step 1: Add failing preflight tests with an injected importer.**

```ts
it("does not import PDF.js when a known WebKit is below the floor", async () => {
  const importer = vi.fn();
  await expect(loadPdfRuntime("2.35.9", importer)).rejects.toMatchObject({
    installed: "2.35.9",
    required: MIN_WEBKITGTK,
  });
  expect(importer).not.toHaveBeenCalled();
});

it("attempts the runtime when WebKit is unknown", async () => {
  const runtime = fakeRuntime();
  const importer = vi.fn().mockResolvedValue(runtime);
  await expect(loadPdfRuntime(undefined, importer)).resolves.toBe(runtime);
  expect(importer).toHaveBeenCalledOnce();
});

it("classifies an unknown runtime import failure as compatibility", async () => {
  const cause = new SyntaxError("unsupported syntax");
  await expect(loadPdfRuntime("unknown", vi.fn().mockRejectedValue(cause))).rejects.toMatchObject({
    installed: "unknown",
    required: MIN_WEBKITGTK,
    cause,
  });
});

it("returns a single memoized import to concurrent callers", async () => {
  const importer = vi.fn().mockResolvedValue(fakeRuntime());
  await Promise.all([loadPdfRuntime("2.44.0", importer), loadPdfRuntime("2.44.0", importer)]);
  expect(importer).toHaveBeenCalledOnce();
});
```

Reset the module cache between tests through an exported test-only reset function guarded by `import.meta.env.MODE === "test"`.

- [ ] **Step 2: Run the test and observe the missing loader.**

```bash
pnpm vitest run src/features/practice/score/loadPdfRuntime.test.ts
```

- [ ] **Step 3: Implement compare-before-import and classify import failures.**

Read the installed version from `useSettings.getState().appInfo.webkitVersion`. A known lower version throws `UnsupportedWebKitError` before calling the importer. `undefined`, an empty string, and the bootstrap sentinel `"unknown"` all attempt the import, as do supported versions. If an unknown runtime's import fails, wrap the cause in `UnsupportedWebKitError("unknown", MIN_WEBKITGTK, { cause })`; if a known supported runtime's import fails, preserve the ordinary `Error` so `ScoreViewer` maps it to `{ kind: "renderer", details }`.

Memoize only a successful or in-flight import. Clear the cached promise after a rejection so Retry performs a fresh import.

```ts
let runtimePromise: Promise<PdfRuntime> | null = null;

export function loadPdfRuntime(
  installed: string | undefined,
  importer: () => Promise<PdfRuntime> = () => import("./pdfRuntime"),
): Promise<PdfRuntime> {
  const known = /^\d+\.\d+\.\d+$/.test(installed ?? "");
  if (known && !meetsMinimumWebkit(installed as string)) {
    return Promise.reject(new UnsupportedWebKitError(installed as string, MIN_WEBKITGTK));
  }
  runtimePromise ??= importer().catch((cause: unknown) => {
    runtimePromise = null;
    if (!known) throw new UnsupportedWebKitError("unknown", MIN_WEBKITGTK, { cause });
    throw cause;
  });
  return runtimePromise;
}
```

- [ ] **Step 4: Export one worker factory and remove the double-worker probe.**

`pdfRuntime.ts` owns all value imports from `pdfjs-dist`, the worker URL, security options, and:

```ts
let workerSequence = 0;

export async function createScoreWorker(): Promise<PDFWorker> {
  const worker = new PDFWorker({ name: `riff-score-${workerSequence += 1}` });
  await worker.promise;
  if (typeof Worker === "undefined" || !(worker.port instanceof Worker)) {
    worker.destroy();
    throw new Error("PDF.js fell back to a main-thread worker");
  }
  return worker;
}

export const scoreDocumentOptions = {
  isEvalSupported: false,
  disableAutoFetch: true,
  disableStream: true,
  disableRange: true,
  enableXfa: false,
  stopAtErrors: true,
  useWorkerFetch: false,
  useWasm: false,
} as const;
```

Pass that same worker into `getDocument`; do not create a probe worker. Export `isPasswordException(error: unknown)` from `pdfRuntime.ts`, implemented there with the PDF.js `PasswordException` constructor. Keep type-only PDF.js imports in `ScoreViewer` legal via `import type`.

- [ ] **Step 5: Verify and commit.**

```bash
pnpm vitest run src/features/practice/score/loadPdfRuntime.test.ts src/features/practice/score/webkitVersion.test.ts
pnpm typecheck
git add src/features/practice/score/loadPdfRuntime.ts src/features/practice/score/loadPdfRuntime.test.ts src/features/practice/score/pdfRuntime.ts src/features/practice/score/ScoreViewer.tsx src/features/practice/score/webkitVersion.ts
git rm src/features/practice/score/pdfjs.ts
git commit -m "refactor(score): load PDF runtime after compatibility checks"
```

---

## Task 7: Rebuild the Viewer Lifecycle Around Generation and First Paint

**Files:**

- Modify: `src/features/practice/score/ScoreViewer.tsx`
- Modify: `src/features/practice/score/ScoreViewer.test.tsx`
- Modify: `src/features/practice/score/pdfRuntime.ts`
- Modify: `src/features/practice/score/scoreError.ts`

**Lifecycle contract:** one viewer attempt owns exactly one generation, worker, loading task, PDF document, event bus, viewer instance, resize observer, and Tauri command listener. Every owned resource is destroyed or detached during retry, generation change, or unmount.

- [ ] **Step 1: Replace name/size lifecycle tests with generation and cancellation tests.**

Add fakes whose promises can resolve out of order and whose cleanup calls are observable:

```tsx
it("ignores every continuation from an overtaken generation", async () => {
  const first = deferred<ArrayBuffer>();
  vi.mocked(ipc.scoreBytes)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(SECOND_BYTES);
  const { rerender } = render(<ScoreViewer open={FIRST_OPEN} {...callbacks} />);
  rerender(<ScoreViewer open={SECOND_OPEN} {...callbacks} />);
  first.resolve(FIRST_BYTES);
  await flushPromises();
  expect(getDocument).toHaveBeenCalledTimes(1);
  expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: SECOND_BYTES }));
});

it("does not report ready until the first visible page paints", async () => {
  render(<ScoreViewer open={FIRST_OPEN} {...callbacks} />);
  await settleDocumentLoad();
  expect(callbacks.onFirstPagePaint).not.toHaveBeenCalled();
  pdfEventBus.dispatch("pagerendered", { pageNumber: FIRST_OPEN.view.page, cssTransform: false });
  expect(callbacks.onFirstPagePaint).toHaveBeenCalledOnce();
});

it("destroys every owned resource on unmount", async () => {
  const { unmount } = render(<ScoreViewer open={FIRST_OPEN} {...callbacks} />);
  await settleDocumentLoad();
  unmount();
  expect(loadingTask.destroy).toHaveBeenCalledOnce();
  await waitFor(() => expect(worker.destroy).toHaveBeenCalledOnce());
  expect(viewerController.destroy).toHaveBeenCalledOnce();
  expect(resizeObserver.disconnect).toHaveBeenCalledOnce();
  expect(unlistenCommand).toHaveBeenCalledOnce();
});

it("destroys a worker when cancellation wins before getDocument exists", async () => {
  const workerStart = deferred<PDFWorker>();
  vi.mocked(runtime.createScoreWorker).mockReturnValue(workerStart.promise);
  const { unmount } = render(<ScoreViewer open={FIRST_OPEN} {...callbacks} />);
  unmount();
  workerStart.resolve(worker);
  await flushPromises();
  expect(worker.destroy).toHaveBeenCalledOnce();
  expect(getDocument).not.toHaveBeenCalled();
});
```

Add cases for runtime rejection, `scoreBytes` `ScoreStale` suppression, encrypted/unreadable PDF.js exception mapping, view-patch result adoption, and command events with a different generation being ignored. Remove the old page-one text-content preflight expectation.

- [ ] **Step 2: Run the viewer test and observe failures against the old effect.**

```bash
pnpm vitest run src/features/practice/score/ScoreViewer.test.tsx
```

- [ ] **Step 3: Implement a cancellation guard after every await.**

The effect key is `open.generation`. Use this structure:

```ts
useEffect(() => {
  let cancelled = false;
  let worker: PDFWorker | null = null;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let runtime: PdfRuntime | null = null;
  let stage: ScoreLoadStage = "runtime";
  let destroyController: (() => void) | null = null;
  let unlistenCommand: (() => void) | null = null;

  const active = () => !cancelled;
  const start = async () => {
    try {
      runtime = await loadPdfRuntime(useSettings.getState().appInfo.webkitVersion);
      if (!active()) return;
      stage = "worker";
      worker = await runtime.createScoreWorker();
      if (!active()) {
        worker.destroy();
        worker = null;
        return;
      }
      stage = "bytes";
      const bytes = new Uint8Array(await ipc.scoreBytes(open.generation));
      if (!active()) return;
      stage = "document";
      loadingTask = runtime.getDocument({
        data: bytes,
        worker,
        ...runtime.scoreDocumentOptions,
      });
      const document = await loadingTask.promise;
      if (!active()) return;
      stage = "viewer";
      const controller = createPdfViewerController(runtime, containerRef.current);
      let firstPaintSeen = false;
      controller.eventBus.on("pagerendered", () => {
        if (active() && !firstPaintSeen) {
          firstPaintSeen = true;
          onFirstPagePaint();
        }
      });
      controller.connect(document, open.view);
      destroyController = () => controller.destroy();
      unlistenCommand = await listen<ScoreCommandEvent>("score://command", ({ payload }) => {
        if (payload.generation === open.generation) controller.run(payload.command);
      });
      if (!active()) unlistenCommand();
    } catch (error) {
      if (active() && !isScoreStale(error)) {
        const failure = classifyScoreLoadFailure(error, stage, runtime?.isPasswordException);
        void ipc.logWrite("warn", "score viewer load failed", { stage, failure }).catch(() => {});
        onFailure(failure);
      }
    }
  };
  void start();
  return () => {
    cancelled = true;
    unlistenCommand?.();
    try {
      destroyController?.();
    } catch (error) {
      void ipc.logWrite("warn", "score viewer cleanup failed", { error: String(error) }).catch(() => {});
    }
    if (loadingTask) {
      void loadingTask
        .destroy()
        .catch((error: unknown) =>
          ipc.logWrite("warn", "PDF loading task cleanup failed", { error: String(error) }).catch(() => {}),
        )
        .finally(() => worker?.destroy());
    } else {
      worker?.destroy();
    }
  };
}, [open.generation, onFailure, onFirstPagePaint]);
```

Keep callbacks stable in `ScoreSurface` with `useCallback` so they do not restart the effect. `createPdfViewerController` constructs the viewer without assigning a document; register the first-paint listener before `controller.connect` assigns `viewer.pdfDocument`, preventing a fast render from beating the listener. Its `destroy` method disconnects the ResizeObserver, removes DOM/EventBus/scroll handlers, clears the viewer document, and removes created viewer nodes. “First page paint” means the first `pagerendered` event for the visible restored page, not specifically PDF page number 1.

- [ ] **Step 4: Persist only canonical, current view state.**

Debounce page/scale/rotation/layout changes as currently done, but attach an incrementing patch sequence. Call `scoreViewPatch(open.generation, proposed)`, ignore stale errors, and adopt the returned canonical view locally and through `useScore.getState().adoptView(open.generation, canonical)` only if its sequence is the newest outstanding patch. Never let an old response overwrite later local interaction. Report every non-stale patch failure globally and keep the already-rendered score usable; a persistence/validation failure after first paint is not a document load failure.

- [ ] **Step 5: Preserve security options and remove page-one text probing.**

Pass the Task 6 options to every `getDocument` call. Construct `PDFLinkService`, then assign `linkService.externalLinkEnabled = false`. Construct `PDFViewer` with `annotationMode: AnnotationMode.ENABLE` and `enableScripting: false`. Do not enable eval, XFA, range, stream, auto-fetch, remote worker fetch, WebAssembly asset fetch, external links, or PDF scripting. Search capability is determined by find events when the user searches, not by eagerly extracting page-one text. Tests must assert each option and the post-construction link-service assignment.

Track the current load stage as `runtime`, `worker`, `bytes`, `document`, or `viewer`. In `scoreError.ts`, classify in this order: `ScoreStale` is suppressed; `UnsupportedWebKitError` becomes `unsupportedWebkit`; an existing `RiffError` becomes `riff`; `runtime.isPasswordException(error)` becomes `riff` with `{ code: "score-encrypted" }`; runtime/worker failures become `renderer`; document/viewer failures become `riff` with `{ code: "score-unreadable", details: { reason: String(error) } }`. This keeps malformed-document recovery distinct from a renderer that could not start without importing PDF.js values outside the runtime boundary.

- [ ] **Step 6: Verify and commit.**

```bash
pnpm vitest run src/features/practice/score/ScoreViewer.test.tsx src/features/practice/score/ScoreSurface.test.tsx
pnpm typecheck
git add src/features/practice/score/ScoreViewer.tsx src/features/practice/score/ScoreViewer.test.tsx src/features/practice/score/pdfRuntime.ts src/features/practice/score/scoreError.ts
git commit -m "fix(score): make viewer lifecycle generation-safe"
```

---

## Task 8: Route Commands Cross-Window and Remove Keyboard Conflicts

**Files:**

- Delete: `src/features/practice/score/commands.ts`
- Modify: `src/routes/__root.tsx`
- Modify: `src/features/keybindings/keymap.ts`
- Modify: `src/features/keybindings/chord.ts`
- Modify: `src/features/keybindings/useKeybindings.ts`
- Modify: `src/features/keybindings/chord.test.ts`
- Modify: `src/features/keybindings/keymap.test.ts`
- Modify: `src/features/keybindings/useKeybindings.test.tsx`
- Modify: `src/features/practice/score/ScoreViewer.tsx`

- [ ] **Step 1: Add failing tests for physical-key normalization and editing protection.**

```ts
it.each([
  [{ key: "+", code: "Equal", ctrlKey: true, shiftKey: true }, "ctrl+shift+="],
  [{ key: "=", code: "Equal", ctrlKey: true, shiftKey: false }, "ctrl+="],
  [{ key: " ", code: "Space", ctrlKey: true, shiftKey: true }, "ctrl+shift+space"],
])("normalizes physical score keys", (event, expected) => {
  expect(chordFromEvent(keyboardEvent(event))).toBe(expected);
});

it("formats the normalized Space key for display", () => {
  expect(formatChord("ctrl+shift+space")).toBe("Ctrl+Shift+Space");
});

it.each(["input", "textarea", "select", "contenteditable", "slider"])(
  "does not run score shortcuts while editing %s",
  (targetKind) => {
    const event = targetedKeyboardEvent(targetKind, { code: "Space", ctrlKey: true, shiftKey: true });
    dispatchKey(event);
    expect(runScoreCommand).not.toHaveBeenCalled();
  },
);
```

Add a root test proving a score command invokes `ipc.scoreCommand(open.generation, command)` even when the practice pane is popped out. Add a viewer test proving only the hosting webview responds to `score://command` for its generation.

- [ ] **Step 2: Run focused interaction tests and observe current conflicts.**

```bash
pnpm vitest run src/features/keybindings/chord.test.ts src/features/keybindings/keymap.test.ts src/features/keybindings/useKeybindings.test.tsx src/routes/-__root.test.tsx
```

- [ ] **Step 3: Define non-conflicting default chords.**

Set score auto-scroll to `Ctrl+Shift+Space`. Keep zoom on `Ctrl+=` and `Ctrl+-`; keep speed on `Ctrl+Shift+=` and `Ctrl+Shift+-`. Normalize `Equal`, `Minus`, and `Space` using `event.code`, while retaining the existing platform modifier order. Internal chord strings remain lowercase; `formatChord` turns `space` into the visible label `Space`.

Suppress application shortcuts when the event target is `input`, `textarea`, `select`, contenteditable, or has `role="slider"`. Preserve Escape behavior only where an open overlay explicitly owns it.

- [ ] **Step 4: Send score commands through Rust.**

The root keybinding handler obtains the current score store snapshot and calls:

```ts
const open = useScore.getState().open;
if (open) {
  try {
    await ipc.scoreCommand(open.generation, command);
  } catch (error) {
    if (!isScoreStale(error)) reportFailure(error, "sending a score command");
  }
}
```

The score-hosting viewer listens to the targeted event implemented in Task 3. Delete the feature-local emitter and verify `rg "score/commands|emitScoreCommand" src` has no matches.

Opening search, choosing a page, or opening/focusing/changing the speed control explicitly stops auto-scroll before performing the requested command.

- [ ] **Step 5: Verify and commit.**

```bash
pnpm vitest run src/features/keybindings/chord.test.ts src/features/keybindings/keymap.test.ts src/features/keybindings/useKeybindings.test.tsx src/routes/-__root.test.tsx src/features/practice/score/ScoreViewer.test.tsx
pnpm typecheck
git add src/routes/__root.tsx src/features/keybindings/keymap.ts src/features/keybindings/chord.ts src/features/keybindings/useKeybindings.ts src/features/keybindings/chord.test.ts src/features/keybindings/keymap.test.ts src/features/keybindings/useKeybindings.test.tsx src/features/practice/score/ScoreViewer.tsx
git rm src/features/practice/score/commands.ts
git commit -m "fix(score): route conflict-free cross-window commands"
```

---

## Task 9: Make Every Toolbar Action Reachable at Every Width

**Files:**

- Modify: `src/features/practice/score/ScoreToolbar.tsx`
- Modify: `src/features/practice/score/ScoreToolbar.test.tsx`
- Modify: `src/features/practice/score/score.css`
- Modify: `src/locales/en/common.json`

- [ ] **Step 1: Add failing toolbar structure and interaction tests.**

```tsx
it("renders both overflow tiers with the same command callbacks", async () => {
  render(<ScoreToolbar {...props} />);
  await user.click(screen.getByTestId("score-overflow-last-trigger"));
  const lastOverflow = screen.getByTestId("score-overflow-last");
  expect(within(lastOverflow).getByRole("button", { name: "Auto-scroll" })).toBeEnabled();
  expect(within(lastOverflow).getByRole("slider", { name: "Auto-scroll speed" })).toBeEnabled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByTestId("score-overflow-all-trigger"));
  const allOverflow = screen.getByTestId("score-overflow-all");
  expect(within(allOverflow).getByRole("button", { name: "Rotate" })).toBeEnabled();
  expect(within(allOverflow).getByRole("button", { name: "Scroll mode" })).toBeEnabled();
  await user.click(within(allOverflow).getByRole("button", { name: "Zoom in" }));
  expect(props.onZoom).toHaveBeenCalledWith(1);
});

it("has an accessible name and expanded state on each overflow trigger", () => {
  render(<ScoreToolbar {...props} />);
  for (const trigger of screen.getAllByRole("button", { name: "More score controls" })) {
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
});
```

- [ ] **Step 2: Run the toolbar test and observe hidden-without-overflow behavior.**

```bash
pnpm vitest run src/features/practice/score/ScoreToolbar.test.tsx
```

- [ ] **Step 3: Extract reusable control groups and render two Popover overflows.**

Create `CoreControls`, `NextTierControls`, and `LastTierControls` inside `ScoreToolbar.tsx`. `CoreControls` contains previous, page field, next, fit, and search. `NextTierControls` contains zoom, scroll mode, spread, and rotation. `LastTierControls` contains auto-scroll, its speed slider, and pin. Inline composition renders all three. The `data-toolbar-overflow="last"` popover renders `LastTierControls`; `data-toolbar-overflow="all"` renders `NextTierControls` plus `LastTierControls`. Pass the same callback object to inline and overflow copies so behavior cannot diverge.

Use the repository Popover primitive. Each trigger has localized `aria-label="More score controls"`, reflects `aria-expanded`, and returns focus to the trigger when closed.

Keep every button and slider at least `1.5rem` by `1.5rem` in both densities. `LastTierControls` calls a shared `onSpeedInteractionStart` on slider focus and pointer-down so touching the speed control pauses auto-scroll before its value changes.

- [ ] **Step 4: Implement exact container-query visibility.**

At 46rem and wider, all inline groups show and both overflow triggers are hidden. From 34rem to below 46rem, hide only `LastTierControls` inline and show only the `last` overflow. Below 34rem, keep `CoreControls` inline, hide both collapsing tiers, and show only the `all` overflow. Do not use the currently dead `data-toolbar-overflow` selector without matching markup.

Add a CSS source test or toolbar class assertion proving each of the three states has a reachable control path.

- [ ] **Step 5: Verify and commit.**

```bash
pnpm vitest run src/features/practice/score/ScoreToolbar.test.tsx
pnpm typecheck
git add src/features/practice/score/ScoreToolbar.tsx src/features/practice/score/ScoreToolbar.test.tsx src/features/practice/score/score.css src/locales/en/common.json
git commit -m "fix(score): keep toolbar controls reachable"
```

---

## Task 10: Fix Search, Focus Return, and Screen-Reader Announcements

**Files:**

- Modify: `src/features/practice/score/ScoreSearch.tsx`
- Create: `src/features/practice/score/ScoreSearch.test.tsx`
- Modify: `src/features/practice/score/ScoreToolbar.tsx`
- Modify: `src/features/practice/score/ScoreViewer.tsx`
- Modify: `src/features/practice/score/ScoreViewer.test.tsx`
- Modify: `src/locales/en/common.json`

- [ ] **Step 1: Add failing behavior tests.**

```tsx
it("allows search before any page text has been probed", () => {
  render(
    <ScoreSearch
      query=""
      status={NO_SEARCH}
      onQueryChange={onQueryChange}
      onFindAgain={onFindAgain}
      onClose={onClose}
    />,
  );
  expect(screen.getByRole("searchbox")).toBeEnabled();
});

it("explains that an image-only score may have no searchable text", async () => {
  const { rerender } = render(
    <ScoreSearch
      query="allegro"
      status={{ query: "allegro", state: "pending", current: 0, total: 0 }}
      onQueryChange={onQueryChange}
      onFindAgain={onFindAgain}
      onClose={onClose}
    />,
  );
  rerender(
    <ScoreSearch
      query="allegro"
      status={{ query: "allegro", state: "not-found", current: 0, total: 0 }}
      onQueryChange={onQueryChange}
      onFindAgain={onFindAgain}
      onClose={onClose}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("scanned or image-only");
});

it("returns focus to the find trigger when search closes", async () => {
  render(<ToolbarWithSearch />);
  await user.click(screen.getByRole("button", { name: "Find" }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Find" })).toHaveFocus();
});
```

Add viewer announcement tests: no announcement on initial load, one announcement after a manual page change, none for page changes attributed to auto-scroll, and exactly one message for each explicit auto-scroll start and stop.

- [ ] **Step 2: Run the focused accessibility tests and observe failures.**

```bash
pnpm vitest run src/features/practice/score/ScoreSearch.test.tsx src/features/practice/score/ScoreViewer.test.tsx
```

- [ ] **Step 3: Remove eager text gating and model find state.**

Delete `hasText` and the page-one `getTextContent` probe. The search input is always enabled for a loaded document. Track `{ query, current, total, pending }` from PDF.js find events. When a non-empty query settles with zero matches, render `No matches. This score may be scanned or image-only.` in a polite status region.

- [ ] **Step 4: Restore focus and announce only meaningful transitions.**

Give the Find trigger a ref. On search close, schedule `triggerRef.current?.focus()` in `requestAnimationFrame`. Track the last announced manual page separately from current page. Suppress the initial page, repeated page values, programmatic layout updates, and auto-scroll-attributed transitions. Announce `Page {page} of {pages}` only after a manual page navigation settles. The explicit toggle announces `Auto-scroll started` or `Auto-scroll stopped` once; visibility/manual-intent safety pauses announce the stop only when auto-scroll was actually running.

- [ ] **Step 5: Verify semantics and commit.**

```bash
pnpm vitest run src/features/practice/score/ScoreSearch.test.tsx src/features/practice/score/ScoreViewer.test.tsx src/features/practice/score/ScoreToolbar.test.tsx
pnpm typecheck
git add src/features/practice/score/ScoreSearch.tsx src/features/practice/score/ScoreSearch.test.tsx src/features/practice/score/ScoreToolbar.tsx src/features/practice/score/ScoreViewer.tsx src/features/practice/score/ScoreViewer.test.tsx src/locales/en/common.json
git commit -m "fix(score): make search and announcements accessible"
```

---

## Task 11: Bound Auto-Scroll and Pause It for Visibility or Manual Intent

**Files:**

- Modify: `src/features/practice/score/useAutoScroll.ts`
- Modify: `src/features/practice/score/useAutoScroll.test.ts`
- Modify: `src/features/practice/score/ScoreViewer.tsx`

**Interface:**

```ts
const MAX_FRAME_SECONDS = 0.1;
const pixels = speedPixelsPerSecond * Math.min((timestamp - previous) / 1_000, MAX_FRAME_SECONDS);
```

- [ ] **Step 1: Add failing tests for background throttling and intent pauses.**

```ts
it("caps one animation-frame delta at one tenth of a second", () => {
  const { element, ref } = fakeContainer();
  renderHook(() => useAutoScroll({ ...BASE, container: ref }));
  tick(5_000);
  expect(element.scrollTop).toBeCloseTo(100, 0);
});

it("pauses when the document becomes hidden and does not jump on return", () => {
  const onPause = vi.fn();
  const { element, ref } = fakeContainer();
  renderHook(() => useAutoScroll({ ...BASE, onPause, container: ref }));
  tick(100);
  const beforeHide = element.scrollTop;
  setDocumentVisibility("hidden");
  tick(10_000);
  setDocumentVisibility("visible");
  tick(16);
  expect(element.scrollTop).toBe(beforeHide);
  expect(onPause).toHaveBeenCalledOnce();
});

it.each(["page", "search", "speed"])("pauses before a manual %s command", (kind) => {
  const controller = mountedControllerWithAutoScroll();
  controller.run(manualCommand(kind));
  expect(controller.autoScroll.stop).toHaveBeenCalledBefore(controller.performManualAction);
});
```

- [ ] **Step 2: Run the focused hook test and observe the unbounded delta.**

```bash
pnpm vitest run src/features/practice/score/useAutoScroll.test.ts
```

- [ ] **Step 3: Implement the cap and visibility lifecycle.**

Clamp elapsed seconds before multiplying by speed or accumulating page-mode time. Listen for `visibilitychange`; when hidden, cancel the frame, clear the previous timestamp, call `onPause` once, and return from the loop. The controlled `running` prop becomes false through the viewer state update, so visibility returning cannot resume implicitly. Remove the listener and cancel any frame on cleanup.

In the viewer command dispatcher, set `scrolling` false before page navigation, search opening/submission, and speed changes. Preserve the hook's passive scroll listener and expected-position tolerance so wheel/touch scrolling pauses while its own programmatic scroll does not. A later explicit auto-scroll command may start it again. Cleanup removes both the visibility and scroll listeners.

- [ ] **Step 4: Verify and commit.**

```bash
pnpm vitest run src/features/practice/score/useAutoScroll.test.ts src/features/practice/score/ScoreViewer.test.tsx
pnpm typecheck
git add src/features/practice/score/useAutoScroll.ts src/features/practice/score/useAutoScroll.test.ts src/features/practice/score/ScoreViewer.tsx
git commit -m "fix(score): bound and pause auto scroll"
```

---

## Task 12: Unify Startup Reopen and Workspace Write-Failure UX

**Files:**

- Modify: `src/routes/__root.tsx`
- Modify: `src/routes/-__root.test.tsx`
- Modify: `src/stores/score.ts`
- Modify: `src/stores/score.test.ts`
- Modify: `src/locales/en/common.json`
- Modify: `src/locales/en/errors.json`

- [ ] **Step 1: Add failing tests for one combined prompt and one persistent write toast.**

```tsx
it("offers one combined reopen and continues when one pane fails", async () => {
  vi.mocked(ipc.practicePendingReopen).mockResolvedValue(["score"]);
  vi.mocked(ipc.scorePendingReopen).mockResolvedValue({ name: "Etude.pdf", size: 42 });
  vi.mocked(ipc.practiceReopen).mockRejectedValue({
    code: "not-found",
    details: { what: "a pending pane window" },
  });
  render(<RootHarness />);
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  const options = toast.mock.calls[0]?.[1];
  await options.action.onClick();
  expect(ipc.practiceReopen).toHaveBeenCalledOnce();
  expect(ipc.scoreReopen).toHaveBeenCalledOnce();
  expect(options.action.label).toBe("Reopen");
});

it("deduplicates workspace write failures with a stable toast id", async () => {
  await useScore.getState().subscribe();
  const error = { code: "io", details: { path: "workspace.json", message: "disk full" } } as const;
  await emitCaptured("workspace://write-failed", error);
  await emitCaptured("workspace://write-failed", error);
  expect(toast.error).toHaveBeenCalledTimes(2);
  expect(toast.error.mock.calls[0][1]).toMatchObject({ id: "workspace-write-failed" });
  expect(toast.error.mock.calls[1][1]).toMatchObject({ id: "workspace-write-failed" });
});
```

The toast library may receive two update calls; the stable ID ensures one visible toast. Also test that its action invokes `ipc.openPath("data")` rather than exposing a raw path.

- [ ] **Step 2: Run focused root/store tests and observe duplicate prompt behavior.**

```bash
pnpm vitest run src/routes/-__root.test.tsx src/stores/score.test.ts
```

- [ ] **Step 3: Query pending state only after subscriptions are live.**

The root initialization order is:

1. Await score store subscription.
2. In the main window only, fetch practice and score pending flags concurrently.
3. Show one `Restore your workspace?` prompt describing exactly what is pending.
4. On acceptance, await `practiceReopen()` first; report its failure but continue.
5. Then await the score store's `reopen()` so Rust targets the actual final Score host; report a non-stale infrastructure failure without undoing reopened panes.
6. Never prompt in a pane window.

Because Rust consumes the score pending record before awaiting, repeated clicks cannot open the same score twice. Disable the accept button while restore calls are in flight.

- [ ] **Step 4: Subscribe to workspace write failures in main.**

Register `workspace://write-failed` only when `getCurrentWindow().label === "main"`. Show localized text explaining that recent layout/score position changes may not survive restart. Use toast ID `workspace-write-failed` and an action that calls `ipc.openPath("data")`. Unlisten with the root cleanup.

- [ ] **Step 5: Verify and commit.**

```bash
pnpm vitest run src/routes/-__root.test.tsx src/stores/score.test.ts
pnpm typecheck
git add src/routes/__root.tsx src/routes/-__root.test.tsx src/stores/score.ts src/stores/score.test.ts src/locales/en/common.json src/locales/en/errors.json
git commit -m "fix(score): unify reopen and persistence failure UX"
```

---

## Task 13: Move PDF.js CSS to a Layered Boundary and Prove Lazy Loading

**Files:**

- Modify: `src/features/practice/score/score.css`
- Modify: `src/features/practice/score/pdfRuntime.ts`
- Modify: `src/features/practice/score/ScoreViewer.tsx`
- Create: `src/features/practice/score/importBoundaries.test.ts`
- Modify: `docs/adr/0005-pdf-viewer-css-is-imported-whole-and-its-pixels-left-alone.md`

- [ ] **Step 1: Add failing source-level import-boundary tests.**

```ts
it("keeps runtime PDF.js values behind the dynamic loader", () => {
  const files = productionSourcesOutside("src/features/practice/score/pdfRuntime.ts");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(/from ["']pdfjs-dist(?:\/|["'])/);
  }
});

it("loads the score surface lazily from the practice pane", () => {
  const source = readFileSync(resolve("src/features/practice/PracticePane.tsx"), "utf8");
  expect(source).toContain("lazy(() =>");
  expect(source).not.toMatch(/^import .*ScoreSurface/m);
  expect(source).not.toContain("ScoreViewer");
});

it("imports PDF.js viewer CSS through the score layer", () => {
  const source = readFileSync(resolve("src/features/practice/score/score.css"), "utf8");
  expect(source.trimStart()).toMatch(/^@import ["']pdfjs-dist\/web\/pdf_viewer\.css["'] layer\(pdfjs\);/);
});
```

The helper enumerates `.ts` and `.tsx` production files, excludes tests and `import type` lines, and reports the violating filename in the assertion message.

- [ ] **Step 2: Run the boundary test and observe the static CSS/runtime imports.**

```bash
pnpm vitest run src/features/practice/score/importBoundaries.test.ts
```

- [ ] **Step 3: Move the CSS import and eliminate static runtime values.**

Make the first statement of the feature-local `score.css`:

```css
@import "pdfjs-dist/web/pdf_viewer.css" layer(pdfjs);
```

Keep `ScoreViewer.tsx` importing `./score.css`, which preserves lazy score-chunk loading. Remove the direct upstream CSS import from TypeScript. Outside `pdfRuntime.ts`, permit PDF.js references only as `import type`; all constructors and `getDocument` come from the resolved runtime object.

- [ ] **Step 4: Record the deliberate global CSS exception in ADR 0005.**

State that PDF.js's viewer stylesheet is global because its internal DOM contract requires it, but it is isolated in the named `pdfjs` cascade layer and the score feature's own selectors remain `.score-*` scoped. State that runtime JavaScript remains a lazy practice-score chunk.

- [ ] **Step 5: Verify build chunking and commit.**

```bash
pnpm vitest run src/features/practice/score/importBoundaries.test.ts
pnpm build
rg "pdfjs" dist/assets
git add src/features/practice/score/score.css src/features/practice/score/pdfRuntime.ts src/features/practice/score/ScoreViewer.tsx src/features/practice/score/importBoundaries.test.ts docs/adr/0005-pdf-viewer-css-is-imported-whole-and-its-pixels-left-alone.md
git commit -m "perf(score): isolate the lazy PDF runtime"
```

Expected: build succeeds; the asset listing shows PDF.js in an asynchronously referenced chunk rather than the initial application module. Record exact before/after asset bytes in Task 15.

---

## Task 14: Build a Real WebKit2GTK Score Harness and Long Fixture

**Files:**

- Create: `scripts/score-harness/index.html`
- Create: `scripts/score-harness/main.tsx`
- Create: `scripts/score-harness/vite.config.mts`
- Create: `scripts/score-webkit-harness.py`
- Create: `scripts/generate-long-score.mjs`
- Create: `scripts/generate-link-score.mjs`
- Create: `src-tauri/tests/fixtures/scores/long-300-pages.pdf`
- Modify: `src-tauri/tests/fixtures/scores/external-link.pdf`
- Modify: `src-tauri/tests/fixtures/scores/README.md`
- Modify: `package.json`
- Test: `src/features/practice/score/importBoundaries.test.ts`

**Harness result contract:**

```ts
type HarnessResult = {
  fixture: string;
  status: "pass" | "controlled-error" | "fail";
  classification?: ScoreLoadFailure["kind"];
  firstPaintMs?: number;
  interactionMs?: number;
  page?: number;
  navigatedAway: boolean;
  assertions: Record<string, boolean>;
};
```

- [ ] **Step 1: Add a failing package/boundary test for the harness entry points.**

Extend `importBoundaries.test.ts` to assert that `package.json` contains `score:fixture`, `score:harness:build`, and `score:harness`, and that the harness imports the production `ScoreSurface` rather than a copied viewer.

```ts
expect(readFileSync("scripts/score-harness/main.tsx", "utf8"))
  .toContain('import("../../src/features/practice/score/ScoreSurface")');
```

Run:

```bash
pnpm vitest run src/features/practice/score/importBoundaries.test.ts
```

Expected: failure because the harness files and scripts do not exist.

- [ ] **Step 2: Create a deterministic 300-page PDF generator.**

`generate-long-score.mjs` requires `--pages` with a positive decimal integer and `--output` with a filesystem path. It accepts optional `--target-mib` with a positive decimal integer for uncommitted performance fixtures. Reject every other argument. Construct a PDF 1.7 file with:

- object 1: catalog pointing to object 2;
- object 2: pages tree containing objects `3` through `pages + 2`;
- one page object per requested page using the shared empty content object `pages + 3`;
- one Helvetica font object at `pages + 4`;
- when `--target-mib` is present, a benign unreferenced padding stream large enough that the final file is at least the requested size;
- byte-accurate xref offsets collected before appending each object;
- trailer, `startxref`, and `%%EOF`.

Write through a temporary sibling file and rename it over the output only after the complete buffer is assembled. Reject extra arguments and page counts below 1. Run:

```bash
node scripts/generate-long-score.mjs --pages 300 --output src-tauri/tests/fixtures/scores/long-300-pages.pdf
pdfinfo src-tauri/tests/fixtures/scores/long-300-pages.pdf | rg '^Pages:\s+300$'
```

Expected: `pdfinfo` exits 0 and reports exactly 300 pages. Document that the generated file tests long-document virtualization and lifecycle behavior and contains no copyrighted score content.

Create `generate-link-score.mjs` with no external dependencies. It writes a two-page PDF whose first page has two visible annotations: one `/URI` action to `https://example.invalid/riff-fixture` and one `/GoTo` destination targeting page 2 with `/Fit`. It uses the same byte-offset/xref writer and atomic sibling rename. Regenerate and validate:

```bash
node scripts/generate-link-score.mjs --output src-tauri/tests/fixtures/scores/external-link.pdf
qpdf --check src-tauri/tests/fixtures/scores/external-link.pdf
```

- [ ] **Step 3: Create a dedicated Vite harness that imports production UI.**

Use this config, keeping the output outside the repository:

```ts
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  build: {
    target: "safari16",
    outDir: "/tmp/riff-score-harness",
    emptyOutDir: true,
  },
});
```

Before dynamically importing application modules, `main.tsx` installs `window.__RIFF_BOOTSTRAP__` with the exact default `Settings` shape from `src/stores/settings.ts`, six empty `AppPaths` strings, `recovery: { state: "none" }`, and this app info:

```ts
const webkitVersion = new URL(location.href).searchParams.get("webkit") ?? "unknown";
const appInfo: AppInfo = {
  version: "harness",
  tauriVersion: "harness",
  webkitVersion,
  buildDate: "1970-01-01",
  gitSha: "harness",
};
```

Assign through a local `Window & { __RIFF_BOOTSTRAP__: BootstrapPayload }` type, not `any`. Then call `mockWindows("main")` and install IPC:

```ts
const bytes = await fetch(`/fixtures/${fixture}`).then((response) => {
  if (!response.ok) throw new Error(`fixture HTTP ${response.status}`);
  return response.arrayBuffer();
});

mockIPC((command, payload) => {
  if (command === "score_bytes") return bytes.slice(0);
  if (command === "score_view_patch") {
    currentView = payload?.view as View;
    return currentView;
  }
  if (command === "score_state") return open;
  if (command === "score_close") return true;
  if (command === "score_command") return undefined;
  throw new Error(`unexpected IPC command: ${command}`);
}, { shouldMockEvents: true });
```

Render the production `ScoreSurface` with generation `harness-1`. On first paint, record `performance.now() - startedAt`, click the real buttons for next page, zoom in, rotate, fit width/page, spread, auto-scroll, and find, submit `allegro`, and record whether each interaction changes the expected viewer/controller state. Run the surface at UI scales 0.8, 1.0, and 1.5; comfortable and compact density; and container widths representing wide, middle, and narrow tiers. At each tier assert the always-inline controls remain visible, exactly the specified overflow trigger is visible, and every collapsed action is operable from its popover.

For each painted page, compare canvas, text-layer, and page bounding boxes and require every edge to differ by at most one CSS pixel; after a successful text search, require a highlight rectangle to intersect its text-layer rectangle. For the scanned fixture, assert the zero-match image-only hint. For the external-link fixture, verify an internal destination changes the PDF page while an external link leaves `location.href` on the harness origin. For the 300-page fixture, turn through at least 50 pages and back while the Python driver samples memory. On failure, store the typed classification. Publish exactly one terminal object on `window.__RIFF_HARNESS_RESULT__` and set `document.documentElement.dataset.harnessDone = "true"`.

The encrypted fixture is successful only when its terminal status is `controlled-error` and its visible panel has a recovery action. All other valid fixtures are successful only after first paint and all fixture-relevant assertions pass.

- [ ] **Step 4: Drive the harness through the installed WebKit2GTK runtime.**

`score-webkit-harness.py` must:

1. Parse `--root`, `--fixtures`, `--json`, repeatable `--fixture`, and optional `--timeout` with a default of 30 seconds. When no `--fixture` is given, use the five required fixture names below.
2. Require `gi` and `WebKit2` 4.1, printing one actionable install error and exiting 2 if unavailable.
3. Serve the build directory plus the exact `--fixtures` directory on `127.0.0.1` using `ThreadingHTTPServer` and an ephemeral port; reject traversal outside either root.
4. Create one `WebKit2.WebView`, reject every navigation whose host/port differs from the harness origin, and record attempted external navigation.
5. Run `engraved.pdf`, `scanned.pdf`, `encrypted.pdf`, `external-link.pdf`, and `long-300-pages.pdf` sequentially across the UI-scale/density/width scenarios emitted by the TypeScript harness.
6. Poll `window.__RIFF_HARNESS_RESULT__` with `evaluate_javascript`, collecting each JSON object.
7. Sample resident memory for the WebKit process tree from `/proc/*/status` before load, after first paint, after each ten-page interval of the long fixture, and after teardown.
8. Write one JSON document atomically to `--json`, including `distribution` from `/etc/os-release`, `webkitVersion`, top-level `passed`, fixture results, peak RSS, navigation attempts, and total duration.
9. Exit 0 only when every required assertion passes; exit 1 for a test failure and 2 for harness/infrastructure failure.

Use `WebKit2.get_major_version()`, `get_minor_version()`, and `get_micro_version()` for the runtime version; do not infer it from the package manager.

- [ ] **Step 5: Add exact package scripts and run the local harness.**

```json
{
  "score:fixture": "node scripts/generate-long-score.mjs --pages 300 --output src-tauri/tests/fixtures/scores/long-300-pages.pdf",
  "score:harness:build": "vite build --config scripts/score-harness/vite.config.mts",
  "score:harness": "python3 scripts/score-webkit-harness.py --root /tmp/riff-score-harness --fixtures src-tauri/tests/fixtures/scores --json /tmp/riff-score-harness-result.json"
}
```

Run:

```bash
pnpm score:fixture
cp src-tauri/tests/fixtures/scores/long-300-pages.pdf /tmp/riff-long-first.pdf
pnpm score:fixture
cmp /tmp/riff-long-first.pdf src-tauri/tests/fixtures/scores/long-300-pages.pdf
pnpm score:harness:build
xvfb-run -a pnpm score:harness
jq . /tmp/riff-score-harness-result.json
```

Expected: `cmp` proves reproducible generation, every normal fixture passes, encrypted is a controlled error, external navigation is blocked, the internal destination works, and the JSON includes non-zero first-paint and RSS measurements.

- [ ] **Step 6: Verify and commit.**

```bash
pnpm vitest run src/features/practice/score/importBoundaries.test.ts
pnpm typecheck
git diff --check
git add scripts/score-harness/index.html scripts/score-harness/main.tsx scripts/score-harness/vite.config.mts scripts/score-webkit-harness.py scripts/generate-long-score.mjs scripts/generate-link-score.mjs src-tauri/tests/fixtures/scores/long-300-pages.pdf src-tauri/tests/fixtures/scores/external-link.pdf src-tauri/tests/fixtures/scores/README.md package.json src/features/practice/score/importBoundaries.test.ts
git commit -m "test(score): add native WebKit score harness"
```

---

## Task 15: Measure and Apply the WebKit Floor, Then Capture Release Evidence

**Files:**

- Create: `scripts/apply-webkit-floor.mjs`
- Create: `scripts/apply-webkit-floor.test.mjs`
- Create: `docs/measurements/2026-09-01-pdf-system-hardening.md` through the script
- Modify: `src/features/practice/score/webkitVersion.ts` through the script
- Modify: `src-tauri/tauri.conf.json` through the script
- Modify: `src/features/practice/score/webkitVersion.test.ts`
- Modify: `THIRD-PARTY-LICENSES.md`

**Evidence rule:** no compatibility version is chosen from memory. The floor is the lowest tested WebKitGTK version that passes immediately after the highest tested failure, with at least one newer passing version as confirmation.

- [ ] **Step 1: Add failing tests that reject an unsupported measurement matrix.**

Make `apply-webkit-floor.mjs` export pure `selectFloor(results)` and `renderMeasurement(selection, results, evidence)` functions. Test:

```js
assert.throws(
  () => selectFloor([{ webkitVersion: "2.38.0", passed: true }]),
  /at least one failing runtime/,
);
assert.throws(
  () => selectFloor([
    { webkitVersion: "2.38.0", passed: false },
    { webkitVersion: "2.40.0", passed: true },
  ]),
  /newer confirming pass/,
);
assert.equal(selectFloor([
  { webkitVersion: "2.38.6", passed: false },
  { webkitVersion: "2.40.5", passed: true },
  { webkitVersion: "2.42.4", passed: true },
]).floor, "2.40.5");
```

Add a Vitest assertion that `MIN_WEBKITGTK`, `bundle.linux.deb.depends`, and `bundle.linux.rpm.depends` contain the same parsed version.

Run:

```bash
node --test scripts/apply-webkit-floor.test.mjs
pnpm vitest run src/features/practice/score/webkitVersion.test.ts
```

Expected: failure until the selector and cross-file equality assertion exist.

- [ ] **Step 2: Implement deterministic selection and atomic file updates.**

The script accepts one or more harness JSON paths. It sorts semantic versions numerically, verifies each result contains all Task 14 fixtures, finds the highest failure, selects the first later pass, and requires a second later pass. It rejects duplicate version results with conflicting outcomes.

When invoked with `--apply`, it:

- replaces the quoted `MIN_WEBKITGTK` value through one exact-match assertion;
- parses `tauri.conf.json`, changes only the WebKit dependency version in both deb and rpm arrays, and writes two-space JSON with a trailing newline;
- writes the measurement Markdown to a temporary sibling and renames it;
- records every input runtime/result, selected floor, selection reasoning, fixture timings, peak RSS, navigation outcome, generated asset sizes, package smoke results, and command versions.

The script exits without writing if any validation fails. Its generated Markdown contains actual values from input JSON/evidence JSON and never a blank evidence field.

- [ ] **Step 3: Run the compatibility matrix on actual target runtimes.**

On each available supported-distribution image or machine, run:

```bash
pnpm score:harness:build
xvfb-run -a python3 scripts/score-webkit-harness.py --root /tmp/riff-score-harness --json /tmp/riff-score-harness-result.json
pkg-config --modversion webkit2gtk-4.1
```

Save each immutable result under `/tmp/riff-webkit-results` with a filename generated from its JSON fields as `${distribution}-webkit-${webkitVersion}.json`, normalizing distribution to lowercase ASCII letters, digits, and dashes. The required matrix has a highest failure, the next tested pass, and one newer pass. If the locally installed runtime is the only runtime available, stop Task 15 without changing the declared floor; do not substitute a guessed version.

- [ ] **Step 4: Collect performance, security, and package evidence.**

Build the regular app twice: once at Task 13's parent commit and once at current HEAD. Record total initial JavaScript bytes and the lazy PDF chunk bytes using `find dist/assets -name '*.js' -printf '%s %f\n' | sort -n`. The empty Practice route passes only if its initial module graph evaluates neither the PDF.js main module nor the worker.

Generate uncommitted performance inputs and run each through the same harness:

```bash
node scripts/generate-long-score.mjs --pages 300 --target-mib 20 --output /tmp/riff-score-20m.pdf
node scripts/generate-long-score.mjs --pages 300 --target-mib 100 --output /tmp/riff-score-100m.pdf
python3 scripts/score-webkit-harness.py --root /tmp/riff-score-harness --fixtures /tmp --fixture riff-score-20m.pdf --json /tmp/riff-score-20m.json
python3 scripts/score-webkit-harness.py --root /tmp/riff-score-harness --fixtures /tmp --fixture riff-score-100m.pdf --json /tmp/riff-score-100m.json
```

On the recorded reference machine, the 20 MiB fixture must reach first paint in under 1 second. The 100 MiB fixture has no invented pass threshold: record first paint and peak RSS. Confirm the Rust test counters show one bounded preflight read and one complete byte read before first paint.

Then run:

```bash
pnpm tauri build --bundles deb,rpm
dpkg-deb --info src-tauri/target/release/bundle/deb/*.deb
dpkg-deb -f src-tauri/target/release/bundle/deb/*.deb Depends
rpm -qip src-tauri/target/release/bundle/rpm/*.rpm
rpm -qpR src-tauri/target/release/bundle/rpm/*.rpm
jq -e '.permissions == ["core:default"]' src-tauri/capabilities/default.json
rg '"(shell|fs|dialog|http):' src-tauri/capabilities/default.json
```

Expected: both packages build and declare the same measured WebKit dependency; `jq` confirms `core:default` is the entire permission array; the forbidden capability search has no matches. Install each package in its matching disposable image, launch under `xvfb-run`, open the normal and encrypted fixtures, pop the Score pane out and dock it back, and record launch/first-paint/error-panel results in `/tmp/riff-release-evidence.json`. Pop-out and dock-back must each complete in under 1 second with loading UI retained until paint.

Run the harness three times on the long score and require:

- interaction completion under 1 second after first paint;
- no monotonic RSS growth while 50 virtualized pages leave view;
- post-teardown RSS within 10% of the first cycle after all three cycles.

If a threshold fails, keep the evidence, fix the cause in a new focused commit, and repeat all three samples before applying the floor.

- [ ] **Step 5: Apply the measured value and record the browser compilation target.**

```bash
node scripts/apply-webkit-floor.mjs --apply --evidence /tmp/riff-release-evidence.json /tmp/riff-webkit-results/*.json
pnpm licenses:generate
git diff --exit-code THIRD-PARTY-LICENSES.md third-party-licenses.json
```

Keep the existing `safari16` Vite target unless the production matrix itself proves that target is the failing cause. Record that exact target in the measurement file; do not claim a Safari-to-WebKitGTK version equivalence. Link the three raw runtime result filenames. If changing the compilation target becomes necessary, stop for a focused compatibility design decision and rerun the entire matrix afterward. If license generation changes the file because of generated artifact state, inspect and commit the deterministic output; do not hand-edit license text.

- [ ] **Step 6: Verify the applied floor and commit.**

```bash
node --test scripts/apply-webkit-floor.test.mjs
pnpm vitest run src/features/practice/score/webkitVersion.test.ts
pnpm score:harness:build
xvfb-run -a pnpm score:harness
git diff --check
git add scripts/apply-webkit-floor.mjs scripts/apply-webkit-floor.test.mjs docs/measurements/2026-09-01-pdf-system-hardening.md src/features/practice/score/webkitVersion.ts src/features/practice/score/webkitVersion.test.ts src-tauri/tauri.conf.json THIRD-PARTY-LICENSES.md third-party-licenses.json
git commit -m "build(score): apply measured WebKit compatibility floor"
```

---

## Task 16: Close Documentation, Accessibility, Contract, and CI Gates

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/adr/0003-a-scores-bytes-cross-ipc-not-the-asset-protocol.md`
- Modify: `docs/adr/0004-the-workspace-lives-in-the-data-directory-not-in-settings.md`
- Modify: `docs/adr/0005-pdf-viewer-css-is-imported-whole-and-its-pixels-left-alone.md`
- Modify: `docs/superpowers/plans/15-score-viewer.md`
- Modify: `docs/superpowers/specs/2026-09-01-pdf-system-hardening-design.md`
- Create: `src/features/practice/score/ScoreAccessibility.test.tsx`
- Modify: `src-tauri/tests/event_targets.rs`
- Modify: `src-tauri/tests/ipc_shapes.rs`
- Modify: `src-tauri/tests/titlebar_drag.rs`
- Modify: score-related frontend and Rust tests only if the full gates expose a defect

- [ ] **Step 1: Add final axe and invariant coverage before changing documentation.**

Add parameterized axe cases for:

```ts
const scoreStates = [
  "ready",
  "search-open",
  "last-tier-overflow-open",
  "all-tier-overflow-open",
  "loading",
  "slow-loading",
  "renderer-error",
  "unsupported-webkit",
] as const;
```

Each case renders the actual score surface state, runs the existing axe helper, and expects zero violations. Add Rust/source invariants asserting:

- no serialized IPC representative contains a key named `path` below `OpenScore`, `ScoreCommandEvent`, or any score failure;
- `score://changed` is the one deliberate score broadcast and both `score://command` and `score://open-failed` are targeted;
- `core:default` remains the only capability entry;
- the score bytes response stays raw rather than JSON/base64;
- the measured WebKit floor matches frontend and both package formats.

Run the new focused cases first and fix any accessible-name, focus, contrast, or event-shape defect they reveal.

- [ ] **Step 2: Update durable architecture guidance.**

Add these exact invariants to `CLAUDE.md` in the relevant existing sections:

- score paths remain Rust-only and bytes cross IPC with a session generation;
- every score bytes/view/close/command operation validates its generation;
- `score://changed` synchronizes all webviews, while `score://command` and `score://open-failed` target the current Score host;
- filesystem reads and PDF preflight never run on the Tauri event/UI thread;
- PDF.js value imports stay behind `loadPdfRuntime`, and first page paint defines ready;
- toolbar controls hidden by container queries require a reachable overflow copy;
- the declared WebKit floor may change only with a checked-in measurement record.

ADR 0003 records generation-bearing raw bytes and check/work/recheck. ADR 0004 records in-memory generations, canonical views, mutex-consumed reopen, and targeted durability failures. ADR 0005 records lazy runtime loading and the low-priority global PDF.js CSS layer.

Update `README.md` with user-facing support/recovery behavior: measured WebKit requirement, 10-second slow-load actions, encrypted/unreadable recovery, and cross-window shortcuts. Mark plan 15 as historical and point to this design/implementation plan. Change the design spec status to implemented only after every gate and packaged check passes.

- [ ] **Step 3: Regenerate governed artifacts and inspect the diffs.**

```bash
RIFF_UPDATE_FIXTURES=1 cargo test --manifest-path src-tauri/Cargo.toml --test ipc_shapes
pnpm i18n:extract
pnpm licenses:generate
git diff -- src-tauri/tests/fixtures/ipc-shapes.json src/locales/en THIRD-PARTY-LICENSES.md third-party-licenses.json src/routeTree.gen.ts
```

Expected: the IPC fixture contains the reviewed generation/command/error shapes and no paths; every English value is non-empty; license output is deterministic; the route tree is unchanged unless a real route was added.

- [ ] **Step 4: Run the complete repository gates without skipping coverage or deny.**

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo deny check --manifest-path src-tauri/Cargo.toml
pnpm score:harness:build
xvfb-run -a pnpm score:harness
```

Expected: every command exits 0, coverage remains at least 80% lines/functions/statements and 70% branches, the initial entry chunk remains below 250 KiB gzipped, the real-WebKit JSON is passing, and no dependency/capability drift appears.

- [ ] **Step 5: Perform the final implementation self-review.**

Review the complete diff from the design commit to HEAD:

```bash
git diff 325784a..HEAD --check
git diff 325784a..HEAD --stat
git log --oneline 325784a..HEAD
rg -n "console\.(log|debug)" src src-tauri scripts
rg -n "score-stale|score://" src src-tauri
```

Use the accepted spec's §16 lists as a checklist. For every requirement, cite its production file and test/evidence file in the commit message body or a final review note. Fix correctness findings in the task commit that owns the code when it is still unshared; otherwise add one focused conventional commit whose message names the defect. Do not mark the design implemented while any required matrix/package evidence is missing.

- [ ] **Step 6: Commit the documentation and verified completion state.**

```bash
git add CLAUDE.md README.md docs/adr/0003-a-scores-bytes-cross-ipc-not-the-asset-protocol.md docs/adr/0004-the-workspace-lives-in-the-data-directory-not-in-settings.md docs/adr/0005-pdf-viewer-css-is-imported-whole-and-its-pixels-left-alone.md docs/superpowers/plans/15-score-viewer.md docs/superpowers/specs/2026-09-01-pdf-system-hardening-design.md src/features/practice/score/ScoreAccessibility.test.tsx src-tauri/tests/event_targets.rs src-tauri/tests/ipc_shapes.rs src-tauri/tests/titlebar_drag.rs src-tauri/tests/fixtures/ipc-shapes.json src/locales/en THIRD-PARTY-LICENSES.md third-party-licenses.json
git commit -m "docs(score): record hardened PDF subsystem"
```

After the commit, rerun `git status --short` and `git show --check --stat HEAD`. A clean status and clean patch check are required before handoff.

---

## Implementation Completion Checklist

- [ ] Every task has its focused failing test captured before implementation.
- [ ] Every task's focused verification passes before its commit.
- [ ] Raw score paths and URLs never cross IPC or appear in logs/errors.
- [ ] Same-name/same-size replacements still reset by generation.
- [ ] Stale byte, close, patch, and command work is harmless and silent.
- [ ] Picker/drop/reopen failures reach exactly one usable recovery surface.
- [ ] First page paint, not document parse completion, ends loading.
- [ ] Slow loading remains recoverable without aborting the live attempt.
- [ ] Search, overflow, focus return, announcements, and keyboard suppression pass axe/interaction tests.
- [ ] Auto-scroll has delta, visibility, cleanup, and manual-intent protection.
- [ ] The real WebKit harness passes every required fixture and external navigation remains blocked.
- [ ] The measured floor has one preceding failure and two passing runtimes.
- [ ] Deb/rpm smoke tests, CSP/capability audit, memory/timing evidence, and licenses are recorded.
- [ ] All frontend, Rust, coverage, build, deny, formatting, and lint gates pass.

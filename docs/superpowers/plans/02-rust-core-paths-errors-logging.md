# 02 — Rust Core: Paths, Errors, Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three primitives every later Rust module depends on — where files live, how failures cross the IPC boundary, and where diagnostics go.

**Architecture:** Path resolution is a **pure function** over explicit XDG roots, so it is fully unit-testable without ever calling `std::env::set_var` — which is racy under Rust's parallel test runner and `unsafe` in the 2024 edition. `RiffError` is adjacently tagged so the frontend can localise by code instead of displaying Rust prose. Logging opens a **new directory per launch** from the first line of `main`, before anything can fail, so "which run was this?" always has an answer.

**Tech Stack:** `directories` 6.0, `thiserror` 2.0, `tracing` 0.1, `tracing-subscriber` 0.3, `tracing-appender` 0.2, `time` 0.3, `tempfile` 3.27.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§4.1, §5, §12)

## Global Constraints

- **Platform:** Linux only. webkit2gtk **4.1**, **glibc ≥ 2.39**, build target `ubuntu-24.04`.
- **Zero network.** No HTTP client in either language.
- **Rust owns the filesystem.** The webview's only capability is `core:default`.
- **No caller-supplied paths across IPC.** Commands take enums; native pickers open in Rust.
- **Rust lints:** `clippy::unwrap_used` denied outside tests, `expect_used` allowed with a message.
- **Never install:** any HTTP client, `tauri-specta`, `specta`.
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/paths.rs` | `AppPaths`, XDG resolution, `RIFF_*` overrides, directory creation |
| `src-tauri/src/error.rs` | `RiffError`, its serialised shape, conversion helpers |
| `src-tauri/src/logging.rs` | `tracing` subscriber, per-launch session directory, retention, live level, panic hook |
| `src-tauri/src/lib.rs` | Declares the modules |

---

### Task 1: `AppPaths` and XDG resolution

**Interfaces:**
- Produces: `paths::AppPaths { config_dir, data_dir, state_dir, cache_dir, log_dir }` with methods `settings_file()`, `schema_file()`, `history_file()`; `paths::XdgRoots`, `paths::PathOverrides`, `paths::resolve(&XdgRoots, &PathOverrides) -> Result<AppPaths, PathResolutionError>`, `paths::ensure_dirs(&AppPaths) -> std::io::Result<()>`.

**Files:**
- Create: `src-tauri/src/paths.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependencies**

```bash
cd src-tauri
cargo add directories@6.0 thiserror@2.0
cargo add --dev tempfile@3.27
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/paths.rs` containing **only** this test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn roots(base: &str) -> XdgRoots {
        XdgRoots {
            config: Some(PathBuf::from(format!("{base}/.config"))),
            data: Some(PathBuf::from(format!("{base}/.local/share"))),
            state: Some(PathBuf::from(format!("{base}/.local/state"))),
            cache: Some(PathBuf::from(format!("{base}/.cache"))),
        }
    }

    #[test]
    fn resolves_xdg_directories_under_the_plain_name_riff() {
        let p = resolve(&roots("/home/u"), &PathOverrides::none())
            .expect("all roots present");
        assert_eq!(p.config_dir, PathBuf::from("/home/u/.config/riff"));
        assert_eq!(p.data_dir, PathBuf::from("/home/u/.local/share/riff"));
        assert_eq!(p.state_dir, PathBuf::from("/home/u/.local/state/riff"));
        assert_eq!(p.cache_dir, PathBuf::from("/home/u/.cache/riff"));
        assert_eq!(p.log_dir, PathBuf::from("/home/u/.local/state/riff/logs"));
    }

    #[test]
    fn named_files_sit_in_the_right_directories() {
        let p = resolve(&roots("/home/u"), &PathOverrides::none()).expect("roots");
        assert_eq!(p.settings_file(), PathBuf::from("/home/u/.config/riff/settings.json"));
        assert_eq!(p.schema_file(), PathBuf::from("/home/u/.config/riff/settings.schema.json"));
        assert_eq!(p.history_file(), PathBuf::from("/home/u/.local/share/riff/history.jsonl"));
    }

    #[test]
    fn riff_config_home_overrides_xdg_exactly_and_is_not_suffixed() {
        let overrides = PathOverrides {
            config: Some(PathBuf::from("/tmp/probe/cfg")),
            data: None,
        };
        let p = resolve(&roots("/home/u"), &overrides).expect("roots");
        assert_eq!(p.config_dir, PathBuf::from("/tmp/probe/cfg"));
        assert_eq!(p.data_dir, PathBuf::from("/home/u/.local/share/riff"));
    }

    #[test]
    fn missing_roots_and_no_override_is_an_error_not_a_fallback() {
        let empty = XdgRoots { config: None, data: None, state: None, cache: None };
        assert!(resolve(&empty, &PathOverrides::none()).is_err());
    }

    #[test]
    fn state_root_absent_falls_back_to_the_data_root() {
        let mut r = roots("/home/u");
        r.state = None;
        let p = resolve(&r, &PathOverrides::none()).expect("data root covers state");
        assert_eq!(p.state_dir, PathBuf::from("/home/u/.local/share/riff/state"));
    }

    #[test]
    fn ensure_dirs_creates_everything_and_is_idempotent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let base = tmp.path().to_string_lossy().into_owned();
        let p = resolve(&roots(&base), &PathOverrides::none()).expect("roots");
        ensure_dirs(&p).expect("first create");
        ensure_dirs(&p).expect("second create must not fail");
        assert!(p.config_dir.is_dir());
        assert!(p.log_dir.is_dir());
    }
}
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd src-tauri && cargo test paths`
Expected: FAIL to compile — `cannot find type XdgRoots in this scope`

- [ ] **Step 4: Implement**

Insert above the test module in `src-tauri/src/paths.rs`:

```rust
//! Where Riff keeps things. XDG Base Directory layout, using the plain name
//! `riff` rather than the reverse-DNS identifier, because these are files
//! users are expected to open and edit.

use std::path::{Path, PathBuf};

/// The four XDG roots, before Riff's own subdirectory is appended.
/// Passed in rather than read from the environment so `resolve` stays pure
/// and testable — `std::env::set_var` is racy across parallel tests.
#[derive(Debug, Clone, Default)]
pub struct XdgRoots {
    pub config: Option<PathBuf>,
    pub data: Option<PathBuf>,
    pub state: Option<PathBuf>,
    pub cache: Option<PathBuf>,
}

impl XdgRoots {
    pub fn from_system() -> Self {
        match directories::BaseDirs::new() {
            Some(b) => Self {
                config: Some(b.config_dir().to_path_buf()),
                data: Some(b.data_dir().to_path_buf()),
                state: b.state_dir().map(Path::to_path_buf),
                cache: Some(b.cache_dir().to_path_buf()),
            },
            None => Self::default(),
        }
    }
}

/// `RIFF_CONFIG_HOME` and `RIFF_DATA_HOME`. Used verbatim — they name Riff's
/// directory itself, not a parent to append `riff` to — so a test or a
/// portable install can point at a temporary directory with no surprises.
#[derive(Debug, Clone, Default)]
pub struct PathOverrides {
    pub config: Option<PathBuf>,
    pub data: Option<PathBuf>,
}

impl PathOverrides {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn from_env() -> Self {
        Self {
            config: std::env::var_os("RIFF_CONFIG_HOME").map(PathBuf::from),
            data: std::env::var_os("RIFF_DATA_HOME").map(PathBuf::from),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub state_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl AppPaths {
    pub fn settings_file(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }
    pub fn schema_file(&self) -> PathBuf {
        self.config_dir.join("settings.schema.json")
    }
    pub fn history_file(&self) -> PathBuf {
        self.data_dir.join("history.jsonl")
    }
}

#[derive(Debug, thiserror::Error)]
#[error(
    "cannot determine where to store data: none of $XDG_CONFIG_HOME, $HOME or \
     RIFF_CONFIG_HOME resolved to a usable directory"
)]
pub struct PathResolutionError;

pub fn resolve(
    roots: &XdgRoots,
    overrides: &PathOverrides,
) -> Result<AppPaths, PathResolutionError> {
    let config_dir = match &overrides.config {
        Some(dir) => dir.clone(),
        None => roots.config.as_ref().ok_or(PathResolutionError)?.join("riff"),
    };
    let data_dir = match &overrides.data {
        Some(dir) => dir.clone(),
        None => roots.data.as_ref().ok_or(PathResolutionError)?.join("riff"),
    };
    // XDG_STATE_HOME is the newest of the four and not every environment sets
    // it. Falling back inside the data directory keeps logs with the rest of
    // Riff's data instead of scattering them.
    let state_dir = match &roots.state {
        Some(root) => root.join("riff"),
        None => data_dir.join("state"),
    };
    let cache_dir = match &roots.cache {
        Some(root) => root.join("riff"),
        None => data_dir.join("cache"),
    };
    let log_dir = state_dir.join("logs");

    Ok(AppPaths { config_dir, data_dir, state_dir, cache_dir, log_dir })
}

pub fn ensure_dirs(paths: &AppPaths) -> std::io::Result<()> {
    for dir in [
        &paths.config_dir,
        &paths.data_dir,
        &paths.state_dir,
        &paths.cache_dir,
        &paths.log_dir,
    ] {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}
```

- [ ] **Step 5: Declare the module**

At the top of `src-tauri/src/lib.rs`:

```rust
pub mod paths;
```

- [ ] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test paths`
Expected: PASS, 6 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(paths): resolve xdg directories with riff_* overrides"
```

---

### Task 2: `RiffError`

**Interfaces:**
- Produces: `error::RiffError` with variants `Io`, `Parse`, `Validation`, `NotFound`, `Denied`; `error::RiffResult<T>`; constructor `RiffError::io(path, &std::io::Error)`. Serialises as `{"code": "<kebab-case-variant>", "details": { … }}`.

**Files:**
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/error.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_adjacently_tagged_so_the_frontend_can_switch_on_code() {
        let err = RiffError::Validation {
            field: "appearance.uiScale".into(),
            reason: "out of range".into(),
        };
        let json = serde_json::to_value(&err).expect("serialises");
        assert_eq!(json["code"], "validation");
        assert_eq!(json["details"]["field"], "appearance.uiScale");
        assert_eq!(json["details"]["reason"], "out of range");
    }

    #[test]
    fn variant_names_are_kebab_case() {
        let err = RiffError::NotFound { what: "settings.json".into() };
        let json = serde_json::to_value(&err).expect("serialises");
        assert_eq!(json["code"], "not-found");
    }

    #[test]
    fn io_helper_records_the_path_that_failed() {
        let source = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "nope");
        let err = RiffError::io("/etc/riff/settings.json", &source);
        match err {
            RiffError::Io { path, message } => {
                assert_eq!(path, "/etc/riff/settings.json");
                assert!(message.contains("nope"));
            }
            other => panic!("expected Io, got {other:?}"),
        }
    }

    #[test]
    fn display_is_human_readable_for_logs() {
        let err = RiffError::Denied { what: "writing outside the config directory".into() };
        assert_eq!(err.to_string(), "not permitted: writing outside the config directory");
    }
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd src-tauri && cargo test error`
Expected: FAIL to compile — `cannot find type RiffError`

- [ ] **Step 3: Implement**

Insert above the tests in `src-tauri/src/error.rs`:

```rust
//! The only error type that crosses the IPC boundary.
//!
//! Adjacently tagged on purpose: the frontend switches on `code` to pick a
//! localised message and shows `details` in a collapsible technical panel.
//! Raw Rust error prose is never primary UI text — it cannot be translated.

use std::path::Path;

#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "code", content = "details", rename_all = "kebab-case")]
pub enum RiffError {
    #[error("io error at {path}: {message}")]
    Io { path: String, message: String },

    #[error("could not parse {path}: {message}")]
    Parse { path: String, message: String, line: Option<u32> },

    #[error("invalid value for {field}: {reason}")]
    Validation { field: String, reason: String },

    #[error("not found: {what}")]
    NotFound { what: String },

    #[error("not permitted: {what}")]
    Denied { what: String },
}

impl RiffError {
    pub fn io(path: impl AsRef<Path>, source: &std::io::Error) -> Self {
        Self::Io {
            path: path.as_ref().display().to_string(),
            message: source.to_string(),
        }
    }

    pub fn parse(path: impl AsRef<Path>, source: &serde_json::Error) -> Self {
        Self::Parse {
            path: path.as_ref().display().to_string(),
            message: source.to_string(),
            line: u32::try_from(source.line()).ok(),
        }
    }
}

pub type RiffResult<T> = Result<T, RiffError>;
```

- [ ] **Step 4: Declare the module**

In `src-tauri/src/lib.rs`:

```rust
pub mod error;
```

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test error`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(error): add the adjacently tagged RiffError type"
```

---

### Task 3: Session logging and the panic hook

Riff writes **one directory per launch**, not one file per day. Three launches
in a day would otherwise interleave into a single file with no session
boundary, and the first question of any bug report — "which run was this?" —
would have no answer.

**Interfaces:**
- Produces: `logging::{Session, start_session, set_level, set_panic_notifier, install_panic_hook}`.
  - `start_session(&AppPaths, default_level) -> Session` creates `<log_dir>/<RFC3339>-<pid>/riff.log`, points `<log_dir>/latest` at it, and prunes older sessions.
  - `Session { dir, guard, level }` — the guard must be held for the process lifetime; `level` is a `tracing_subscriber::reload::Handle` so the level changes live.

**Files:**
- Create: `src-tauri/src/logging.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependencies**

```bash
cd src-tauri
cargo add tracing@0.1
cargo add tracing-subscriber@0.3 --features env-filter,fmt
cargo add tracing-appender@0.2
cargo add time@0.3 --features formatting
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/logging.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn paths(tmp: &std::path::Path) -> crate::paths::AppPaths {
        let p = crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.join("config")),
                data: Some(tmp.join("data")),
            },
        )
        .expect("overrides supply both roots");
        crate::paths::ensure_dirs(&p).expect("dirs");
        p
    }

    #[test]
    fn each_launch_gets_its_own_directory() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());

        let first = session_dir(&p.log_dir, "2026-08-28T10-00-00Z", 111);
        let second = session_dir(&p.log_dir, "2026-08-28T10-00-00Z", 222);
        assert_ne!(first, second, "two launches in the same second must not collide");
        assert!(first.starts_with(&p.log_dir));
    }

    #[test]
    fn session_directories_sort_chronologically_by_name() {
        // Lexical order is chronological order, so listing them needs no
        // mtime and survives clock skew and file copying.
        let dir = std::path::Path::new("/logs");
        let older = session_dir(dir, "2026-08-28T09-00-00Z", 1);
        let newer = session_dir(dir, "2026-08-28T10-00-00Z", 1);
        assert!(older < newer);
    }

    #[test]
    fn writes_the_log_inside_the_session_directory() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        let dir = {
            let session = start_session(&p, "info");
            tracing::error!("probe line");
            let dir = session.dir.clone();
            drop(session); // flushes the non-blocking writer
            dir
        };
        let body = std::fs::read_to_string(dir.join("riff.log")).expect("log readable");
        assert!(body.contains("probe line"), "log did not capture the event: {body}");
    }

    #[test]
    fn latest_points_at_the_current_session() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        let session = start_session(&p, "info");
        let latest = p.log_dir.join("latest");
        assert!(latest.exists(), "`latest` is what makes `tail -f` usable");
        assert_eq!(
            std::fs::canonicalize(&latest).expect("resolves"),
            std::fs::canonicalize(&session.dir).expect("resolves"),
        );
    }

    #[test]
    fn pruning_keeps_the_newest_sessions_and_removes_the_rest() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        for hour in 0..8 {
            std::fs::create_dir_all(p.log_dir.join(format!("2026-08-28T0{hour}-00-00Z-1")))
                .expect("seed");
        }
        prune_sessions(&p.log_dir, 3);

        let mut remaining: Vec<_> = std::fs::read_dir(&p.log_dir)
            .expect("readdir")
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n != "latest")
            .collect();
        remaining.sort();
        assert_eq!(remaining.len(), 3, "retention must bound growth");
        assert!(remaining[0].starts_with("2026-08-28T05"), "the newest must survive: {remaining:?}");
    }

    #[test]
    fn pruning_a_missing_directory_is_not_an_error() {
        prune_sessions(std::path::Path::new("/nonexistent/logs"), 3);
    }

    #[test]
    fn a_panic_is_written_beside_the_log_so_it_is_findable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        write_panic_file(tmp.path(), "thread panicked at 'boom'");
        let body = std::fs::read_to_string(tmp.path().join("panic.txt")).expect("panic file");
        assert!(body.contains("boom"));
    }
}
```

- [ ] **Step 3: Run and watch them fail**

Run: `cd src-tauri && cargo test logging`
Expected: FAIL to compile — `cannot find function start_session`

- [ ] **Step 4: Implement**

Insert above the tests:

```rust
//! Diagnostics. Initialised before anything that can fail, so a startup
//! failure still leaves a trail.
//!
//! One directory per launch rather than one file per day. Rotation by date
//! interleaves several runs into one file, and "which run was this?" is the
//! first question every bug report has to answer. A session directory also
//! gives panics somewhere obvious to land.
//!
//! File paths are logged; file *contents* never are. Redaction happens at
//! export (Plan 11), not here, so the on-disk log keeps real paths the user
//! can grep on their own machine.

use std::path::{Path, PathBuf};

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{reload, EnvFilter, Registry};

/// How many launches to keep. Ten is enough to cover "it broke sometime this
/// week" without letting a debug-level session fill a home directory.
pub const RETAIN_SESSIONS: usize = 10;

pub struct Session {
    pub dir: PathBuf,
    /// MUST be held for the process lifetime; dropping it flushes the
    /// non-blocking writer. Losing it early silently truncates the log.
    guard: WorkerGuard,
    level: reload::Handle<EnvFilter, Registry>,
}

impl Session {
    /// Changes the level of the running process, so "reproduce it with debug
    /// logging" is a toggle rather than a terminal instruction.
    pub fn set_level(&self, level: &str) -> bool {
        let Ok(filter) = EnvFilter::try_new(level) else { return false };
        self.level.reload(filter).is_ok()
    }
}

pub fn session_dir(log_dir: &Path, stamp: &str, pid: u32) -> PathBuf {
    log_dir.join(format!("{stamp}-{pid}"))
}

pub fn now_stamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_owned())
        .replace(':', "-")
}

#[must_use]
pub fn start_session(paths: &crate::paths::AppPaths, default_level: &str) -> Session {
    let dir = session_dir(&paths.log_dir, &now_stamp(), std::process::id());
    let _ = std::fs::create_dir_all(&dir);

    // `latest` is what makes `tail -f ~/.local/state/riff/logs/latest/riff.log`
    // work without looking anything up first.
    let latest = paths.log_dir.join("latest");
    let _ = std::fs::remove_file(&latest);
    let _ = std::os::unix::fs::symlink(&dir, &latest);

    let appender = tracing_appender::rolling::never(&dir, "riff.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);

    // RIFF_LOG wins over the persisted setting, which wins over the default.
    let base = EnvFilter::try_from_env("RIFF_LOG")
        .or_else(|_| EnvFilter::try_new(default_level))
        .unwrap_or_else(|_| EnvFilter::default().add_directive(LevelFilter::INFO.into()));
    let (filter, level) = reload::Layer::new(base);

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(writer)
                .with_ansi(false)
                .with_target(true)
                .with_thread_ids(true)
                .with_line_number(true),
        )
        .try_init();

    prune_sessions(&paths.log_dir, RETAIN_SESSIONS);

    Session { dir, guard, level }
}

/// Keeps the newest `keep` session directories. Names are RFC 3339 stamps, so
/// lexical order is chronological order — no mtime, no clock skew.
pub fn prune_sessions(log_dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(log_dir) else { return };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.file_name().is_some_and(|n| n != "latest"))
        .collect();
    dirs.sort();
    if dirs.len() <= keep {
        return;
    }
    for old in &dirs[..dirs.len() - keep] {
        let _ = std::fs::remove_dir_all(old);
    }
}

pub fn write_panic_file(session_dir: &Path, body: &str) {
    let _ = std::fs::write(session_dir.join("panic.txt"), body);
}

/// Optional notifier, installed by Plan 04 once a window exists. Behind a
/// `OnceLock` so this module needs no dependency on Tauri.
static PANIC_NOTIFIER: std::sync::OnceLock<fn(&str)> = std::sync::OnceLock::new();
static PANIC_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Registers a best-effort, NON-BLOCKING way to tell the user about a panic.
/// A blocking dialog raised from a panic on the GTK main thread can deadlock,
/// turning a crash report into a hang.
pub fn set_panic_notifier(notifier: fn(&str)) {
    let _ = PANIC_NOTIFIER.set(notifier);
}

/// Logs panics with a backtrace, writes `panic.txt` into the session
/// directory, then runs the previous hook. Logging always succeeds;
/// notifying is a courtesy that may not be available yet.
pub fn install_panic_hook(session_dir: &Path) {
    let _ = PANIC_DIR.set(session_dir.to_path_buf());
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        tracing::error!(panic = %info, backtrace = %backtrace, "panic");
        if let Some(dir) = PANIC_DIR.get() {
            write_panic_file(dir, &format!("{info}\n\n{backtrace}"));
        }
        if let Some(notify) = PANIC_NOTIFIER.get() {
            notify(&info.to_string());
        }
        previous(info);
    }));
}
```

- [ ] **Step 5: Declare the module**

In `src-tauri/src/lib.rs`:

```rust
pub mod logging;
```

- [ ] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test logging -- --test-threads=1`
Expected: PASS, 7 tests

`--test-threads=1` because `tracing`'s global subscriber can only be installed
once per process; `try_init` tolerates that, but running these serially keeps
the assertions about directory contents meaningful.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(logging): one log directory per launch, with retention and live level"
```

---
### Task 4: Gate check

- [ ] **Step 1: Run everything**

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo deny check licenses
```
Expected: all exit 0. `clippy` covers test code too via `--all-targets`; `unwrap` inside `#[cfg(test)]` is what `expect` is for, so replace any that trips the lint.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: verify rust core gates" --allow-empty
```

# 02 — Rust Core: Paths, Errors, Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three primitives every later Rust module depends on — where files live, how failures cross the IPC boundary, and where diagnostics go.

**Architecture:** Path resolution is a **pure function** over explicit XDG roots, so it is fully unit-testable without ever calling `std::env::set_var` — which is racy under Rust's parallel test runner and `unsafe` in the 2024 edition. `RiffError` is adjacently tagged so the frontend can localise by code instead of displaying Rust prose. Logging writes to a rolling file from the first line of `main`, before anything can fail.

**Tech Stack:** `directories` 6.0, `thiserror` 2.0, `tracing` 0.1, `tracing-subscriber` 0.3, `tracing-appender` 0.2, `tempfile` 3.27.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§4.1, §5, §12)

## Global Constraints

- **Platform:** Linux only. webkit2gtk **4.1**, **glibc ≥ 2.39**, build target `ubuntu-24.04`.
- **Zero network.** No HTTP client in either language.
- **Rust owns the filesystem.** Webview capabilities are exactly `core:default` and `log:default`.
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
| `src-tauri/src/logging.rs` | `tracing` subscriber, daily rolling file, panic hook |
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

### Task 3: Logging and the panic hook

**Interfaces:**
- Produces: `logging::init(&Path) -> tracing_appender::non_blocking::WorkerGuard` (the guard must be held for the process lifetime or buffered lines are lost at exit) and `logging::install_panic_hook()`.

**Files:**
- Create: `src-tauri/src/logging.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependencies**

```bash
cd src-tauri
cargo add tracing@0.1
cargo add tracing-subscriber@0.3 --features env-filter,fmt
cargo add tracing-appender@0.2
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/logging.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_rolling_log_file_into_the_given_directory() {
        let tmp = tempfile::tempdir().expect("tempdir");
        {
            let _guard = init(tmp.path());
            tracing::error!("probe line");
            // `_guard` drops here, flushing the non-blocking writer.
        }
        let entries: Vec<_> = std::fs::read_dir(tmp.path())
            .expect("log dir readable")
            .filter_map(Result::ok)
            .collect();
        assert_eq!(entries.len(), 1, "exactly one log file expected");

        let name = entries[0].file_name().to_string_lossy().into_owned();
        assert!(name.starts_with("riff."), "unexpected log filename: {name}");

        let body = std::fs::read_to_string(entries[0].path()).expect("log readable");
        assert!(body.contains("probe line"), "log did not capture the event: {body}");
    }
}
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd src-tauri && cargo test logging`
Expected: FAIL to compile — `cannot find function init`

- [ ] **Step 4: Implement**

Insert above the tests:

```rust
//! Diagnostics. Initialised before anything that can fail, so a startup
//! failure still leaves a trail.
//!
//! File paths are logged; file *contents* never are. Riff is a local-first
//! application and its log must stay safe to paste into a public issue.

use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::EnvFilter;

/// Returns a guard that MUST be held for the lifetime of the process.
/// Dropping it flushes the non-blocking writer; losing it early silently
/// truncates the log.
#[must_use]
pub fn init(log_dir: &Path) -> WorkerGuard {
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("riff")
        .filename_suffix("log")
        .max_log_files(7)
        .build(log_dir)
        .unwrap_or_else(|_| {
            // A broken log directory must never stop the application, so fall
            // back to a non-rotating appender in the same place.
            RollingFileAppender::new(Rotation::NEVER, log_dir, "riff.log")
        });

    let (writer, guard) = tracing_appender::non_blocking(appender);

    let filter = EnvFilter::try_from_env("RIFF_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info"));

    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_ansi(false)
        .with_target(true)
        .try_init();

    guard
}

/// Optional notifier, installed by Plan 04 once a window exists. Behind a
/// `OnceLock` so this module needs no dependency on Tauri.
static PANIC_NOTIFIER: std::sync::OnceLock<fn(&str)> = std::sync::OnceLock::new();

/// Registers a best-effort, NON-BLOCKING way to tell the user about a panic.
/// A blocking dialog raised from a panic on the GTK main thread can deadlock,
/// turning a crash report into a hang.
pub fn set_panic_notifier(notifier: fn(&str)) {
    let _ = PANIC_NOTIFIER.set(notifier);
}

/// Logs panics with a backtrace before the default hook runs. Logging always
/// succeeds; notifying is a courtesy that may not be available yet.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        tracing::error!(panic = %info, backtrace = %backtrace, "panic");
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
Expected: PASS

`--test-threads=1` because `tracing`'s global subscriber can only be installed once per process; `try_init` tolerates that, but running this test serially keeps the assertion about file count meaningful.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(logging): add rolling file logging and a panic hook"
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

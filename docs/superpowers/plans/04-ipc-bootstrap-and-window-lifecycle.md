# 04 — IPC, Bootstrap and Window Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the settings store to a webview that has almost no permissions, and make the window appear correctly themed on its first painted frame — or appear anyway if the frontend dies.

**Architecture:** Settings are read *before* `tauri::Builder` exists and injected as `window.__RIFF_BOOTSTRAP__` by an initialisation script, which also applies the theme attributes to `<html>`. The window is created hidden and revealed either when the frontend signals readiness or by a three-second watchdog, whichever comes first. Because the window is hidden until then, unstyled content is impossible by construction rather than by timing.

**Tech Stack:** Tauri 2.11, `tauri-plugin-single-instance`, `tauri-plugin-window-state`, `tauri-plugin-dialog`, `tauri-plugin-opener`.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§3.1, §5, §12)

## Global Constraints

- **Platform:** Linux only. webkit2gtk **4.1**, **glibc ≥ 2.39**, build target `ubuntu-24.04`.
- **Zero network.** CSP `connect-src` admits the IPC origins and nothing else.
- **The webview's only capability is `core:default`.** The `opener`, `dialog` and `window-state` plugins are driven only from Rust and therefore need no JS permission. `tauri-plugin-log` is deliberately **not** installed: it writes to its own directory, separate from the session logs, and Plan 11's `log_write` command carries frontend diagnostics into the one file that matters.
- **No caller-supplied paths across IPC.** Commands take enums; native pickers open in Rust.
- **Rust lints:** `clippy::unwrap_used` denied outside tests.
- **Never install:** `tauri-specta`, `specta`, any HTTP client.
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/commands/mod.rs` | Re-exports and the `generate_handler!` list |
| `src-tauri/src/commands/settings.rs` | get / patch / reset / import / export, plus the `settings://write-failed` event |
| `src-tauri/src/commands/app.rs` | `app_info`, `paths_get`, `open_path`, `open_external`, `app_ready` |
| `src-tauri/src/commands/window.rs` | minimise, toggle maximise, close, decoration toggle |
| `src-tauri/src/bootstrap.rs` | The `js_init_script` plugin and its payload type |
| `src-tauri/src/lib.rs` | Wiring: logging, paths, store, plugins, window reveal, exit flush |
| `src-tauri/tests/ipc_shapes.rs` | Serialises every payload against a committed fixture |
| `src/lib/ipc/types.ts` | Hand-written mirrors of the Rust types |
| `src/lib/ipc/index.ts` | Typed `invoke` facade |
| `src-tauri/tauri.conf.json` | CSP, window, bundle targets, package dependencies |
| `src-tauri/capabilities/default.json` | Exactly two permissions |

---

### Task 1: Application info and path commands

**Interfaces:**
- Produces: `commands::app::{AppInfo, PathKind, ExternalLink}` and commands `app_info`, `paths_get`, `open_path`, `open_external`, `app_ready`.

**Files:**
- Create: `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/app.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the plugins**

```bash
cd src-tauri
cargo add tauri-plugin-single-instance@2 tauri-plugin-window-state@2 tauri-plugin-dialog@2
cargo add rfd@0.15 --no-default-features --features gtk3
```

`tauri-plugin-opener` is already a dependency from the template.

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/commands/app.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_kinds_serialise_as_kebab_case_so_the_frontend_can_name_them() {
        assert_eq!(serde_json::to_value(PathKind::Config).expect("ser"), "config");
        assert_eq!(serde_json::to_value(PathKind::Logs).expect("ser"), "logs");
    }

    #[test]
    fn external_links_are_a_closed_set_not_arbitrary_urls() {
        // The point of the enum is that no caller can supply a URL.
        assert_eq!(ExternalLink::Repository.url(), "https://github.com/valasme/riff");
        assert_eq!(ExternalLink::Issues.url(), "https://github.com/valasme/riff/issues");
        assert_eq!(ExternalLink::License.url(), "https://github.com/valasme/riff/blob/main/LICENSE");
    }

    #[test]
    fn every_path_kind_maps_to_a_real_directory() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let paths = crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.path().join("config")),
                data: Some(tmp.path().join("data")),
            },
        )
        .expect("roots");
        for kind in [PathKind::Config, PathKind::Data, PathKind::Cache, PathKind::Logs] {
            assert!(kind.resolve(&paths).is_absolute(), "{kind:?} produced a relative path");
        }
    }
}
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd src-tauri && cargo test commands::app`
Expected: FAIL to compile

- [ ] **Step 4: Implement**

Insert above the tests:

```rust
//! Commands that expose the application to itself.
//!
//! `open_path` and `open_external` take enums rather than strings on purpose.
//! There is no path and no URL a compromised frontend could ask Riff to open,
//! because the set of openable things is fixed at compile time.

use std::path::PathBuf;
use std::sync::Arc;

use crate::error::{RiffError, RiffResult};
use crate::paths::AppPaths;
use crate::settings::store::SettingsStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PathKind {
    Config,
    Data,
    Cache,
    Logs,
}

impl PathKind {
    pub fn resolve(self, paths: &AppPaths) -> PathBuf {
        match self {
            Self::Config => paths.config_dir.clone(),
            Self::Data => paths.data_dir.clone(),
            Self::Cache => paths.cache_dir.clone(),
            Self::Logs => paths.log_dir.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalLink {
    Repository,
    Issues,
    License,
}

impl ExternalLink {
    pub fn url(self) -> &'static str {
        match self {
            Self::Repository => "https://github.com/valasme/riff",
            Self::Issues => "https://github.com/valasme/riff/issues",
            Self::License => "https://github.com/valasme/riff/blob/main/LICENSE",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub tauri_version: String,
    pub webkit_version: String,
    pub build_date: String,
    pub git_sha: String,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        tauri_version: tauri::VERSION.to_owned(),
        webkit_version: webkit_version(),
        build_date: option_env!("RIFF_BUILD_DATE").unwrap_or("unknown").to_owned(),
        git_sha: option_env!("RIFF_GIT_SHA").unwrap_or("unknown").to_owned(),
    }
}

fn webkit_version() -> String {
    // From the runtime, not the build: the two can differ after a system
    // upgrade, and the runtime one is what a bug report needs.
    //
    // NOT `pkg-config --modversion webkit2gtk-4.1`. pkg-config and the .pc
    // file both come from libwebkit2gtk-4.1-dev, which users do not install,
    // so shelling out would print "unknown" on essentially every machine
    // Riff actually runs on — including every machine that files a bug.
    tauri::webview_version().unwrap_or_else(|_| "unknown".to_owned())
}

#[tauri::command]
pub fn paths_get(store: tauri::State<'_, Arc<SettingsStore>>) -> AppPaths {
    store.paths().clone()
}

#[tauri::command]
pub fn open_path(
    kind: PathKind,
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<SettingsStore>>,
) -> RiffResult<()> {
    let target = kind.resolve(store.paths());
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(target.to_string_lossy(), None::<&str>)
        .map_err(|e| RiffError::Denied { what: e.to_string() })
}

#[tauri::command]
pub fn open_external(link: ExternalLink, app: tauri::AppHandle) -> RiffResult<()> {
    // Opening a link hands it to the user's browser. Riff itself makes no
    // network request, which is what "zero network" means.
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(link.url(), None::<&str>)
        .map_err(|e| RiffError::Denied { what: e.to_string() })
}

#[tauri::command]
pub fn app_ready(window: tauri::WebviewWindow) -> RiffResult<()> {
    // The last boot phase. Together with the earlier marks this makes the
    // 400 ms startup target from spec §13 falsifiable instead of aspirational.
    tracing::info!(phase = "first-paint", "boot");
    window.show().map_err(|e| RiffError::Denied { what: e.to_string() })
}
```

- [ ] **Step 5: Declare the modules**

Create `src-tauri/src/commands/mod.rs`:

```rust
pub mod app;
```

Add to `src-tauri/src/lib.rs`:

```rust
pub mod commands;
```

- [ ] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test commands::app`
Expected: PASS, 3 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ipc): add application info and enum-scoped open commands"
```

---

### Task 2: Settings commands with Rust-side file pickers

**Interfaces:**
- Produces: commands `settings_get`, `settings_patch`, `settings_reset`, `settings_export`, `settings_import`.

**Files:**
- Create: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/commands/settings.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> (std::sync::Arc<SettingsStore>, tempfile::TempDir) {
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
        let (s, _) = SettingsStore::load(paths);
        (std::sync::Arc::new(s), tmp)
    }

    #[test]
    fn import_from_a_path_keeps_existing_onboarding_completion() {
        let (s, tmp) = store();
        s.patch(&json!({ "onboarding": { "completedAt": "2026-08-28T10:00:00Z" } })).expect("patch");

        let incoming = tmp.path().join("exported.json");
        std::fs::write(&incoming, br#"{"version":1,"appearance":{"theme":"light"}}"#).expect("write");

        let result = import_from(&s, &incoming).expect("import");
        assert_eq!(result.appearance.theme, crate::settings::model::Theme::Light);
        assert_eq!(
            result.onboarding.completed_at.as_deref(),
            Some("2026-08-28T10:00:00Z"),
            "importing preferences must not restart first run"
        );
    }

    #[test]
    fn import_rejects_a_malformed_file_without_changing_anything() {
        let (s, tmp) = store();
        let before = s.get();
        let bad = tmp.path().join("bad.json");
        std::fs::write(&bad, b"not json at all").expect("write");

        let err = import_from(&s, &bad).expect_err("must reject");
        assert!(matches!(err, RiffError::Parse { .. }));
        assert_eq!(s.get(), before, "a rejected import must leave state untouched");
    }

    #[test]
    fn export_writes_the_current_document() {
        let (s, tmp) = store();
        s.patch(&json!({ "appearance": { "density": "compact" } })).expect("patch");
        let target = tmp.path().join("out.json");
        export_to(&s, &target).expect("export");

        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&target).expect("read")).expect("json");
        assert_eq!(written["appearance"]["density"], "compact");
    }
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd src-tauri && cargo test commands::settings`
Expected: FAIL to compile

- [ ] **Step 3: Implement**

Insert above the tests:

```rust
//! Settings commands.
//!
//! Neither import nor export accepts a path from the frontend. The native
//! picker is opened here, in Rust, so no filesystem path is ever chosen by,
//! passed through, or visible to the webview — the same rule `open_path`
//! follows. This is also why the webview needs no `dialog` capability.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tauri_plugin_dialog::DialogExt;

use crate::error::{RiffError, RiffResult};
use crate::settings::model::Settings;
use crate::settings::store::{FlushScheduler, Section, SettingsStore};

#[tauri::command]
pub fn settings_get(store: tauri::State<'_, Arc<SettingsStore>>) -> Settings {
    store.get()
}

/// A VALIDATION failure returns `Err` — nothing was applied, so the caller
/// should roll back. A WRITE failure does not: the value is applied in memory
/// and the interface must keep showing it, or the interface is lying about
/// what the user chose. The write failure is reported out-of-band so a toast
/// can explain it while the setting stays applied and retries on next change.
#[tauri::command]
pub fn settings_patch(
    patch: Value,
    store: tauri::State<'_, Arc<SettingsStore>>,
    scheduler: tauri::State<'_, Arc<FlushScheduler>>,
) -> RiffResult<Settings> {
    let next = store.patch(&patch)?;
    schedule_write(&scheduler);
    Ok(next)
}

#[tauri::command]
pub fn settings_reset(
    section: Option<Section>,
    store: tauri::State<'_, Arc<SettingsStore>>,
    scheduler: tauri::State<'_, Arc<FlushScheduler>>,
) -> RiffResult<Settings> {
    let next = store.reset(section)?;
    schedule_write(&scheduler);
    Ok(next)
}

/// Schedules a write instead of performing one. Flushing synchronously here
/// would defeat the coalescing in Plan 03 Task 8 entirely — a UI-scale drag
/// is forty patches, and forty `fsync`ed atomic writes is not what §4.4
/// describes. The scheduler reports its own failures, once per cause.
fn schedule_write(scheduler: &FlushScheduler) {
    scheduler.notify();
}

#[tauri::command]
pub async fn settings_export(
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<SettingsStore>>,
) -> RiffResult<Option<PathBuf>> {
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name("riff-settings.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    export_to(&store, &target)?;
    Ok(Some(target))
}

#[tauri::command]
pub async fn settings_import(
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<SettingsStore>>,
) -> RiffResult<Option<Settings>> {
    let Some(source) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    Ok(Some(import_from(&store, &source)?))
}

pub fn export_to(store: &SettingsStore, target: &Path) -> RiffResult<()> {
    let bytes = serde_json::to_vec_pretty(&store.get()).map_err(|e| RiffError::Validation {
        field: "settings".to_owned(),
        reason: e.to_string(),
    })?;
    crate::storage::atomic::write_atomic(target, &bytes).map_err(|e| RiffError::io(target, &e))
}

pub fn import_from(store: &SettingsStore, source: &Path) -> RiffResult<Settings> {
    let bytes = std::fs::read(source).map_err(|e| RiffError::io(source, &e))?;
    let mut document: Value =
        serde_json::from_slice(&bytes).map_err(|e| RiffError::parse(source, &e))?;

    crate::settings::migrate::run(&mut document);

    // Onboarding is not a preference and is not importable: someone else's
    // exported settings must not drop this user back into a first-run wizard.
    if let Some(object) = document.as_object_mut() {
        object.remove("onboarding");
    }

    let next = store.patch(&document)?;
    if let Err(err) = store.flush_if_dirty() {
        tracing::error!(%err, "imported settings could not be written");
    }
    Ok(next)
}
```

- [ ] **Step 4: Declare it**

In `src-tauri/src/commands/mod.rs`:

```rust
pub mod settings;
```

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test commands::settings`
Expected: PASS, 3 tests

If `into_path()` does not exist on the dialog's returned type in the installed plugin version, run `cargo doc --open -p tauri-plugin-dialog` and use the equivalent accessor. Do not fall back to accepting a path from the frontend.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ipc): add settings commands with rust-side file pickers"
```

---

### Task 3: Window control commands

**Interfaces:**
- Produces: commands `window_minimize`, `window_toggle_maximize`, `window_close`, `window_set_decorations(enabled: bool) -> RiffResult<bool>` returning what the window manager actually did.

**Files:**
- Create: `src-tauri/src/commands/window.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Implement**

Create `src-tauri/src/commands/window.rs`:

```rust
//! Custom title bar controls.

use crate::error::{RiffError, RiffResult};

fn denied(e: tauri::Error) -> RiffError {
    RiffError::Denied { what: e.to_string() }
}

#[tauri::command]
pub fn window_minimize(window: tauri::WebviewWindow) -> RiffResult<()> {
    window.minimize().map_err(denied)
}

#[tauri::command]
pub fn window_toggle_maximize(window: tauri::WebviewWindow) -> RiffResult<()> {
    if window.is_maximized().map_err(denied)? {
        window.unmaximize().map_err(denied)
    } else {
        window.maximize().map_err(denied)
    }
}

#[tauri::command]
pub fn window_close(window: tauri::WebviewWindow) -> RiffResult<()> {
    window.close().map_err(denied)
}

/// Completes a quit the user confirmed. `window_close` fires the
/// `CloseRequested` handler, which asks again when `confirmOnQuit` is set;
/// this bypasses that once.
#[tauri::command]
pub fn window_quit_confirmed(window: tauri::WebviewWindow) -> RiffResult<()> {
    use tauri::Manager;
    window
        .state::<crate::QuitApproved>()
        .0
        .store(true, std::sync::atomic::Ordering::SeqCst);
    window.close().map_err(denied)
}

/// Returns the decoration state the window ACTUALLY has afterwards.
///
/// Under Wayland the compositor owns decorations and may ignore the request
/// outright — Hyprland does. The caller compares the returned value with what
/// it asked for and reverts its own setting if they differ, rather than
/// leaving the user with no title bar at all and a switch claiming otherwise.
#[tauri::command]
pub fn window_set_decorations(enabled: bool, window: tauri::WebviewWindow) -> RiffResult<bool> {
    window.set_decorations(enabled).map_err(denied)?;
    window.is_decorated().map_err(denied)
}
```

- [ ] **Step 2: Declare it**

In `src-tauri/src/commands/mod.rs`:

```rust
pub mod window;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ipc): add window control commands that report real decoration state"
```

---

### Task 4: The IPC shape fixture

This is what replaces code generation. A change to any Rust type that crosses the boundary fails this test and names the TypeScript that must follow.

**Files:**
- Create: `src-tauri/tests/ipc_shapes.rs`, `src-tauri/tests/fixtures/ipc-shapes.json`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/ipc_shapes.rs`:

```rust
//! Guards the hand-written TypeScript in `src/lib/ipc/types.ts`.
//!
//! Serialises one representative value of every type that crosses the IPC
//! boundary and compares the result against a committed fixture. Changing a
//! Rust type fails this test, which is the reminder to change the TypeScript.
//!
//! To accept an intentional change: RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes

use riff_lib::commands::app::{AppInfo, ExternalLink, PathKind};
use riff_lib::error::RiffError;
use riff_lib::settings::model::Settings;
use riff_lib::settings::store::Section;
use serde_json::json;

// Every type that crosses to the frontend belongs here, including the ones
// that travel in the bootstrap payload rather than as a command result.
// A rename in AppPaths would otherwise reach TypeScript unannounced.

fn shapes() -> serde_json::Value {
    json!({
        "Settings": Settings::default(),
        "Section": [Section::General, Section::Appearance, Section::Onboarding],
        "PathKind": [PathKind::Config, PathKind::Data, PathKind::Cache, PathKind::Logs],
        "ExternalLink": [ExternalLink::Repository, ExternalLink::Issues, ExternalLink::License],
        "AppPaths": riff_lib::paths::AppPaths {
            config_dir: "/c".into(),
            data_dir: "/d".into(),
            state_dir: "/s".into(),
            cache_dir: "/k".into(),
            log_dir: "/s/logs".into(),
            home_dir: "/h".into(),
        },
        "AppInfo": AppInfo {
            version: "0.0.0".into(),
            tauri_version: "0.0.0".into(),
            webkit_version: "0.0.0".into(),
            build_date: "1970-01-01".into(),
            git_sha: "0000000".into(),
        },
        "RiffError": [
            RiffError::Io { path: "p".into(), message: "m".into() },
            RiffError::Parse { path: "p".into(), message: "m".into(), line: Some(1) },
            RiffError::Validation { field: "f".into(), reason: "r".into() },
            RiffError::NotFound { what: "w".into() },
            RiffError::Denied { what: "w".into() },
        ],
    })
}

#[test]
fn ipc_shapes_match_the_committed_fixture() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ipc-shapes.json");
    let actual = serde_json::to_string_pretty(&shapes()).expect("serialises");

    if std::env::var_os("RIFF_UPDATE_FIXTURES").is_some() {
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent).expect("fixture directory");
        }
        std::fs::write(path, &actual).expect("write fixture");
        return;
    }

    let expected = std::fs::read_to_string(path).unwrap_or_else(|_| {
        panic!("missing fixture; run RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes")
    });

    assert_eq!(
        actual.trim(),
        expected.trim(),
        "\nIPC payload shapes changed. Update src/lib/ipc/types.ts to match, then re-run with \
         RIFF_UPDATE_FIXTURES=1 to accept the new shape.\n"
    );
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd src-tauri && cargo test --test ipc_shapes`
Expected: FAIL — `missing fixture; run RIFF_UPDATE_FIXTURES=1 …`

- [ ] **Step 3: Generate the fixture**

Run: `cd src-tauri && RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes`
Expected: PASS

- [ ] **Step 4: Confirm it now guards**

Run: `cd src-tauri && cargo test --test ipc_shapes`
Expected: PASS

Then temporarily rename `AppInfo.git_sha` to `git_hash` and re-run.
Expected: FAIL with the diff. Revert the rename.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(ipc): pin payload shapes with a committed fixture"
```

---

### Task 5: The bootstrap plugin

**Interfaces:**
- Produces: `bootstrap::Bootstrap { settings, paths, app_info }` and `bootstrap::init(&Bootstrap) -> TauriPlugin<Wry>`, which sets `window.__RIFF_BOOTSTRAP__` and the `<html>` attributes before any page script runs.

**Files:**
- Create: `src-tauri/src/bootstrap.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/bootstrap.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Bootstrap {
        let tmp = std::path::PathBuf::from("/tmp/riff-test");
        Bootstrap {
            settings: crate::settings::model::Settings::default(),
            paths: crate::paths::AppPaths {
                config_dir: tmp.join("config"),
                data_dir: tmp.join("data"),
                state_dir: tmp.join("state"),
                cache_dir: tmp.join("cache"),
                log_dir: tmp.join("state/logs"),
            },
            app_info: crate::commands::app::app_info(),
            recovered_from: None,
        }
    }

    #[test]
    fn the_script_defines_the_global_before_anything_reads_it() {
        let script = render_script(&sample());
        assert!(script.contains("window.__RIFF_BOOTSTRAP__ ="));
        assert!(script.contains("\"theme\":\"dark\""));
    }

    #[test]
    fn the_script_applies_theme_attributes_without_an_inline_html_script() {
        // An inline <script> in index.html would violate `script-src 'self'`.
        // Doing it here keeps the CSP strict.
        let script = render_script(&sample());
        assert!(script.contains("dataset.theme"));
        assert!(script.contains("dataset.density"));
        assert!(script.contains("dataset.contrast"));
        assert!(script.contains("dataset.motion"));
        assert!(script.contains("--ui-scale"));
    }

    #[test]
    fn the_script_is_valid_when_a_path_contains_quotes_or_backslashes() {
        let mut payload = sample();
        payload.paths.config_dir = std::path::PathBuf::from(r#"/tmp/we"ird\path"#);
        let script = render_script(&payload);
        // serde_json escapes it; the raw sequence must not appear unescaped.
        assert!(!script.contains(r#""ird\path"#));
    }
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd src-tauri && cargo test bootstrap`
Expected: FAIL to compile

- [ ] **Step 3: Implement**

Insert above the tests:

```rust
//! Hands the frontend everything it needs before its first line runs.
//!
//! Two jobs, both done in one initialisation script so that `index.html`
//! needs no inline `<script>` — an inline script would force
//! `script-src 'unsafe-inline'` into the CSP, which is exactly the directive
//! worth keeping strict.
//!
//! The window is created hidden and revealed only once the frontend has
//! painted, so a flash of unstyled content is impossible by construction.
//! These attributes still land before React mounts, so the first painted
//! frame is already correct.

use tauri::plugin::TauriPlugin;
use tauri::Wry;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: crate::settings::model::Settings,
    pub paths: crate::paths::AppPaths,
    pub app_info: crate::commands::app::AppInfo,
    /// Set when `settings.json` could not be parsed and was moved aside. It
    /// travels in the payload rather than as an event because recovery
    /// happens before `tauri::Builder` exists — there is nothing to emit to
    /// yet, and emitting later would race the frontend's first render.
    pub recovered_from: Option<std::path::PathBuf>,
}

pub fn render_script(payload: &Bootstrap) -> String {
    let json = serde_json::to_string(payload).unwrap_or_else(|_| "null".to_owned());
    format!(
        r#"window.__RIFF_BOOTSTRAP__ = {json};
(function apply() {{
  var root = document.documentElement;
  if (!root) {{ requestAnimationFrame(apply); return; }}
  var b = window.__RIFF_BOOTSTRAP__;
  var a = (b && b.settings && b.settings.appearance) || {{}};
  root.dataset.theme = a.theme === "light" ? "light" : "dark";
  root.dataset.density = a.density === "compact" ? "compact" : "comfortable";
  root.dataset.contrast = a.highContrast ? "high" : "normal";
  // Also before first paint: without it a user who set "always reduce" still
  // sees the first animation of every launch.
  root.dataset.motion =
    a.reduceMotion === "always" ? "reduced"
    : a.reduceMotion === "never" ? "full"
    : (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full");
  root.style.setProperty("--ui-scale", String(a.uiScale || 1));
}})();"#
    )
}

pub fn init(payload: &Bootstrap) -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("riff-bootstrap")
        .js_init_script(render_script(payload))
        .build()
}
```

- [ ] **Step 4: Declare it**

In `src-tauri/src/lib.rs`:

```rust
pub mod bootstrap;
```

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test bootstrap`
Expected: PASS, 3 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(bootstrap): inject settings and theme before the first page script"
```

---

### Task 6: Tauri configuration

**Files:**
- Modify: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`

- [ ] **Step 1: Rewrite the configuration**

Overwrite `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "riff",
  "version": "../package.json",
  "identifier": "io.github.valasme.riff",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Riff",
        "width": 1280,
        "height": 832,
        "minWidth": 960,
        "minHeight": 640,
        "decorations": false,
        "visible": false,
        "backgroundColor": "#242424"
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'none'; connect-src ipc: http://ipc.localhost; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
      "devCsp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src ipc: http://ipc.localhost ws://localhost:1421 http://localhost:1420",
      "freezePrototype": true
    }
  },
  "bundle": {
    "active": true,
    "targets": ["deb", "rpm", "appimage"],
    "category": "Music",
    "shortDescription": "Practise with sheet music, video and audio in one place",
    "longDescription": "Riff is a local-first practice workspace for musicians. It keeps a PDF score, a video lesson and an audio track side by side on one page. No accounts, no telemetry, no network.",
    "copyright": "Copyright (c) 2026 valasme",
    "license": "MIT",
    "homepage": "https://github.com/valasme/riff",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "linux": {
      "deb": { "depends": ["libwebkit2gtk-4.1-0", "libgtk-3-0"] },
      "rpm": { "depends": ["webkit2gtk4.1", "gtk3"] },
      "appimage": { "bundleMediaFramework": false }
    }
  }
}
```

`"category": "Music"` is not a style choice. Tauri validates this against its own `AppCategory` list, which has no `"Audio"` entry — the build fails outright. `Music` is the one that exists, and `tauri-bundler` expands it to the freedesktop `Categories=AudioVideo;Audio;Music;` the desktop entry wants anyway.

`bundleMediaFramework` stays `false` deliberately. It bundles GStreamer into the AppImage and inflates it by well over a hundred megabytes; there is no media in this milestone, so paying that now would be paying for nothing. It is the lever the media work in spec §15 will pull.

- [ ] **Step 2: Trim capabilities to the two that are actually used**

Overwrite `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Riff's main window. The opener, dialog and window-state plugins are driven only from Rust and therefore need no JS permission, and there is no log plugin — frontend diagnostics go through our own log_write command.",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

- [ ] **Step 3: Verify the configuration parses**

Run: `cd src-tauri && cargo build`
Expected: succeeds. A malformed `tauri.conf.json` fails at build time with the offending JSON pointer.

- [ ] **Step 4: Verify the version is read from package.json**

Run: `grep -c '"version": "../package.json"' src-tauri/tauri.conf.json`
Expected: `1`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build(tauri): strict csp, hidden themed window, three bundle targets"
```

---

### Task 7: Wire it together

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Collect the command handlers**

Append to `src-tauri/src/commands/mod.rs`:

```rust
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
```

- [ ] **Step 2: Write the entry point**

Overwrite the `run` function in `src-tauri/src/lib.rs`, keeping the `pub mod` declarations above it:

```rust
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
    let paths = match paths::resolve(&paths::XdgRoots::from_system(), &paths::PathOverrides::from_env())
    {
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
    tracing::info!(phase = "paths", elapsed_ms = boot.elapsed().as_millis() as u64, "boot");
    // The best-effort notification Plan 02 deferred to here. Non-blocking on
    // purpose: a blocking dialog raised from a panic on the GTK main thread
    // can deadlock, turning a crash report into a hang. The hook already
    // logged unconditionally; this is a courtesy on top.
    logging::set_panic_notifier(|message| {
        use tauri_plugin_dialog::DialogExt;
        if let Some(app) = APP_HANDLE.get() {
            app.dialog().message(message).title("Riff crashed").show(|_| {});
        }
    });

    // 3. Settings, BEFORE the Tauri builder exists — the bootstrap script
    //    needs them as a string at plugin-registration time.
    let (store, outcome) = SettingsStore::load(paths.clone());
    match &outcome {
        LoadOutcome::Fresh => tracing::info!("no settings file; starting from defaults"),
        LoadOutcome::Loaded => tracing::info!("settings loaded"),
        LoadOutcome::Migrated { from } => tracing::info!(from, "settings migrated"),
        LoadOutcome::Recovered { quarantined } => {
            tracing::error!(path = %quarantined.display(), "settings recovered from a corrupt file");
        }
    }
    let store = Arc::new(store);
    if let Err(err) = store.flush_if_dirty() {
        tracing::error!(%err, "could not write initial settings");
    }
    if let Err(err) = settings::schema::write(&paths) {
        tracing::warn!(%err, "could not write settings.schema.json");
    }

    tracing::info!(phase = "settings", elapsed_ms = boot.elapsed().as_millis() as u64, "boot");

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
                let tauri::WindowEvent::CloseRequested { api, .. } = event else { return };
                if !store.get().general.confirm_on_quit {
                    return;
                }
                if window.state::<QuitApproved>().0.load(std::sync::atomic::Ordering::SeqCst) {
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
                    Ok(watcher) => app.manage(watcher),
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
```

- [ ] **Step 3: Signal readiness from the frontend**

In `src/main.tsx`, replace the render call:

```tsx
import { invoke } from "@tauri-apps/api/core";

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <div id="app-root" className="flex" />
  </React.StrictMode>,
);

// Reveal the window only once something has painted. The Rust watchdog shows
// it after three seconds regardless, so a failure here delays startup rather
// than preventing it.
requestAnimationFrame(() => {
  void invoke("app_ready").catch(() => {});
});
```

- [ ] **Step 4: Run the application**

Run: `pnpm app`
Expected: a dark, undecorated 1280×832 window appears. Check `~/.config/riff/settings.json` and `~/.config/riff/settings.schema.json` both exist, and `~/.local/state/riff/logs/` contains a log.

- [ ] **Step 5: Verify the reveal watchdog**

Temporarily comment out the `requestAnimationFrame` block in `src/main.tsx` and run `pnpm app` again.
Expected: the window still appears, after roughly three seconds, with `frontend never signalled readiness` in the log. Restore the block.

- [ ] **Step 6: Verify zero network**

With the application running: `ss -tup | grep -i riff`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): wire the store, bootstrap, watcher and reveal watchdog"
```

---

### Task 8: The TypeScript IPC facade

**Interfaces:**
- Produces: `@/lib/ipc` exporting `ipc` (typed command functions), the types `Settings`, `Appearance`, `General`, `Onboarding`, `AppPaths`, `AppInfo`, `RiffError`, `Section`, `PathKind`, `ExternalLink`, `DeepPartial<T>`, and `isRiffError(value)`.

**Files:**
- Create: `src/lib/ipc/types.ts`, `src/lib/ipc/index.ts`, `src/lib/ipc/ipc.test.ts`

- [ ] **Step 1: Write the types**

Create `src/lib/ipc/types.ts`. These mirror `src-tauri/tests/fixtures/ipc-shapes.json` exactly; that fixture is what fails when they drift.

```ts
export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";
export type ReduceMotion = "system" | "always" | "never";
export type TitleBarStyle = "custom" | "system";
export type StartupRoute = "practice" | "history" | "last-used";
export type Section = "general" | "appearance" | "onboarding";
export type PathKind = "config" | "data" | "cache" | "logs";
export type ExternalLink = "repository" | "issues" | "license";

export interface General {
  startupRoute: StartupRoute;
  lastRoute: string;
  restoreWindowState: boolean;
  confirmOnQuit: boolean;
  language: string;
}

export interface Sidebar {
  collapsed: boolean;
  rememberCollapsed: boolean;
}

export interface Appearance {
  theme: Theme;
  density: Density;
  uiScale: number;
  reduceMotion: ReduceMotion;
  highContrast: boolean;
  titleBar: TitleBarStyle;
  sidebar: Sidebar;
}

export interface Onboarding {
  completedAt: string | null;
  version: number;
}

export interface Settings {
  $schema: string;
  version: number;
  general: General;
  appearance: Appearance;
  onboarding: Onboarding;
}

export interface AppPaths {
  configDir: string;
  dataDir: string;
  stateDir: string;
  cacheDir: string;
  logDir: string;
  /** Carried so the frontend can redact it before anything reaches the clipboard. */
  homeDir: string;
}

export interface AppInfo {
  version: string;
  tauriVersion: string;
  webkitVersion: string;
  buildDate: string;
  gitSha: string;
}

export type RiffError =
  | { code: "io"; details: { path: string; message: string } }
  | { code: "parse"; details: { path: string; message: string; line: number | null } }
  | { code: "validation"; details: { field: string; reason: string } }
  | { code: "not-found"; details: { what: string } }
  | { code: "denied"; details: { what: string } };

/** Mirrors the Rust merge patch: every field optional, recursively. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
```

- [ ] **Step 2: Write the facade**

Create `src/lib/ipc/index.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  AppPaths,
  DeepPartial,
  ExternalLink,
  PathKind,
  RiffError,
  Section,
  Settings,
} from "./types";

export * from "./types";

export function isRiffError(value: unknown): value is RiffError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code: unknown }).code === "string"
  );
}

/**
 * Every command Riff exposes. Hand-written rather than generated: the
 * Tauri-v2 line of tauri-specta has been a release candidate for twenty-five
 * versions, and a pre-release dependency on this seam is not worth eighty
 * lines. `src-tauri/tests/ipc_shapes.rs` fails if the Rust types drift.
 */
export const ipc = {
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsPatch: (patch: DeepPartial<Settings>) => invoke<Settings>("settings_patch", { patch }),
  settingsReset: (section?: Section) => invoke<Settings>("settings_reset", { section: section ?? null }),
  settingsExport: () => invoke<string | null>("settings_export"),
  settingsImport: () => invoke<Settings | null>("settings_import"),
  pathsGet: () => invoke<AppPaths>("paths_get"),
  openPath: (kind: PathKind) => invoke<void>("open_path", { kind }),
  openExternal: (link: ExternalLink) => invoke<void>("open_external", { link }),
  appInfo: () => invoke<AppInfo>("app_info"),
  appReady: () => invoke<void>("app_ready"),
  windowMinimize: () => invoke<void>("window_minimize"),
  windowToggleMaximize: () => invoke<void>("window_toggle_maximize"),
  windowClose: () => invoke<void>("window_close"),
  windowQuitConfirmed: () => invoke<void>("window_quit_confirmed"),
  windowSetDecorations: (enabled: boolean) => invoke<boolean>("window_set_decorations", { enabled }),
} as const;
```

- [ ] **Step 3: Write the test**

Create `src/lib/ipc/ipc.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { ipc, isRiffError } = await import("./index");

describe("ipc facade", () => {
  beforeEach(() => invoke.mockReset());

  it("passes a patch under the argument name the command expects", async () => {
    invoke.mockResolvedValue({});
    await ipc.settingsPatch({ appearance: { theme: "light" } });
    expect(invoke).toHaveBeenCalledWith("settings_patch", {
      patch: { appearance: { theme: "light" } },
    });
  });

  it("sends null rather than undefined when resetting everything", async () => {
    invoke.mockResolvedValue({});
    await ipc.settingsReset();
    expect(invoke).toHaveBeenCalledWith("settings_reset", { section: null });
  });

  it("recognises a serialised RiffError", () => {
    expect(isRiffError({ code: "denied", details: { what: "x" } })).toBe(true);
    expect(isRiffError(new Error("boom"))).toBe(false);
    expect(isRiffError(null)).toBe(false);
  });
});
```

- [ ] **Step 4: Run it**

Run: `pnpm test src/lib/ipc`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ipc): add the hand-written typed command facade"
```

---

### Task 9: Gate check

- [ ] **Step 1: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```
Expected: all exit 0.

- [ ] **Step 2: Confirm the capability surface has not grown**

Run: `python3 -c "import json;print(json.load(open('src-tauri/capabilities/default.json'))['permissions'])"`
Expected: exactly `['core:default']`. If anything else appears, a plugin is being called from JavaScript that should be called from Rust.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify ipc and window lifecycle gates" --allow-empty
```

# 11 — Diagnostics, Log Export and the Command Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When something goes wrong, the user can hand over one file that answers every question, and can fix common breakage from a terminal without a working window.

**Architecture:** Everything here runs **before** `tauri::Builder` exists. Argument parsing, health checks and repair need no GTK, no webview and no display, so `riff doctor` works over SSH on a machine whose window will not open — which is exactly when you need it. The GUI's "Export diagnostics" button and `riff logs export` call the same function, so there is one bundle format and one code path.

**Tech Stack:** `clap` 4 with derive, `sysinfo`-free hand-rolled probes (no dependency for reading `/etc/os-release`), the session logger from Plan 02, the settings store from Plan 03.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§4.1, §12, §18)

## Global Constraints

- **CLI dispatch happens before `tauri_plugin_single_instance` is registered.** Otherwise a second invocation forwards its arguments to the running GUI and exits silently, and `riff --help` prints nothing while Riff is open.
- **No CLI path initialises GTK or a webview.** `riff doctor` must work with no `DISPLAY` and no `WAYLAND_DISPLAY`.
- **The CLI is a different trust domain from the webview.** Accepting `--output <path>` from the user's own shell is fine and does not contradict the no-caller-supplied-paths rule, which exists to constrain a *compromised frontend*. State this in the module doc so it does not read as an inconsistency.
- **Never dump the environment.** Environment variables are read from an allow-list. A full dump routinely contains API tokens, and this file is designed to be pasted in public.
- **Redaction happens at export, not at write.** Local logs keep real paths so the user can grep them; the bundle rewrites `$HOME` and the username.
- **Zero network.** Nothing here uploads anything. Export writes a file; the user decides where it goes.
- **Rust lints:** `clippy::unwrap_used` denied outside tests.
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/diagnostics/mod.rs` | Re-exports |
| `src-tauri/src/diagnostics/probe.rs` | `SystemInfo` — distro, kernel, glibc, session, desktop, locale, hardware |
| `src-tauri/src/diagnostics/banner.rs` | The block written at the top of every session log |
| `src-tauri/src/diagnostics/bundle.rs` | Assemble, redact and cap the export |
| `src-tauri/src/diagnostics/health.rs` | `Check`, `run_checks`, `Severity` — shared by `doctor` and the GUI |
| `src-tauri/src/cli.rs` | `clap` definition and dispatch |
| `src-tauri/src/commands/diagnostics.rs` | `diagnostics_export`, `log_write` |
| `src/features/settings/sections/AboutSection.tsx` | The export button |
| `src/lib/logger.ts` | Frontend bridge, `window.onerror`, `unhandledrejection` |

---

### Task 1: The system probe

**Interfaces:**
- Produces: `diagnostics::probe::{SystemInfo, probe, Env}` where `Env` is an injected map so the probe is pure and testable.

**Files:**
- Create: `src-tauri/src/diagnostics/mod.rs`, `src-tauri/src/diagnostics/probe.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write the failing tests**

Create `src-tauri/src/diagnostics/probe.rs` containing only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Env {
        pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()
    }

    const OS_RELEASE: &str = r#"NAME="Arch Linux"
PRETTY_NAME="Arch Linux"
ID=arch
BUILD_ID=rolling
"#;

    #[test]
    fn reads_the_distribution_from_os_release() {
        let info = SystemInfo::from_parts(OS_RELEASE, "6.9.3-arch1-1", &env(&[]));
        assert_eq!(info.distro, "Arch Linux");
        assert_eq!(info.distro_id, "arch");
        assert_eq!(info.kernel, "6.9.3-arch1-1");
    }

    #[test]
    fn falls_back_when_os_release_is_absent_rather_than_failing() {
        let info = SystemInfo::from_parts("", "", &env(&[]));
        assert_eq!(info.distro, "unknown");
        // A diagnostics probe that can fail is a diagnostics probe that will
        // fail on the one machine you needed it for.
    }

    #[test]
    fn identifies_the_session_and_desktop() {
        let info = SystemInfo::from_parts(
            OS_RELEASE,
            "6.9",
            &env(&[("XDG_SESSION_TYPE", "wayland"), ("XDG_CURRENT_DESKTOP", "Hyprland")]),
        );
        assert_eq!(info.session_type, "wayland");
        assert_eq!(info.desktop, "Hyprland");
    }

    #[test]
    fn names_the_compositor_when_its_signature_is_present() {
        let info = SystemInfo::from_parts(
            OS_RELEASE,
            "6.9",
            &env(&[("XDG_SESSION_TYPE", "wayland"), ("HYPRLAND_INSTANCE_SIGNATURE", "abc")]),
        );
        assert_eq!(info.compositor.as_deref(), Some("Hyprland"));
    }

    #[test]
    fn records_only_allow_listed_environment_variables() {
        let info = SystemInfo::from_parts(
            OS_RELEASE,
            "6.9",
            &env(&[
                ("RIFF_LOG", "debug"),
                ("GDK_SCALE", "2"),
                ("AWS_SECRET_ACCESS_KEY", "hunter2"),
                ("GITHUB_TOKEN", "ghp_xxx"),
            ]),
        );
        assert!(info.env.contains_key("RIFF_LOG"));
        assert!(info.env.contains_key("GDK_SCALE"));
        assert!(
            !info.env.keys().any(|k| k.contains("SECRET") || k.contains("TOKEN")),
            "a diagnostics file is meant to be pasted in public; never dump the environment"
        );
    }

    #[test]
    fn detects_an_appimage_launch() {
        let info = SystemInfo::from_parts(OS_RELEASE, "6.9", &env(&[("APPIMAGE", "/tmp/riff.AppImage")]));
        assert_eq!(info.package_format.as_deref(), Some("AppImage"));
    }
}
```

- [x] **Step 2: Run and watch them fail**

Run: `cd src-tauri && cargo test diagnostics::probe`
Expected: FAIL to compile — `cannot find type SystemInfo`

- [x] **Step 3: Implement**

Insert above the tests:

```rust
//! What machine is this, really.
//!
//! Split into `from_parts` (pure, tested) and `probe` (reads the world), so
//! every branch is exercised without needing a machine that has the property
//! under test. A diagnostics probe must never fail — every field degrades to
//! "unknown" rather than returning an error.

use std::collections::BTreeMap;

pub type Env = BTreeMap<String, String>;

/// Read verbatim into the report. Anything not on this list is not recorded,
/// because a full environment dump routinely contains credentials and this
/// file is designed to be pasted into a public issue.
const ENV_ALLOW_PREFIXES: &[&str] = &[
    "RIFF_", "XDG_", "GDK_", "GTK_", "WEBKIT_", "GST_", "QT_", "LANG", "LC_",
    "DISPLAY", "WAYLAND_DISPLAY", "DESKTOP_SESSION", "APPIMAGE", "container",
];

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub distro: String,
    pub distro_id: String,
    pub distro_version: String,
    pub kernel: String,
    pub arch: String,
    pub session_type: String,
    pub desktop: String,
    pub compositor: Option<String>,
    pub package_format: Option<String>,
    pub locale: String,
    pub env: Env,
}

impl SystemInfo {
    pub fn from_parts(os_release: &str, kernel: &str, env: &Env) -> Self {
        let field = |key: &str| -> String {
            os_release
                .lines()
                .find_map(|line| line.strip_prefix(&format!("{key}=")))
                .map(|value| value.trim_matches('"').to_owned())
                .unwrap_or_else(|| "unknown".to_owned())
        };

        let get = |key: &str| env.get(key).cloned().unwrap_or_default();

        // Compositor identification, in the order the signatures are unique.
        let compositor = if env.contains_key("HYPRLAND_INSTANCE_SIGNATURE") {
            Some("Hyprland".to_owned())
        } else if env.contains_key("SWAYSOCK") {
            Some("sway".to_owned())
        } else if env.contains_key("NIRI_SOCKET") {
            Some("niri".to_owned())
        } else {
            None
        };

        let package_format = if env.contains_key("APPIMAGE") {
            Some("AppImage".to_owned())
        } else {
            None
        };

        Self {
            distro: field("PRETTY_NAME"),
            distro_id: field("ID"),
            distro_version: field("VERSION_ID"),
            kernel: if kernel.is_empty() { "unknown".to_owned() } else { kernel.to_owned() },
            arch: std::env::consts::ARCH.to_owned(),
            session_type: get("XDG_SESSION_TYPE"),
            desktop: get("XDG_CURRENT_DESKTOP"),
            compositor,
            package_format,
            locale: env.get("LC_ALL").or_else(|| env.get("LANG")).cloned().unwrap_or_default(),
            env: env
                .iter()
                .filter(|(key, _)| ENV_ALLOW_PREFIXES.iter().any(|p| key.starts_with(p)))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        }
    }
}

pub fn probe() -> SystemInfo {
    let os_release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    let kernel = std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default();
    let env: Env = std::env::vars().collect();
    SystemInfo::from_parts(&os_release, kernel.trim(), &env)
}
```

Create `src-tauri/src/diagnostics/mod.rs`:

```rust
pub mod probe;
```

Add `pub mod diagnostics;` to `src-tauri/src/lib.rs`.

- [x] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test diagnostics::probe`
Expected: PASS, 6 tests

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(diagnostics): probe the host without dumping the environment"
```

---

### Task 2: The session banner

Every session log opens with this. It is the difference between a bug report
that takes one round trip and one that takes four.

**Interfaces:**
- Produces: `diagnostics::banner::{Banner, render}`.

**Files:**
- Create: `src-tauri/src/diagnostics/banner.rs`
- Modify: `src-tauri/src/diagnostics/mod.rs`

- [x] **Step 1: Write the failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn banner() -> Banner {
        Banner {
            app_version: "0.1.0".into(),
            git_sha: "abc1234".into(),
            build_date: "2026-08-28".into(),
            build_profile: "release".into(),
            tauri_version: "2.11.5".into(),
            webkit_version: "2.52.6".into(),
            system: crate::diagnostics::probe::SystemInfo::from_parts(
                "PRETTY_NAME=\"Arch Linux\"\nID=arch\n",
                "6.9.3-arch1-1",
                &Default::default(),
            ),
            paths: vec![("config".into(), "/home/u/.config/riff".into(), true)],
            settings_outcome: "loaded".into(),
        }
    }

    #[test]
    fn records_everything_a_bug_report_asks_for() {
        let text = render(&banner());
        for expected in ["0.1.0", "abc1234", "2026-08-28", "2.52.6", "Arch Linux", "6.9.3-arch1-1"] {
            assert!(text.contains(expected), "banner is missing {expected}:\n{text}");
        }
    }

    #[test]
    fn marks_whether_each_directory_is_writable() {
        let text = render(&banner());
        assert!(text.contains("/home/u/.config/riff"));
        assert!(text.contains("writable"));
    }

    #[test]
    fn is_a_single_block_that_survives_being_pasted() {
        let text = render(&banner());
        assert!(text.starts_with("=== riff session ==="));
        assert!(text.ends_with('\n'));
    }
}
```

- [x] **Step 2: Run and watch it fail**

Run: `cd src-tauri && cargo test diagnostics::banner`
Expected: FAIL to compile

- [x] **Step 3: Implement**

```rust
//! The first lines of every session log.

use crate::diagnostics::probe::SystemInfo;

pub struct Banner {
    pub app_version: String,
    pub git_sha: String,
    pub build_date: String,
    pub build_profile: String,
    pub tauri_version: String,
    pub webkit_version: String,
    pub system: SystemInfo,
    /// name, path, writable
    pub paths: Vec<(String, String, bool)>,
    pub settings_outcome: String,
}

pub fn render(b: &Banner) -> String {
    let mut out = String::from("=== riff session ===\n");
    let mut line = |k: &str, v: &str| out.push_str(&format!("{k:<16}{v}\n"));

    line("version", &format!("{} ({}, built {})", b.app_version, b.git_sha, b.build_date));
    line("profile", &b.build_profile);
    line("tauri", &b.tauri_version);
    line("webkitgtk", &b.webkit_version);
    line("distro", &format!("{} ({})", b.system.distro, b.system.distro_version));
    line("kernel", &b.system.kernel);
    line("arch", &b.system.arch);
    line("session", &b.system.session_type);
    line("desktop", &b.system.desktop);
    if let Some(compositor) = &b.system.compositor {
        line("compositor", compositor);
    }
    if let Some(format) = &b.system.package_format {
        line("installed as", format);
    }
    line("locale", &b.system.locale);
    line("settings", &b.settings_outcome);

    out.push_str("paths\n");
    for (name, path, writable) in &b.paths {
        let state = if *writable { "writable" } else { "NOT WRITABLE" };
        out.push_str(&format!("  {name:<10}{path}  [{state}]\n"));
    }

    if !b.system.env.is_empty() {
        out.push_str("environment\n");
        for (key, value) in &b.system.env {
            out.push_str(&format!("  {key}={value}\n"));
        }
    }

    out.push_str("=====================\n");
    out
}
```

- [x] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test diagnostics::banner`
Expected: PASS, 3 tests

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(diagnostics): write a full session banner to every log"
```

---

### Task 3: Health checks

Shared by `riff doctor` and, later, an in-app health panel. A check knows how
to describe itself and whether `repair` can fix it.

**Interfaces:**
- Produces: `diagnostics::health::{Check, Severity, Outcome, run_checks}`.

**Files:**
- Create: `src-tauri/src/diagnostics/health.rs`

- [x] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn paths(tmp: &std::path::Path) -> crate::paths::AppPaths {
        crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.join("config")),
                data: Some(tmp.join("data")),
            },
        )
        .expect("overrides supply both roots")
    }

    #[test]
    fn a_healthy_installation_reports_no_problems() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        crate::paths::ensure_dirs(&p).expect("dirs");
        std::fs::write(p.settings_file(), b"{\"version\":1}").expect("seed");

        let report = run_checks(&p);
        assert!(report.iter().all(|c| c.severity == Severity::Ok), "{report:#?}");
    }

    #[test]
    fn a_missing_directory_is_reported_as_repairable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        // Deliberately do not create anything.
        let report = run_checks(&p);
        let missing = report.iter().find(|c| c.id == "dirs").expect("a dirs check exists");
        assert_eq!(missing.severity, Severity::Error);
        assert!(missing.repairable, "riff repair must be able to fix this");
    }

    #[test]
    fn an_unparseable_settings_file_is_an_error_and_is_repairable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        crate::paths::ensure_dirs(&p).expect("dirs");
        std::fs::write(p.settings_file(), b"{ not json").expect("seed");

        let check = run_checks(&p).into_iter().find(|c| c.id == "settings").expect("check");
        assert_eq!(check.severity, Severity::Error);
        assert!(check.repairable);
    }

    #[test]
    fn a_missing_settings_file_is_fine_because_defaults_are_written_on_launch() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        crate::paths::ensure_dirs(&p).expect("dirs");

        let check = run_checks(&p).into_iter().find(|c| c.id == "settings").expect("check");
        assert_eq!(check.severity, Severity::Ok);
    }

    #[test]
    fn accumulated_quarantine_files_are_a_warning_not_an_error() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        crate::paths::ensure_dirs(&p).expect("dirs");
        for i in 0..6 {
            std::fs::write(p.config_dir.join(format!("settings.json.corrupt-{i}")), b"x")
                .expect("seed");
        }

        let check = run_checks(&p).into_iter().find(|c| c.id == "quarantine").expect("check");
        assert_eq!(check.severity, Severity::Warn);
        assert!(check.repairable);
    }
}
```

- [x] **Step 2: Run and watch them fail**

Run: `cd src-tauri && cargo test diagnostics::health`
Expected: FAIL to compile

- [x] **Step 3: Implement**

```rust
//! What is wrong with this installation, and can we fix it.
//!
//! Every check is pure over an `AppPaths`, so `doctor` needs no window, no
//! GTK and no display — which is the state the machine is usually in when
//! somebody runs it.

use crate::paths::AppPaths;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Ok,
    Warn,
    Error,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: &'static str,
    pub title: &'static str,
    pub severity: Severity,
    pub detail: String,
    /// Whether `riff repair` knows how to fix this.
    pub repairable: bool,
}

const QUARANTINE_WARN_AT: usize = 5;

pub fn run_checks(paths: &AppPaths) -> Vec<Check> {
    vec![check_dirs(paths), check_writable(paths), check_settings(paths), check_quarantine(paths)]
}

fn check_dirs(paths: &AppPaths) -> Check {
    let missing: Vec<_> = [
        ("config", &paths.config_dir),
        ("data", &paths.data_dir),
        ("state", &paths.state_dir),
        ("cache", &paths.cache_dir),
        ("logs", &paths.log_dir),
    ]
    .into_iter()
    .filter(|(_, dir)| !dir.is_dir())
    .map(|(name, _)| name)
    .collect();

    if missing.is_empty() {
        Check { id: "dirs", title: "Directories", severity: Severity::Ok, detail: "all present".into(), repairable: false }
    } else {
        Check {
            id: "dirs",
            title: "Directories",
            severity: Severity::Error,
            detail: format!("missing: {}", missing.join(", ")),
            repairable: true,
        }
    }
}

fn check_writable(paths: &AppPaths) -> Check {
    let unwritable: Vec<String> = [&paths.config_dir, &paths.data_dir, &paths.log_dir]
        .into_iter()
        .filter(|dir| dir.is_dir() && is_read_only(dir))
        .map(|dir| dir.display().to_string())
        .collect();

    if unwritable.is_empty() {
        Check { id: "writable", title: "Permissions", severity: Severity::Ok, detail: "writable".into(), repairable: false }
    } else {
        Check {
            id: "writable",
            title: "Permissions",
            severity: Severity::Error,
            detail: format!("not writable: {}", unwritable.join(", ")),
            // Changing permissions on the user's directories is their call,
            // not ours. We report it; we do not chmod behind their back.
            repairable: false,
        }
    }
}

fn is_read_only(dir: &std::path::Path) -> bool {
    match std::fs::metadata(dir) {
        Ok(meta) => meta.permissions().readonly(),
        Err(_) => true,
    }
}

fn check_settings(paths: &AppPaths) -> Check {
    let file = paths.settings_file();
    match std::fs::read(&file) {
        // Absent is fine: launching writes defaults.
        Err(_) => Check { id: "settings", title: "settings.json", severity: Severity::Ok, detail: "absent; defaults will be written".into(), repairable: false },
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(_) => Check { id: "settings", title: "settings.json", severity: Severity::Ok, detail: "parses".into(), repairable: false },
            Err(err) => Check {
                id: "settings",
                title: "settings.json",
                severity: Severity::Error,
                detail: format!("does not parse: {err}"),
                repairable: true,
            },
        },
    }
}

fn check_quarantine(paths: &AppPaths) -> Check {
    let count = std::fs::read_dir(&paths.config_dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().contains(".corrupt-"))
                .count()
        })
        .unwrap_or(0);

    if count >= QUARANTINE_WARN_AT {
        Check {
            id: "quarantine",
            title: "Quarantined files",
            severity: Severity::Warn,
            detail: format!("{count} recovered settings files are taking up space"),
            repairable: true,
        }
    } else {
        Check { id: "quarantine", title: "Quarantined files", severity: Severity::Ok, detail: format!("{count}"), repairable: false }
    }
}
```

- [x] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test diagnostics::health`
Expected: PASS, 5 tests

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(diagnostics): add health checks shared by doctor and repair"
```

---

### Task 4: The export bundle

One file. One format. Both the GUI button and `riff logs export` call this.

**Interfaces:**
- Produces: `diagnostics::bundle::{build, redact, MAX_BYTES}`.

**Files:**
- Create: `src-tauri/src/diagnostics/bundle.rs`

- [x] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_the_home_directory_and_the_username() {
        let text = "error at /home/dimitris/.config/riff/settings.json for dimitris";
        let redacted = redact(text, "/home/dimitris", "dimitris");
        assert!(redacted.contains("$HOME/.config/riff/settings.json"));
        assert!(!redacted.contains("dimitris"), "the account name must not survive: {redacted}");
    }

    #[test]
    fn redaction_is_a_no_op_when_home_is_unknown() {
        assert_eq!(redact("plain text", "", ""), "plain text");
    }

    #[test]
    fn a_runaway_debug_log_is_truncated_rather_than_producing_an_unusable_paste() {
        let huge = "x".repeat(MAX_BYTES * 2);
        let out = cap(&huge);
        assert!(out.len() <= MAX_BYTES + 200, "cap must bound the output");
        assert!(out.contains("truncated"), "truncation must be visible, never silent");
    }

    #[test]
    fn the_newest_session_survives_truncation_because_it_is_the_one_that_matters() {
        let out = cap(&format!("{}\nTAIL-MARKER\n", "x".repeat(MAX_BYTES * 2)));
        assert!(out.contains("TAIL-MARKER"));
    }
}
```

- [x] **Step 2: Run and watch them fail**

Run: `cd src-tauri && cargo test diagnostics::bundle`
Expected: FAIL to compile

- [x] **Step 3: Implement**

```rust
//! The file a user hands to a developer.
//!
//! Plain text on purpose: it needs no tool to open, pastes into an issue, and
//! costs no compression dependency. Redaction happens here rather than at
//! write time, so the on-disk log keeps real paths the user can grep.

use std::path::Path;

/// Five megabytes. Large enough for ten sessions at debug level, small enough
/// to attach to an issue.
pub const MAX_BYTES: usize = 5 * 1024 * 1024;

pub fn redact(text: &str, home: &str, user: &str) -> String {
    let mut out = text.to_owned();
    if !home.is_empty() {
        out = out.replace(home, "$HOME");
    }
    if !user.is_empty() {
        out = out.replace(user, "$USER");
    }
    out
}

/// Keeps the END of the input. The newest session is the one that explains
/// the bug; the oldest is the one you can afford to lose.
pub fn cap(text: &str) -> String {
    if text.len() <= MAX_BYTES {
        return text.to_owned();
    }
    let start = text.len() - MAX_BYTES;
    let boundary = text[start..].find('\n').map_or(start, |i| start + i + 1);
    format!(
        "[... {} bytes truncated; older sessions omitted ...]\n{}",
        boundary,
        &text[boundary..]
    )
}

/// Assembles the bundle: banner, current settings, then every retained
/// session newest-first.
pub fn build(paths: &crate::paths::AppPaths, banner: &str, home: &str, user: &str) -> String {
    let mut out = String::new();
    out.push_str("=== riff diagnostics ===\n");
    out.push_str(banner);

    out.push_str("\n=== settings.json ===\n");
    match std::fs::read_to_string(paths.settings_file()) {
        Ok(text) => out.push_str(&text),
        Err(err) => out.push_str(&format!("could not read: {err}\n")),
    }

    out.push_str("\n=== sessions ===\n");
    for dir in sessions_newest_first(&paths.log_dir) {
        out.push_str(&format!("\n--- {} ---\n", dir.file_name().unwrap_or_default().to_string_lossy()));
        match std::fs::read_to_string(dir.join("riff.log")) {
            Ok(text) => out.push_str(&text),
            Err(err) => out.push_str(&format!("could not read: {err}\n")),
        }
        if let Ok(panic_text) = std::fs::read_to_string(dir.join("panic.txt")) {
            out.push_str("--- panic ---\n");
            out.push_str(&panic_text);
        }
    }

    cap(&redact(&out, home, user))
}

pub fn sessions_newest_first(log_dir: &Path) -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<_> = std::fs::read_dir(log_dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|e| e.path().is_dir())
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    // Session directories are named by RFC 3339 timestamp, so lexical order
    // is chronological order. No mtime, no clock skew.
    dirs.sort();
    dirs.reverse();
    dirs
}
```

- [x] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test diagnostics::bundle`
Expected: PASS, 4 tests

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(diagnostics): assemble a redacted, size-capped export bundle"
```

---

### Task 5: The command line

**Interfaces:**
- Produces: `cli::{Cli, Command, dispatch}`. `dispatch` returns `Option<i32>` — `Some(code)` means "handled, exit now", `None` means "no subcommand, launch the GUI".

**Files:**
- Create: `src-tauri/src/cli.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [x] **Step 1: Add clap**

```bash
cd src-tauri && cargo add clap@4 --features derive
```

`clap` rather than a hand-rolled parser: the entire value of a support CLI is
being pleasant to someone who is already annoyed, and that is `--help`
quality, `did you mean`, and consistent exit codes. The derive macro reuses
`syn`/`proc-macro2`, already in the tree via serde and tauri.

- [x] **Step 2: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn no_arguments_means_launch_the_window() {
        let cli = Cli::parse_from(["riff"]);
        assert!(cli.command.is_none(), "bare `riff` must still start the application");
    }

    #[test]
    fn the_definition_is_internally_consistent() {
        // clap's own assertions catch duplicate flags, bad defaults and
        // conflicting short options at test time rather than at first run.
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }

    #[test]
    fn every_documented_subcommand_parses() {
        for args in [
            vec!["riff", "doctor"],
            vec!["riff", "doctor", "--json"],
            vec!["riff", "repair", "--yes"],
            vec!["riff", "logs", "--list"],
            vec!["riff", "logs", "--path"],
            vec!["riff", "logs", "export", "--output", "/tmp/r.txt"],
            vec!["riff", "config", "--show"],
            vec!["riff", "config", "--validate"],
            vec!["riff", "paths"],
            vec!["riff", "history", "--count"],
        ] {
            Cli::try_parse_from(&args).unwrap_or_else(|e| panic!("{args:?} failed: {e}"));
        }
    }

    #[test]
    fn an_unknown_subcommand_is_a_usage_error_not_a_silent_launch() {
        assert!(Cli::try_parse_from(["riff", "nonsense"]).is_err());
    }

    #[test]
    fn the_log_level_override_is_available_on_every_invocation() {
        let cli = Cli::parse_from(["riff", "--log-level", "debug"]);
        assert_eq!(cli.log_level.as_deref(), Some("debug"));
    }
}
```

- [x] **Step 3: Run and watch them fail**

Run: `cd src-tauri && cargo test cli`
Expected: FAIL to compile

- [x] **Step 4: Implement**

```rust
//! Riff's terminal surface.
//!
//! Dispatched from `run()` BEFORE `tauri::Builder` is constructed, for two
//! reasons. First, `tauri_plugin_single_instance` forwards a second process's
//! arguments to the running window and exits — so `riff --help` typed while
//! Riff is open would print nothing at all. Second, nothing here needs GTK, a
//! webview or a display, which means `riff doctor` works over SSH on a machine
//! whose window will not open. That is exactly when somebody runs it.
//!
//! Accepting `--output <path>` here does not contradict the rule that no
//! caller-supplied path crosses IPC. That rule constrains a *compromised
//! webview*. This is the user's own shell, already able to write any file
//! they can write.

use clap::{Parser, Subcommand};

use crate::diagnostics::health::Severity;
use crate::paths::AppPaths;

pub const EXIT_OK: i32 = 0;
pub const EXIT_FAILED: i32 = 1;
pub const EXIT_UNHEALTHY: i32 = 3;

#[derive(Parser, Debug)]
#[command(
    name = "riff",
    version,
    about = "A local-first practice workspace for musicians",
    long_about = "Run with no arguments to open Riff.\n\nThe subcommands below \
                  work without a display, so they can be used to diagnose and \
                  repair an installation whose window will not open."
)]
pub struct Cli {
    /// Log level for this run: error, warn, info, debug, trace.
    #[arg(long, global = true)]
    pub log_level: Option<String>,

    /// Machine-readable output.
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Check this installation and report anything wrong.
    Doctor,

    /// Fix what `doctor` found. Never destroys data without quarantining it.
    Repair {
        /// Apply fixes without asking.
        #[arg(long, short)]
        yes: bool,
    },

    /// Inspect and export session logs.
    Logs {
        /// Print the log directory and exit.
        #[arg(long)]
        path: bool,
        /// List retained sessions with their dates and versions.
        #[arg(long)]
        list: bool,
        /// Print the last N lines of the current session.
        #[arg(long, value_name = "N")]
        tail: Option<usize>,
        #[command(subcommand)]
        action: Option<LogsAction>,
    },

    /// Inspect settings.json.
    Config {
        /// Print the settings file path.
        #[arg(long)]
        path: bool,
        /// Print the current settings.
        #[arg(long)]
        show: bool,
        /// Parse the file and report whether it is valid.
        #[arg(long)]
        validate: bool,
    },

    /// Print every directory Riff uses.
    Paths,

    /// Inspect the practice history file.
    History {
        /// Print the history file path.
        #[arg(long)]
        path: bool,
        /// Print how many sessions are recorded.
        #[arg(long)]
        count: bool,
    },
}

#[derive(Subcommand, Debug)]
pub enum LogsAction {
    /// Write a redacted diagnostics bundle for a bug report.
    Export {
        /// Where to write it. Defaults to the current directory.
        #[arg(long, short)]
        output: Option<std::path::PathBuf>,
    },
}
```

Then the dispatcher, below the definition:

```rust
/// `Some(code)` means the invocation was handled and the process should exit.
/// `None` means no subcommand was given and the window should open.
pub fn dispatch(cli: &Cli, paths: &AppPaths) -> Option<i32> {
    let Some(command) = &cli.command else { return None };

    let code = match command {
        Command::Doctor => doctor(paths, cli.json),
        Command::Repair { yes } => repair(paths, *yes),
        Command::Paths => {
            print_paths(paths, cli.json);
            EXIT_OK
        }
        Command::Config { path, show, validate } => config(paths, *path, *show, *validate),
        Command::Logs { path, list, tail, action } => logs(paths, *path, *list, *tail, action.as_ref()),
        Command::History { path, count } => history(paths, *path, *count),
    };
    Some(code)
}

fn doctor(paths: &AppPaths, json: bool) -> i32 {
    let checks = crate::diagnostics::health::run_checks(paths);
    if json {
        println!("{}", serde_json::to_string_pretty(&checks).unwrap_or_default());
    } else {
        for check in &checks {
            let mark = match check.severity {
                Severity::Ok => "ok  ",
                Severity::Warn => "warn",
                Severity::Error => "FAIL",
            };
            println!("[{mark}] {:<22} {}", check.title, check.detail);
        }
        let repairable = checks.iter().any(|c| c.repairable);
        if repairable {
            println!("\nRun `riff repair` to fix what can be fixed automatically.");
        }
    }
    if checks.iter().any(|c| c.severity == Severity::Error) { EXIT_UNHEALTHY } else { EXIT_OK }
}
```

`repair`, `logs`, `config`, `history` and `print_paths` follow the same shape.
`repair` must, in order: warn if a PID file shows Riff is running, create
missing directories, quarantine an unparseable `settings.json` before writing
defaults over it, and prune quarantine files beyond the newest three. It never
deletes a file it has not first copied aside.

- [x] **Step 5: Dispatch it from `run()`**

In `src-tauri/src/lib.rs`, immediately after paths are resolved and logging is
initialised, and **before** `tauri::Builder::default()`:

```rust
let cli = <cli::Cli as clap::Parser>::parse();
if let Some(code) = cli::dispatch(&cli, &paths) {
    std::process::exit(code);
}
```

- [x] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test cli`
Expected: PASS, 5 tests

- [x] **Step 7: Verify by hand**

```bash
cargo run -- --help
cargo run -- doctor
cargo run -- paths --json
cargo run -- logs --list
```
Expected: each prints and exits without opening a window. Then open Riff and
run `riff --help` again in another terminal — it must still print, proving the
dispatch happens before single-instance.

- [x] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(cli): add doctor, repair, logs, config, paths and history"
```

---

### Task 6: The export command and the About button

**Files:**
- Create: `src-tauri/src/commands/diagnostics.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src/lib/ipc/*`, `AboutSection.tsx`, `src/locales/en/settings.json`

- [x] **Step 1: Write the command**

```rust
//! Export, from the GUI. Opens the save dialog in Rust and writes the same
//! bundle `riff logs export` writes — one format, one code path.

use tauri_plugin_dialog::DialogExt;

use crate::error::{RiffError, RiffResult};

#[tauri::command]
pub async fn diagnostics_export(
    app: tauri::AppHandle,
    store: tauri::State<'_, std::sync::Arc<crate::settings::store::SettingsStore>>,
) -> RiffResult<Option<std::path::PathBuf>> {
    let stamp = crate::diagnostics::now_stamp();
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(&format!("riff-diagnostics-{stamp}.txt"))
        .add_filter("Text", &["txt"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };

    let text = crate::diagnostics::current_bundle(store.paths());
    std::fs::write(&target, text).map_err(|e| RiffError::io(&target, &e))?;
    Ok(Some(target))
}
```

Add `$crate::commands::diagnostics::diagnostics_export,` and
`$crate::commands::diagnostics::log_write,` to `riff_handlers!`.

- [x] **Step 2: Add it to the facade**

In `src/lib/ipc/index.ts`:

```ts
  diagnosticsExport: () => invoke<string | null>("diagnostics_export"),
  logWrite: (level: LogLevel, message: string, context?: unknown) =>
    invoke<void>("log_write", { level, message, context: context ?? null }),
```

and `export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";` in `types.ts`.

- [x] **Step 3: Add the button**

In `AboutSection.tsx`, replace the ambiguous second "Copy diagnostics" with:

```tsx
<SettingRow
  label={t("settings:about.exportDiagnostics.label")}
  description={t("settings:about.exportDiagnostics.description")}
>
  <Button
    variant="secondary"
    onClick={async () => {
      const path = await ipc.diagnosticsExport();
      if (path) toast.success(t("settings:about.exportDiagnostics.done", { path }));
    }}
  >
    {t("settings:about.exportDiagnostics.action")}
  </Button>
</SettingRow>
```

Strings:

```json
"exportDiagnostics": {
  "label": "Export diagnostics",
  "description": "Writes one text file with your logs, versions and settings. Your home directory and username are replaced before it is saved, so it is safe to attach to a bug report.",
  "action": "Export",
  "done": "Diagnostics written to {{path}}"
}
```

The crash screen's button keeps the name **Copy error details** so the two are
no longer two different things called the same thing.

- [x] **Step 4: Update the IPC fixture**

Run: `cd src-tauri && RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes`
Then add `SystemInfo`, `Check` and `LogLevel` representatives to `shapes()` so
the new types are guarded like the rest.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(about): export a redacted diagnostics bundle from settings"
```

---

### Task 7: The frontend log bridge

Without this, a React crash leaves **no trace on disk** — the most common
class of failure is the one currently invisible in a bug report.

**Files:**
- Create: `src/lib/logger.ts`, `src/lib/logger.test.ts`
- Modify: `src/main.tsx`, `src/components/RouteError.tsx`, `src/stores/settings.ts`

- [x] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const logWrite = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ipc", () => ({ ipc: { logWrite } }));

const { installGlobalErrorHandlers, log } = await import("./logger");

describe("logger", () => {
  beforeEach(() => logWrite.mockClear());

  it("forwards an error to the rust log", async () => {
    await log.error("boom", { where: "test" });
    expect(logWrite).toHaveBeenCalledWith("error", "boom", { where: "test" });
  });

  it("captures an unhandled rejection", async () => {
    installGlobalErrorHandlers();
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("nope") }),
    );
    expect(logWrite).toHaveBeenCalledWith("error", expect.stringContaining("nope"), expect.anything());
  });

  it("never throws when the bridge itself fails", async () => {
    logWrite.mockRejectedValueOnce(new Error("ipc down"));
    await expect(log.warn("still fine")).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Implement**

`src/lib/logger.ts` exports `log.{error,warn,info,debug}`, forwards to
`ipc.logWrite`, swallows its own failures (a logger that can throw turns a
warning into a crash), mirrors to `console` in development only, and
`installGlobalErrorHandlers()` wires `window.onerror` and `unhandledrejection`.

Call it as the first statement in `src/main.tsx`, before the render. Wire the
error boundary's `onError` and `useSettings.patch`'s catch block into it.

- [x] **Step 3: Run the tests, then commit**

```bash
git add -A
git commit -m "feat(logging): forward frontend errors into the session log"
```

---

### Task 8: Packaging the CLI

**Files:**
- Modify: `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `README.md`

- [x] **Step 1: Generate a man page and completions**

```bash
cd src-tauri && cargo add --build clap_mangen clap_complete
```

In `build.rs`, generate `riff.1` and bash/zsh/fish completions into `OUT_DIR`,
then copy them into `src-tauri/dist-extra/`. Packagers expect a man page; its
absence is a lint failure in both Debian and Fedora review.

- [x] **Step 2: Install them from the bundle**

```json
"deb": {
  "files": {
    "/usr/share/man/man1/riff.1": "dist-extra/riff.1",
    "/usr/share/bash-completion/completions/riff": "dist-extra/riff.bash",
    "/usr/share/zsh/site-functions/_riff": "dist-extra/_riff",
    "/usr/share/fish/vendor_completions.d/riff.fish": "dist-extra/riff.fish"
  }
}
```

Same block for `rpm`.

- [x] **Step 3: Document it**

Add a **Troubleshooting** section to `README.md`:

````markdown
## Troubleshooting

Riff logs every session to its own folder under `~/.local/state/riff/logs/`,
stamped with the version, distribution, desktop and session type it was
running under. `latest` always points at the current one.

```bash
riff doctor                 # check the installation
riff repair                 # fix what can be fixed
riff logs --tail 100        # recent output
riff logs export            # one redacted file for a bug report
```

`riff logs export` rewrites your home directory and username, so the result is
safe to attach to an issue. Attaching it is the single most useful thing you
can do in a bug report.
````

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "build: ship a man page, shell completions and troubleshooting docs"
```

---

### Task 9: Gate check

- [x] **Step 1: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

- [x] **Step 2: Prove the diagnostics story end to end**

```bash
printf 'broken' > ~/.config/riff/settings.json
riff doctor                     # reports settings.json as a repairable error, exits 3
riff repair --yes               # quarantines it, writes defaults
riff doctor                     # exits 0
riff logs export -o /tmp/d.txt
grep -c "$USER" /tmp/d.txt      # must print 0
grep -c 'riff session' /tmp/d.txt
```

- [x] **Step 3: Prove the CLI works while the GUI is running**

Open Riff, then in a terminal: `riff --help` and `riff doctor`.
Expected: both print immediately. Neither opens a second window, and neither
is swallowed by single-instance.

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: verify diagnostics and cli gates" --allow-empty
```

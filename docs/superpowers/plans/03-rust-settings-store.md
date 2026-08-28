# 03 — Rust Settings Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings that cannot be lost — atomic writes, corruption quarantined rather than overwritten, unknown keys preserved, and external edits picked up live.

**Architecture:** Rust is the single source of truth. The store holds `Settings` behind an `RwLock`, coalesces writes, and writes through a temp file plus `rename` plus a parent-directory `fsync`. Everything that could be timing-dependent — the debounce and the file watcher — is split so the *decision* is a pure function and only the thin scheduling glue is untested. This is the most important plan in the milestone: it is the only place where a bug costs a user their data.

**Tech Stack:** `serde` 1, `serde_json` 1, `schemars` 1.2, `notify` 8.2, `tempfile` 3.27, `time` 0.3.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§4)

## Global Constraints

- **Platform:** Linux only. webkit2gtk **4.1**, **glibc ≥ 2.39**, build target `ubuntu-24.04`.
- **Zero network.** No HTTP client in either language.
- **Rust owns the filesystem.** The webview's only capability is `core:default`.
- **Rust lints:** `clippy::unwrap_used` denied outside tests, `expect_used` allowed with a message.
- **Never install:** any HTTP client, `tauri-specta`, `specta`.
- **Commits:** Conventional Commits, one per task.

### Invariants this plan must never break

1. A file Riff failed to parse is **never** overwritten. It is renamed aside and kept.
2. A failed write **never** discards in-memory state and **never** crashes.
3. Loading settings **cannot fail**. The worst outcome is defaults plus a warning.
4. Keys Riff does not recognise survive a read-modify-write cycle.

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/storage/atomic.rs` | `write_atomic`, `write_if_changed` — durable file replacement |
| `src-tauri/src/settings/model.rs` | `Settings` and its sections, lenient enums, `UiScale` |
| `src-tauri/src/settings/defaults.rs` | `Settings::default()` and the schema/onboarding version constants |
| `src-tauri/src/settings/patch.rs` | JSON merge patch application |
| `src-tauri/src/settings/migrate.rs` | Version runner over a step table |
| `src-tauri/src/settings/schema.rs` | `schemars` generation, written only when changed |
| `src-tauri/src/settings/store.rs` | `SettingsStore`: load, patch, reset, flush |
| `src-tauri/src/settings/watcher.rs` | `should_reload` decision plus `notify` wiring |
| `src-tauri/src/settings/mod.rs` | Re-exports |

---

### Task 1: Atomic file replacement

**Interfaces:**
- Produces: `storage::atomic::write_atomic(&Path, &[u8]) -> std::io::Result<()>` and `storage::atomic::write_if_changed(&Path, &[u8]) -> std::io::Result<bool>` (returns whether it wrote).

**Files:**
- Create: `src-tauri/src/storage/mod.rs`, `src-tauri/src/storage/atomic.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Move `tempfile` to a real dependency**

It is currently dev-only. The atomic writer needs it at runtime.

```bash
cd src-tauri && cargo add tempfile@3.27
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/storage/atomic.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_new_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("settings.json");
        write_atomic(&target, b"{\"a\":1}").expect("write");
        assert_eq!(std::fs::read(&target).expect("read"), b"{\"a\":1}");
    }

    #[test]
    fn replaces_an_existing_file_wholesale_leaving_no_partial_content() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("settings.json");
        write_atomic(&target, b"a-much-longer-original-payload").expect("first");
        write_atomic(&target, b"short").expect("second");
        assert_eq!(std::fs::read(&target).expect("read"), b"short");
    }

    #[test]
    fn leaves_no_temporary_files_behind() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("settings.json");
        write_atomic(&target, b"{}").expect("write");
        let count = std::fs::read_dir(tmp.path()).expect("readdir").count();
        assert_eq!(count, 1, "only the target file should remain");
    }

    #[test]
    fn creates_missing_parent_directories() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("nested/deeper/settings.json");
        write_atomic(&target, b"{}").expect("write");
        assert!(target.is_file());
    }

    #[test]
    fn write_if_changed_skips_identical_content() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("settings.schema.json");
        assert!(write_if_changed(&target, b"same").expect("first"), "first write happens");
        assert!(!write_if_changed(&target, b"same").expect("second"), "identical write is skipped");
        assert!(write_if_changed(&target, b"different").expect("third"), "changed write happens");
    }

    #[test]
    fn reports_the_error_when_the_target_directory_is_read_only() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path().join("locked");
        std::fs::create_dir(&dir).expect("mkdir");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("chmod");

        let result = write_atomic(&dir.join("settings.json"), b"{}");

        // Restore permissions so the tempdir can be cleaned up.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("chmod");
        assert!(result.is_err(), "a read-only directory must surface an error");
    }
}
```

- [ ] **Step 3: Run and watch them fail**

Run: `cd src-tauri && cargo test atomic`
Expected: FAIL to compile — `cannot find function write_atomic`

- [ ] **Step 4: Implement**

Insert above the tests:

```rust
//! Durable file replacement.
//!
//! Three details carry the durability, and all three are easy to omit:
//!   1. the temporary file must live in the SAME directory as the target,
//!      because `rename` is only atomic within one filesystem;
//!   2. the data must be fsynced before the rename, or the rename can land
//!      while the content has not;
//!   3. the PARENT DIRECTORY must be fsynced after the rename, or the rename
//!      itself can be lost on power failure. This is the step everyone skips.

use std::io::Write;
use std::path::Path;

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent directory")
    })?;
    std::fs::create_dir_all(dir)?;

    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.flush()?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error)?;

    // Durability of the rename itself.
    std::fs::File::open(dir)?.sync_all()?;
    Ok(())
}

/// Writes only when the content differs. Used for `settings.schema.json`,
/// which is regenerated every launch: rewriting it unconditionally would
/// touch its mtime and wake the config-directory watcher on every start.
pub fn write_if_changed(path: &Path, bytes: &[u8]) -> std::io::Result<bool> {
    if let Ok(existing) = std::fs::read(path) {
        if existing == bytes {
            return Ok(false);
        }
    }
    write_atomic(path, bytes)?;
    Ok(true)
}
```

- [ ] **Step 5: Declare the modules**

Create `src-tauri/src/storage/mod.rs`:

```rust
pub mod atomic;
```

Add to `src-tauri/src/lib.rs`:

```rust
pub mod storage;
```

- [ ] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test atomic`
Expected: PASS, 7 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(storage): add atomic file replacement with parent fsync"
```

---

### Task 2: The settings model

**Interfaces:**
- Produces: `settings::model::{Settings, General, Appearance, Onboarding, StartupRoute, Theme, Density, ReduceMotion, TitleBar, Sidebar, UiScale}`, constants `CURRENT_VERSION: u32 = 1` and `CURRENT_ONBOARDING_VERSION: u32 = 1`.

**Files:**
- Create: `src-tauri/src/settings/mod.rs`, `src-tauri/src/settings/model.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Add `schemars`**

```bash
cd src-tauri && cargo add schemars@1.2
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/settings/model.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_spec() {
        let s = Settings::default();
        assert_eq!(s.version, CURRENT_VERSION);
        assert_eq!(s.general.startup_route, StartupRoute::Practice);
        assert!(s.general.restore_window_state);
        assert!(!s.general.confirm_on_quit);
        assert_eq!(s.appearance.theme, Theme::Dark);
        assert_eq!(s.appearance.density, Density::Comfortable);
        assert_eq!(s.appearance.ui_scale.get(), 1.0);
        assert!(!s.appearance.high_contrast);
        assert_eq!(s.appearance.title_bar, TitleBar::Custom);
        assert!(s.onboarding.completed_at.is_none());
    }

    #[test]
    fn a_partial_file_loads_with_defaults_for_everything_absent() {
        let s: Settings = serde_json::from_str(r#"{"appearance":{"theme":"light"}}"#)
            .expect("partial documents must load");
        assert_eq!(s.appearance.theme, Theme::Light);
        assert_eq!(s.appearance.density, Density::Comfortable);
        assert_eq!(s.general.startup_route, StartupRoute::Practice);
    }

    #[test]
    fn an_unrecognised_enum_value_falls_back_instead_of_failing_the_whole_load() {
        let s: Settings = serde_json::from_str(r#"{"appearance":{"theme":"solarized"}}"#)
            .expect("one bad key must not cost the user every setting");
        assert_eq!(s.appearance.theme, Theme::Dark);
    }

    #[test]
    fn ui_scale_clamps_rather_than_rejecting() {
        let low: Settings = serde_json::from_str(r#"{"appearance":{"uiScale":0.1}}"#).expect("loads");
        assert_eq!(low.appearance.ui_scale.get(), 0.8);
        let high: Settings = serde_json::from_str(r#"{"appearance":{"uiScale":9.0}}"#).expect("loads");
        assert_eq!(high.appearance.ui_scale.get(), 1.5);
        let junk: Settings = serde_json::from_str(r#"{"appearance":{"uiScale":"big"}}"#).expect("loads");
        assert_eq!(junk.appearance.ui_scale.get(), 1.0);
    }

    #[test]
    fn unknown_keys_inside_a_section_survive_too() {
        // The case that actually happens: a newer build adds
        // `appearance.accentColor`, the user downgrades, and the older build
        // writes the file back. Root-only preservation would destroy it.
        let original = r#"{"version":1,"appearance":{"theme":"light","accentColor":"#ff0000"}}"#;
        let s: Settings = serde_json::from_str(original).expect("loads");
        let round_tripped = serde_json::to_value(&s).expect("serialises");
        assert_eq!(round_tripped["appearance"]["accentColor"], "#ff0000");
        assert_eq!(round_tripped["appearance"]["theme"], "light");
    }

    #[test]
    fn unknown_top_level_keys_survive_a_round_trip() {
        let original = r#"{"version":1,"futureFeature":{"enabled":true}}"#;
        let s: Settings = serde_json::from_str(original).expect("loads");
        let round_tripped = serde_json::to_value(&s).expect("serialises");
        assert_eq!(
            round_tripped["futureFeature"]["enabled"], true,
            "a downgrade must not destroy settings written by a newer version"
        );
    }

    #[test]
    fn serialises_camel_case_with_a_schema_pointer() {
        let json = serde_json::to_value(Settings::default()).expect("serialises");
        assert_eq!(json["$schema"], "./settings.schema.json");
        assert!(json["general"]["startupRoute"].is_string());
        assert!(json["appearance"]["uiScale"].is_number());
    }
}
```

- [ ] **Step 3: Run and watch them fail**

Run: `cd src-tauri && cargo test settings::model`
Expected: FAIL to compile

- [ ] **Step 4: Implement**

Insert above the tests:

```rust
//! The settings document.
//!
//! Every field carries `#[serde(default)]` so a partial or older file still
//! loads, and every enum deserialises leniently so one unrecognised value
//! costs the user that value alone rather than the entire document.

use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};

pub const CURRENT_VERSION: u32 = 1;
pub const CURRENT_ONBOARDING_VERSION: u32 = 1;

/// Deserialises `T`, falling back to `T::default()` and a warning when the
/// value is not recognised. This is what makes an unknown enum variant a
/// local problem instead of a total load failure.
fn lenient<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    match serde_json::from_value::<T>(raw.clone()) {
        Ok(value) => Ok(value),
        Err(err) => {
            tracing::warn!(%err, %raw, "unrecognised settings value; using the default");
            Ok(T::default())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    #[serde(rename = "$schema")]
    pub schema: String,
    pub version: u32,
    pub general: General,
    pub appearance: Appearance,
    pub onboarding: Onboarding,
    /// Keys Riff does not recognise, kept verbatim so a downgrade followed by
    /// an upgrade does not silently delete a newer version's settings.
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema: "./settings.schema.json".to_owned(),
            version: CURRENT_VERSION,
            general: General::default(),
            appearance: Appearance::default(),
            onboarding: Onboarding::default(),
            unknown: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct General {
    /// Keys this build does not recognise. Present on every section, not only
    /// the root: new settings are added *inside* sections, so root-only
    /// preservation would protect exactly the case that never happens and
    /// lose the one that does.
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
    #[serde(deserialize_with = "lenient")]
    pub startup_route: StartupRoute,
    pub last_route: String,
    pub restore_window_state: bool,
    pub confirm_on_quit: bool,
    pub language: String,
}

impl Default for General {
    fn default() -> Self {
        Self {
            startup_route: StartupRoute::Practice,
            last_route: "/practice".to_owned(),
            restore_window_state: true,
            confirm_on_quit: false,
            language: "en".to_owned(),
            unknown: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Appearance {
    /// Keys this build does not recognise. Present on every section, not only
    /// the root: new settings are added *inside* sections, so root-only
    /// preservation would protect exactly the case that never happens and
    /// lose the one that does.
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
    #[serde(deserialize_with = "lenient")]
    pub theme: Theme,
    #[serde(deserialize_with = "lenient")]
    pub density: Density,
    pub ui_scale: UiScale,
    #[serde(deserialize_with = "lenient")]
    pub reduce_motion: ReduceMotion,
    pub high_contrast: bool,
    #[serde(deserialize_with = "lenient")]
    pub title_bar: TitleBar,
    pub sidebar: Sidebar,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            density: Density::Comfortable,
            ui_scale: UiScale::default(),
            reduce_motion: ReduceMotion::System,
            high_contrast: false,
            title_bar: TitleBar::Custom,
            sidebar: Sidebar::default(),
            unknown: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Sidebar {
    pub collapsed: bool,
    pub remember_collapsed: bool,
}

impl Default for Sidebar {
    fn default() -> Self {
        Self { collapsed: false, remember_collapsed: true }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Onboarding {
    /// RFC 3339. `None` means first run has not been completed.
    pub completed_at: Option<String>,
    pub version: u32,
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
}

macro_rules! kebab_enum {
    ($name:ident { $default:ident, $($variant:ident),* $(,)? }) => {
        #[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
        #[serde(rename_all = "kebab-case")]
        pub enum $name {
            #[default]
            $default,
            $($variant),*
        }
    };
}

kebab_enum!(StartupRoute { Practice, History, LastUsed });
kebab_enum!(Theme { Dark, Light });
kebab_enum!(Density { Comfortable, Compact });
kebab_enum!(ReduceMotion { System, Always, Never });
kebab_enum!(TitleBar { Custom, System });

/// Clamped on the way in, so an out-of-range value in a hand-edited file is
/// corrected rather than rejected.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, JsonSchema)]
pub struct UiScale(f32);

impl UiScale {
    pub const MIN: f32 = 0.8;
    pub const MAX: f32 = 1.5;

    pub fn new(value: f32) -> Self {
        if value.is_finite() {
            Self(value.clamp(Self::MIN, Self::MAX))
        } else {
            Self::default()
        }
    }

    pub fn get(self) -> f32 {
        self.0
    }
}

impl Default for UiScale {
    fn default() -> Self {
        Self(1.0)
    }
}

impl<'de> Deserialize<'de> for UiScale {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        Ok(serde_json::from_value::<f32>(raw).map(Self::new).unwrap_or_default())
    }
}
```

> The `Onboarding::version` default is `0` from `#[derive(Default)]`, which is
> lower than `CURRENT_ONBOARDING_VERSION`. That is deliberate: a settings file
> written before onboarding existed should present onboarding.

- [ ] **Step 5: Declare the modules**

Create `src-tauri/src/settings/mod.rs`:

```rust
pub mod model;
```

Add to `src-tauri/src/lib.rs`:

```rust
pub mod settings;
```

- [ ] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test settings::model`
Expected: PASS, 6 tests

If `#[schemars(skip)]` on the flattened map fails to compile, remove that attribute — `schemars` represents a flattened map as `additionalProperties`, which is also correct.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): add the settings model with lenient deserialisation"
```

---

### Task 3: JSON merge patch

**Interfaces:**
- Produces: `settings::patch::apply(&Settings, &serde_json::Value) -> Result<Settings, RiffError>`.

**Files:**
- Create: `src-tauri/src/settings/patch.rs`
- Modify: `src-tauri/src/settings/mod.rs`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/settings/patch.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::model::{Settings, Theme};
    use serde_json::json;

    #[test]
    fn applies_a_nested_field_without_disturbing_its_siblings() {
        let before = Settings::default();
        let after = apply(&before, &json!({ "appearance": { "theme": "light" } })).expect("applies");
        assert_eq!(after.appearance.theme, Theme::Light);
        assert_eq!(after.appearance.density, before.appearance.density);
        assert_eq!(after.general.startup_route, before.general.startup_route);
    }

    #[test]
    fn null_is_ignored_rather_than_clearing_a_value() {
        let mut before = Settings::default();
        before.onboarding.completed_at = Some("2026-08-28T10:00:00Z".to_owned());
        let after = apply(&before, &json!({ "onboarding": { "completedAt": null } })).expect("applies");
        assert_eq!(
            after.onboarding.completed_at.as_deref(),
            Some("2026-08-28T10:00:00Z"),
            "clearing is a reset operation, not a patch operation"
        );
    }

    #[test]
    fn an_out_of_range_value_is_clamped_by_the_model_not_rejected() {
        let after = apply(&Settings::default(), &json!({ "appearance": { "uiScale": 5.0 } }))
            .expect("applies");
        assert_eq!(after.appearance.ui_scale.get(), 1.5);
    }

    #[test]
    fn unknown_keys_in_the_patch_are_preserved_like_unknown_keys_in_the_file() {
        let after = apply(&Settings::default(), &json!({ "futureThing": 1 })).expect("applies");
        let json = serde_json::to_value(&after).expect("serialises");
        assert_eq!(json["futureThing"], 1);
    }

    #[test]
    fn a_patch_that_is_not_an_object_is_a_validation_error() {
        let err = apply(&Settings::default(), &json!("nope")).expect_err("must reject");
        assert!(matches!(err, crate::error::RiffError::Validation { .. }));
    }
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd src-tauri && cargo test settings::patch`
Expected: FAIL to compile — `cannot find function apply`

- [ ] **Step 3: Implement**

Insert above the tests:

```rust
//! RFC 7386-style merge patch, with one deliberate divergence.
//!
//! In RFC 7386 a `null` member deletes the key. Here `null` is IGNORED,
//! because the frontend's `DeepPartial` type produces `null` for "not
//! supplied" and a caller must never be able to erase a setting by omission.
//! Clearing is `settings_reset`, an explicit and separate operation.

use crate::error::RiffError;
use crate::settings::model::Settings;
use serde_json::Value;

pub fn apply(current: &Settings, patch: &Value) -> Result<Settings, RiffError> {
    if !patch.is_object() {
        return Err(RiffError::Validation {
            field: "patch".to_owned(),
            reason: "expected a JSON object".to_owned(),
        });
    }

    let mut merged = serde_json::to_value(current).map_err(|e| RiffError::Validation {
        field: "settings".to_owned(),
        reason: e.to_string(),
    })?;
    merge(&mut merged, patch);

    // Re-deserialising is the validation step: clamping, lenient enums and
    // unknown-key capture all happen here, so the returned value is always a
    // legal Settings no matter what the caller sent.
    serde_json::from_value(merged).map_err(|e| RiffError::Validation {
        field: "patch".to_owned(),
        reason: e.to_string(),
    })
}

fn merge(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target_map), Value::Object(patch_map)) => {
            for (key, patch_value) in patch_map {
                if patch_value.is_null() {
                    continue;
                }
                merge(
                    target_map.entry(key.clone()).or_insert(Value::Null),
                    patch_value,
                );
            }
        }
        (target_slot, patch_value) => *target_slot = patch_value.clone(),
    }
}
```

- [ ] **Step 4: Declare it**

In `src-tauri/src/settings/mod.rs`:

```rust
pub mod patch;
```

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test settings::patch`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): apply typed changes as a merge patch"
```

---

### Task 4: The migration runner

**Interfaces:**
- Produces: `settings::migrate::{MigrationStep, STEPS, run, run_with}`. `run_with(&mut Value, &[MigrationStep]) -> Option<u32>` returns the version migrated *from*, or `None` if nothing ran.

**Files:**
- Create: `src-tauri/src/settings/migrate.rs`
- Modify: `src-tauri/src/settings/mod.rs`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/settings/migrate.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Schema version 1 has no predecessor, so `STEPS` is empty. These tests
    /// exercise the RUNNER using a synthetic table — the machinery is what
    /// can be wrong today, and it must be correct before a real migration
    /// depends on it.
    fn synthetic() -> Vec<MigrationStep> {
        vec![
            MigrationStep { from: 0, to: 1, apply: |doc| {
                doc["general"]["startupRoute"] = json!("practice");
            }},
            MigrationStep { from: 1, to: 2, apply: |doc| {
                doc["appearance"]["density"] = json!("compact");
            }},
        ]
    }

    #[test]
    fn runs_every_step_in_order_to_reach_the_target() {
        let mut doc = json!({ "version": 0, "general": {}, "appearance": {} });
        let from = run_with(&mut doc, &synthetic());
        assert_eq!(from, Some(0));
        assert_eq!(doc["version"], 2);
        assert_eq!(doc["general"]["startupRoute"], "practice");
        assert_eq!(doc["appearance"]["density"], "compact");
    }

    #[test]
    fn starts_from_the_documents_own_version_not_from_zero() {
        let mut doc = json!({ "version": 1, "general": {}, "appearance": {} });
        assert_eq!(run_with(&mut doc, &synthetic()), Some(1));
        assert_eq!(doc["version"], 2);
        assert!(doc["general"]["startupRoute"].is_null(), "step 0->1 must not have run");
    }

    #[test]
    fn a_current_document_is_left_untouched() {
        let mut doc = json!({ "version": 2, "general": {} });
        assert_eq!(run_with(&mut doc, &synthetic()), None);
        assert_eq!(doc["version"], 2);
    }

    #[test]
    fn a_newer_document_is_left_untouched_and_not_downgraded() {
        let mut doc = json!({ "version": 99 });
        assert_eq!(run_with(&mut doc, &synthetic()), None);
        assert_eq!(doc["version"], 99, "a downgrade must never rewrite a newer file");
    }

    #[test]
    fn a_missing_version_is_treated_as_zero() {
        let mut doc = json!({ "general": {}, "appearance": {} });
        assert_eq!(run_with(&mut doc, &synthetic()), Some(0));
        assert_eq!(doc["version"], 2);
    }

    #[test]
    fn a_document_that_is_not_an_object_is_left_alone_rather_than_panicking() {
        let mut doc = json!([1, 2, 3]);
        assert_eq!(run_with(&mut doc, &synthetic()), None);
        assert_eq!(doc, json!([1, 2, 3]));
    }

    #[test]
    fn the_real_step_table_is_empty_at_schema_version_one() {
        assert!(STEPS.is_empty(), "add a test alongside any real migration");
    }
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd src-tauri && cargo test settings::migrate`
Expected: FAIL to compile

- [ ] **Step 3: Implement**

Insert above the tests:

```rust
//! Forward-only schema migration.
//!
//! Steps are declarative and run in ascending order. A document already at or
//! beyond the newest version is never touched — a user who downgrades must
//! not have their file rewritten by the older build.

use serde_json::Value;

pub struct MigrationStep {
    pub from: u32,
    pub to: u32,
    pub apply: fn(&mut Value),
}

/// Empty at schema version 1: there is no earlier version to migrate from.
pub static STEPS: &[MigrationStep] = &[];

pub fn run(document: &mut Value) -> Option<u32> {
    run_with(document, STEPS)
}

pub fn run_with(document: &mut Value, steps: &[MigrationStep]) -> Option<u32> {
    // A document that is not an object has no version and no fields for a
    // step to touch; indexing one would panic.
    if !document.is_object() {
        return None;
    }
    let start = document
        .get("version")
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
        .unwrap_or(0);

    let mut current = start;
    let mut ran = false;

    // Bounded by the table length: a step table with a cycle (or a step whose
    // `to` is not greater than its `from`) would otherwise spin forever
    // holding the settings file hostage at startup. Cheap insurance on
    // machinery that has no real migrations to prove it correct yet.
    for _ in 0..=steps.len() {
        let Some(step) = steps.iter().find(|s| s.from == current) else {
            break;
        };
        debug_assert!(step.to > step.from, "migration steps must move forward");
        (step.apply)(document);
        current = step.to;
        document["version"] = Value::from(current);
        ran = true;
    }

    ran.then_some(start)
}
```

- [ ] **Step 4: Declare it**

In `src-tauri/src/settings/mod.rs`:

```rust
pub mod migrate;
```

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test settings::migrate`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): add a forward-only schema migration runner"
```

---

### Task 5: Schema generation

**Interfaces:**
- Produces: `settings::schema::render() -> String` and `settings::schema::write(&AppPaths) -> std::io::Result<bool>`.

**Files:**
- Create: `src-tauri/src/settings/schema.rs`
- Modify: `src-tauri/src/settings/mod.rs`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/settings/schema.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_the_top_level_sections() {
        let rendered = render();
        let schema: serde_json::Value = serde_json::from_str(&rendered).expect("valid json");
        let properties = &schema["properties"];
        assert!(properties["general"].is_object());
        assert!(properties["appearance"].is_object());
        assert!(properties["onboarding"].is_object());
    }

    #[test]
    fn writes_once_and_then_skips_identical_regeneration() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let paths = crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.path().join("config")),
                data: Some(tmp.path().join("data")),
            },
        )
        .expect("overrides supply both roots");

        assert!(write(&paths).expect("first write"), "first launch writes the schema");
        assert!(!write(&paths).expect("second write"), "an unchanged launch must touch nothing");
        assert!(paths.schema_file().is_file());
    }
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd src-tauri && cargo test settings::schema`
Expected: FAIL to compile

- [ ] **Step 3: Implement**

Insert above the tests:

```rust
//! The JSON Schema shipped beside `settings.json`.
//!
//! `settings.json` carries `"$schema": "./settings.schema.json"`, so an
//! editor opening it offers completion and validation. That is the whole
//! reason settings are a hand-editable file rather than a database.

use crate::paths::AppPaths;
use crate::settings::model::Settings;
use crate::storage::atomic::write_if_changed;

pub fn render() -> String {
    let schema = schemars::schema_for!(Settings);
    serde_json::to_string_pretty(&schema).unwrap_or_else(|_| "{}".to_owned())
}

/// Returns whether anything was written. Skipping unchanged content matters:
/// the config directory is watched, and an unconditional rewrite would wake
/// the watcher on every launch.
pub fn write(paths: &AppPaths) -> std::io::Result<bool> {
    write_if_changed(&paths.schema_file(), render().as_bytes())
}
```

- [ ] **Step 4: Declare it**

In `src-tauri/src/settings/mod.rs`:

```rust
pub mod schema;
```

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test settings::schema`
Expected: PASS, 2 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): generate the json schema beside settings.json"
```

---

### Task 6: The store

**Interfaces:**
- Produces: `settings::store::{SettingsStore, LoadOutcome, Section}`.
  - `SettingsStore::load(AppPaths) -> (SettingsStore, LoadOutcome)` — infallible.
  - `.get() -> Settings`, `.patch(&Value) -> RiffResult<Settings>`, `.reset(Option<Section>) -> RiffResult<Settings>`, `.flush_if_dirty() -> RiffResult<()>`, `.write_count() -> usize`, `.last_written_bytes() -> Option<Vec<u8>>`, `.paths() -> &AppPaths`.
  - `LoadOutcome::{Fresh, Loaded, Migrated { from: u32 }, Recovered { quarantined: PathBuf }}`
  - `Section::{General, Appearance, Onboarding}`

**Files:**
- Create: `src-tauri/src/settings/store.rs`
- Modify: `src-tauri/src/settings/mod.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Add `time` for quarantine timestamps**

```bash
cd src-tauri && cargo add time@0.3 --features formatting
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/settings/store.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::model::Theme;
    use serde_json::json;

    fn store() -> (SettingsStore, LoadOutcome, tempfile::TempDir) {
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
        let (s, outcome) = SettingsStore::load(paths);
        (s, outcome, tmp)
    }

    #[test]
    fn a_missing_file_yields_defaults_and_writes_them_so_the_user_can_find_it() {
        let (s, outcome, _tmp) = store();
        assert!(matches!(outcome, LoadOutcome::Fresh));
        s.flush_if_dirty().expect("flush");
        assert!(s.paths().settings_file().is_file(), "the file must exist to be editable");
        assert_eq!(s.get().appearance.theme, Theme::Dark);
    }

    #[test]
    fn a_corrupt_file_is_quarantined_and_never_overwritten() {
        let (s, _outcome, _tmp) = store();
        let path = s.paths().settings_file();
        std::fs::write(&path, b"{ this is not json").expect("write garbage");

        let (reloaded, outcome) = SettingsStore::load(s.paths().clone());
        let LoadOutcome::Recovered { quarantined: Some(quarantined) } = outcome else {
            panic!("expected Recovered with a quarantine path, got {outcome:?}");
        };
        assert!(quarantined.is_file(), "the user's bad file must be kept");
        assert_eq!(
            std::fs::read(&quarantined).expect("read"),
            b"{ this is not json",
            "quarantined content must be byte-identical"
        );
        assert!(
            !path.is_file(),
            "quarantine must MOVE the file, not copy it — a copy leaves the original \
             to be overwritten by the next flush, so a failed copy loses it entirely"
        );
        assert_eq!(reloaded.get().appearance.theme, Theme::Dark);
    }

    #[test]
    fn a_file_that_cannot_be_quarantined_is_never_overwritten() {
        use std::os::unix::fs::PermissionsExt;
        let (s, _outcome, _tmp) = store();
        let path = s.paths().settings_file();
        std::fs::write(&path, b"{ this is not json").expect("write garbage");

        let dir = s.paths().config_dir.clone();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("chmod");
        let (blocked, outcome) = SettingsStore::load(s.paths().clone());
        let flushed = blocked.flush_if_dirty();
        let still_there = std::fs::read(&path).expect("read");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("restore");

        assert!(matches!(outcome, LoadOutcome::Recovered { quarantined: None }));
        assert!(flushed.is_err(), "writing must be refused, not attempted");
        assert_eq!(still_there, b"{ this is not json", "invariant 1: never overwrite what we failed to parse");
    }

    #[test]
    fn migrating_leaves_a_versioned_backup_behind() {
        let (s, _outcome, _tmp) = store();
        std::fs::write(s.paths().settings_file(), br#"{"version":0,"appearance":{"theme":"light"}}"#)
            .expect("seed");

        let (_reloaded, _outcome) = SettingsStore::load(s.paths().clone());
        assert!(
            s.paths().config_dir.join("settings.json.bak-v0").is_file(),
            "a migration bug must be recoverable, not terminal"
        );
    }

    #[test]
    fn a_change_landing_during_a_flush_is_not_lost() {
        use std::sync::Arc;
        let (s, _outcome, _tmp) = store();
        let s = Arc::new(s);

        let writer = {
            let s = Arc::clone(&s);
            std::thread::spawn(move || {
                for i in 0..200 {
                    s.patch(&json!({ "general": { "lastRoute": format!("/r{i}") } }))
                        .expect("patch");
                }
            })
        };
        for _ in 0..200 {
            let _ = s.flush_if_dirty();
        }
        writer.join().expect("writer thread");
        s.flush_if_dirty().expect("final flush");

        let on_disk: serde_json::Value =
            serde_json::from_slice(&std::fs::read(s.paths().settings_file()).expect("read"))
                .expect("json");
        assert_eq!(
            on_disk["general"]["lastRoute"], s.get().general.last_route,
            "the last change must reach disk; a plain dirty flag drops the one that \
             lands between serialising and clearing it"
        );
    }

    #[test]
    fn a_patch_survives_a_reload() {
        let (s, _outcome, _tmp) = store();
        s.patch(&json!({ "appearance": { "theme": "light" } })).expect("patch");
        s.flush_if_dirty().expect("flush");

        let (reloaded, outcome) = SettingsStore::load(s.paths().clone());
        assert!(matches!(outcome, LoadOutcome::Loaded));
        assert_eq!(reloaded.get().appearance.theme, Theme::Light);
    }

    #[test]
    fn several_patches_coalesce_into_one_write() {
        let (s, _outcome, _tmp) = store();
        let before = s.write_count();
        s.patch(&json!({ "appearance": { "theme": "light" } })).expect("one");
        s.patch(&json!({ "appearance": { "density": "compact" } })).expect("two");
        s.patch(&json!({ "general": { "confirmOnQuit": true } })).expect("three");
        s.flush_if_dirty().expect("flush");
        assert_eq!(s.write_count() - before, 1, "dragging a slider must not write forty times");
    }

    #[test]
    fn flushing_when_clean_writes_nothing() {
        let (s, _outcome, _tmp) = store();
        s.flush_if_dirty().expect("initial");
        let after_first = s.write_count();
        s.flush_if_dirty().expect("second");
        assert_eq!(s.write_count(), after_first);
    }

    #[test]
    fn reset_all_preserves_onboarding_completion() {
        let (s, _outcome, _tmp) = store();
        s.patch(&json!({
            "appearance": { "theme": "light" },
            "onboarding": { "completedAt": "2026-08-28T10:00:00Z" }
        }))
        .expect("patch");

        let after = s.reset(None).expect("reset");
        assert_eq!(after.appearance.theme, Theme::Dark, "appearance returns to defaults");
        assert_eq!(
            after.onboarding.completed_at.as_deref(),
            Some("2026-08-28T10:00:00Z"),
            "resetting preferences is not a request to redo first run"
        );
    }

    #[test]
    fn resetting_the_onboarding_section_is_how_first_run_is_replayed() {
        let (s, _outcome, _tmp) = store();
        s.patch(&json!({ "onboarding": { "completedAt": "2026-08-28T10:00:00Z" } })).expect("patch");
        let after = s.reset(Some(Section::Onboarding)).expect("reset");
        assert!(after.onboarding.completed_at.is_none());
    }

    #[test]
    fn a_failed_write_keeps_in_memory_state_and_reports_the_error() {
        use std::os::unix::fs::PermissionsExt;
        let (s, _outcome, _tmp) = store();
        s.flush_if_dirty().expect("initial write");

        let dir = s.paths().config_dir.clone();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("chmod");
        s.patch(&json!({ "appearance": { "theme": "light" } })).expect("patch applies in memory");
        let result = s.flush_if_dirty();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("restore");

        assert!(result.is_err(), "the failure must be reported");
        assert_eq!(
            s.get().appearance.theme,
            Theme::Light,
            "the user's choice must not be silently reverted in the interface"
        );
    }

    #[test]
    fn unknown_keys_in_the_file_survive_a_patch_and_flush() {
        let (s, _outcome, _tmp) = store();
        std::fs::write(
            s.paths().settings_file(),
            br#"{"version":1,"futureFeature":{"enabled":true}}"#,
        )
        .expect("seed");

        let (reloaded, _) = SettingsStore::load(s.paths().clone());
        reloaded.patch(&json!({ "appearance": { "theme": "light" } })).expect("patch");
        reloaded.flush_if_dirty().expect("flush");

        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(reloaded.paths().settings_file()).expect("read"))
                .expect("valid json");
        assert_eq!(written["futureFeature"]["enabled"], true);
        assert_eq!(written["appearance"]["theme"], "light");
    }

    #[test]
    fn last_written_bytes_match_the_file_for_watcher_self_suppression() {
        let (s, _outcome, _tmp) = store();
        s.flush_if_dirty().expect("flush");
        let on_disk = std::fs::read(s.paths().settings_file()).expect("read");
        assert_eq!(s.last_written_bytes().as_deref(), Some(on_disk.as_slice()));
    }
}
```

- [ ] **Step 3: Run and watch them fail**

Run: `cd src-tauri && cargo test settings::store`
Expected: FAIL to compile — `cannot find type SettingsStore`

- [ ] **Step 4: Implement**

Insert above the tests:

```rust
//! The single source of truth for settings.
//!
//! Loading is infallible by construction: the worst outcome is defaults plus
//! a recorded reason. An application that will not start because its
//! preferences file is malformed has turned a cosmetic problem into an outage.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, RwLock};

use serde_json::Value;

use crate::error::{RiffError, RiffResult};
use crate::paths::AppPaths;
use crate::settings::migrate;
use crate::settings::model::{self, Appearance, General, Onboarding, Settings};
use crate::storage::atomic::write_atomic;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Section {
    General,
    Appearance,
    Onboarding,
}

#[derive(Debug)]
pub enum LoadOutcome {
    /// No file existed; defaults are in memory and pending a write.
    Fresh,
    Loaded,
    Migrated { from: u32 },
    /// The file could not be parsed and was renamed aside.
    /// The file could not be parsed. `Some` means it was renamed aside and
    /// defaults may be written; `None` means it could not be moved, so Riff
    /// must leave the user's file alone.
    Recovered { quarantined: Option<PathBuf> },
}

pub struct SettingsStore {
    paths: AppPaths,
    state: RwLock<Settings>,
    last_written: Mutex<Option<Vec<u8>>>,
    /// Bumped by every mutation. A flush clears the dirty state only if this
    /// has not moved since it took its snapshot, so a change that lands while
    /// a write is in flight is not lost — a plain boolean would drop it.
    revision: AtomicU64,
    flushed: AtomicU64,
    /// Set when the file on disk is unreadable AND could not be moved aside.
    /// Writing would destroy data we failed to preserve.
    write_blocked: AtomicBool,
    writes: AtomicUsize,
}

impl SettingsStore {
    pub fn load(paths: AppPaths) -> (Self, LoadOutcome) {
        let file = paths.settings_file();
        let (settings, outcome) = match std::fs::read(&file) {
            Err(_) => (Settings::default(), LoadOutcome::Fresh),
            Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
                Err(err) => {
                    tracing::error!(%err, path = %file.display(), "settings file is unreadable");
                    let quarantined = quarantine(&file);
                    (Settings::default(), LoadOutcome::Recovered { quarantined })
                }
                Ok(mut document) => {
                    let found = document.get("version").and_then(Value::as_u64).unwrap_or(0);
                    if found < u64::from(model::CURRENT_VERSION) {
                        backup_before_migration(&file, found as u32);
                    } else if found > u64::from(model::CURRENT_VERSION) {
                        // Load it, preserve it, keep writing — but say so once,
                        // because a downgrade is the likeliest cause and the
                        // user should know which direction the mismatch runs.
                        tracing::warn!(
                            found,
                            current = model::CURRENT_VERSION,
                            "settings were written by a newer version of Riff; unknown keys are preserved"
                        );
                    }
                    let migrated_from = migrate::run(&mut document);
                    let settings = serde_json::from_value::<Settings>(document)
                        .unwrap_or_else(|err| {
                            tracing::warn!(%err, "settings did not deserialise; using defaults");
                            Settings::default()
                        });
                    match migrated_from {
                        Some(from) => (settings, LoadOutcome::Migrated { from }),
                        None => (settings, LoadOutcome::Loaded),
                    }
                }
            },
        };

        // Anything but a clean load leaves something to write. The one
        // exception is a corrupt file we could not move aside: writing then
        // would destroy the very bytes quarantine failed to preserve.
        let blocked = matches!(outcome, LoadOutcome::Recovered { quarantined: None });
        let dirty = !matches!(outcome, LoadOutcome::Loaded) && !blocked;
        let store = Self {
            paths,
            state: RwLock::new(settings),
            last_written: Mutex::new(None),
            revision: AtomicU64::new(u64::from(dirty)),
            flushed: AtomicU64::new(0),
            write_blocked: AtomicBool::new(blocked),
            writes: AtomicUsize::new(0),
        };
        (store, outcome)
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn get(&self) -> Settings {
        self.read().clone()
    }

    pub fn write_count(&self) -> usize {
        self.writes.load(Ordering::Relaxed)
    }

    pub fn last_written_bytes(&self) -> Option<Vec<u8>> {
        self.last_written.lock().ok().and_then(|g| g.clone())
    }

    pub fn patch(&self, patch: &Value) -> RiffResult<Settings> {
        let next = crate::settings::patch::apply(&self.read(), patch)?;
        self.replace(next.clone());
        Ok(next)
    }

    pub fn reset(&self, section: Option<Section>) -> RiffResult<Settings> {
        let mut next = self.read().clone();
        match section {
            Some(Section::General) => next.general = General::default(),
            Some(Section::Appearance) => next.appearance = Appearance::default(),
            Some(Section::Onboarding) => next.onboarding = Onboarding::default(),
            // "Everything" means preferences. Onboarding completion is not a
            // preference, and replaying first run is its own explicit action.
            None => {
                next.general = General::default();
                next.appearance = Appearance::default();
            }
        }
        self.replace(next.clone());
        Ok(next)
    }

    /// Replaces the whole document, used by the file watcher on an external
    /// edit. Deliberately does NOT mark the store dirty — the disk already
    /// holds this content — and records the bytes as ours so the same event
    /// arriving twice does not reload twice.
    pub fn adopt(&self, settings: Settings, bytes: Vec<u8>) {
        if let Ok(mut guard) = self.state.write() {
            *guard = settings;
        }
        if let Ok(mut guard) = self.last_written.lock() {
            *guard = Some(bytes);
        }
    }

    pub fn is_dirty(&self) -> bool {
        !self.write_blocked.load(Ordering::SeqCst)
            && self.revision.load(Ordering::SeqCst) != self.flushed.load(Ordering::SeqCst)
    }

    pub fn flush_if_dirty(&self) -> RiffResult<()> {
        if self.write_blocked.load(Ordering::SeqCst) {
            return Err(RiffError::Denied {
                what: "settings.json could not be read or moved aside; refusing to overwrite it".to_owned(),
            });
        }
        if !self.is_dirty() {
            return Ok(());
        }

        // Snapshot the revision BEFORE serialising. A patch that lands while
        // this write is in flight leaves revision ahead of the snapshot, so
        // the store stays dirty and the change is written by the next flush
        // instead of being silently dropped.
        let snapshot = self.revision.load(Ordering::SeqCst);
        let bytes = serde_json::to_vec_pretty(&self.read()).map_err(|e| RiffError::Validation {
            field: "settings".to_owned(),
            reason: e.to_string(),
        })?;
        let path = self.paths.settings_file();

        // Cleared only on success. A failed write leaves the store dirty so
        // the next change retries, and leaves memory untouched so the
        // interface never lies about what the user chose.
        write_atomic(&path, &bytes).map_err(|e| RiffError::io(&path, &e))?;

        if let Ok(mut guard) = self.last_written.lock() {
            *guard = Some(bytes);
        }
        self.writes.fetch_add(1, Ordering::Relaxed);
        self.flushed.store(snapshot, Ordering::SeqCst);
        Ok(())
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, Settings> {
        self.state.read().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn replace(&self, next: Settings) {
        if let Ok(mut guard) = self.state.write() {
            *guard = next;
        }
        self.revision.fetch_add(1, Ordering::SeqCst);
    }
}

/// Moves the unreadable file aside. Returns `None` if it could not be moved,
/// which is the signal that Riff must NOT write over it.
///
/// `rename` rather than copy-and-overwrite: a copy leaves the original in
/// place to be overwritten by the next flush, so if the copy silently failed
/// the user would lose the file entirely. Rename either moves it or does not.
fn quarantine(path: &std::path::Path) -> Option<PathBuf> {
    let target = path.with_extension(format!("json.corrupt-{}", stamp()));
    match std::fs::rename(path, &target) {
        Ok(()) => Some(target),
        Err(err) => {
            tracing::error!(%err, path = %path.display(), "could not quarantine the unreadable settings file; it will be left untouched");
            None
        }
    }
}

/// Copies the pre-migration document aside before the chain runs, so a
/// migration bug is recoverable rather than terminal.
fn backup_before_migration(path: &std::path::Path, from: u32) {
    let target = path.with_extension(format!("json.bak-v{from}"));
    if let Err(err) = std::fs::copy(path, &target) {
        tracing::error!(%err, "could not back up settings before migrating");
    }
}

fn stamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_owned())
        .replace(':', "-")
}
```

> `read()` recovers from a poisoned lock rather than propagating the panic.
> A previous panic while holding the settings lock must not make every
> subsequent read fail — the data itself is still valid.

- [ ] **Step 5: Declare it**

In `src-tauri/src/settings/mod.rs`:

```rust
pub mod store;
```

- [ ] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test settings::store`
Expected: PASS, 13 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): add the store with quarantine, coalescing and reset"
```

---

### Task 7: The external-edit watcher

**Interfaces:**
- Produces: `settings::watcher::should_reload(event_path, settings_path, new_bytes, last_written) -> bool` and `settings::watcher::spawn(Arc<SettingsStore>, on_change) -> notify::Result<RecommendedWatcher>`.

**Files:**
- Create: `src-tauri/src/settings/watcher.rs`
- Modify: `src-tauri/src/settings/mod.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Add `notify`**

```bash
cd src-tauri && cargo add notify@8.2
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/settings/watcher.rs` with only:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    const SETTINGS: &str = "/cfg/settings.json";

    #[test]
    fn reloads_on_a_genuine_external_edit() {
        assert!(should_reload(
            Path::new(SETTINGS),
            Path::new(SETTINGS),
            b"{\"version\":1}",
            Some(b"{\"version\":1,\"old\":true}"),
        ));
    }

    #[test]
    fn ignores_our_own_write() {
        let ours = b"{\"version\":1}";
        assert!(!should_reload(Path::new(SETTINGS), Path::new(SETTINGS), ours, Some(ours)));
    }

    #[test]
    fn ignores_the_schema_file_regenerated_on_every_launch() {
        assert!(!should_reload(
            Path::new("/cfg/settings.schema.json"),
            Path::new(SETTINGS),
            b"{}",
            None,
        ));
    }

    #[test]
    fn ignores_quarantined_files_left_beside_the_real_one() {
        assert!(!should_reload(
            Path::new("/cfg/settings.json.corrupt-2026-08-28T10-00-00Z"),
            Path::new(SETTINGS),
            b"{}",
            None,
        ));
    }

    #[test]
    fn reloads_when_we_have_never_written_anything() {
        assert!(should_reload(Path::new(SETTINGS), Path::new(SETTINGS), b"{}", None));
    }
}
```

- [ ] **Step 3: Run and watch them fail**

Run: `cd src-tauri && cargo test settings::watcher`
Expected: FAIL to compile

- [ ] **Step 4: Implement**

Insert above the tests:

```rust
//! Live reload of hand edits to `settings.json`.
//!
//! `notify` reports events for the whole directory, so two filters are
//! load-bearing. Without the filename match, regenerating
//! `settings.schema.json` or leaving a `settings.json.corrupt-*` file behind
//! would trigger a reload on every launch. Without the byte comparison, our
//! own flush would bounce back through the watcher and re-enter the store.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use crate::settings::model::Settings;
use crate::settings::store::SettingsStore;

pub fn should_reload(
    event_path: &Path,
    settings_path: &Path,
    new_bytes: &[u8],
    last_written: Option<&[u8]>,
) -> bool {
    if event_path.file_name() != settings_path.file_name() {
        return false;
    }
    last_written != Some(new_bytes)
}

/// Watches the config directory and calls `on_change` with the reloaded
/// settings. The returned watcher must be kept alive; dropping it stops
/// watching.
pub fn spawn<F>(store: Arc<SettingsStore>, on_change: F) -> notify::Result<RecommendedWatcher>
where
    F: Fn(Settings) + Send + 'static,
{
    let settings_path = store.paths().settings_file();
    let config_dir = store.paths().config_dir.clone();

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        for path in &event.paths {
            let Ok(bytes) = std::fs::read(path) else { continue };
            if !should_reload(path, &settings_path, &bytes, store.last_written_bytes().as_deref()) {
                continue;
            }
            match serde_json::from_slice::<Settings>(&bytes) {
                Ok(settings) => {
                    tracing::info!("settings changed on disk; reloading");
                    store.adopt(settings.clone(), bytes.clone());
                    on_change(settings);
                }
                Err(err) => {
                    // A half-written file during an editor save is normal.
                    // Ignore it; the editor's final write will land shortly.
                    tracing::debug!(%err, "ignoring an unparseable intermediate write");
                }
            }
        }
    })?;

    watcher.configure(notify::Config::default().with_poll_interval(Duration::from_millis(300)))?;
    watcher.watch(&config_dir, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}
```

- [ ] **Step 5: Declare it**

In `src-tauri/src/settings/mod.rs`:

```rust
pub mod watcher;
```

- [ ] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test settings::watcher`
Expected: PASS, 5 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): reload hand edits without echoing our own writes"
```

---

### Task 8: The coalescing flush

Spec §4.4 promises "dragging the UI-scale slider produces one write, not
forty." Nothing so far delivers it: `flush_if_dirty` writes whenever it is
called, and Plan 04 calls it on every patch. This is the missing scheduler.

**Interfaces:**
- Produces: `settings::store::FlushScheduler` with `spawn(Arc<SettingsStore>, Duration, on_error) -> FlushScheduler`, `.notify()`, and `.flush_now()`.

**Files:**
- Modify: `src-tauri/src/settings/store.rs`

- [ ] **Step 1: Write the failing tests**

Append to the `store.rs` test module:

```rust
    use std::time::Duration;

    #[test]
    fn a_burst_of_changes_produces_one_write() {
        let (s, _outcome, _tmp) = store();
        let s = std::sync::Arc::new(s);
        let scheduler = FlushScheduler::spawn(std::sync::Arc::clone(&s), Duration::from_millis(30), |_| {});

        // Forty steps of a slider drag.
        for i in 0..40 {
            s.patch(&json!({ "appearance": { "uiScale": 1.0 + (i as f64) * 0.01 } }))
                .expect("patch");
            scheduler.notify();
        }
        std::thread::sleep(Duration::from_millis(200));

        assert_eq!(s.write_count(), 1, "a drag must coalesce into one write, not forty");
    }

    #[test]
    fn a_change_after_the_window_closes_writes_again() {
        let (s, _outcome, _tmp) = store();
        let s = std::sync::Arc::new(s);
        let scheduler = FlushScheduler::spawn(std::sync::Arc::clone(&s), Duration::from_millis(30), |_| {});

        s.patch(&json!({ "appearance": { "theme": "light" } })).expect("one");
        scheduler.notify();
        std::thread::sleep(Duration::from_millis(200));
        s.patch(&json!({ "appearance": { "density": "compact" } })).expect("two");
        scheduler.notify();
        std::thread::sleep(Duration::from_millis(200));

        assert_eq!(s.write_count(), 2, "coalescing must not swallow later changes");
    }

    #[test]
    fn a_write_failure_is_reported_once_per_flush_not_once_per_change() {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::atomic::{AtomicUsize, Ordering};

        static REPORTS: AtomicUsize = AtomicUsize::new(0);
        REPORTS.store(0, Ordering::SeqCst);

        let (s, _outcome, _tmp) = store();
        let s = std::sync::Arc::new(s);
        s.flush_if_dirty().expect("initial write");

        let dir = s.paths().config_dir.clone();
        let scheduler = FlushScheduler::spawn(std::sync::Arc::clone(&s), Duration::from_millis(30), |_| {
            REPORTS.fetch_add(1, Ordering::SeqCst);
        });

        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("chmod");
        for _ in 0..10 {
            s.patch(&json!({ "appearance": { "theme": "light" } })).expect("patch");
            scheduler.notify();
        }
        std::thread::sleep(Duration::from_millis(200));
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("restore");

        assert_eq!(
            REPORTS.load(Ordering::SeqCst),
            1,
            "one toast per failure, not one per keystroke"
        );
    }
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd src-tauri && cargo test settings::store::tests::a_burst`
Expected: FAIL to compile — `cannot find type FlushScheduler`

- [ ] **Step 3: Implement**

Add to `store.rs`:

```rust
/// Coalesces writes. Every mutation calls `notify()`; the worker waits for a
/// quiet period before flushing, so a slider drag is one `fsync` rather than
/// forty.
///
/// The scheduling lives here rather than in the command layer because the
/// command layer would have to reimplement it per command, and because a
/// write failure has to be reported from wherever the write actually happens.
pub struct FlushScheduler {
    tx: std::sync::mpsc::Sender<Message>,
}

enum Message {
    Changed,
    FlushNow,
}

impl FlushScheduler {
    pub fn spawn<F>(store: std::sync::Arc<SettingsStore>, delay: std::time::Duration, on_error: F) -> Self
    where
        F: Fn(RiffError) + Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::channel::<Message>();
        std::thread::Builder::new()
            .name("riff-settings-flush".into())
            .spawn(move || {
                // One error per failure *cause*, not one per attempt: a
                // read-only config directory would otherwise raise a toast on
                // every keystroke.
                let mut reported: Option<String> = None;
                while let Ok(first) = rx.recv() {
                    if matches!(first, Message::Changed) {
                        // Drain the burst: keep resetting the timer while
                        // changes keep arriving.
                        while rx.recv_timeout(delay).is_ok() {}
                    }
                    match store.flush_if_dirty() {
                        Ok(()) => reported = None,
                        Err(err) => {
                            let cause = err.to_string();
                            if reported.as_deref() != Some(cause.as_str()) {
                                reported = Some(cause);
                                on_error(err);
                            }
                        }
                    }
                }
            })
            .ok();
        Self { tx }
    }

    pub fn notify(&self) {
        let _ = self.tx.send(Message::Changed);
    }

    /// Skips the quiet period. Used on exit, where waiting 250 ms to save is
    /// waiting 250 ms too long.
    pub fn flush_now(&self) {
        let _ = self.tx.send(Message::FlushNow);
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test settings::store`
Expected: PASS, 16 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(settings): coalesce writes so a slider drag is one fsync"
```

---

### Task 9: Gate check

- [ ] **Step 1: Run everything**

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo deny check licenses
```
Expected: all exit 0, roughly 50 tests passing.

- [ ] **Step 2: Confirm the four invariants have a test each**

Run: `cd src-tauri && cargo test settings -- --list | grep -E 'quarantin|failed_write|unknown_keys|missing_file'`
Expected: four or more test names printed. If any invariant from the top of this plan has no test, add it now rather than in a later plan.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify settings store gates" --allow-empty
```

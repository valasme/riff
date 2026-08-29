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
        assert!(properties["practice"].is_object());
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

        assert!(
            write(&paths).expect("first write"),
            "first launch writes the schema"
        );
        assert!(
            !write(&paths).expect("second write"),
            "an unchanged launch must touch nothing"
        );
        assert!(paths.schema_file().is_file());
    }
}

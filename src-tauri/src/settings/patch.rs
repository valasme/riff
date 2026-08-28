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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::model::{Settings, Theme};
    use serde_json::json;

    #[test]
    fn applies_a_nested_field_without_disturbing_its_siblings() {
        let before = Settings::default();
        let after =
            apply(&before, &json!({ "appearance": { "theme": "light" } })).expect("applies");
        assert_eq!(after.appearance.theme, Theme::Light);
        assert_eq!(after.appearance.density, before.appearance.density);
        assert_eq!(after.general.startup_route, before.general.startup_route);
    }

    #[test]
    fn null_is_ignored_rather_than_clearing_a_value() {
        let mut before = Settings::default();
        before.onboarding.completed_at = Some("2026-08-28T10:00:00Z".to_owned());
        let after =
            apply(&before, &json!({ "onboarding": { "completedAt": null } })).expect("applies");
        assert_eq!(
            after.onboarding.completed_at.as_deref(),
            Some("2026-08-28T10:00:00Z"),
            "clearing is a reset operation, not a patch operation"
        );
    }

    #[test]
    fn an_out_of_range_value_is_clamped_by_the_model_not_rejected() {
        let after = apply(
            &Settings::default(),
            &json!({ "appearance": { "uiScale": 5.0 } }),
        )
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

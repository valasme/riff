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
            MigrationStep {
                from: 0,
                to: 1,
                apply: |doc| {
                    doc["general"]["startupRoute"] = json!("practice");
                },
            },
            MigrationStep {
                from: 1,
                to: 2,
                apply: |doc| {
                    doc["appearance"]["density"] = json!("compact");
                },
            },
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
        assert!(
            doc["general"]["startupRoute"].is_null(),
            "step 0->1 must not have run"
        );
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
        assert_eq!(
            doc["version"], 99,
            "a downgrade must never rewrite a newer file"
        );
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

//! The only error type that crosses the IPC boundary.
//!
//! Adjacently tagged on purpose: the frontend switches on `code` to pick a
//! localised message and shows `details` in a collapsible technical panel.
//! Raw Rust error prose is never primary UI text — it cannot be translated.

use std::path::Path;

#[derive(Debug, Clone, PartialEq, thiserror::Error, serde::Serialize)]
#[serde(tag = "code", content = "details", rename_all = "kebab-case")]
pub enum RiffError {
    #[error("io error at {path}: {message}")]
    Io { path: String, message: String },

    #[error("could not parse {path}: {message}")]
    Parse {
        path: String,
        message: String,
        line: Option<u32>,
    },

    #[error("invalid value for {field}: {reason}")]
    Validation { field: String, reason: String },

    #[error("not found: {what}")]
    NotFound { what: String },

    #[error("not permitted: {what}")]
    Denied { what: String },

    /// The workspace names a score that is no longer at its recorded path.
    /// Never stat-ed proactively — see spec §9 — so this fires at the moment
    /// something actually tries to read the file: opening it fresh, or
    /// accepting the reopen offer.
    #[error("score not found: {name}")]
    ScoreMissing { name: String },

    /// Riff does not prompt for a password. A code of its own because it is
    /// the one failure the user can act on differently: find the password
    /// elsewhere, or decrypt the file with another tool first.
    #[error("score is password-protected")]
    ScoreEncrypted,

    /// Everything else that keeps a score from opening: not a PDF at all, a
    /// truncated file, a malformed cross-reference table. These share one
    /// code because the user's next action is the same regardless — open a
    /// different file — and the distinction belongs in `details`, not in a
    /// fourth code nobody would act on differently.
    #[error("score could not be read: {reason}")]
    ScoreUnreadable { reason: String },

    #[error("score operation is stale")]
    ScoreStale,

    #[error("score infrastructure failure: {operation}")]
    ScoreInfrastructure { operation: String },
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
        let err = RiffError::NotFound {
            what: "settings.json".into(),
        };
        let json = serde_json::to_value(&err).expect("serialises");
        assert_eq!(json["code"], "not-found");
    }

    #[test]
    fn score_error_codes_are_kebab_case() {
        assert_eq!(
            serde_json::to_value(RiffError::ScoreMissing { name: "x".into() }).expect("ser")
                ["code"],
            "score-missing"
        );
        assert_eq!(
            serde_json::to_value(RiffError::ScoreEncrypted).expect("ser")["code"],
            "score-encrypted"
        );
        assert_eq!(
            serde_json::to_value(RiffError::ScoreUnreadable { reason: "x".into() }).expect("ser")
                ["code"],
            "score-unreadable"
        );
    }

    /// A code earns its existence only when it changes what the user does
    /// next (spec §9) — and only if it also has something to say. Reads the
    /// real locale file rather than trusting the Rust side alone, because a
    /// key present in Rust and absent from `errors.json` is exactly the gap
    /// `reportFailure`'s `defaultValue` fallback hides at runtime.
    #[test]
    fn every_score_error_code_has_a_message() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/locales/en/errors.json");
        let document: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).expect("errors.json"))
                .expect("valid json");
        let codes = document["code"].as_object().expect("a code object");
        for code in [
            "score-missing",
            "score-encrypted",
            "score-unreadable",
            "score-stale",
        ] {
            let message = codes.get(code).and_then(serde_json::Value::as_str);
            assert!(
                message.is_some_and(|m| !m.is_empty()),
                "errors.json has no message for code \"{code}\""
            );
        }
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
        let err = RiffError::Denied {
            what: "writing outside the config directory".into(),
        };
        assert_eq!(
            err.to_string(),
            "not permitted: writing outside the config directory"
        );
    }
}

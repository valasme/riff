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

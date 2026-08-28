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
        out.push_str(&format!(
            "\n--- {} ---\n",
            dir.file_name().unwrap_or_default().to_string_lossy()
        ));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_the_home_directory_and_the_username() {
        let text = "error at /home/dimitris/.config/riff/settings.json for dimitris";
        let redacted = redact(text, "/home/dimitris", "dimitris");
        assert!(redacted.contains("$HOME/.config/riff/settings.json"));
        assert!(
            !redacted.contains("dimitris"),
            "the account name must not survive: {redacted}"
        );
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
        assert!(
            out.contains("truncated"),
            "truncation must be visible, never silent"
        );
    }

    #[test]
    fn the_newest_session_survives_truncation_because_it_is_the_one_that_matters() {
        let out = cap(&format!("{}\nTAIL-MARKER\n", "x".repeat(MAX_BYTES * 2)));
        assert!(out.contains("TAIL-MARKER"));
    }
}

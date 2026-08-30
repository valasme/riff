//! Exercises `workspace::read_and_validate` against the real fixtures in
//! `tests/fixtures/scores/`, not just synthetic byte strings — Task 1 exists
//! precisely so these paths are reachable at all.

use riff_lib::error::RiffError;
use riff_lib::workspace::read_and_validate;
use std::path::{Path, PathBuf};

fn fixture(name: &str) -> PathBuf {
    Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/scores"
    ))
    .join(name)
}

#[test]
fn an_engraved_score_opens_cleanly() {
    let bytes = read_and_validate(&fixture("engraved.pdf")).expect("a well-formed PDF opens");
    assert!(bytes.starts_with(b"%PDF-"));
}

#[test]
fn a_scanned_score_with_no_text_layer_still_opens() {
    // No text layer is a rendering/search concern for pdf.js, not a Rust
    // validation failure — the file is a perfectly good PDF.
    read_and_validate(&fixture("scanned.pdf")).expect("a scan is not a validation failure");
}

#[test]
fn an_encrypted_score_reports_score_encrypted() {
    let err = read_and_validate(&fixture("encrypted.pdf")).expect_err("must be rejected");
    assert!(matches!(err, RiffError::ScoreEncrypted));
}

#[test]
fn a_truncated_score_reports_score_unreadable() {
    let err = read_and_validate(&fixture("truncated.pdf")).expect_err("must be rejected");
    assert!(matches!(err, RiffError::ScoreUnreadable { .. }));
}

#[test]
fn a_non_pdf_wearing_a_pdf_extension_reports_score_unreadable() {
    let err = read_and_validate(&fixture("not-a-pdf.pdf")).expect_err("must be rejected");
    assert!(matches!(err, RiffError::ScoreUnreadable { .. }));
}

#[test]
fn a_missing_score_reports_score_missing() {
    let err = read_and_validate(&fixture("does-not-exist.pdf")).expect_err("must be rejected");
    match err {
        RiffError::ScoreMissing { name } => assert_eq!(name, "does-not-exist.pdf"),
        other => panic!("expected ScoreMissing, got {other:?}"),
    }
}

#[test]
fn a_score_with_an_external_link_still_opens() {
    // The link itself is disabled in the viewer (Task 5); Rust's job here is
    // only to confirm the file is a readable, unencrypted PDF.
    read_and_validate(&fixture("external-link.pdf")).expect("opens");
}

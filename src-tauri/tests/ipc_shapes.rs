//! Guards the hand-written TypeScript in `src/lib/ipc/types.ts`.
//!
//! Serialises one representative value of every type that crosses the IPC
//! boundary and compares the result against a committed fixture. Changing a
//! Rust type fails this test, which is the reminder to change the TypeScript.
//!
//! To accept an intentional change: RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes

use riff_lib::commands::app::{AppInfo, ExternalLink, PathKind};
use riff_lib::commands::diagnostics::LogLevel;
use riff_lib::commands::licenses::LicenseEntry;
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
        "LogLevel": [
            LogLevel::Error,
            LogLevel::Warn,
            LogLevel::Info,
            LogLevel::Debug,
            LogLevel::Trace,
        ],
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
        "LicenseEntry": LicenseEntry {
            name: "n".into(),
            version: "0.0.0".into(),
            license: "MIT".into(),
            ecosystem: "npm".into(),
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
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/ipc-shapes.json"
    );
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

pub mod banner;
pub mod bundle;
pub mod health;
pub mod probe;

/// The one bundle format, built the same way whether it is requested from
/// `riff logs export` or the About section's Export button.
pub fn current_bundle(paths: &crate::paths::AppPaths) -> String {
    let system = probe::probe();
    let app_info = crate::commands::app::app_info();

    let dir_row = |name: &str, dir: &std::path::Path| {
        (
            name.to_owned(),
            dir.display().to_string(),
            dir.is_dir() && !health::is_read_only(dir),
        )
    };

    let banner_text = banner::render(&banner::Banner {
        app_version: app_info.version,
        git_sha: app_info.git_sha,
        build_date: app_info.build_date,
        build_profile: if cfg!(debug_assertions) {
            "debug".into()
        } else {
            "release".into()
        },
        tauri_version: app_info.tauri_version,
        webkit_version: app_info.webkit_version,
        system,
        paths: vec![
            dir_row("config", &paths.config_dir),
            dir_row("data", &paths.data_dir),
            dir_row("state", &paths.state_dir),
            dir_row("cache", &paths.cache_dir),
            dir_row("logs", &paths.log_dir),
        ],
        settings_outcome: settings_outcome(paths),
    });

    let home = paths.home_dir.display().to_string();
    let user = std::env::var("USER").unwrap_or_default();
    bundle::build(paths, &banner_text, &home, &user)
}

/// Read-only: this must never quarantine a corrupt file as a side effect of
/// exporting diagnostics. `health::run_checks` already reads without writing.
fn settings_outcome(paths: &crate::paths::AppPaths) -> String {
    health::run_checks(paths)
        .into_iter()
        .find(|c| c.id == "settings")
        .map(|c| c.detail)
        .unwrap_or_else(|| "unknown".to_owned())
}

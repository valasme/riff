//! What is wrong with this installation, and can we fix it.
//!
//! Every check is pure over an `AppPaths`, so `doctor` needs no window, no
//! GTK and no display — which is the state the machine is usually in when
//! somebody runs it.

use crate::paths::AppPaths;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Ok,
    Warn,
    Error,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: &'static str,
    pub title: &'static str,
    pub severity: Severity,
    pub detail: String,
    /// Whether `riff repair` knows how to fix this.
    pub repairable: bool,
}

const QUARANTINE_WARN_AT: usize = 5;

pub fn run_checks(paths: &AppPaths) -> Vec<Check> {
    vec![
        check_dirs(paths),
        check_writable(paths),
        check_settings(paths),
        check_quarantine(paths),
    ]
}

fn check_dirs(paths: &AppPaths) -> Check {
    let missing: Vec<_> = [
        ("config", &paths.config_dir),
        ("data", &paths.data_dir),
        ("state", &paths.state_dir),
        ("cache", &paths.cache_dir),
        ("logs", &paths.log_dir),
    ]
    .into_iter()
    .filter(|(_, dir)| !dir.is_dir())
    .map(|(name, _)| name)
    .collect();

    if missing.is_empty() {
        Check {
            id: "dirs",
            title: "Directories",
            severity: Severity::Ok,
            detail: "all present".into(),
            repairable: false,
        }
    } else {
        Check {
            id: "dirs",
            title: "Directories",
            severity: Severity::Error,
            detail: format!("missing: {}", missing.join(", ")),
            repairable: true,
        }
    }
}

fn check_writable(paths: &AppPaths) -> Check {
    let unwritable: Vec<String> = [&paths.config_dir, &paths.data_dir, &paths.log_dir]
        .into_iter()
        .filter(|dir| dir.is_dir() && is_read_only(dir))
        .map(|dir| dir.display().to_string())
        .collect();

    if unwritable.is_empty() {
        Check {
            id: "writable",
            title: "Permissions",
            severity: Severity::Ok,
            detail: "writable".into(),
            repairable: false,
        }
    } else {
        Check {
            id: "writable",
            title: "Permissions",
            severity: Severity::Error,
            detail: format!("not writable: {}", unwritable.join(", ")),
            // Changing permissions on the user's directories is their call,
            // not ours. We report it; we do not chmod behind their back.
            repairable: false,
        }
    }
}

fn is_read_only(dir: &std::path::Path) -> bool {
    match std::fs::metadata(dir) {
        Ok(meta) => meta.permissions().readonly(),
        Err(_) => true,
    }
}

fn check_settings(paths: &AppPaths) -> Check {
    let file = paths.settings_file();
    match std::fs::read(&file) {
        // Absent is fine: launching writes defaults.
        Err(_) => Check {
            id: "settings",
            title: "settings.json",
            severity: Severity::Ok,
            detail: "absent; defaults will be written".into(),
            repairable: false,
        },
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(_) => Check {
                id: "settings",
                title: "settings.json",
                severity: Severity::Ok,
                detail: "parses".into(),
                repairable: false,
            },
            Err(err) => Check {
                id: "settings",
                title: "settings.json",
                severity: Severity::Error,
                detail: format!("does not parse: {err}"),
                repairable: true,
            },
        },
    }
}

fn check_quarantine(paths: &AppPaths) -> Check {
    let count = std::fs::read_dir(&paths.config_dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().contains(".corrupt-"))
                .count()
        })
        .unwrap_or(0);

    if count >= QUARANTINE_WARN_AT {
        Check {
            id: "quarantine",
            title: "Quarantined files",
            severity: Severity::Warn,
            detail: format!("{count} recovered settings files are taking up space"),
            repairable: true,
        }
    } else {
        Check {
            id: "quarantine",
            title: "Quarantined files",
            severity: Severity::Ok,
            detail: format!("{count}"),
            repairable: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(tmp: &std::path::Path) -> crate::paths::AppPaths {
        crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.join("config")),
                data: Some(tmp.join("data")),
            },
        )
        .expect("overrides supply both roots")
    }

    #[test]
    fn a_healthy_installation_reports_no_problems() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        crate::paths::ensure_dirs(&p).expect("dirs");
        std::fs::write(p.settings_file(), b"{\"version\":1}").expect("seed");

        let report = run_checks(&p);
        assert!(
            report.iter().all(|c| c.severity == Severity::Ok),
            "{report:#?}"
        );
    }

    #[test]
    fn a_missing_directory_is_reported_as_repairable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        // Deliberately do not create anything.
        let report = run_checks(&p);
        let missing = report
            .iter()
            .find(|c| c.id == "dirs")
            .expect("a dirs check exists");
        assert_eq!(missing.severity, Severity::Error);
        assert!(missing.repairable, "riff repair must be able to fix this");
    }

    #[test]
    fn an_unparseable_settings_file_is_an_error_and_is_repairable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        crate::paths::ensure_dirs(&p).expect("dirs");
        std::fs::write(p.settings_file(), b"{ not json").expect("seed");

        let check = run_checks(&p)
            .into_iter()
            .find(|c| c.id == "settings")
            .expect("check");
        assert_eq!(check.severity, Severity::Error);
        assert!(check.repairable);
    }

    #[test]
    fn a_missing_settings_file_is_fine_because_defaults_are_written_on_launch() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        crate::paths::ensure_dirs(&p).expect("dirs");

        let check = run_checks(&p)
            .into_iter()
            .find(|c| c.id == "settings")
            .expect("check");
        assert_eq!(check.severity, Severity::Ok);
    }

    #[test]
    fn accumulated_quarantine_files_are_a_warning_not_an_error() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        crate::paths::ensure_dirs(&p).expect("dirs");
        for i in 0..6 {
            std::fs::write(
                p.config_dir.join(format!("settings.json.corrupt-{i}")),
                b"x",
            )
            .expect("seed");
        }

        let check = run_checks(&p)
            .into_iter()
            .find(|c| c.id == "quarantine")
            .expect("check");
        assert_eq!(check.severity, Severity::Warn);
        assert!(check.repairable);
    }
}

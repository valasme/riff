//! The first lines of every session log.

use crate::diagnostics::probe::SystemInfo;

pub struct Banner {
    pub app_version: String,
    pub git_sha: String,
    pub build_date: String,
    pub build_profile: String,
    pub tauri_version: String,
    pub webkit_version: String,
    pub system: SystemInfo,
    /// name, path, writable
    pub paths: Vec<(String, String, bool)>,
    pub settings_outcome: String,
}

pub fn render(b: &Banner) -> String {
    let mut out = String::from("=== riff session ===\n");
    let mut line = |k: &str, v: &str| out.push_str(&format!("{k:<16}{v}\n"));

    line(
        "version",
        &format!("{} ({}, built {})", b.app_version, b.git_sha, b.build_date),
    );
    line("profile", &b.build_profile);
    line("tauri", &b.tauri_version);
    line("webkitgtk", &b.webkit_version);
    line(
        "distro",
        &format!("{} ({})", b.system.distro, b.system.distro_version),
    );
    line("kernel", &b.system.kernel);
    line("arch", &b.system.arch);
    line("session", &b.system.session_type);
    line("desktop", &b.system.desktop);
    if let Some(compositor) = &b.system.compositor {
        line("compositor", compositor);
    }
    line("locale", &b.system.locale);
    line("settings", &b.settings_outcome);

    out.push_str("paths\n");
    for (name, path, writable) in &b.paths {
        let state = if *writable {
            "writable"
        } else {
            "NOT WRITABLE"
        };
        out.push_str(&format!("  {name:<10}{path}  [{state}]\n"));
    }

    if !b.system.env.is_empty() {
        out.push_str("environment\n");
        for (key, value) in &b.system.env {
            out.push_str(&format!("  {key}={value}\n"));
        }
    }

    out.push_str("=====================\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn banner() -> Banner {
        Banner {
            app_version: "0.1.0".into(),
            git_sha: "abc1234".into(),
            build_date: "2026-08-28".into(),
            build_profile: "release".into(),
            tauri_version: "2.11.5".into(),
            webkit_version: "2.52.6".into(),
            system: crate::diagnostics::probe::SystemInfo::from_parts(
                "PRETTY_NAME=\"Arch Linux\"\nID=arch\n",
                "6.9.3-arch1-1",
                &Default::default(),
            ),
            paths: vec![("config".into(), "/home/u/.config/riff".into(), true)],
            settings_outcome: "loaded".into(),
        }
    }

    #[test]
    fn records_everything_a_bug_report_asks_for() {
        let text = render(&banner());
        for expected in [
            "0.1.0",
            "abc1234",
            "2026-08-28",
            "2.52.6",
            "Arch Linux",
            "6.9.3-arch1-1",
        ] {
            assert!(
                text.contains(expected),
                "banner is missing {expected}:\n{text}"
            );
        }
    }

    #[test]
    fn marks_whether_each_directory_is_writable() {
        let text = render(&banner());
        assert!(text.contains("/home/u/.config/riff"));
        assert!(text.contains("writable"));
    }

    #[test]
    fn is_a_single_block_that_survives_being_pasted() {
        let text = render(&banner());
        assert!(text.starts_with("=== riff session ==="));
        assert!(text.ends_with('\n'));
    }
}

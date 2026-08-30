//! What machine is this, really.
//!
//! Split into `from_parts` (pure, tested) and `probe` (reads the world), so
//! every branch is exercised without needing a machine that has the property
//! under test. A diagnostics probe must never fail — every field degrades to
//! "unknown" rather than returning an error.

use std::collections::BTreeMap;

pub type Env = BTreeMap<String, String>;

/// Read verbatim into the report. Anything not on this list is not recorded,
/// because a full environment dump routinely contains credentials and this
/// file is designed to be pasted into a public issue.
const ENV_ALLOW_PREFIXES: &[&str] = &[
    "RIFF_",
    "XDG_",
    "GDK_",
    "GTK_",
    "WEBKIT_",
    "GST_",
    "QT_",
    "LANG",
    "LC_",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "DESKTOP_SESSION",
    "container",
];

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub distro: String,
    pub distro_id: String,
    pub distro_version: String,
    pub kernel: String,
    pub arch: String,
    pub session_type: String,
    pub desktop: String,
    pub compositor: Option<String>,
    pub locale: String,
    pub env: Env,
}

impl SystemInfo {
    pub fn from_parts(os_release: &str, kernel: &str, env: &Env) -> Self {
        let field = |key: &str| -> String {
            os_release
                .lines()
                .find_map(|line| line.strip_prefix(&format!("{key}=")))
                .map(|value| value.trim_matches('"').to_owned())
                .unwrap_or_else(|| "unknown".to_owned())
        };

        let get = |key: &str| env.get(key).cloned().unwrap_or_default();

        // Compositor identification, in the order the signatures are unique.
        let compositor = if env.contains_key("HYPRLAND_INSTANCE_SIGNATURE") {
            Some("Hyprland".to_owned())
        } else if env.contains_key("SWAYSOCK") {
            Some("sway".to_owned())
        } else if env.contains_key("NIRI_SOCKET") {
            Some("niri".to_owned())
        } else {
            None
        };

        Self {
            distro: field("PRETTY_NAME"),
            distro_id: field("ID"),
            distro_version: field("VERSION_ID"),
            kernel: if kernel.is_empty() {
                "unknown".to_owned()
            } else {
                kernel.to_owned()
            },
            arch: std::env::consts::ARCH.to_owned(),
            session_type: get("XDG_SESSION_TYPE"),
            desktop: get("XDG_CURRENT_DESKTOP"),
            compositor,
            locale: env
                .get("LC_ALL")
                .or_else(|| env.get("LANG"))
                .cloned()
                .unwrap_or_default(),
            env: env
                .iter()
                .filter(|(key, _)| ENV_ALLOW_PREFIXES.iter().any(|p| key.starts_with(p)))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        }
    }
}

pub fn probe() -> SystemInfo {
    let os_release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    let kernel = std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default();
    let env: Env = std::env::vars().collect();
    SystemInfo::from_parts(&os_release, kernel.trim(), &env)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Env {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    const OS_RELEASE: &str = r#"NAME="Arch Linux"
PRETTY_NAME="Arch Linux"
ID=arch
BUILD_ID=rolling
"#;

    #[test]
    fn reads_the_distribution_from_os_release() {
        let info = SystemInfo::from_parts(OS_RELEASE, "6.9.3-arch1-1", &env(&[]));
        assert_eq!(info.distro, "Arch Linux");
        assert_eq!(info.distro_id, "arch");
        assert_eq!(info.kernel, "6.9.3-arch1-1");
    }

    #[test]
    fn falls_back_when_os_release_is_absent_rather_than_failing() {
        let info = SystemInfo::from_parts("", "", &env(&[]));
        assert_eq!(info.distro, "unknown");
        // A diagnostics probe that can fail is a diagnostics probe that will
        // fail on the one machine you needed it for.
    }

    #[test]
    fn identifies_the_session_and_desktop() {
        let info = SystemInfo::from_parts(
            OS_RELEASE,
            "6.9",
            &env(&[
                ("XDG_SESSION_TYPE", "wayland"),
                ("XDG_CURRENT_DESKTOP", "Hyprland"),
            ]),
        );
        assert_eq!(info.session_type, "wayland");
        assert_eq!(info.desktop, "Hyprland");
    }

    #[test]
    fn names_the_compositor_when_its_signature_is_present() {
        let info = SystemInfo::from_parts(
            OS_RELEASE,
            "6.9",
            &env(&[
                ("XDG_SESSION_TYPE", "wayland"),
                ("HYPRLAND_INSTANCE_SIGNATURE", "abc"),
            ]),
        );
        assert_eq!(info.compositor.as_deref(), Some("Hyprland"));
    }

    #[test]
    fn records_only_allow_listed_environment_variables() {
        let info = SystemInfo::from_parts(
            OS_RELEASE,
            "6.9",
            &env(&[
                ("RIFF_LOG", "debug"),
                ("GDK_SCALE", "2"),
                ("AWS_SECRET_ACCESS_KEY", "hunter2"),
                ("GITHUB_TOKEN", "ghp_xxx"),
            ]),
        );
        assert!(info.env.contains_key("RIFF_LOG"));
        assert!(info.env.contains_key("GDK_SCALE"));
        assert!(
            !info
                .env
                .keys()
                .any(|k| k.contains("SECRET") || k.contains("TOKEN")),
            "a diagnostics file is meant to be pasted in public; never dump the environment"
        );
    }
}

//! Where Riff keeps things. XDG Base Directory layout, using the plain name
//! `riff` rather than the reverse-DNS identifier, because these are files
//! users are expected to open and edit.

use std::path::{Path, PathBuf};

/// The four XDG roots, before Riff's own subdirectory is appended.
/// Passed in rather than read from the environment so `resolve` stays pure
/// and testable — `std::env::set_var` is racy across parallel tests.
#[derive(Debug, Clone, Default)]
pub struct XdgRoots {
    pub config: Option<PathBuf>,
    pub data: Option<PathBuf>,
    pub state: Option<PathBuf>,
    pub cache: Option<PathBuf>,
    pub home: Option<PathBuf>,
}

impl XdgRoots {
    pub fn from_system() -> Self {
        match directories::BaseDirs::new() {
            Some(b) => Self {
                config: Some(b.config_dir().to_path_buf()),
                data: Some(b.data_dir().to_path_buf()),
                state: b.state_dir().map(Path::to_path_buf),
                cache: Some(b.cache_dir().to_path_buf()),
                home: Some(b.home_dir().to_path_buf()),
            },
            None => Self::default(),
        }
    }
}

/// `RIFF_CONFIG_HOME` and `RIFF_DATA_HOME`. Used verbatim — they name Riff's
/// directory itself, not a parent to append `riff` to — so a test or a
/// portable install can point at a temporary directory with no surprises.
#[derive(Debug, Clone, Default)]
pub struct PathOverrides {
    pub config: Option<PathBuf>,
    pub data: Option<PathBuf>,
}

impl PathOverrides {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn from_env() -> Self {
        Self {
            config: std::env::var_os("RIFF_CONFIG_HOME").map(PathBuf::from),
            data: std::env::var_os("RIFF_DATA_HOME").map(PathBuf::from),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub state_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub log_dir: PathBuf,
    /// The user's home directory, carried so the frontend can redact it from
    /// anything it puts on the clipboard. Deriving it by stripping
    /// `/.config/riff` from `config_dir` silently fails whenever
    /// `XDG_CONFIG_HOME` or `RIFF_CONFIG_HOME` is set — and then leaks the
    /// account name through the one affordance built to protect it.
    pub home_dir: PathBuf,
}

impl AppPaths {
    pub fn settings_file(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }
    pub fn schema_file(&self) -> PathBuf {
        self.config_dir.join("settings.schema.json")
    }
    pub fn history_file(&self) -> PathBuf {
        self.data_dir.join("history.jsonl")
    }
}

#[derive(Debug, thiserror::Error)]
#[error(
    "cannot determine where to store data: none of $XDG_CONFIG_HOME, $HOME or \
     RIFF_CONFIG_HOME resolved to a usable directory"
)]
pub struct PathResolutionError;

pub fn resolve(
    roots: &XdgRoots,
    overrides: &PathOverrides,
) -> Result<AppPaths, PathResolutionError> {
    let config_dir = match &overrides.config {
        Some(dir) => dir.clone(),
        None => roots
            .config
            .as_ref()
            .ok_or(PathResolutionError)?
            .join("riff"),
    };
    let data_dir = match &overrides.data {
        Some(dir) => dir.clone(),
        None => roots.data.as_ref().ok_or(PathResolutionError)?.join("riff"),
    };
    // XDG_STATE_HOME is the newest of the four and not every environment sets
    // it. Falling back inside the data directory keeps logs with the rest of
    // Riff's data instead of scattering them.
    let state_dir = match &roots.state {
        Some(root) => root.join("riff"),
        None => data_dir.join("state"),
    };
    let cache_dir = match &roots.cache {
        Some(root) => root.join("riff"),
        None => data_dir.join("cache"),
    };
    let log_dir = state_dir.join("logs");

    let home_dir = roots.home.clone().unwrap_or_default();

    Ok(AppPaths {
        config_dir,
        data_dir,
        state_dir,
        cache_dir,
        log_dir,
        home_dir,
    })
}

pub fn ensure_dirs(paths: &AppPaths) -> std::io::Result<()> {
    for dir in [
        &paths.config_dir,
        &paths.data_dir,
        &paths.state_dir,
        &paths.cache_dir,
        &paths.log_dir,
    ] {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn roots(base: &str) -> XdgRoots {
        XdgRoots {
            config: Some(PathBuf::from(format!("{base}/.config"))),
            data: Some(PathBuf::from(format!("{base}/.local/share"))),
            state: Some(PathBuf::from(format!("{base}/.local/state"))),
            cache: Some(PathBuf::from(format!("{base}/.cache"))),
            home: Some(PathBuf::from(base)),
        }
    }

    #[test]
    fn resolves_xdg_directories_under_the_plain_name_riff() {
        let p = resolve(&roots("/home/u"), &PathOverrides::none()).expect("all roots present");
        assert_eq!(p.config_dir, PathBuf::from("/home/u/.config/riff"));
        assert_eq!(p.data_dir, PathBuf::from("/home/u/.local/share/riff"));
        assert_eq!(p.state_dir, PathBuf::from("/home/u/.local/state/riff"));
        assert_eq!(p.cache_dir, PathBuf::from("/home/u/.cache/riff"));
        assert_eq!(p.log_dir, PathBuf::from("/home/u/.local/state/riff/logs"));
    }

    #[test]
    fn the_home_directory_is_carried_so_the_frontend_can_redact_it() {
        let p = resolve(&roots("/home/u"), &PathOverrides::none()).expect("roots");
        assert_eq!(p.home_dir, PathBuf::from("/home/u"));
    }

    #[test]
    fn named_files_sit_in_the_right_directories() {
        let p = resolve(&roots("/home/u"), &PathOverrides::none()).expect("roots");
        assert_eq!(
            p.settings_file(),
            PathBuf::from("/home/u/.config/riff/settings.json")
        );
        assert_eq!(
            p.schema_file(),
            PathBuf::from("/home/u/.config/riff/settings.schema.json")
        );
        assert_eq!(
            p.history_file(),
            PathBuf::from("/home/u/.local/share/riff/history.jsonl")
        );
    }

    #[test]
    fn riff_config_home_overrides_xdg_exactly_and_is_not_suffixed() {
        let overrides = PathOverrides {
            config: Some(PathBuf::from("/tmp/probe/cfg")),
            data: None,
        };
        let p = resolve(&roots("/home/u"), &overrides).expect("roots");
        assert_eq!(p.config_dir, PathBuf::from("/tmp/probe/cfg"));
        assert_eq!(p.data_dir, PathBuf::from("/home/u/.local/share/riff"));
    }

    #[test]
    fn missing_roots_and_no_override_is_an_error_not_a_fallback() {
        let empty = XdgRoots {
            config: None,
            data: None,
            state: None,
            cache: None,
            home: None,
        };
        assert!(resolve(&empty, &PathOverrides::none()).is_err());
    }

    #[test]
    fn state_root_absent_falls_back_to_the_data_root() {
        let mut r = roots("/home/u");
        r.state = None;
        let p = resolve(&r, &PathOverrides::none()).expect("data root covers state");
        assert_eq!(
            p.state_dir,
            PathBuf::from("/home/u/.local/share/riff/state")
        );
    }

    #[test]
    fn ensure_dirs_creates_everything_and_is_idempotent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let base = tmp.path().to_string_lossy().into_owned();
        let p = resolve(&roots(&base), &PathOverrides::none()).expect("roots");
        ensure_dirs(&p).expect("first create");
        ensure_dirs(&p).expect("second create must not fail");
        assert!(p.config_dir.is_dir());
        assert!(p.log_dir.is_dir());
    }
}

//! Commands that expose the application to itself.
//!
//! `open_path` and `open_external` take enums rather than strings on purpose.
//! There is no path and no URL a compromised frontend could ask Riff to open,
//! because the set of openable things is fixed at compile time.

use std::path::PathBuf;
use std::sync::Arc;

use crate::error::{RiffError, RiffResult};
use crate::paths::AppPaths;
use crate::settings::store::SettingsStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PathKind {
    Config,
    Data,
    Cache,
    Logs,
}

impl PathKind {
    pub fn resolve(self, paths: &AppPaths) -> PathBuf {
        match self {
            Self::Config => paths.config_dir.clone(),
            Self::Data => paths.data_dir.clone(),
            Self::Cache => paths.cache_dir.clone(),
            Self::Logs => paths.log_dir.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalLink {
    Repository,
    Issues,
    License,
}

impl ExternalLink {
    pub fn url(self) -> &'static str {
        match self {
            Self::Repository => "https://github.com/valasme/riff",
            Self::Issues => "https://github.com/valasme/riff/issues",
            Self::License => "https://github.com/valasme/riff/blob/main/LICENSE",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub tauri_version: String,
    pub webkit_version: String,
    pub build_date: String,
    pub git_sha: String,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        tauri_version: tauri::VERSION.to_owned(),
        webkit_version: webkit_version(),
        build_date: option_env!("RIFF_BUILD_DATE")
            .unwrap_or("unknown")
            .to_owned(),
        git_sha: option_env!("RIFF_GIT_SHA").unwrap_or("unknown").to_owned(),
    }
}

fn webkit_version() -> String {
    // From the runtime, not the build: the two can differ after a system
    // upgrade, and the runtime one is what a bug report needs.
    //
    // NOT `pkg-config --modversion webkit2gtk-4.1`. pkg-config and the .pc
    // file both come from libwebkit2gtk-4.1-dev, which users do not install,
    // so shelling out would print "unknown" on essentially every machine
    // Riff actually runs on — including every machine that files a bug.
    tauri::webview_version().unwrap_or_else(|_| "unknown".to_owned())
}

#[tauri::command]
pub fn paths_get(store: tauri::State<'_, Arc<SettingsStore>>) -> AppPaths {
    store.paths().clone()
}

#[tauri::command]
pub fn open_path(
    kind: PathKind,
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<SettingsStore>>,
) -> RiffResult<()> {
    let target = kind.resolve(store.paths());
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(target.to_string_lossy(), None::<&str>)
        .map_err(|e| RiffError::Denied {
            what: e.to_string(),
        })
}

#[tauri::command]
pub fn open_external(link: ExternalLink, app: tauri::AppHandle) -> RiffResult<()> {
    // Opening a link hands it to the user's browser. Riff itself makes no
    // network request, which is what "zero network" means.
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(link.url(), None::<&str>)
        .map_err(|e| RiffError::Denied {
            what: e.to_string(),
        })
}

#[tauri::command]
pub fn app_ready(window: tauri::WebviewWindow) -> RiffResult<()> {
    // The last boot phase. Together with the earlier marks this makes the
    // 400 ms startup target from spec §13 falsifiable instead of aspirational.
    tracing::info!(phase = "first-paint", "boot");
    window.show().map_err(|e| RiffError::Denied {
        what: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_kinds_serialise_as_kebab_case_so_the_frontend_can_name_them() {
        assert_eq!(
            serde_json::to_value(PathKind::Config).expect("ser"),
            "config"
        );
        assert_eq!(serde_json::to_value(PathKind::Logs).expect("ser"), "logs");
    }

    #[test]
    fn external_links_are_a_closed_set_not_arbitrary_urls() {
        // The point of the enum is that no caller can supply a URL.
        assert_eq!(
            ExternalLink::Repository.url(),
            "https://github.com/valasme/riff"
        );
        assert_eq!(
            ExternalLink::Issues.url(),
            "https://github.com/valasme/riff/issues"
        );
        assert_eq!(
            ExternalLink::License.url(),
            "https://github.com/valasme/riff/blob/main/LICENSE"
        );
    }

    #[test]
    fn every_path_kind_maps_to_a_real_directory() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let paths = crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.path().join("config")),
                data: Some(tmp.path().join("data")),
            },
        )
        .expect("roots");
        for kind in [
            PathKind::Config,
            PathKind::Data,
            PathKind::Cache,
            PathKind::Logs,
        ] {
            assert!(
                kind.resolve(&paths).is_absolute(),
                "{kind:?} produced a relative path"
            );
        }
    }
}

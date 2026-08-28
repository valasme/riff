//! Third-party notices, read from a bundled resource so About works offline —
//! which, given Riff makes no network requests at all, is the only way it
//! could work.

use tauri::path::BaseDirectory;
use tauri::Manager;

use crate::error::{RiffError, RiffResult};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseEntry {
    pub name: String,
    pub version: String,
    pub license: String,
    pub ecosystem: String,
}

#[tauri::command]
pub fn licenses_get(app: tauri::AppHandle) -> RiffResult<Vec<LicenseEntry>> {
    let path = app
        .path()
        .resolve("third-party-licenses.json", BaseDirectory::Resource)
        .map_err(|e| RiffError::NotFound {
            what: e.to_string(),
        })?;

    let bytes = std::fs::read(&path).map_err(|e| RiffError::io(&path, &e))?;
    serde_json::from_slice(&bytes).map_err(|e| RiffError::parse(&path, &e))
}

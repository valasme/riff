//! Hands the frontend everything it needs before its first line runs.
//!
//! Two jobs, both done in one initialisation script so that `index.html`
//! needs no inline `<script>` — an inline script would force
//! `script-src 'unsafe-inline'` into the CSP, which is exactly the directive
//! worth keeping strict.
//!
//! The window is created hidden and revealed only once the frontend has
//! painted, so a flash of unstyled content is impossible by construction.
//! These attributes still land before React mounts, so the first painted
//! frame is already correct.

use tauri::plugin::TauriPlugin;
use tauri::Wry;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: crate::settings::model::Settings,
    pub paths: crate::paths::AppPaths,
    pub app_info: crate::commands::app::AppInfo,
    /// Set when `settings.json` could not be parsed and was moved aside. It
    /// travels in the payload rather than as an event because recovery
    /// happens before `tauri::Builder` exists — there is nothing to emit to
    /// yet, and emitting later would race the frontend's first render.
    pub recovered_from: Option<std::path::PathBuf>,
}

pub fn render_script(payload: &Bootstrap) -> String {
    let json = serde_json::to_string(payload).unwrap_or_else(|_| "null".to_owned());
    format!(
        r#"window.__RIFF_BOOTSTRAP__ = {json};
(function apply() {{
  var root = document.documentElement;
  if (!root) {{ requestAnimationFrame(apply); return; }}
  var b = window.__RIFF_BOOTSTRAP__;
  var a = (b && b.settings && b.settings.appearance) || {{}};
  root.dataset.theme = a.theme === "light" ? "light" : "dark";
  root.dataset.density = a.density === "compact" ? "compact" : "comfortable";
  root.dataset.contrast = a.highContrast ? "high" : "normal";
  // Also before first paint: without it a user who set "always reduce" still
  // sees the first animation of every launch.
  root.dataset.motion =
    a.reduceMotion === "always" ? "reduced"
    : a.reduceMotion === "never" ? "full"
    : (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full");
  root.style.setProperty("--ui-scale", String(a.uiScale || 1));
}})();"#
    )
}

pub fn init(payload: &Bootstrap) -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("riff-bootstrap")
        .js_init_script(render_script(payload))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Bootstrap {
        let tmp = std::path::PathBuf::from("/tmp/riff-test");
        Bootstrap {
            settings: crate::settings::model::Settings::default(),
            paths: crate::paths::AppPaths {
                config_dir: tmp.join("config"),
                data_dir: tmp.join("data"),
                state_dir: tmp.join("state"),
                cache_dir: tmp.join("cache"),
                log_dir: tmp.join("state/logs"),
                home_dir: tmp.join("home"),
            },
            app_info: crate::commands::app::app_info(),
            recovered_from: None,
        }
    }

    #[test]
    fn the_script_defines_the_global_before_anything_reads_it() {
        let script = render_script(&sample());
        assert!(script.contains("window.__RIFF_BOOTSTRAP__ ="));
        assert!(script.contains("\"theme\":\"dark\""));
    }

    #[test]
    fn the_script_applies_theme_attributes_without_an_inline_html_script() {
        // An inline <script> in index.html would violate `script-src 'self'`.
        // Doing it here keeps the CSP strict.
        let script = render_script(&sample());
        assert!(script.contains("dataset.theme"));
        assert!(script.contains("dataset.density"));
        assert!(script.contains("dataset.contrast"));
        assert!(script.contains("dataset.motion"));
        assert!(script.contains("--ui-scale"));
    }

    #[test]
    fn the_script_is_valid_when_a_path_contains_quotes_or_backslashes() {
        let mut payload = sample();
        payload.paths.config_dir = std::path::PathBuf::from(r#"/tmp/we"ird\path"#);
        let script = render_script(&payload);
        // serde_json escapes it; the raw sequence must not appear unescaped.
        assert!(!script.contains(r#""ird\path"#));
    }
}

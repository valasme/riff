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
    /// What loading the settings file had to do. It travels in the payload
    /// rather than as an event because recovery happens before
    /// `tauri::Builder` exists — there is nothing to emit to yet, and emitting
    /// later would race the frontend's first render.
    pub recovery: Recovery,
}

/// The three states the frontend has to be able to tell apart.
///
/// It used to be an `Option<PathBuf>`, which collapsed "could not keep your
/// file, so writing is off for this session" into "nothing happened" — and
/// the user got the generic write-failure toast instead, the one promising
/// Riff "will try again on the next change". It will not: `write_blocked` is
/// set and every flush returns `Denied` for the rest of the session.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Recovery {
    /// The file was read. Nothing to say.
    None,
    /// It could not be read and was renamed aside; Riff started from defaults
    /// and the original is at `kept`.
    Quarantined { kept: std::path::PathBuf },
    /// It could not be read *and* could not be moved aside, so Riff refuses to
    /// write over it. Every change this session applies in memory and is lost
    /// on exit.
    WriteBlocked { path: std::path::PathBuf },
}

impl Recovery {
    pub fn of(
        outcome: &crate::settings::store::LoadOutcome,
        paths: &crate::paths::AppPaths,
    ) -> Self {
        use crate::settings::store::LoadOutcome;
        match outcome {
            LoadOutcome::Recovered {
                quarantined: Some(kept),
            } => Self::Quarantined { kept: kept.clone() },
            LoadOutcome::Recovered { quarantined: None } => Self::WriteBlocked {
                path: paths.settings_file(),
            },
            _ => Self::None,
        }
    }
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
  // Whitelist, not a chain of ternaries: a hand-edited settings.json can
  // carry any string at all, and the pre-paint frame must not act on it.
  root.dataset.theme = ["dark", "darker", "light"].indexOf(a.theme) >= 0 ? a.theme : "dark";
  root.dataset.density = a.density === "compact" ? "compact" : "comfortable";
  root.dataset.contrast = a.highContrast ? "high" : "normal";
  // Also before first paint: without it a user who set "always reduce" still
  // sees the first animation of every launch. "system" is written as itself
  // rather than resolved against matchMedia here — globals.css answers it,
  // and answering it in JS freezes the desktop's preference at whatever it
  // was during startup. See motionAttribute() in src/lib/appearance.ts.
  root.dataset.motion =
    a.reduceMotion === "always" ? "reduced"
    : a.reduceMotion === "never" ? "full"
    : "system";
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
            recovery: Recovery::None,
        }
    }

    fn paths() -> crate::paths::AppPaths {
        sample().paths
    }

    #[test]
    fn a_file_that_could_not_be_quarantined_tells_the_user_writing_is_off() {
        use crate::settings::store::LoadOutcome;
        // `Recovered { quarantined: None }` used to collapse to the same
        // payload as a clean load, so the only thing the user saw was the
        // generic write-failure toast — which promises Riff will try again on
        // the next change. It will not.
        let blocked = Recovery::of(&LoadOutcome::Recovered { quarantined: None }, &paths());
        assert_eq!(
            blocked,
            Recovery::WriteBlocked {
                path: paths().settings_file()
            },
            "the message has to name the file and say writing is off"
        );
        assert_ne!(blocked, Recovery::None);

        let kept = Recovery::of(
            &LoadOutcome::Recovered {
                quarantined: Some("/c/settings.json.corrupt-x".into()),
            },
            &paths(),
        );
        assert_eq!(
            kept,
            Recovery::Quarantined {
                kept: "/c/settings.json.corrupt-x".into()
            }
        );

        for quiet in [
            LoadOutcome::Fresh,
            LoadOutcome::Loaded,
            LoadOutcome::Migrated { from: 0 },
        ] {
            assert_eq!(Recovery::of(&quiet, &paths()), Recovery::None);
        }
    }

    #[test]
    fn the_script_defines_the_global_before_anything_reads_it() {
        let script = render_script(&sample());
        assert!(script.contains("window.__RIFF_BOOTSTRAP__ ="));
        assert!(script.contains("\"theme\":\"dark\""));
    }

    #[test]
    fn the_script_recognises_every_theme_the_settings_model_allows() {
        // A theme added to the model but not to this script paints one frame
        // of the wrong colours on every launch for whoever picked it.
        let script = render_script(&sample());
        for theme in ["dark", "darker", "light"] {
            assert!(
                script.contains(&format!("\"{theme}\"")),
                "the bootstrap script does not know about the {theme} theme"
            );
        }
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
    fn the_script_leaves_the_system_motion_preference_for_the_stylesheet() {
        // The pre-paint frame and `motionAttribute()` in src/lib/appearance.ts
        // write the same attribute, so they have to agree on what "system"
        // becomes. Resolving it here against matchMedia writes "full" whenever
        // the desktop happens not to want reduced motion at startup — and
        // "full" is what globals.css reads as "the user chose Never", so the
        // desktop's preference could no longer take effect for the rest of the
        // session.
        let script = render_script(&sample());
        assert!(
            !script.contains("prefers-reduced-motion"),
            "the bootstrap script resolves the system motion preference itself; \
             globals.css must be the one that answers it"
        );
        assert!(script.contains(r#": "system";"#));
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

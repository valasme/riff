//! The settings document.
//!
//! Every field carries `#[serde(default)]` so a partial or older file still
//! loads, and every enum deserialises leniently so one unrecognised value
//! costs the user that value alone rather than the entire document.

use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};

pub const CURRENT_VERSION: u32 = 1;
pub const CURRENT_ONBOARDING_VERSION: u32 = 1;

/// Deserialises `T`, falling back to `T::default()` and a warning when the
/// value is not recognised. This is what makes an unknown enum variant a
/// local problem instead of a total load failure.
fn lenient<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    match serde_json::from_value::<T>(raw.clone()) {
        Ok(value) => Ok(value),
        Err(err) => {
            tracing::warn!(%err, %raw, "unrecognised settings value; using the default");
            Ok(T::default())
        }
    }
}

/// Reads a settings document, tolerating a section it cannot understand
/// rather than losing every preference to it. Returns the sections that had to
/// fall back to defaults; an empty list means the document was read whole.
///
/// **Section-level, not field-level and not all-or-nothing.** `lenient` above
/// already rescues a single unrecognised enum value, but it cannot help with a
/// wrong *type* — `"confirmOnQuit": "true"` fails `General` itself, which
/// failed `Settings`, which used to silently revert every setting the user had
/// ever chosen. Falling back per section is the smaller fix: a mistyped
/// `general` costs `general`, not `appearance`. It still costs the whole
/// section, which is exactly why the caller quarantines the file and tells the
/// user rather than treating this as a clean load.
pub fn read(document: serde_json::Value) -> (Settings, Vec<&'static str>) {
    // Read out first, because everything below may replace it with a default
    // and the document is consumed on the way. `completedAt` is not a
    // preference: losing it drops the user back into the welcome wizard, which
    // is the most visible symptom a defaulted load has.
    let completed_at = document
        .pointer("/onboarding/completedAt")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);

    let mut document = document;
    let mut defaulted: Vec<&'static str> = Vec::new();
    if let Some(object) = document.as_object_mut() {
        for (name, readable) in SECTIONS {
            let Some(value) = object.get(name) else {
                continue;
            };
            if readable(value) {
                continue;
            }
            tracing::warn!(
                section = name,
                "settings section is unreadable; using its defaults"
            );
            defaulted.push(name);
            // Removed rather than replaced: every field carries
            // `#[serde(default)]`, so the hole fills itself.
            object.remove(name);
        }
    }

    let mut settings = match serde_json::from_value::<Settings>(document) {
        Ok(settings) => settings,
        Err(err) => {
            // Not a section — the document is not an object at all, or a root
            // scalar like `version` has the wrong type.
            tracing::warn!(%err, "the settings document itself is unreadable; using defaults");
            defaulted.push("the document");
            Settings::default()
        }
    };
    if settings.onboarding.completed_at.is_none() {
        settings.onboarding.completed_at = completed_at;
    }
    (settings, defaulted)
}

fn readable<T: serde::de::DeserializeOwned>(value: &serde_json::Value) -> bool {
    serde_json::from_value::<T>(value.clone()).is_ok()
}

/// Whether a section's own type can read this value.
type Readable = fn(&serde_json::Value) -> bool;

const SECTIONS: [(&str, Readable); 4] = [
    ("general", readable::<General>),
    ("appearance", readable::<Appearance>),
    ("onboarding", readable::<Onboarding>),
    ("practice", readable::<Practice>),
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    #[serde(rename = "$schema")]
    pub schema: String,
    pub version: u32,
    pub general: General,
    pub appearance: Appearance,
    pub onboarding: Onboarding,
    pub practice: Practice,
    /// Keys Riff does not recognise, kept verbatim so a downgrade followed by
    /// an upgrade does not silently delete a newer version's settings.
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema: "./settings.schema.json".to_owned(),
            version: CURRENT_VERSION,
            general: General::default(),
            appearance: Appearance::default(),
            onboarding: Onboarding::default(),
            practice: Practice::default(),
            unknown: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct General {
    /// Keys this build does not recognise. Present on every section, not only
    /// the root: new settings are added *inside* sections, so root-only
    /// preservation would protect exactly the case that never happens and
    /// lose the one that does.
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
    #[serde(deserialize_with = "lenient")]
    pub startup_route: StartupRoute,
    pub last_route: String,
    pub restore_window_state: bool,
    pub confirm_on_quit: bool,
    pub language: String,
}

impl Default for General {
    fn default() -> Self {
        Self {
            startup_route: StartupRoute::Practice,
            last_route: "/practice".to_owned(),
            restore_window_state: true,
            confirm_on_quit: false,
            language: "en".to_owned(),
            unknown: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Appearance {
    /// Keys this build does not recognise. Present on every section, not only
    /// the root: new settings are added *inside* sections, so root-only
    /// preservation would protect exactly the case that never happens and
    /// lose the one that does.
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
    #[serde(deserialize_with = "lenient")]
    pub theme: Theme,
    #[serde(deserialize_with = "lenient")]
    pub density: Density,
    pub ui_scale: UiScale,
    #[serde(deserialize_with = "lenient")]
    pub reduce_motion: ReduceMotion,
    pub high_contrast: bool,
    #[serde(deserialize_with = "lenient")]
    pub title_bar: TitleBar,
    pub sidebar: Sidebar,
    /// How far a rendered score is darkened, so a white page does not glare
    /// in a dark room. A preference — chosen once, about the room and the
    /// monitor and the person — which is why it lives here and not in
    /// `workspace.json` with the view (spec §7, ADR 0004).
    pub score_dim: ScoreDim,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            density: Density::Comfortable,
            ui_scale: UiScale::default(),
            reduce_motion: ReduceMotion::System,
            high_contrast: false,
            title_bar: TitleBar::Custom,
            sidebar: Sidebar::default(),
            score_dim: ScoreDim::default(),
            unknown: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Sidebar {
    pub collapsed: bool,
    pub remember_collapsed: bool,
}

impl Default for Sidebar {
    fn default() -> Self {
        Self {
            collapsed: false,
            remember_collapsed: true,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Onboarding {
    /// RFC 3339. `None` means first run has not been completed.
    pub completed_at: Option<String>,
    pub version: u32,
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
}

/// One of the three regions of Practice. The pane is the thing; whether it
/// currently sits in the grid or in a window of its own is a separate
/// question, answered by `Practice::popped_out`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Pane {
    Score,
    Video,
    Audio,
}

impl Pane {
    pub const ALL: [Self; 3] = [Self::Score, Self::Video, Self::Audio];
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Practice {
    /// Keys this build does not recognise. Present on every section, not only
    /// the root: new settings are added *inside* sections, so root-only
    /// preservation would protect exactly the case that never happens and
    /// lose the one that does.
    #[serde(flatten)]
    #[schemars(skip)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
    /// The panes currently in a window of their own. State rather than a
    /// preference — written as it changes and given no control in Settings,
    /// exactly as `general.last_route` is.
    #[serde(deserialize_with = "lenient_panes")]
    pub popped_out: Vec<Pane>,
}

/// Drops pane identifiers this build does not know and keeps the rest, then
/// deduplicates. The section-wide `lenient` helper cannot do either job: it
/// falls back to `T::default()` for the *whole* value, so one unknown pane
/// written by a newer build would dock the other two back. The dedup is not
/// cosmetic — the list is a set, and two entries for one pane would ask Tauri
/// to build two windows with the same label, which it refuses.
fn lenient_panes<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Pane>, D::Error> {
    let raw = serde_json::Value::deserialize(deserializer)?;
    let Some(items) = raw.as_array() else {
        tracing::warn!(%raw, "practice.poppedOut is not a list; ignoring it");
        return Ok(Vec::new());
    };
    let mut panes = Vec::new();
    for item in items {
        match serde_json::from_value::<Pane>(item.clone()) {
            Ok(pane) => {
                if !panes.contains(&pane) {
                    panes.push(pane);
                }
            }
            Err(err) => tracing::warn!(%err, %item, "unrecognised pane; ignoring it"),
        }
    }
    Ok(panes)
}

macro_rules! kebab_enum {
    ($name:ident { $default:ident, $($variant:ident),* $(,)? }) => {
        #[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
        #[serde(rename_all = "kebab-case")]
        pub enum $name {
            #[default]
            $default,
            $($variant),*
        }
    };
}

kebab_enum!(StartupRoute {
    Practice,
    History,
    LastUsed
});
kebab_enum!(Theme {
    Dark,
    Darker,
    Light
});
kebab_enum!(Density {
    Comfortable,
    Compact
});
kebab_enum!(ReduceMotion {
    System,
    Always,
    Never
});
kebab_enum!(TitleBar { Custom, System });

/// Clamped on the way in, so an out-of-range value in a hand-edited file is
/// corrected rather than rejected.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, JsonSchema)]
pub struct UiScale(f32);

impl UiScale {
    pub const MIN: f32 = 0.8;
    pub const MAX: f32 = 1.5;

    pub fn new(value: f32) -> Self {
        if value.is_finite() {
            Self(value.clamp(Self::MIN, Self::MAX))
        } else {
            Self::default()
        }
    }

    pub fn get(self) -> f32 {
        self.0
    }
}

impl Default for UiScale {
    fn default() -> Self {
        Self(1.0)
    }
}

impl<'de> Deserialize<'de> for UiScale {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        Ok(serde_json::from_value::<f32>(raw)
            .map(Self::new)
            .unwrap_or_default())
    }
}

/// How far a score's rendered page is darkened: 0 is off, 0.4 is as far as
/// Riff will go. Clamped on the way in exactly as `UiScale` is, so an
/// out-of-range value in a hand-edited file is corrected rather than
/// rejected.
///
/// A magnitude, not a mode — which is why there is no separate toggle, and
/// why it does not follow the theme: with a number the user chose, engaging
/// automatically under a dark theme would be fighting them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, JsonSchema)]
pub struct ScoreDim(f32);

impl ScoreDim {
    pub const MIN: f32 = 0.0;
    pub const MAX: f32 = 0.4;

    pub fn new(value: f32) -> Self {
        if value.is_finite() {
            Self(value.clamp(Self::MIN, Self::MAX))
        } else {
            Self::default()
        }
    }

    pub fn get(self) -> f32 {
        self.0
    }
}

impl<'de> Deserialize<'de> for ScoreDim {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        Ok(serde_json::from_value::<f32>(raw)
            .map(Self::new)
            .unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_spec() {
        let s = Settings::default();
        assert_eq!(s.version, CURRENT_VERSION);
        assert_eq!(s.general.startup_route, StartupRoute::Practice);
        assert!(s.general.restore_window_state);
        assert!(!s.general.confirm_on_quit);
        assert_eq!(s.appearance.theme, Theme::Dark);
        assert_eq!(s.appearance.density, Density::Comfortable);
        assert_eq!(s.appearance.ui_scale.get(), 1.0);
        assert!(!s.appearance.high_contrast);
        assert_eq!(s.appearance.title_bar, TitleBar::Custom);
        assert!(s.onboarding.completed_at.is_none());
        assert!(
            s.practice.popped_out.is_empty(),
            "a fresh install has every pane in the grid"
        );
    }

    #[test]
    fn a_practice_section_survives_a_round_trip_with_unknown_keys() {
        // `practice` is state rather than preference, so it is rewritten far
        // more often than any other section — which makes it the likeliest
        // place for an older build to destroy a newer one's key.
        let original = r#"{"version":1,"practice":{"poppedOut":["score"],"pinnedTo":"HDMI-1"}}"#;
        let s: Settings = serde_json::from_str(original).expect("loads");
        assert_eq!(s.practice.popped_out, vec![Pane::Score]);
        let round_tripped = serde_json::to_value(&s).expect("serialises");
        assert_eq!(round_tripped["practice"]["pinnedTo"], "HDMI-1");
        assert_eq!(round_tripped["practice"]["poppedOut"][0], "score");
    }

    #[test]
    fn an_unrecognised_pane_is_dropped_without_costing_the_others() {
        // A downgrade after a build that added a fourth pane. Losing the pane
        // it does not know is correct; losing the two it does is not.
        let s: Settings =
            serde_json::from_str(r#"{"practice":{"poppedOut":["score","metronome","audio"]}}"#)
                .expect("loads");
        assert_eq!(s.practice.popped_out, vec![Pane::Score, Pane::Audio]);
    }

    #[test]
    fn a_partial_file_loads_with_defaults_for_everything_absent() {
        let s: Settings = serde_json::from_str(r#"{"appearance":{"theme":"light"}}"#)
            .expect("partial documents must load");
        assert_eq!(s.appearance.theme, Theme::Light);
        assert_eq!(s.appearance.density, Density::Comfortable);
        assert_eq!(s.general.startup_route, StartupRoute::Practice);
    }

    #[test]
    fn an_unrecognised_enum_value_falls_back_instead_of_failing_the_whole_load() {
        let s: Settings = serde_json::from_str(r#"{"appearance":{"theme":"solarized"}}"#)
            .expect("one bad key must not cost the user every setting");
        assert_eq!(s.appearance.theme, Theme::Dark);
    }

    #[test]
    fn ui_scale_clamps_rather_than_rejecting() {
        let low: Settings =
            serde_json::from_str(r#"{"appearance":{"uiScale":0.1}}"#).expect("loads");
        assert_eq!(low.appearance.ui_scale.get(), 0.8);
        let high: Settings =
            serde_json::from_str(r#"{"appearance":{"uiScale":9.0}}"#).expect("loads");
        assert_eq!(high.appearance.ui_scale.get(), 1.5);
        let junk: Settings =
            serde_json::from_str(r#"{"appearance":{"uiScale":"big"}}"#).expect("loads");
        assert_eq!(junk.appearance.ui_scale.get(), 1.0);
    }

    #[test]
    fn score_dim_clamps_out_of_range_values_rather_than_rejecting_them() {
        let high: Settings =
            serde_json::from_str(r#"{"appearance":{"scoreDim":9.0}}"#).expect("loads");
        assert_eq!(high.appearance.score_dim.get(), 0.4);
        let low: Settings =
            serde_json::from_str(r#"{"appearance":{"scoreDim":-1.0}}"#).expect("loads");
        assert_eq!(low.appearance.score_dim.get(), 0.0);
        let junk: Settings =
            serde_json::from_str(r#"{"appearance":{"scoreDim":"dark"}}"#).expect("loads");
        assert_eq!(junk.appearance.score_dim.get(), 0.0);
    }

    #[test]
    fn dim_is_off_by_default_and_does_not_follow_the_theme() {
        // A magnitude, not a mode: zero means off, so there is no separate
        // toggle — and engaging automatically under a dark theme would be
        // fighting a number the user chose.
        let dark = Settings::default();
        assert_eq!(dark.appearance.theme, Theme::Dark);
        assert_eq!(dark.appearance.score_dim.get(), 0.0);

        let light: Settings =
            serde_json::from_str(r#"{"appearance":{"theme":"light","scoreDim":0.3}}"#)
                .expect("loads");
        assert_eq!(
            light.appearance.score_dim.get(),
            0.3,
            "dim is independent of the theme in both directions"
        );
    }

    #[test]
    fn unknown_keys_inside_a_section_survive_too() {
        // The case that actually happens: a newer build adds
        // `appearance.accentColor`, the user downgrades, and the older build
        // writes the file back. Root-only preservation would destroy it.
        let original = r##"{"version":1,"appearance":{"theme":"light","accentColor":"#ff0000"}}"##;
        let s: Settings = serde_json::from_str(original).expect("loads");
        let round_tripped = serde_json::to_value(&s).expect("serialises");
        assert_eq!(round_tripped["appearance"]["accentColor"], "#ff0000");
        assert_eq!(round_tripped["appearance"]["theme"], "light");
    }

    #[test]
    fn unknown_top_level_keys_survive_a_round_trip() {
        let original = r#"{"version":1,"futureFeature":{"enabled":true}}"#;
        let s: Settings = serde_json::from_str(original).expect("loads");
        let round_tripped = serde_json::to_value(&s).expect("serialises");
        assert_eq!(
            round_tripped["futureFeature"]["enabled"], true,
            "a downgrade must not destroy settings written by a newer version"
        );
    }

    #[test]
    fn serialises_camel_case_with_a_schema_pointer() {
        let json = serde_json::to_value(Settings::default()).expect("serialises");
        assert_eq!(json["$schema"], "./settings.schema.json");
        assert!(json["general"]["startupRoute"].is_string());
        assert!(json["appearance"]["uiScale"].is_number());
    }
}

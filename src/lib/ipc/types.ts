export type Theme = "dark" | "darker" | "light";
export type Density = "comfortable" | "compact";
export type ReduceMotion = "system" | "always" | "never";
export type TitleBarStyle = "custom" | "system";
export type StartupRoute = "practice" | "history" | "last-used";
export type Section = "general" | "appearance" | "onboarding" | "practice";
export type Pane = "score" | "video" | "audio";
export type PathKind = "config" | "data" | "cache" | "logs";
export type ExternalLink = "repository" | "issues" | "license";
export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export interface General {
  startupRoute: StartupRoute;
  lastRoute: string;
  restoreWindowState: boolean;
  confirmOnQuit: boolean;
  language: string;
}

export interface Sidebar {
  collapsed: boolean;
  rememberCollapsed: boolean;
}

export interface Appearance {
  theme: Theme;
  density: Density;
  uiScale: number;
  reduceMotion: ReduceMotion;
  highContrast: boolean;
  titleBar: TitleBarStyle;
  sidebar: Sidebar;
}

export interface Onboarding {
  completedAt: string | null;
  version: number;
}

/**
 * Read, never patched. Rust owns which panes are popped out — a compositor can
 * destroy a pop-out window without the webview hearing about it — so the
 * frontend changes this set through `practicePopOut` and `practiceDockBack`
 * and learns about it through `practice://panes-changed`.
 */
export interface Practice {
  poppedOut: Pane[];
}

/** Two of pdf.js's four `ScrollMode` values — see `CONTEXT.md`'s "View" entry. */
export type ScrollMode = "continuous" | "page";
export type SpreadMode = "none" | "odd" | "even";

/** Free zoom leaves the fit mode rather than fighting it (spec §6). */
export type Scale =
  | { mode: "fit-width" }
  | { mode: "fit-page" }
  | { mode: "custom"; value: number };

/**
 * The six values a pop-out carries with it and a reopen offer restores.
 * Whether auto-scroll is running and whether a page is pinned are
 * deliberately not here — both always start off. See spec §6.4.
 */
export interface View {
  page: number;
  scale: Scale;
  rotation: number;
  spread: SpreadMode;
  scrollMode: ScrollMode;
  autoScrollSpeed: number;
}

/** Never a path — see `workspace::Score` in Rust for why. */
export interface Score {
  name: string;
  size: number;
}

export interface OpenScore {
  score: Score;
  view: View;
}

export interface Settings {
  $schema: string;
  version: number;
  general: General;
  appearance: Appearance;
  onboarding: Onboarding;
  practice: Practice;
}

export interface AppPaths {
  configDir: string;
  dataDir: string;
  stateDir: string;
  cacheDir: string;
  logDir: string;
  /** Carried so the frontend can redact it before anything reaches the clipboard. */
  homeDir: string;
}

export interface AppInfo {
  version: string;
  tauriVersion: string;
  webkitVersion: string;
  buildDate: string;
  gitSha: string;
}

/** Mirrors `diagnostics::health::Severity`. */
export type Severity = "ok" | "warn" | "error";

/** One line of `riff doctor`, for people who never open a terminal. */
export interface HealthCheck {
  id: string;
  title: string;
  severity: Severity;
  detail: string;
  /** Whether `riff repair` knows how to fix this. */
  repairable: boolean;
}

/**
 * What loading `settings.json` had to do. Three states, not two: "could not
 * keep your file, so writing is off" used to collapse into "nothing happened",
 * and the user got the generic write-failure toast promising Riff would try
 * again on the next change. It will not.
 */
export type Recovery =
  | { state: "none" }
  | { state: "quarantined"; kept: string }
  | { state: "writeBlocked"; path: string };

export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  ecosystem: string;
}

export type RiffError =
  | { code: "io"; details: { path: string; message: string } }
  | { code: "parse"; details: { path: string; message: string; line: number | null } }
  | { code: "validation"; details: { field: string; reason: string } }
  | { code: "not-found"; details: { what: string } }
  | { code: "denied"; details: { what: string } }
  | { code: "score-missing"; details: { name: string } }
  // A unit variant: adjacently-tagged serde omits `details` entirely rather
  // than writing `null`, so this arm carries no second field at all.
  | { code: "score-encrypted" }
  | { code: "score-unreadable"; details: { reason: string } };

/** Mirrors the Rust merge patch: every field optional, recursively. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

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
  | { code: "denied"; details: { what: string } };

/** Mirrors the Rust merge patch: every field optional, recursively. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

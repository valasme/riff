export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";
export type ReduceMotion = "system" | "always" | "never";
export type TitleBarStyle = "custom" | "system";
export type StartupRoute = "practice" | "history" | "last-used";
export type Section = "general" | "appearance" | "onboarding";
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

export interface Settings {
  $schema: string;
  version: number;
  general: General;
  appearance: Appearance;
  onboarding: Onboarding;
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

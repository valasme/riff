import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  AppPaths,
  DeepPartial,
  ExternalLink,
  LogLevel,
  PathKind,
  RiffError,
  Section,
  Settings,
} from "./types";

export * from "./types";

export function isRiffError(value: unknown): value is RiffError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code: unknown }).code === "string"
  );
}

/**
 * Every command Riff exposes. Hand-written rather than generated: the
 * Tauri-v2 line of tauri-specta has been a release candidate for twenty-five
 * versions, and a pre-release dependency on this seam is not worth eighty
 * lines. `src-tauri/tests/ipc_shapes.rs` fails if the Rust types drift.
 */
export const ipc = {
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsPatch: (patch: DeepPartial<Settings>) => invoke<Settings>("settings_patch", { patch }),
  settingsReset: (section?: Section) =>
    invoke<Settings>("settings_reset", { section: section ?? null }),
  settingsExport: () => invoke<string | null>("settings_export"),
  settingsImport: () => invoke<Settings | null>("settings_import"),
  pathsGet: () => invoke<AppPaths>("paths_get"),
  openPath: (kind: PathKind) => invoke<void>("open_path", { kind }),
  openExternal: (link: ExternalLink) => invoke<void>("open_external", { link }),
  appInfo: () => invoke<AppInfo>("app_info"),
  appReady: () => invoke<void>("app_ready"),
  diagnosticsExport: () => invoke<string | null>("diagnostics_export"),
  logWrite: (level: LogLevel, message: string, context?: unknown) =>
    invoke<void>("log_write", { level, message, context: context ?? null }),
  windowMinimize: () => invoke<void>("window_minimize"),
  windowToggleMaximize: () => invoke<void>("window_toggle_maximize"),
  windowClose: () => invoke<void>("window_close"),
  windowQuitConfirmed: () => invoke<void>("window_quit_confirmed"),
  windowSetDecorations: (enabled: boolean) =>
    invoke<boolean>("window_set_decorations", { enabled }),
} as const;

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import i18n from "@/app/i18n";
import type {
  AppInfo,
  AppPaths,
  DeepPartial,
  ExternalLink,
  HealthCheck,
  LicenseEntry,
  LogLevel,
  OpenScore,
  Pane,
  PathKind,
  RiffError,
  Score,
  Section,
  Settings,
  View,
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
  diagnosticsCheck: () => invoke<HealthCheck[]>("diagnostics_check"),
  logWrite: (level: LogLevel, message: string, context?: unknown) =>
    invoke<void>("log_write", { level, message, context: context ?? null }),
  licensesGet: () => invoke<LicenseEntry[]>("licenses_get"),
  windowMinimize: () => invoke<void>("window_minimize"),
  windowToggleMaximize: () => invoke<void>("window_toggle_maximize"),
  windowClose: () => invoke<void>("window_close"),
  windowQuitConfirmed: () => invoke<void>("window_quit_confirmed"),
  windowStartDragging: () => invoke<void>("window_start_dragging"),
  /**
   * Each of these answers with the whole popped-out set rather than an
   * acknowledgement: Rust owns it, and a reply saying only "done" would leave
   * the caller guessing at what became of the other two panes.
   */
  practiceState: () => invoke<Pane[]>("practice_state"),
  practicePopOut: (pane: Pane) => invoke<Pane[]>("practice_pop_out", { pane }),
  practiceDockBack: (pane: Pane) => invoke<Pane[]>("practice_dock_back", { pane }),
  practiceDockAll: () => invoke<Pane[]>("practice_dock_all"),
  practiceFocus: (pane: Pane) => invoke<void>("practice_focus", { pane }),
  practicePendingReopen: () => invoke<Pane[]>("practice_pending_reopen"),
  practiceReopen: () => invoke<Pane[]>("practice_reopen"),
  /**
   * Opens the native picker in Rust and never returns a path — only what
   * `score_state` would also answer. `null` means the picker was dismissed.
   */
  scoreOpen: () => invoke<OpenScore | null>("score_open"),
  /**
   * `tauri::ipc::Response` arrives here as a genuine `ArrayBuffer`, not
   * base64 or an array of numbers — `ipc-protocol.js` decodes any non-JSON
   * content type with `.arrayBuffer()`. See ADR 0003.
   */
  scoreBytes: () => invoke<ArrayBuffer>("score_bytes"),
  scoreClose: () => invoke<void>("score_close"),
  scoreState: () => invoke<OpenScore | null>("score_state"),
  scoreViewPatch: (view: View) => invoke<View>("score_view_patch", { view }),
  scorePendingReopen: () => invoke<Score | null>("score_pending_reopen"),
  scoreReopen: () => invoke<OpenScore | null>("score_reopen"),
} as const;

/**
 * The one place a rejected command becomes something the user can see.
 *
 * Every call site used to be `void ipc.x()` or a bare `async` handler with no
 * rejection path, so a failure produced a log line and nothing on screen —
 * including on Import (Rust has a test asserting it rejects a malformed file;
 * the dialog just closed), Export, and Export diagnostics, which is pressed
 * precisely when something is already wrong.
 *
 * `code.unknown` is the floor rather than a missing-key error: Tauri rejects
 * with a bare string when a command panics or does not exist, and that is
 * exactly the case with no `RiffError` to key off.
 *
 * `ipc.logWrite` directly rather than `log.warn`, because `@/lib/logger`
 * imports this module and a cycle here would be a cycle in the module every
 * other module depends on.
 */
export function reportFailure(error: unknown, doing: string): void {
  const code = isRiffError(error) ? error.code : "unknown";
  void ipc.logWrite("warn", `${doing} failed`, { code, error: String(error) }).catch(() => {});
  toast.error(i18n.t(`errors:code.${code}`, { defaultValue: i18n.t("errors:code.unknown") }));
}

/**
 * `void ipc.x()` with a voice. Wraps a fire-and-forget call so a rejection
 * raises the toast above instead of vanishing.
 */
export function fire(promise: Promise<unknown>, doing: string): void {
  void promise.catch((error: unknown) => reportFailure(error, doing));
}

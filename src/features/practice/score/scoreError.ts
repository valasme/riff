import { isRiffError, type RiffError } from "@/lib/ipc";

export type ScoreLoadFailure =
  | { kind: "riff"; error: RiffError }
  | { kind: "unsupportedWebkit"; installed: string; required: string }
  | { kind: "renderer"; details: string };

/**
 * Localises a `RiffError`'s code — shared by `PracticePane` (the picker and
 * a failed drop) and `ScoreViewer` (a failed load), so the three surfaces
 * that can report "this score would not open" agree on the same message for
 * the same code.
 */
export function scoreErrorMessage(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (isRiffError(error)) {
    return t(`errors:code.${error.code}`, { defaultValue: t("errors:code.unknown") });
  }
  return t("errors:code.unknown");
}

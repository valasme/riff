import type { Onboarding, Theme } from "@/lib/ipc";

/**
 * Bump this to present onboarding again to existing users after adding a step
 * worth showing them. Exported because the root route's guard needs it too.
 */
export const ONBOARDING_VERSION = 1;

/**
 * A version LOWER than current re-presents onboarding — that is how a new
 * step is introduced to existing users. A version HIGHER is left alone: a
 * downgraded install must not force a wizard the user already finished.
 */
export function shouldShowOnboarding(onboarding: Onboarding, currentVersion: number): boolean {
  if (onboarding.completedAt === null) return true;
  return onboarding.version < currentVersion;
}

/**
 * A suggestion only. Riff has no System theme (the user answers once), but
 * opening the theme step already matching their desktop is a courtesy.
 */
export function preferredTheme(): Theme {
  if (typeof matchMedia !== "function") return "dark";
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

import type { Appearance, ReduceMotion } from "@/lib/ipc";

const SCALE_MIN = 0.8;
const SCALE_MAX = 1.5;

/**
 * `system` defers to the desktop's `prefers-reduced-motion`, which is an
 * unambiguous accessibility declaration made on the user's behalf. Theme has
 * no equivalent System option on purpose: colour scheme is a taste question
 * the user already answered during onboarding.
 */
export function resolveMotion(preference: ReduceMotion): "reduced" | "full" {
  if (preference === "always") return "reduced";
  if (preference === "never") return "full";
  const prefersReduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return prefersReduced ? "reduced" : "full";
}

/**
 * The single place appearance settings become DOM state. The same four
 * attributes are written by the Rust bootstrap script before React mounts,
 * so the first painted frame already matches.
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  root.dataset.theme = appearance.theme;
  root.dataset.density = appearance.density;
  root.dataset.contrast = appearance.highContrast ? "high" : "normal";
  root.dataset.motion = resolveMotion(appearance.reduceMotion);

  const scale = Number.isFinite(appearance.uiScale)
    ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, appearance.uiScale))
    : 1;
  root.style.setProperty("--ui-scale", String(scale));
}

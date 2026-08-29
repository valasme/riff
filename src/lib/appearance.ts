import type { Appearance, ReduceMotion } from "@/lib/ipc";

const SCALE_MIN = 0.8;
const SCALE_MAX = 1.5;

/**
 * `system` defers to the desktop's `prefers-reduced-motion`, which is an
 * unambiguous accessibility declaration made on the user's behalf. Theme has
 * no equivalent System option on purpose: colour scheme is a taste question
 * the user already answered during onboarding.
 *
 * System is passed through rather than answered here, and that is the whole
 * point. Reading `matchMedia` and writing the result froze the answer at the
 * value the desktop happened to hold during startup: turn reduced motion on
 * in the desktop's accessibility settings while Riff is running and nothing
 * changed until the next launch, because `data-motion="full"` is exactly what
 * globals.css's `:root:not([data-motion="full"])` guard reads as "the user
 * said no". Deferring means deferring — the media query in globals.css
 * decides, and it re-decides the moment the desktop does.
 */
export function motionAttribute(preference: ReduceMotion): "reduced" | "full" | "system" {
  if (preference === "always") return "reduced";
  if (preference === "never") return "full";
  return "system";
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
  root.dataset.motion = motionAttribute(appearance.reduceMotion);

  const scale = Number.isFinite(appearance.uiScale)
    ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, appearance.uiScale))
    : 1;
  root.style.setProperty("--ui-scale", String(scale));
}

import type { StartupRoute } from "@/lib/ipc";

const FALLBACK = "/practice";

/**
 * `lastRoute` is validated rather than trusted. It can hold `/onboarding`,
 * which would drop the user into a wizard they already finished on every
 * launch, or a route an update removed.
 */
export function resolveStartupRoute(
  preference: StartupRoute,
  lastRoute: string,
  knownRoutes: readonly string[],
): string {
  if (preference === "practice") return "/practice";
  if (preference === "history") return "/history";
  if (lastRoute === "/onboarding" || !knownRoutes.includes(lastRoute)) return FALLBACK;
  return lastRoute;
}

import { createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";

/**
 * Hash history, not browser history. Tauri's asset protocol serves no SPA
 * fallback, so reloading on a deep path like /settings/general would 404.
 * The URL is never visible — the window has no address bar.
 */
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

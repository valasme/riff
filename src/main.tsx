import "@/styles/globals.css";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { Providers } from "@/app/providers";
import { router } from "@/app/router";
import { ipc } from "@/lib/ipc";
import { installGlobalErrorHandlers } from "@/lib/logger";

// First statement, before the render: a crash in React's first paint must
// still leave a trace, and that trace can only exist if these are wired up
// before anything has a chance to throw.
installGlobalErrorHandlers();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </React.StrictMode>,
);

// Reveal the window once the initial render has committed. `requestAnimationFrame`
// never fires here: it is scheduled against the display's refresh cycle, and a
// window created with `visible: false` has none until something shows it, so it
// would always fall through to the Rust watchdog instead of the fast path it
// exists for. A microtask after the synchronous initial render is the earliest
// point that does not depend on the window already being visible.
queueMicrotask(() => {
  void ipc.appReady().catch(() => {});
});

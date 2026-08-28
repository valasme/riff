import "@/styles/globals.css";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import ReactDOM from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <div id="app-root" className="flex" />
  </React.StrictMode>,
);

// Reveal the window once the initial render has committed. `requestAnimationFrame`
// never fires here: it is scheduled against the display's refresh cycle, and a
// window created with `visible: false` has none until something shows it, so it
// would always fall through to the Rust watchdog instead of the fast path it
// exists for. A microtask after the synchronous initial render is the earliest
// point that does not depend on the window already being visible.
queueMicrotask(() => {
  void invoke("app_ready").catch(() => {});
});

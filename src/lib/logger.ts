import type { LogLevel } from "@/lib/ipc";
import { ipc } from "@/lib/ipc";

/**
 * The frontend's only way onto disk. Without this, a React crash before any
 * Rust command runs leaves no trace anywhere a bug report can find — so every
 * write swallows its own failure rather than letting a broken bridge turn a
 * warning into a crash.
 */
async function write(level: LogLevel, message: string, context?: unknown): Promise<void> {
  if (import.meta.env.DEV) {
    const method = level === "error" || level === "warn" ? level : "log";
    console[method](`[${level}]`, message, context ?? "");
  }
  try {
    await ipc.logWrite(level, message, context);
  } catch {
    // The bridge itself failing must not raise further — there is nowhere
    // left to report it.
  }
}

export const log = {
  error: (message: string, context?: unknown) => write("error", message, context),
  warn: (message: string, context?: unknown) => write("warn", message, context),
  info: (message: string, context?: unknown) => write("info", message, context),
  debug: (message: string, context?: unknown) => write("debug", message, context),
};

let installed = false;

/** Called once, before the first render, so nothing crashes silently. */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    void log.error(event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason);
    void log.error(message, { reason: String(reason) });
  });
}

import { ChevronRight, ClipboardCopy, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { WindowControls } from "@/features/window/WindowControls";
import { isInCrashLoop, recordCrash, requestSafeMode } from "@/lib/crash-loop";
import { fire, ipc, isRiffError } from "@/lib/ipc";
import { log } from "@/lib/logger";
import { redact } from "@/lib/redact";
import { useTitleBarStyle } from "@/stores/settings";

export function RouteError({ error }: { error: unknown }) {
  const { t } = useTranslation("errors");
  const code = isRiffError(error) ? error.code : "unknown";
  const raw = error instanceof Error ? error.stack : JSON.stringify(error, null, 2);
  // `homeDir` is read straight off the bootstrap payload rather than through
  // the store: this screen exists because something in the application has
  // already thrown, and the one thing it must not do is depend on more of it.
  const home = window.__RIFF_BOOTSTRAP__?.paths.homeDir ?? "";
  const detail = redact(String(raw), home);

  // A deterministic crash is Reload → crash → Reload with no way out, and the
  // second one is where that becomes obvious.
  //
  // Counted in a layout effect behind a ref, not in a `useState` initialiser.
  // StrictMode double-invokes an initialiser, so the very first crash counted
  // as two and offered the escape hatch instead of Reload — which is the right
  // first answer. StrictMode also runs the effect twice, but it preserves refs
  // across that simulated remount, which is what makes the guard hold. A
  // *layout* effect so the decision lands before the browser paints, rather
  // than swapping the button out a frame later.
  const [looping, setLooping] = useState(false);
  const counted = useRef(false);
  useLayoutEffect(() => {
    if (counted.current) return;
    counted.current = true;
    setLooping(isInCrashLoop(recordCrash()));
  }, []);

  // A route render throwing is exactly the kind of failure a bug report
  // needs on disk — the boundary catching it is not itself a trace.
  useEffect(() => {
    void log.error(error instanceof Error ? error.message : String(error), { code, detail });
  }, [error, code, detail]);

  return (
    // `h-screen` and its own scroll container, not `h-full`. `#root` has no
    // height of its own, so `h-full` collapsed this to its content — and with
    // `body { overflow: hidden }` the buttons went off-screen entirely in a
    // pop-out at its 360x320 minimum and at 1.5x UI scale, which is to say on
    // the two windows most likely to be showing it.
    <div role="alert" className="flex h-screen flex-col bg-surface text-foreground">
      <CrashChrome />
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-6">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 text-center">
          <span className="grid size-11 place-items-center rounded-full border border-line bg-card text-muted-foreground">
            <TriangleAlert size={20} aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold">{t("title")}</h1>
            <p className="mt-2 text-[0.9375rem] text-muted-foreground">
              {t(`code.${code}`, { defaultValue: t("code.unknown") })}
            </p>
            {looping && (
              <p className="mt-3 text-[0.8125rem] text-muted-foreground">{t("crashLoop")}</p>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {looping ? (
              <Button onClick={startWithDefaults}>
                <RefreshCw aria-hidden />
                {t("startWithDefaults")}
              </Button>
            ) : (
              <Button onClick={() => window.location.reload()}>
                <RefreshCw aria-hidden />
                {t("reload")}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => fire(ipc.openPath("logs"), "opening the log folder")}
            >
              <FolderOpen aria-hidden />
              {t("openLogs")}
            </Button>
            <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(detail)}>
              <ClipboardCopy aria-hidden />
              {t("copyErrorDetails")}
            </Button>
          </div>
          <details className="group/details w-full text-start">
            <summary className="flex list-none items-center gap-1.5 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight
                size={14}
                aria-hidden
                className="transition-transform duration-[var(--motion-fast)] ease-(--ease-standard) group-open/details:rotate-90 rtl:-scale-x-100"
              />
              {t("technicalDetails")}
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto overscroll-contain rounded-[var(--radius-control)] border border-line bg-card p-3 font-mono text-xs">
              {detail}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

/**
 * The window controls, because the boundary replaces the whole layout and the
 * title bar goes with it. `decorations: false` is baked into tauri.conf.json,
 * so a crash screen without these is a window that cannot be moved, minimised
 * or closed from inside itself — which is the wrong thing to hand someone
 * whose application has just crashed.
 */
function CrashChrome() {
  const titleBar = useTitleBarStyle();
  if (titleBar !== "custom") return null;

  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--spacing-titlebar)] shrink-0 items-center justify-end border-b border-line bg-surface px-2"
    >
      <WindowControls />
    </header>
  );
}

function startWithDefaults() {
  requestSafeMode();
  // Hash history keeps the route across a reload, so a screen that throws on
  // render would be walked straight back into.
  window.location.hash = "#/practice";
  window.location.reload();
}

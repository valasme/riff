import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { OpenScore } from "@/lib/ipc";
import { useScore } from "@/stores/score";
import { ScoreViewer } from "./ScoreViewer";
import type { ScoreLoadFailure } from "./scoreError";
import { scoreErrorMessage } from "./scoreError";

const SLOW_AFTER_MS = 10_000;

export function ScoreSurface({ open }: { open: OpenScore }) {
  const { t } = useTranslation(["common", "errors"]);
  const openAnother = useScore((state) => state.openFromPicker);
  const close = useScore((state) => state.close);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [failure, setFailure] = useState<ScoreLoadFailure | null>(null);
  const firstPagePainted = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by score generation intentionally
  useEffect(() => {
    setAttempt(0);
    setSlow(false);
    setFailure(null);
  }, [open.generation]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: every retry gets a fresh slow-loading timer
  useEffect(() => {
    firstPagePainted.current = false;
    setSlow(false);
    const timer = window.setTimeout(() => {
      if (!firstPagePainted.current) setSlow(true);
    }, SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [open.generation, attempt]);

  if (failure) {
    const message =
      failure.kind === "riff"
        ? scoreErrorMessage(failure.error, (key, options) => t(key, options))
        : failure.kind === "unsupportedWebkit"
          ? `WebKitGTK ${failure.installed} is unsupported; ${failure.required} or newer is required.`
          : failure.details;
    return (
      <div className="grid flex-1 place-items-center p-6 text-center" role="alert">
        <div className="flex max-w-[36rem] flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">{message}</p>
          {failure.kind !== "unsupportedWebkit" && (
            <Button
              onClick={() => {
                setFailure(null);
                setAttempt((value) => value + 1);
              }}
            >
              {t("retry")}
            </Button>
          )}
          <Button variant="outline" onClick={() => void openAnother()}>
            {t("paneActions.openScore")}
          </Button>
          <Button variant="ghost" onClick={() => void close(open.generation)}>
            {t("paneActions.closeScore")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ScoreViewer
        key={`${open.generation}:${attempt}`}
        open={open}
        onLoadError={(message) => setFailure({ kind: "renderer", details: message })}
        onFirstPagePaint={() => {
          firstPagePainted.current = true;
          setSlow(false);
        }}
      />
      {slow && (
        <div
          className="absolute inset-x-3 top-3 z-10 rounded border border-line bg-card p-3 text-sm"
          role="status"
        >
          {t("score.slowLoading")}
        </div>
      )}
    </div>
  );
}

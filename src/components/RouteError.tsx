import { ChevronRight, ClipboardCopy, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ipc, isRiffError } from "@/lib/ipc";
import { log } from "@/lib/logger";

export function RouteError({ error }: { error: unknown }) {
  const { t } = useTranslation("errors");
  const code = isRiffError(error) ? error.code : "unknown";
  const detail = error instanceof Error ? error.stack : JSON.stringify(error, null, 2);

  // A route render throwing is exactly the kind of failure a bug report
  // needs on disk — the boundary catching it is not itself a trace.
  useEffect(() => {
    void log.error(error instanceof Error ? error.message : String(error), { code, detail });
  }, [error, code, detail]);

  return (
    <div role="alert" className="grid h-full place-items-center p-8">
      <div className="flex w-full max-w-lg flex-col items-center gap-5 text-center">
        <span className="grid size-11 place-items-center rounded-full border border-line bg-card text-muted-foreground">
          <TriangleAlert size={20} aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">
            {t(`code.${code}`, { defaultValue: t("code.unknown") })}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden />
            {t("reload")}
          </Button>
          <Button variant="secondary" onClick={() => void ipc.openPath("logs")}>
            <FolderOpen aria-hidden />
            {t("openLogs")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void navigator.clipboard?.writeText(String(detail))}
          >
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
          <pre className="mt-2 max-h-64 overflow-auto rounded-[var(--radius-control)] border border-line bg-card p-3 font-mono text-xs">
            {detail}
          </pre>
        </details>
      </div>
    </div>
  );
}

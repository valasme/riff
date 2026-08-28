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
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground">
        {t(`code.${code}`, { defaultValue: t("code.unknown") })}
      </p>
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>{t("reload")}</Button>
        <Button variant="secondary" onClick={() => void ipc.openPath("logs")}>
          {t("openLogs")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void navigator.clipboard.writeText(String(detail))}
        >
          {t("copyErrorDetails")}
        </Button>
      </div>
      <details className="max-w-full">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          {t("technicalDetails")}
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-raised p-3 font-mono text-xs">
          {detail}
        </pre>
      </details>
    </div>
  );
}

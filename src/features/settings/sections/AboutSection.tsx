import { Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/features/settings/SettingRow";
import { ipc, type LicenseEntry } from "@/lib/ipc";
import { MIT_LICENSE } from "@/lib/license";
import { useSettings } from "@/stores/settings";

export function AboutSection() {
  const { t } = useTranslation(["settings", "common"]);
  const appInfo = useSettings((s) => s.appInfo);
  const [licenses, setLicenses] = useState<LicenseEntry[] | null>(null);

  const rows: [string, string][] = [
    [t("settings:about.version"), appInfo.version],
    [t("settings:about.tauri"), appInfo.tauriVersion],
    [t("settings:about.webkit"), appInfo.webkitVersion],
    [t("settings:about.buildDate"), appInfo.buildDate],
    [t("settings:about.commit"), appInfo.gitSha],
  ];

  return (
    <section className="py-2">
      <dl className="border-b border-separator py-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-1">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="flex items-center gap-2 font-mono text-xs">
              {value}
              {/* §8.5 says each of these is copyable. One bulk button is not
                  the same affordance as being able to grab the version. */}
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("settings:about.copyValue", { label })}
                onClick={() => {
                  void navigator.clipboard?.writeText(value);
                  toast.success(t("common:copied"));
                }}
              >
                <Copy size={14} aria-hidden />
              </Button>
            </dd>
          </div>
        ))}
      </dl>

      {/* The full text, in the application. Linking to GitHub for it would
          be a network round trip in an application whose first promise is
          that it makes none. */}
      <details className="border-b border-separator py-4">
        <summary className="cursor-pointer text-[0.9375rem] font-medium">
          {t("settings:about.license")}
        </summary>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">
          {t("settings:about.licenseBody")}
        </p>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-raised p-3 font-mono text-xs">
          {MIT_LICENSE}
        </pre>
      </details>

      {/* Several hundred entries mounted at once would be the only place in
          this application capable of janking, so the list only renders once
          expanded, and is fetched exactly once. */}
      <details
        className="border-b border-separator py-4"
        onToggle={(e) => {
          if (e.currentTarget.open && licenses === null) void ipc.licensesGet().then(setLicenses);
        }}
      >
        <summary className="cursor-pointer text-[0.9375rem] font-medium">
          {t("settings:about.thirdParty")}
        </summary>
        <ul className="mt-3 max-h-80 overflow-auto">
          {licenses?.map((entry) => (
            <li
              key={`${entry.ecosystem}-${entry.name}`}
              className="flex justify-between gap-4 py-1"
            >
              <span className="font-mono text-xs">
                {entry.name}@{entry.version}
              </span>
              <span className="text-xs text-muted-foreground">{entry.license}</span>
            </li>
          ))}
        </ul>
      </details>

      <SettingRow label={t("settings:about.repository")} description={t("settings:about.privacy")}>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void ipc.openExternal("repository")}>
            {t("settings:about.repository")}
          </Button>
          <Button variant="secondary" onClick={() => void ipc.openExternal("issues")}>
            {t("settings:about.issues")}
          </Button>
        </div>
      </SettingRow>

      <SettingRow
        label={t("settings:about.exportDiagnostics.label")}
        description={t("settings:about.exportDiagnostics.description")}
      >
        <Button
          variant="secondary"
          onClick={async () => {
            const path = await ipc.diagnosticsExport();
            if (path) toast.success(t("settings:about.exportDiagnostics.done", { path }));
          }}
        >
          {t("settings:about.exportDiagnostics.action")}
        </Button>
      </SettingRow>
    </section>
  );
}

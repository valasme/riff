import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/features/settings/SettingRow";
import { ipc } from "@/lib/ipc";
import { MIT_LICENSE } from "@/lib/license";
import { useSettings } from "@/stores/settings";

/**
 * Diagnostics are meant to be pasted into a public issue, so the home
 * directory — which carries the user's account name — is replaced. A
 * privacy-first application should not leak identity through its own
 * bug-report affordance.
 */
function redactHome(text: string, home: string): string {
  return home ? text.split(home).join("$HOME") : text;
}

export function AboutSection() {
  const { t } = useTranslation(["settings", "common"]);
  const appInfo = useSettings((s) => s.appInfo);
  const paths = useSettings((s) => s.paths);

  const rows: [string, string][] = [
    [t("settings:about.version"), appInfo.version],
    [t("settings:about.tauri"), appInfo.tauriVersion],
    [t("settings:about.webkit"), appInfo.webkitVersion],
    [t("settings:about.buildDate"), appInfo.buildDate],
    [t("settings:about.commit"), appInfo.gitSha],
  ];

  function copyDiagnostics() {
    // Rust carries the real home directory. Deriving it by stripping
    // "/.config/riff" from configDir silently fails under XDG_CONFIG_HOME or
    // RIFF_CONFIG_HOME, and then dataDir and logDir keep the account name —
    // a leak in the one affordance whose whole purpose is preventing it.
    const home = paths.homeDir;
    const report = [
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "",
      `Config: ${paths.configDir}`,
      `Data:   ${paths.dataDir}`,
      `Cache:  ${paths.cacheDir}`,
      `Logs:   ${paths.logDir}`,
    ].join("\n");

    void navigator.clipboard.writeText(redactHome(report, home));
    toast.success(t("common:copied"));
  }

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
        label={t("settings:about.copyDiagnostics")}
        description={t("settings:about.privacy")}
      >
        <Button variant="secondary" onClick={copyDiagnostics}>
          {t("settings:about.copyDiagnostics")}
        </Button>
      </SettingRow>
    </section>
  );
}

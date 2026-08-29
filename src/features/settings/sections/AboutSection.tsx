import { ChevronRight, Copy, ExternalLink, FileDown } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingRow, SettingsGroup } from "@/features/settings/SettingRow";
import { ipc, type LicenseEntry } from "@/lib/ipc";
import { MIT_LICENSE } from "@/lib/license";
import { useSettings } from "@/stores/settings";

export function AboutSection() {
  const { t } = useTranslation(["settings", "common"]);
  const appInfo = useSettings((s) => s.appInfo);
  const [licenses, setLicenses] = useState<LicenseEntry[] | null>(null);
  const [query, setQuery] = useState("");

  const rows: [string, string][] = [
    [t("settings:about.version"), appInfo.version],
    [t("settings:about.tauri"), appInfo.tauriVersion],
    [t("settings:about.webkit"), appInfo.webkitVersion],
    [t("settings:about.buildDate"), appInfo.buildDate],
    [t("settings:about.commit"), appInfo.gitSha],
  ];

  function copy(value: string) {
    void navigator.clipboard?.writeText(value);
    toast.success(t("common:copied"));
  }

  const matches = useMemo(() => {
    if (!licenses) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return licenses;
    return licenses.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) || entry.license.toLowerCase().includes(needle),
    );
  }, [licenses, query]);

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <SettingsGroup title={t("settings:about.groups.build")}>
        <dl className="divide-y divide-separator">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center gap-4 px-4 py-2">
              <dt className="w-28 shrink-0 text-[0.8125rem] text-muted-foreground">{label}</dt>
              <dd className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <code dir="ltr" className="truncate font-mono text-xs">
                  {value}
                </code>
                {/* §8.5 says each of these is copyable. One bulk button is not
                    the same affordance as being able to grab the version. */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("settings:about.copyValue", { label })}
                  onClick={() => copy(value)}
                >
                  <Copy aria-hidden />
                </Button>
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end border-t border-separator px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copy(rows.map(([label, value]) => `${label}: ${value}`).join("\n"))}
          >
            <Copy aria-hidden />
            {t("settings:about.copyAll")}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settings:about.groups.legal")}>
        {/* The full text, in the application. Linking to GitHub for it would
            be a network round trip in an application whose first promise is
            that it makes none. */}
        <Disclosure summary={t("settings:about.license")}>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("settings:about.licenseBody")}
          </p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-[var(--radius-control)] border border-line bg-hover p-3 font-mono text-xs whitespace-pre-wrap">
            {MIT_LICENSE}
          </pre>
        </Disclosure>

        {/* Several hundred entries mounted at once would be the only place in
            this application capable of janking, so the list only renders once
            expanded, and is fetched exactly once. */}
        <Disclosure
          summary={t("settings:about.thirdParty")}
          badge={
            licenses ? t("settings:about.thirdPartyCount", { count: licenses.length }) : undefined
          }
          onToggle={(open) => {
            if (open && licenses === null) void ipc.licensesGet().then(setLicenses);
          }}
        >
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("settings:about.thirdPartySearch")}
            placeholder={t("settings:about.thirdPartySearch")}
          />
          {matches.length === 0 && licenses !== null ? (
            <p className="py-6 text-center text-[0.8125rem] text-muted-foreground">
              {t("settings:about.thirdPartyEmpty")}
            </p>
          ) : (
            <ul className="mt-3 max-h-80 divide-y divide-separator overflow-auto">
              {matches.map((entry) => (
                <li
                  key={`${entry.ecosystem}-${entry.name}`}
                  className="flex items-center justify-between gap-4 py-1.5"
                >
                  <span className="truncate font-mono text-xs">
                    {entry.name}@{entry.version}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{entry.license}</span>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      </SettingsGroup>

      <SettingsGroup title={t("settings:about.groups.support")}>
        <SettingRow
          label={t("settings:about.links.label")}
          description={t("settings:about.links.description")}
        >
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void ipc.openExternal("repository")}>
              <ExternalLink aria-hidden />
              {t("settings:about.repository")}
            </Button>
            <Button variant="secondary" onClick={() => void ipc.openExternal("issues")}>
              <ExternalLink aria-hidden />
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
            <FileDown aria-hidden />
            {t("settings:about.exportDiagnostics.action")}
          </Button>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

/**
 * `<details>` rather than a hand-rolled button with `aria-expanded`: the
 * native element already announces its state, already toggles on Enter and
 * Space, and already survives Ctrl+F in browsers that search collapsed
 * content. Only the marker is replaced, because the platform triangle is the
 * one piece of it that does not match the design.
 */
function Disclosure({
  summary,
  badge,
  onToggle,
  children,
}: {
  summary: string;
  badge?: string;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="group/disclosure border-b border-separator last:border-b-0"
      onToggle={(e) => onToggle?.(e.currentTarget.open)}
    >
      <summary className="flex list-none items-center gap-2 px-4 py-3 text-[0.9375rem] font-medium transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:bg-hover [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={15}
          aria-hidden
          className="shrink-0 text-muted-foreground transition-transform duration-[var(--motion-fast)] ease-(--ease-standard) group-open/disclosure:rotate-90 rtl:-scale-x-100"
        />
        <span>{summary}</span>
        {badge && <span className="ms-auto text-xs text-muted-foreground">{badge}</span>}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

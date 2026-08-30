import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  FileDown,
  Stethoscope,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingRow, SettingsGroup } from "@/features/settings/SettingRow";
import { type HealthCheck, ipc, type LicenseEntry, type Severity } from "@/lib/ipc";
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
          <pre className="mt-3 max-h-64 overflow-auto overscroll-contain rounded-[var(--radius-control)] border border-line bg-hover p-3 font-mono text-xs whitespace-pre-wrap">
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
            // `pe-2.5` is the scrollbar's own 0.625rem, reserved by hand.
            // WebKitGTK draws overlay scrollbars, which take no layout space,
            // so the right-aligned licence name ran underneath the bar and
            // lost its last few characters. `scrollbar-gutter: stable` is the
            // property for exactly this and is a no-op here — the engine
            // reports support and still reserves nothing, because the spec
            // exempts overlay scrollbars — so the gutter has to be padding.
            // `overscroll-contain` keeps the settings pane still once this
            // list reaches an end, rather than handing it the leftover scroll.
            <ul className="mt-3 max-h-80 divide-y divide-separator overflow-auto overscroll-contain pe-2.5">
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

      <SettingsGroup title={t("settings:about.groups.health")}>
        <SettingRow
          label={t("settings:about.health.label")}
          description={t("settings:about.health.description")}
          stacked
        >
          <HealthReport />
        </SettingRow>
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
 * `riff doctor`, in the application. Run on request rather than on mount: the
 * checks stat several directories, and About is opened far more often to read
 * a version number than to diagnose anything.
 *
 * Three states, not two — a failed run must not read as a clean bill of
 * health, which is exactly the mistake this whole plan is about.
 */
function HealthReport() {
  const { t } = useTranslation(["settings", "common"]);
  const [state, setState] = useState<"idle" | "running" | "failed">("idle");
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);

  async function run() {
    setState("running");
    try {
      setChecks(await ipc.diagnosticsCheck());
      setState("idle");
    } catch {
      setChecks(null);
      setState("failed");
    }
  }

  const healthy = checks?.every((check) => check.severity === "ok") ?? false;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="secondary" disabled={state === "running"} onClick={() => void run()}>
          <Stethoscope aria-hidden />
          {state === "running"
            ? t("settings:about.health.checking")
            : checks || state === "failed"
              ? t("settings:about.health.rerun")
              : t("settings:about.health.action")}
        </Button>
      </div>

      {state === "failed" && (
        <p role="alert" className="text-[0.8125rem] font-medium">
          {t("settings:about.health.failed")}
        </p>
      )}

      {checks && (
        <>
          {healthy && (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t("settings:about.health.allOk")}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {checks.map((check) => (
              <li
                key={check.id}
                className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-hover px-3 py-2"
              >
                <SeverityGlyph
                  severity={check.severity}
                  label={t(`settings:about.health.severity.${check.severity}`)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] font-medium">{check.title}</p>
                  <p
                    className={
                      check.severity === "ok"
                        ? "text-xs text-muted-foreground"
                        : "text-xs text-foreground"
                    }
                  >
                    {check.detail}
                  </p>
                  {check.repairable && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("settings:about.health.repairable")}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Shape and a label, not colour. There is no red in Riff's palette — the
 * destructive button is monochrome for the same reason — so severity is
 * carried by the glyph and by `aria-label`, which is what a screen reader and
 * a colour-blind reader both get either way.
 */
function SeverityGlyph({ severity, label }: { severity: Severity; label: string }) {
  const Icon = severity === "ok" ? CircleCheck : severity === "warn" ? TriangleAlert : CircleAlert;
  return (
    <span
      className={`mt-0.5 shrink-0 ${severity === "ok" ? "text-muted-foreground" : "text-foreground"}`}
    >
      <Icon size={15} aria-label={label} />
    </span>
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

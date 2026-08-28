import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { router } from "@/app/router";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import { ipc, type Theme } from "@/lib/ipc";
import { PATH_KINDS, pathFor } from "@/lib/paths";
import { resolveStartupRoute } from "@/lib/startup-route";
import { useSettings } from "@/stores/settings";
import { ONBOARDING_VERSION, preferredTheme } from "./gate";

const STEPS = ["welcome", "theme", "privacy"] as const;

export function OnboardingFlow() {
  const { t } = useTranslation(["onboarding", "common", "settings"]);
  const navigate = useNavigate();
  const patch = useSettings((s) => s.patch);
  const paths = useSettings((s) => s.paths);
  const [index, setIndex] = useState(0);
  const [theme, setTheme] = useState<Theme>(preferredTheme);

  // Applied on arrival, so the step opens already looking like the
  // recommendation rather than describing it. Runs only when the step
  // changes — choosing a card calls choose() directly instead — so patch
  // and theme are deliberately absent from the dependency list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    if (STEPS[index] === "theme") void patch({ appearance: { theme } });
  }, [index]);

  function choose(next: Theme) {
    setTheme(next);
    void patch({ appearance: { theme: next } });
  }

  async function finish() {
    await patch({
      appearance: { theme },
      onboarding: { completedAt: new Date().toISOString(), version: ONBOARDING_VERSION },
    });
    // §8.2: routes to `general.startupRoute`, not a hardcoded /practice. It
    // is /practice by default, so this only differs for someone who imported
    // settings before finishing — but that is the case a hardcoded route gets
    // wrong, and the guard would immediately bounce them anyway.
    const { startupRoute, lastRoute } = useSettings.getState().settings.general;
    navigate({ to: resolveStartupRoute(startupRoute, lastRoute, Object.keys(router.routesById)) });
  }

  const step = STEPS[index];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <p className="font-mono text-xs text-muted-foreground">
        {t("onboarding:step", { current: index + 1, total: STEPS.length })}
      </p>

      <div className="w-full max-w-2xl text-center">
        {step === "welcome" && (
          <>
            <p className="font-display text-5xl italic">riff</p>
            <h1 className="mt-6 text-2xl font-semibold">{t("onboarding:welcome.title")}</h1>
            <p className="mt-3 text-muted-foreground">{t("onboarding:welcome.body")}</p>
            {/* The README is honest about placeholders; the first run is what
                people actually read, so it says so too. */}
            <p className="mt-4 text-[0.8125rem] text-muted-foreground">
              {t("onboarding:welcome.status")}
            </p>
          </>
        )}

        {step === "theme" && (
          <>
            <h1 className="text-2xl font-semibold">{t("onboarding:theme.title")}</h1>
            <p className="mt-2 text-muted-foreground">{t("onboarding:theme.body")}</p>
            {/* Radix, not hand-rolled roles. role="radio" on a <button> with
                no roving tabindex is the ARIA pattern without its keyboard
                behaviour — arrow keys do nothing — and §11 is explicit that
                the work here is not undoing what Radix already gets right. */}
            <RadioGroup
              value={theme}
              onValueChange={(v) => choose(v as Theme)}
              aria-label={t("onboarding:theme.title")}
              className="mt-8 flex justify-center gap-6"
            >
              {(["dark", "light"] as Theme[]).map((option) => (
                <label
                  key={option}
                  htmlFor={`onboarding-theme-${option}`}
                  className={cn(
                    "w-64 cursor-pointer rounded-[var(--radius-card)] border-2 p-3 transition-colors",
                    theme === option ? "border-ring" : "border-border-subtle",
                  )}
                >
                  <RadioGroupItem
                    value={option}
                    id={`onboarding-theme-${option}`}
                    className="sr-only"
                  />
                  <ThemePreview variant={option} />
                  <span className="mt-3 block text-sm font-medium">
                    {t(`onboarding:theme.${option}`)}
                  </span>
                </label>
              ))}
            </RadioGroup>
          </>
        )}

        {step === "privacy" && (
          <>
            <h1 className="text-2xl font-semibold">{t("onboarding:privacy.title")}</h1>
            <p className="mt-3 text-muted-foreground">{t("onboarding:privacy.body")}</p>
            <ul className="mx-auto mt-6 flex max-w-lg flex-col gap-2 text-start">
              {PATH_KINDS.map((kind) => (
                <li key={kind} className="flex items-center justify-between gap-4">
                  <code className="truncate font-mono text-xs text-muted-foreground">
                    {pathFor(kind, paths)}
                  </code>
                  <Button variant="ghost" size="sm" onClick={() => void ipc.openPath(kind)}>
                    {t("common:openFolder")}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {STEPS.map((name, i) => (
          <span
            key={name}
            aria-hidden
            className={cn("h-2 w-2 rounded-full", i === index ? "bg-foreground" : "bg-raised")}
          />
        ))}
      </div>

      <div className="flex gap-3">
        {index > 0 && (
          <Button variant="ghost" onClick={() => setIndex((i) => i - 1)}>
            {t("common:back")}
          </Button>
        )}
        {index < STEPS.length - 1 ? (
          <Button onClick={() => setIndex((i) => i + 1)}>{t("common:continue")}</Button>
        ) : (
          <Button onClick={() => void finish()}>{t("onboarding:privacy.done")}</Button>
        )}
      </div>
    </div>
  );
}

/** A miniature of the real shell, so the choice is shown rather than named. */
function ThemePreview({ variant }: { variant: Theme }) {
  const { t } = useTranslation("onboarding");
  return (
    <div
      data-theme={variant}
      role="img"
      aria-label={t("theme.preview", { name: t(`theme.${variant}`) })}
      className="flex h-28 overflow-hidden rounded-md bg-surface"
    >
      <div className="w-1/4 bg-surface p-1.5">
        <div className="h-3 rounded bg-raised" />
        <div className="mt-1 h-3 rounded bg-raised opacity-50" />
      </div>
      <div className="flex-1 p-1.5">
        <div className="h-full rounded bg-card" />
      </div>
    </div>
  );
}

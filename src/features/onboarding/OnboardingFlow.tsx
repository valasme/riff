import { useNavigate } from "@tanstack/react-router";
import { FolderOpen } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { router } from "@/app/router";
import { ThemePreview } from "@/components/ThemePreview";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/cn";
import { ipc, type Theme } from "@/lib/ipc";
import { PATH_KINDS, pathFor } from "@/lib/paths";
import { resolveStartupRoute } from "@/lib/startup-route";
import { useSettings } from "@/stores/settings";
import { ONBOARDING_VERSION, preferredTheme } from "./gate";

const STEPS = ["welcome", "theme", "privacy"] as const;
const THEMES: Theme[] = ["dark", "darker", "light"];

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
      <p className="font-mono text-xs tracking-wide text-muted-foreground">
        {t("onboarding:step", { current: index + 1, total: STEPS.length })}
      </p>

      <div className="w-full max-w-2xl text-center">
        {step === "welcome" && (
          <>
            <Wordmark className="block text-5xl" />
            <h1 className="mt-6 text-2xl font-semibold">{t("onboarding:welcome.title")}</h1>
            <p className="mt-3 text-muted-foreground">{t("onboarding:welcome.body")}</p>
            {/* The README is honest about placeholders; the first run is what
                people actually read, so it says so too. */}
            <p className="mx-auto mt-4 max-w-prose rounded-[var(--radius-control)] border border-line bg-card px-4 py-3 text-[0.8125rem] text-muted-foreground">
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
            <RadioGroupPrimitive.Root
              value={theme}
              onValueChange={(v) => choose(v as Theme)}
              aria-label={t("onboarding:theme.title")}
              orientation="horizontal"
              className="mt-8 grid grid-cols-3 gap-4"
            >
              {THEMES.map((option) => (
                <RadioGroupPrimitive.Item
                  key={option}
                  value={option}
                  aria-label={t(`onboarding:theme.${option}`)}
                  className={cn(
                    "flex flex-col gap-3 rounded-[var(--radius-card)] border-2 p-3 text-start",
                    "transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) outline-none",
                    theme === option
                      ? "border-foreground bg-hover"
                      : "border-line hover:border-border-subtle",
                  )}
                >
                  <ThemePreview variant={option} className="h-28 w-full" />
                  <span className="text-sm font-medium">{t(`onboarding:theme.${option}`)}</span>
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
          </>
        )}

        {step === "privacy" && (
          <>
            <h1 className="text-2xl font-semibold">{t("onboarding:privacy.title")}</h1>
            <p className="mx-auto mt-3 max-w-prose text-muted-foreground">
              {t("onboarding:privacy.body")}
            </p>
            <ul className="mx-auto mt-6 flex max-w-lg flex-col gap-1.5 text-start">
              {PATH_KINDS.map((kind) => (
                <li
                  key={kind}
                  className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-card ps-3 pe-1.5 py-1.5"
                >
                  <span id={`onboarding-path-${kind}`} className="w-16 shrink-0 text-[0.8125rem]">
                    {t(`settings:general.paths.${kind}`)}
                  </span>
                  <code
                    dir="ltr"
                    className="min-w-0 flex-1 truncate text-start font-mono text-xs text-muted-foreground"
                  >
                    {pathFor(kind, paths)}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("common:openFolder")}
                    aria-describedby={`onboarding-path-${kind}`}
                    onClick={() => void ipc.openPath(kind)}
                  >
                    <FolderOpen aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {STEPS.map((name, i) => (
          <span
            key={name}
            aria-hidden
            className={cn(
              "h-1.5 rounded-full transition-all duration-[var(--motion)] ease-(--ease-standard)",
              i === index ? "w-5 bg-foreground" : "w-1.5 bg-active-fill",
            )}
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

import { RotateCcw } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ThemePreview } from "@/components/ThemePreview";
import { Button } from "@/components/ui/button";
import { SegmentedGroup } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsGroup } from "@/features/settings/SettingRow";
import { cn } from "@/lib/cn";
import { type Density, ipc, type ReduceMotion, type Theme, type TitleBarStyle } from "@/lib/ipc";
import { useAppearance, useSettings } from "@/stores/settings";

const THEMES: Theme[] = ["dark", "darker", "light"];
const DENSITIES: Density[] = ["comfortable", "compact"];
const MOTIONS: ReduceMotion[] = ["system", "always", "never"];
const TITLE_BARS: TitleBarStyle[] = ["custom", "system"];

export function AppearanceSection() {
  const { t, i18n } = useTranslation(["settings", "errors"]);
  const appearance = useAppearance();
  const patch = useSettings((s) => s.patch);

  /**
   * The scale being dragged, before it is applied.
   *
   * The scale cannot be applied on every pointer move, and the reason is
   * mechanical rather than aesthetic. Radix caches the slider's bounding rect
   * on pointer-down and maps the pointer against that cached rect for the
   * whole gesture. Applying the scale live changes the root font size, which
   * changes the slider's own width *and* its position — the settings column is
   * centred and the sub-navigation grows beside it — so from the first pixel
   * of the drag the cached rect describes an element that has moved. The thumb
   * is placed by percentage of the new track, the pointer is mapped through
   * the old one, and the two separate: the handle stops following the cursor
   * while the percentage keeps changing.
   *
   * Holding the value locally until the gesture ends breaks that loop. The
   * readout and the thumb both follow the draft, so the drag is live; the
   * interface resizes once, on release. Arrow keys are unaffected — Radix
   * commits on every step key, so they still apply immediately.
   */
  const [draftScale, setDraftScale] = useState<number | null>(null);
  const uiScale = draftScale ?? appearance.uiScale;

  // The setting is applied on every launch, not only when it changes.
  // `decorations: false` is baked into tauri.conf.json, so without this a
  // user who chose System decorations reopens Riff with no title bar of
  // either kind and a switch insisting otherwise.
  useEffect(() => {
    if (appearance.titleBar === "system") void ipc.windowSetDecorations(true);
  }, [appearance.titleBar]);

  async function setTitleBar(style: TitleBarStyle) {
    // The window manager decides. Under Wayland many compositors, Hyprland
    // among them, simply decline — so ask, then read back what actually
    // happened rather than leaving a switch that claims otherwise.
    // Best-effort: `is_decorated()` reports GTK's own client-side property,
    // so a Wayland compositor that ignores the request will not always show
    // up here. It catches the refusals it can and the description tells the
    // truth about the rest.
    const decorated = await ipc.windowSetDecorations(style === "system");
    if (style === "system" && !decorated) {
      toast.error(t("errors:decorationsRefused"));
      return;
    }
    await patch({ appearance: { titleBar: style } });
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <SettingsGroup title={t("settings:appearance.groups.theme")}>
        <div className="px-4 py-[var(--field-padding)]">
          <p className="mb-3 max-w-prose text-[0.8125rem] leading-relaxed text-muted-foreground">
            {t("settings:appearance.theme.description")}
          </p>
          {/* Cards rather than a row of dots. Theme is the one setting whose
              effect can be shown instead of described, and each card is the
              real shell rendered in that theme — see ThemePreview. */}
          <RadioGroupPrimitive.Root
            aria-label={t("settings:appearance.theme.label")}
            value={appearance.theme}
            onValueChange={(theme) => void patch({ appearance: { theme: theme as Theme } })}
            orientation="horizontal"
            className="grid grid-cols-3 gap-3"
          >
            {THEMES.map((option) => (
              <RadioGroupPrimitive.Item
                key={option}
                value={option}
                // Name from the attribute, detail from `aria-describedby`.
                // Left to its contents the accessible name would be the label
                // and the blurb run together — "Darker Near-black, for dim
                // rooms." — which is a sentence, not the name of a choice.
                aria-label={t(`settings:appearance.themeOptions.${option}`)}
                aria-describedby={`theme-${option}-description`}
                className={cn(
                  "flex flex-col gap-2 rounded-[var(--radius-control)] border-2 p-2 text-start",
                  "transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) outline-none",
                  appearance.theme === option
                    ? "border-foreground bg-hover"
                    : "border-line hover:border-border-subtle",
                )}
              >
                <ThemePreview variant={option} className="h-16 w-full" />
                <span className="text-[0.8125rem] font-medium text-foreground">
                  {t(`settings:appearance.themeOptions.${option}`)}
                </span>
                <span
                  id={`theme-${option}-description`}
                  className="text-[0.75rem] leading-snug text-muted-foreground"
                >
                  {t(`settings:appearance.themeDescriptions.${option}`)}
                </span>
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settings:appearance.groups.layout")}>
        <SettingRow
          label={t("settings:appearance.density.label")}
          description={t("settings:appearance.density.description")}
        >
          <SegmentedGroup
            aria-label={t("settings:appearance.density.label")}
            value={appearance.density}
            onValueChange={(density) => void patch({ appearance: { density } })}
            options={DENSITIES.map((value) => ({
              value,
              label: t(`settings:appearance.densityOptions.${value}`),
            }))}
          />
        </SettingRow>

        <SettingRow
          label={t("settings:appearance.uiScale.label")}
          description={t("settings:appearance.uiScale.description")}
        >
          <div className="flex w-[16rem] items-center gap-3">
            <Slider
              thumbLabel={t("settings:appearance.uiScale.label")}
              min={0.8}
              max={1.5}
              step={0.05}
              value={[uiScale]}
              onValueChange={([next]) => setDraftScale(next ?? null)}
              onValueCommit={([next]) => {
                if (next !== undefined) void patch({ appearance: { uiScale: next } });
                setDraftScale(null);
              }}
            />
            {/* §10: numbers go through Intl, never hand-formatted. A percent
                sign glued to a rounded number is a hand-formatted number.
                `tabular-nums` so the row does not shuffle as it changes. */}
            <span className="w-11 shrink-0 text-end font-mono text-xs tabular-nums text-muted-foreground">
              {new Intl.NumberFormat(i18n.language, { style: "percent" }).format(
                appearance.uiScale,
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setDraftScale(null);
                void patch({ appearance: { uiScale: 1 } });
              }}
              aria-label={t("settings:appearance.uiScale.reset")}
              disabled={uiScale === 1}
            >
              <RotateCcw aria-hidden />
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings:appearance.rememberSidebar.label")}
          description={t("settings:appearance.rememberSidebar.description")}
          htmlFor="remember-sidebar"
        >
          <Switch
            id="remember-sidebar"
            checked={appearance.sidebar.rememberCollapsed}
            onCheckedChange={(rememberCollapsed) =>
              void patch({ appearance: { sidebar: { rememberCollapsed } } })
            }
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings:appearance.groups.accessibility")}>
        <SettingRow
          label={t("settings:appearance.reduceMotion.label")}
          description={t("settings:appearance.reduceMotion.description")}
        >
          <SegmentedGroup
            aria-label={t("settings:appearance.reduceMotion.label")}
            value={appearance.reduceMotion}
            onValueChange={(reduceMotion) => void patch({ appearance: { reduceMotion } })}
            options={MOTIONS.map((value) => ({
              value,
              label: t(`settings:appearance.motionOptions.${value}`),
            }))}
          />
        </SettingRow>

        <SettingRow
          label={t("settings:appearance.highContrast.label")}
          description={t("settings:appearance.highContrast.description")}
          htmlFor="high-contrast"
        >
          <Switch
            id="high-contrast"
            checked={appearance.highContrast}
            onCheckedChange={(highContrast) => void patch({ appearance: { highContrast } })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings:appearance.groups.window")}>
        <SettingRow
          label={t("settings:appearance.titleBar.label")}
          description={t("settings:appearance.titleBar.description")}
        >
          <SegmentedGroup
            aria-label={t("settings:appearance.titleBar.label")}
            value={appearance.titleBar}
            onValueChange={(style) => void setTitleBar(style)}
            options={TITLE_BARS.map((value) => ({
              value,
              label: t(`settings:appearance.titleBarOptions.${value}`),
            }))}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

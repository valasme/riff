import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "@/features/settings/SettingRow";
import { type Density, ipc, type ReduceMotion, type Theme, type TitleBarStyle } from "@/lib/ipc";
import { useAppearance, useSettings } from "@/stores/settings";

export function AppearanceSection() {
  const { t, i18n } = useTranslation(["settings", "errors"]);
  const appearance = useAppearance();
  const patch = useSettings((s) => s.patch);

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
    <section className="py-2">
      <Choice
        name="theme"
        label={t("settings:appearance.theme.label")}
        description={t("settings:appearance.theme.description")}
        value={appearance.theme}
        options={["dark", "light"] as Theme[]}
        optionLabel={(v) => t(`settings:appearance.themeOptions.${v}`)}
        onChange={(theme) => void patch({ appearance: { theme } })}
      />

      <Choice
        name="density"
        label={t("settings:appearance.density.label")}
        description={t("settings:appearance.density.description")}
        value={appearance.density}
        options={["comfortable", "compact"] as Density[]}
        optionLabel={(v) => t(`settings:appearance.densityOptions.${v}`)}
        onChange={(density) => void patch({ appearance: { density } })}
      />

      <SettingRow
        label={t("settings:appearance.uiScale.label")}
        description={t("settings:appearance.uiScale.description")}
      >
        <div className="flex w-56 items-center gap-3">
          <Slider
            thumbLabel={t("settings:appearance.uiScale.label")}
            min={0.8}
            max={1.5}
            step={0.05}
            value={[appearance.uiScale]}
            onValueChange={([uiScale]) => void patch({ appearance: { uiScale } })}
          />
          {/* §10: numbers go through Intl, never hand-formatted. A percent
              sign glued to a rounded number is a hand-formatted number. */}
          <span className="w-12 shrink-0 text-end font-mono text-xs text-muted-foreground">
            {new Intl.NumberFormat(i18n.language, { style: "percent" }).format(appearance.uiScale)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void patch({ appearance: { uiScale: 1 } })}
            aria-label={t("settings:appearance.uiScale.reset")}
          >
            100%
          </Button>
        </div>
      </SettingRow>

      <Choice
        name="motion"
        label={t("settings:appearance.reduceMotion.label")}
        description={t("settings:appearance.reduceMotion.description")}
        value={appearance.reduceMotion}
        options={["system", "always", "never"] as ReduceMotion[]}
        optionLabel={(v) => t(`settings:appearance.motionOptions.${v}`)}
        onChange={(reduceMotion) => void patch({ appearance: { reduceMotion } })}
      />

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

      <Choice
        name="titlebar"
        label={t("settings:appearance.titleBar.label")}
        description={t("settings:appearance.titleBar.description")}
        value={appearance.titleBar}
        options={["custom", "system"] as TitleBarStyle[]}
        optionLabel={(v) => t(`settings:appearance.titleBarOptions.${v}`)}
        onChange={(style) => void setTitleBar(style)}
      />

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
    </section>
  );
}

/** ids come from the stable field name, never the translated label: labels
 *  contain spaces ("Reduce motion-system") and two rows could collide. */
function Choice<T extends string>({
  name,
  label,
  description,
  value,
  options,
  optionLabel,
  onChange,
}: {
  name: string;
  label: string;
  description: string;
  value: T;
  options: T[];
  optionLabel: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <SettingRow label={label} description={description}>
      <RadioGroup
        aria-label={label}
        value={value}
        onValueChange={(v) => onChange(v as T)}
        className="flex gap-4"
      >
        {options.map((option) => (
          <div key={option} className="flex items-center gap-2">
            <RadioGroupItem value={option} id={`${name}-${option}`} />
            <label htmlFor={`${name}-${option}`} className="text-sm">
              {optionLabel(option)}
            </label>
          </div>
        ))}
      </RadioGroup>
    </SettingRow>
  );
}

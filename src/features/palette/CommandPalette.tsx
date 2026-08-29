import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { formatChord } from "@/features/keybindings/chord";
import type { Keybinding } from "@/features/keybindings/keymap";

const GROUPS = ["navigation", "appearance", "application"] as const;

export function CommandPalette({
  open,
  bindings,
  onOpenChange,
}: {
  open: boolean;
  bindings: Keybinding[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("palette");

  return (
    // `title` and `description` are required, not decorative: Radix renders
    // the dialog's accessible name from them, and without one axe reports
    // aria-dialog-name — which the container-scoped assertion below could
    // never catch, because the dialog is portalled to <body>.
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
    >
      <CommandInput placeholder={t("placeholder")} />
      <CommandList>
        <CommandEmpty>{t("empty")}</CommandEmpty>
        {GROUPS.map((group) => {
          const items = bindings.filter((b) => b.group === group && !b.hidden);
          if (items.length === 0) return null;
          return (
            <CommandGroup key={group} heading={t(`groups.${group}`)}>
              {items.map((binding) => {
                const Icon = binding.icon;
                const label = t(binding.descriptionKey, { ns: undefined });
                return (
                  <CommandItem
                    key={binding.id}
                    // cmdk matches on this string, which is why the translated
                    // label rather than the id is used.
                    value={label}
                    onSelect={() => {
                      binding.run();
                      onOpenChange(false);
                    }}
                  >
                    <Icon aria-hidden />
                    <span className="truncate">{label}</span>
                    {binding.chord && <CommandShortcut chord={formatChord(binding.chord)} />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </CommandList>

      {/* The palette is a keyboard surface, so it says how the keyboard works
          rather than leaving it to be discovered. Decorative: every key here
          already does what it says with no help from this strip, and the row
          is `aria-hidden` so it is not read out as three unlabelled keys. */}
      <CommandFooter aria-hidden>
        <Hint keys={["↑", "↓"]}>{t("hints.navigate")}</Hint>
        <Hint keys={["↵"]}>{t("hints.run")}</Hint>
        <Hint keys={["Esc"]}>{t("hints.close")}</Hint>
      </CommandFooter>
    </CommandDialog>
  );
}

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys.map((key) => (
        <Kbd key={key} chord={key} />
      ))}
      {children}
    </span>
  );
}

import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
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
      title={t("placeholder")}
      description={t("empty")}
    >
      <CommandInput placeholder={t("placeholder")} />
      <CommandList>
        <CommandEmpty>{t("empty")}</CommandEmpty>
        {GROUPS.map((group) => {
          const items = bindings.filter((b) => b.group === group && !b.hidden);
          if (items.length === 0) return null;
          return (
            <CommandGroup key={group} heading={t(`groups.${group}`)}>
              {items.map((binding) => (
                <CommandItem
                  key={binding.id}
                  // cmdk matches on this string, which is why the translated
                  // label rather than the id is used.
                  value={t(binding.descriptionKey, { ns: undefined })}
                  onSelect={() => {
                    binding.run();
                    onOpenChange(false);
                  }}
                >
                  {t(binding.descriptionKey, { ns: undefined })}
                  {binding.chord && <CommandShortcut>{formatChord(binding.chord)}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

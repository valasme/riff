import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/cn";

/**
 * On is a filled track; off is an outlined one.
 *
 * The previous switch styled itself with `data-checked:` / `data-unchecked:`,
 * which Tailwind compiles to `[data-checked]` — an attribute Radix does not
 * emit. It emits `data-state="checked"`. So neither rule ever matched, the
 * track never took a background at all, and every switch in Settings rendered
 * as a single dark dot with no on state and no off state. This is the fix, and
 * it is why every `data-*` variant in this directory is written out in full.
 */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "group/switch peer relative inline-flex shrink-0 items-center rounded-full p-0.5",
        "border transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) outline-none",
        "data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7",
        // Neutral by necessity — §7.1 admits no accent hue — so the two states
        // are told apart by fill and by which of the two colours is on the
        // outside, which is a larger difference than any hue would have been.
        "data-[state=checked]:border-foreground data-[state=checked]:bg-foreground",
        "data-[state=unchecked]:border-border-subtle data-[state=unchecked]:bg-transparent",
        "data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full transition-transform duration-[var(--motion-fast)] ease-(--ease-standard)",
          "group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3",
          "group-data-[state=checked]/switch:bg-surface group-data-[state=unchecked]/switch:bg-muted-foreground",
          // Physical translate with an RTL mirror: `dir` is set from the
          // active locale (§10), and a thumb that slides the wrong way is the
          // kind of bug that only shows up in the locale nobody tests.
          "group-data-[state=unchecked]/switch:translate-x-0",
          "group-data-[size=default]/switch:group-data-[state=checked]/switch:translate-x-4",
          "group-data-[size=sm]/switch:group-data-[state=checked]/switch:translate-x-3",
          "rtl:group-data-[size=default]/switch:group-data-[state=checked]/switch:-translate-x-4",
          "rtl:group-data-[size=sm]/switch:group-data-[state=checked]/switch:-translate-x-3",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/cn";

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  );
}

/** A dot. Radix emits `data-state`, never `data-checked` — see switch.tsx. */
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item relative flex aspect-square size-[1.125rem] shrink-0 items-center justify-center rounded-full",
        "border border-border-subtle transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) outline-none",
        "hover:border-foreground/60",
        "data-[state=checked]:border-foreground data-[state=checked]:bg-foreground",
        "data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <span className="block size-1.5 rounded-full bg-surface" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

/**
 * The same radio group, drawn as one control instead of a row of dots.
 *
 * Every mutually-exclusive setting in Riff has two or three short options, and
 * a segmented control shows all of them, shows which is active, and takes one
 * click — where a row of loose dots and labels reads as a form to be filled
 * in and submitted. It is still a Radix radio group underneath, so arrow-key
 * navigation, the roving tabindex and the group's accessible name are the
 * primitive's behaviour rather than something re-implemented here.
 */
function SegmentedGroup<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Root>, "value" | "onValueChange"> & {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented-group"
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      // `orientation` makes Left/Right the arrow keys rather than Up/Down,
      // matching how the control reads.
      orientation="horizontal"
      // An outlined track with nothing in it, so the selected chip is the only
      // fill in the control. Filling the track as well put an 8%-white recess
      // behind a chip painted with the solid `raised` colour — and in the
      // darker theme `raised` is the *darker* of the two, so the selected
      // segment came out recessed and the unselected ones looked chosen.
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line p-0.5",
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          data-slot="segmented-item"
          className={cn(
            "rounded-[calc(var(--radius-control)-0.1875rem)] px-2.5 py-1 text-[0.8125rem] font-medium whitespace-nowrap",
            "text-muted-foreground transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) outline-none",
            "hover:text-foreground",
            // `active-fill` is mixed from the foreground, so the chip is
            // lighter than its surroundings in the dark themes and darker in
            // light — legible in all three without a hard-coded colour.
            "data-[state=checked]:bg-active-fill data-[state=checked]:font-semibold data-[state=checked]:text-foreground",
            "data-disabled:opacity-50",
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem, SegmentedGroup };

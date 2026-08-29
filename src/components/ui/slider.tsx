"use client";

import { Slider as SliderPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/cn";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { thumbLabel?: string }) {
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none",
        // Radix reports orientation as `data-orientation`, so the previous
        // `data-vertical:` / `data-horizontal:` rules matched nothing — see
        // switch.tsx for the same mistake and the same fix.
        "data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-active-fill data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-foreground select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          // biome-ignore lint/suspicious/noArrayIndexKey: thumb count is fixed by min/max/value at mount and never reordered.
          key={index}
          aria-label={thumbLabel}
          className={cn(
            "relative block size-4 shrink-0 rounded-full border-2 border-foreground bg-surface select-none",
            "transition-[box-shadow] duration-[var(--motion-fast)] ease-(--ease-standard) outline-none",
            // The invisible hit area, so the thumb is a 32px target without
            // being a 32px dot (WCAG 2.5.8).
            "after:absolute after:-inset-2",
            "hover:shadow-[0_0_0_0.25rem_var(--hover)] active:shadow-[0_0_0_0.25rem_var(--active-fill)]",
            "data-disabled:pointer-events-none",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };

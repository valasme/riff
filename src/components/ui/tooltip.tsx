"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/cn";

function TooltipProvider({
  delayDuration = 400,
  skipDelayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        // A raised card, not an inverted slab. The old tooltip painted
        // `bg-foreground` with `text-surface`, which is a light box on a dark
        // application — the one bright rectangle in an otherwise neutral
        // interface, and no surface for a key chip to sit on.
        className={cn(
          "z-50 inline-flex w-fit max-w-xs items-center gap-2 rounded-[var(--radius-control)] border border-line bg-card px-2.5 py-1.5 text-xs text-foreground",
          "origin-(--radix-tooltip-content-transform-origin) shadow-[0_0.5rem_1.5rem_-0.5rem_rgb(0_0_0/0.45)]",
          // One fade, 110ms, no zoom or slide. §7 asks for restraint and a
          // tooltip that scales into place draws more attention than the
          // thing it is describing.
          "duration-[var(--motion-fast)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };

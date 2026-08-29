import type * as React from "react";

import { cn } from "@/lib/cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-16 w-full rounded-[var(--radius-control)] border border-border-subtle bg-transparent px-2.5 py-2 text-sm",
        "transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) outline-none",
        "placeholder:text-muted-foreground hover:border-foreground/40 focus-visible:border-foreground",
        // No `cursor-not-allowed`: §11 — the pointing hand and its refusal
        // twin are both browser cursors, and a dimmed control has already
        // said it is unavailable.
        "disabled:bg-hover disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

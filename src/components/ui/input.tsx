import type * as React from "react";

import { cn } from "@/lib/cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-[var(--radius-control)] border border-border-subtle bg-transparent px-2.5 text-sm",
        "transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) outline-none",
        "placeholder:text-muted-foreground hover:border-foreground/40",
        // The 2px ring from globals.css is the focus indicator everywhere
        // else in the application; a field does not get a second, different
        // one. `focus-visible:border-foreground` only sharpens the boundary
        // underneath it.
        "focus-visible:border-foreground",
        "disabled:bg-hover disabled:opacity-60 read-only:text-muted-foreground",
        "[&::-webkit-search-cancel-button]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export { Input };

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A titled card holding a run of related rows.
 *
 * Settings used to be one long card with fifteen undifferentiated rows in it,
 * which made "where is the title bar setting" a scanning problem. Grouping
 * costs one heading per four rows and turns it into a reading problem.
 */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="px-1">
        <h2 className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
        {children}
      </div>
    </section>
  );
}

/**
 * Label, optional description, control. Every setting uses this, which is
 * what keeps the three sections visually identical without a framework.
 *
 * `stacked` is for the rows whose control is wider than the space a right-hand
 * column can offer — a list of paths, a pair of action buttons — so they drop
 * the control below the text rather than squeezing it into a gutter.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  stacked = false,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  stacked?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[var(--row-height)] gap-6 border-b border-separator px-4 py-[var(--field-padding)] last:border-b-0",
        stacked ? "flex-col gap-3" : "items-center justify-between",
      )}
    >
      <div className="min-w-0">
        {/* A <label> with no `for` points at nothing. Rows whose control is a
            radiogroup or a button get a plain element instead. */}
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-[0.9375rem] font-medium">
            {label}
          </label>
        ) : (
          <span className="block text-[0.9375rem] font-medium">{label}</span>
        )}
        {description && (
          <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && <div className={cn(!stacked && "shrink-0")}>{children}</div>}
    </div>
  );
}

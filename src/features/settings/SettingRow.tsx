import type { ReactNode } from "react";

/**
 * Label, optional description, control. Every setting uses this, which is
 * what keeps the three sections visually identical without a framework.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[var(--row-height)] items-start justify-between gap-6 border-b border-separator py-4 last:border-b-0">
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
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

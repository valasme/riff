import { Clock, FileText, Filter, Menu, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";

/** The mockup draws the grid filling the panel with three skeleton rows at
 *  the top and empty checkbox rows below, so the table reads as a table
 *  rather than as three rows floating in a bordered box. */
const ROWS = 8;
const FILLED = 3;

/**
 * The mockup's own skeleton rows, kept as skeletons because that is what the
 * design shows and because inventing demo data would look like a bug in a
 * real user's install.
 */
export function HistoryPlaceholder() {
  const { t } = useTranslation("common");

  return (
    <div className="flex h-full flex-col gap-4 p-[var(--content-padding)]">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={18}
            aria-hidden
            // `inset-y-0` + `my-auto`, not `inset-block-0`: Tailwind has no
            // `inset-block-*` utility, so that class emits nothing and the
            // icon sits at the top of the field.
            className="pointer-events-none absolute inset-y-0 my-auto ms-3 text-muted-foreground"
          />
          <input
            type="search"
            readOnly
            aria-label={t("search")}
            placeholder={t("search")}
            className="h-11 w-full rounded-[var(--radius-nav)] border border-border-subtle bg-surface ps-11 pe-3 text-sm"
          />
        </div>
        <button
          type="button"
          disabled
          aria-disabled="true"
          aria-label={t("filter")}
          title={t("filter")}
          className="grid h-11 w-11 place-items-center rounded-[var(--radius-nav)] bg-raised text-muted-foreground opacity-60"
        >
          <Filter size={18} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-nav)] border border-border-subtle">
        <table className="w-full border-collapse" aria-label={t("history.sessions")}>
          <thead>
            <tr className="bg-raised">
              <th scope="col" className="w-14 p-3">
                <span className="sr-only">{t("history.rowActions")}</span>
              </th>
              {/* The mockup's header carries icons only. The label is kept
                  for screen readers rather than dropped, which is the one
                  place worth diverging from the drawing. */}
              <th
                scope="col"
                className="border-s border-separator p-3 text-start text-sm font-medium"
              >
                <FileText size={16} aria-hidden className="inline-block" />
                <span className="sr-only">{t("history.name")}</span>
              </th>
              <th
                scope="col"
                className="border-s border-separator p-3 text-start text-sm font-medium"
              >
                <Clock size={16} aria-hidden className="inline-block" />
                <span className="sr-only">{t("history.lastPractised")}</span>
              </th>
              {/* Not `<th />`. axe's empty-table-header rule runs by default
                  and fails an unnamed header cell. */}
              <th scope="col" className="w-14 p-3">
                <span className="sr-only">{t("history.rowMenu")}</span>
              </th>
            </tr>
          </thead>
          <tbody aria-hidden="true">
            {Array.from({ length: ROWS }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: row count is fixed by ROWS and never reordered.
              <tr key={i} className="border-t border-separator bg-card">
                <td className="p-3">
                  <div className="h-5 w-5 rounded border border-foreground/70" />
                </td>
                <td className="border-s border-separator p-3">
                  {i < FILLED && <Skeleton className="h-4 w-64" />}
                </td>
                <td className="border-s border-separator p-3">
                  {i < FILLED && <Skeleton className="h-4 w-48" />}
                </td>
                <td className="p-3 text-muted-foreground">{i < FILLED && <Menu size={18} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

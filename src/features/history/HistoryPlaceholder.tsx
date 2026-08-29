import { Clock, EllipsisVertical, FileText, Filter, Info, Search, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

/** Three rows, not eight. The old table padded itself out with five empty
 *  checkbox rows so the grid would fill the panel, which read as five sessions
 *  that failed to load rather than as a preview of a table. Three loading rows
 *  above an explicit note say the same thing without the ambiguity. */
const ROWS = 3;

/**
 * The shape History will take, drawn honestly.
 *
 * Nothing here is live: playback does not exist yet (§15), so there is no
 * session to list. Rather than invent demo data — which looks like a bug in a
 * real user's install — the table shows its columns, three loading rows, and
 * one sentence saying exactly that.
 */
export function HistoryPlaceholder() {
  const { t } = useTranslation("common");

  return (
    <div className="mx-auto flex h-full w-full max-w-[64rem] flex-col gap-4 p-[var(--content-padding)]">
      <header>
        <h1 className="text-lg leading-tight font-semibold">{t("history.heading")}</h1>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">{t("history.subheading")}</p>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={16}
            aria-hidden
            // `inset-y-0` + `my-auto`, not `inset-block-0`: Tailwind has no
            // `inset-block-*` utility, so that class emits nothing and the
            // icon sits at the top of the field.
            className="pointer-events-none absolute inset-y-0 my-auto ms-2.5 text-muted-foreground"
          />
          <Input
            type="search"
            readOnly
            aria-label={t("history.searchPlaceholder")}
            placeholder={t("history.searchPlaceholder")}
            className="h-9 ps-8"
          />
        </div>
        <button
          type="button"
          disabled
          aria-disabled="true"
          aria-label={t("filter")}
          className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-border-subtle text-muted-foreground opacity-60"
        >
          <Filter size={16} aria-hidden />
        </button>
      </div>

      {/* Height from its contents, not from the viewport. Stretched to fill,
          three rows sat above a half-screen of empty card, which reads as a
          table that failed to load rather than as a preview of one. */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
        <div className="min-h-0 overflow-auto">
          <table className="w-full border-collapse text-sm" aria-label={t("history.sessions")}>
            <thead>
              <tr className="border-b border-line bg-hover">
                {/* A drawn box, not `<input type="checkbox">`: the native one
                    is painted by GTK and arrives as a filled grey square that
                    matches nothing else on the screen. Inert either way, so
                    the name goes to a screen reader and the shape to the eye. */}
                <th scope="col" className="w-12 px-3 py-2.5">
                  <div
                    aria-hidden
                    className="size-4 rounded-[0.25rem] border border-border-subtle"
                  />
                  <span className="sr-only">{t("history.selectAll")}</span>
                </th>
                {/* Real column names, not icons alone. The mockup's header
                    carried only glyphs, which meant the one thing a table has
                    to tell you — what each column is — was a guess. The icon
                    stays as an anchor for the eye; the word carries the
                    meaning. */}
                <Column icon={FileText}>{t("history.name")}</Column>
                <Column icon={Clock} className="w-48">
                  {t("history.lastPractised")}
                </Column>
                <Column icon={Timer} className="w-32">
                  {t("history.duration")}
                </Column>
                {/* Not `<th />`. axe's empty-table-header rule runs by default
                    and fails an unnamed header cell. */}
                <th scope="col" className="w-12 px-3 py-2.5">
                  <span className="sr-only">{t("history.rowMenu")}</span>
                </th>
              </tr>
            </thead>
            <tbody aria-hidden="true">
              {Array.from({ length: ROWS }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: row count is fixed by ROWS and never reordered.
                <tr key={i} className="border-b border-separator last:border-b-0">
                  <td className="px-3 py-2.5">
                    <div className="size-4 rounded-[0.25rem] border border-border-subtle" />
                  </td>
                  <td className="px-3 py-2.5">
                    <Skeleton className="h-3.5 w-56" />
                  </td>
                  <td className="px-3 py-2.5">
                    <Skeleton className="h-3.5 w-28" />
                  </td>
                  <td className="px-3 py-2.5">
                    <Skeleton className="h-3.5 w-14" />
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground/50">
                    <EllipsisVertical size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="flex items-start gap-2 border-t border-line bg-hover px-3 py-2.5 text-[0.8125rem] text-muted-foreground">
          <Info size={15} aria-hidden className="mt-0.5 shrink-0" />
          {t("history.preview")}
        </p>
      </div>
    </div>
  );
}

function Column({
  icon: Icon,
  className,
  children,
}: {
  icon: typeof FileText;
  className?: string;
  children: string;
}) {
  return (
    <th
      scope="col"
      className={cn("px-3 py-2.5 text-start text-[0.8125rem] font-semibold", className)}
    >
      <span className="flex items-center gap-2">
        <Icon size={14} aria-hidden className="shrink-0 text-muted-foreground" />
        {children}
      </span>
    </th>
  );
}

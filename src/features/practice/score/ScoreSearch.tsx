import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { SearchStatus } from "./geometry";

/**
 * The row the search toggle reveals, beneath the toolbar. A row rather than
 * a field kept permanently on the toolbar: at the ~650px the Score pane gets
 * beside Video and Audio, a text input costs more width than the feature is
 * worth when nobody is searching (spec §5.1).
 */
export function ScoreSearch({
  query,
  status,
  hasText,
  onQueryChange,
  onFindAgain,
  onClose,
}: {
  query: string;
  status: SearchStatus;
  /** A scan has no text layer, so there is nothing to search. */
  hasText: boolean;
  onQueryChange: (query: string) => void;
  onFindAgain: (direction: 1 | -1) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("common");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Revealing a search field and leaving the caret elsewhere makes the
  // toggle feel like it did nothing.
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card px-2 py-1.5">
      <input
        ref={inputRef}
        type="search"
        value={query}
        disabled={!hasText}
        placeholder={t("score.search.placeholder")}
        aria-label={t("score.search.label")}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter for the next match, Shift+Enter for the previous one —
          // the convention every find bar uses. Escape dismisses, which
          // `useKeybindings` lets through even while typing.
          if (event.key === "Enter") {
            event.preventDefault();
            onFindAgain(event.shiftKey ? -1 : 1);
          }
          if (event.key === "Escape") onClose();
        }}
        className={cn(
          "h-6 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-hover px-2",
          "text-[0.75rem] text-foreground outline-none focus-visible:border-border-subtle",
          "disabled:opacity-50",
        )}
      />

      {/* Announced, not merely highlighted: the highlight is painted into a
          layer over the canvas, which is exactly what a screen-reader user
          is not looking at (spec §10). `role="status"` so a changing count
          is read without stealing focus from the field being typed in. */}
      <span role="status" className="shrink-0 text-[0.75rem] tabular-nums text-muted-foreground">
        {searchMessage(status, hasText, t)}
      </span>

      <SearchButton
        label={t("score.search.previous")}
        onClick={() => onFindAgain(-1)}
        disabled={!hasText || status.total === 0}
      >
        <ChevronUp size={15} aria-hidden />
      </SearchButton>
      <SearchButton
        label={t("score.search.next")}
        onClick={() => onFindAgain(1)}
        disabled={!hasText || status.total === 0}
      >
        <ChevronDown size={15} aria-hidden />
      </SearchButton>
      <SearchButton label={t("score.search.close")} onClick={onClose}>
        <X size={15} aria-hidden />
      </SearchButton>
    </div>
  );
}

/**
 * What the row says about the search, in one place so the states cannot
 * disagree with each other.
 *
 * A scan gets Task 5's sentence rather than "No results": a score with no
 * text layer has nothing to search, and reporting zero matches reads as a
 * search that is broken rather than one that was never possible.
 */
function searchMessage(
  status: SearchStatus,
  hasText: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!hasText) return t("score.noText");
  if (status.state === "pending" || status.query === "") return "";
  if (status.state === "not-found") return t("score.search.notFound");
  const counts = t("score.search.matches", { current: status.current, total: status.total });
  return status.state === "wrapped" ? `${counts} ${t("score.search.wrapped")}` : counts;
}

function SearchButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted-foreground",
        disabled
          ? "opacity-40"
          : "transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:bg-active-fill hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

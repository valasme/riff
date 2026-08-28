# 10 — Static Placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Practice and History, pixel-faithful to the mockups and completely inert.

**Architecture:** Presentational components with no state of their own. That is the point: when the real implementations arrive there is nothing to unwind. No layout engine, no table library, no virtualisation — installing those now would ship unused code and pretend a decision has been made that has not.

**Tech Stack:** Nothing new. Tokens from Plan 05 and shadcn `skeleton`; the search field is a native `<input>`, so no extra primitive is installed for it.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§8.3, §8.4)

## Global Constraints

- **Completely static.** Nothing resizes, sorts, filters or opens. Controls are `disabled` with `aria-disabled`, and the search input is `readOnly`.
- **Skeletons carry `aria-hidden`.** A screen reader must not be read a wall of decorative nothing.
- **Never install:** `react-resizable-panels`, `@tanstack/react-table`, `@tanstack/react-virtual`, `pdfjs-dist`.
- **Logical properties only.** **`lucide-react` only.** **No accent hue.**
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/features/practice/PracticePlaceholder.tsx` | Three panes with their header chrome |
| `src/features/history/HistoryPlaceholder.tsx` | Search, filter and the table shell |
| `src/routes/practice.tsx`, `src/routes/history.tsx` | Route wiring |

---

### Task 1: Practice

**Files:**
- Create: `src/features/practice/PracticePlaceholder.tsx`, `src/features/practice/PracticePlaceholder.test.tsx`
- Modify: `src/routes/practice.tsx`, `src/locales/en/common.json`

- [x] **Step 1: Add the strings**

Add to `src/locales/en/common.json`:

```json
  "inDevelopment": "In development",
  "panes": { "score": "Score", "video": "Video", "audio": "Audio" },
  "paneActions": { "popOut": "Pop out", "closePane": "Close pane" }
```

- [x] **Step 2: Write the failing test**

`src/features/practice/PracticePlaceholder.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/app/i18n";
import { PracticePlaceholder } from "./PracticePlaceholder";

function renderPractice() {
  return render(
    <I18nextProvider i18n={i18n}>
      <PracticePlaceholder />
    </I18nextProvider>,
  );
}

describe("PracticePlaceholder", () => {
  it("shows the three panes from the mockup", () => {
    renderPractice();
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("Video")).toBeInTheDocument();
    expect(screen.getByText("Audio")).toBeInTheDocument();
  });

  it("says plainly that it is not finished", () => {
    renderPractice();
    expect(screen.getAllByText("In development").length).toBeGreaterThan(0);
  });

  it("disables every pane control rather than pretending it works", () => {
    renderPractice();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("has no accessibility violations", async () => {
    const { container } = renderPractice();
    await expect(container).toHaveNoAxeViolations();
  });
});
```

- [x] **Step 3: Run and watch it fail**

Run: `pnpm test PracticePlaceholder`
Expected: FAIL — cannot resolve `./PracticePlaceholder`

- [x] **Step 4: Implement**

`src/features/practice/PracticePlaceholder.tsx`:

```tsx
import { PictureInPicture2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/**
 * Faithful to the mockup and deliberately inert. No resizing, no closing.
 * The layout engine arrives with the content that needs it.
 */
export function PracticePlaceholder() {
  const { t } = useTranslation("common");

  return (
    <div className="grid h-full grid-cols-2 gap-4 p-[var(--content-padding)]">
      <Pane title={t("panes.score")} className="row-span-2" />
      <Pane title={t("panes.video")} />
      <Pane title={t("panes.audio")} />
    </div>
  );
}

function Pane({ title, className }: { title: string; className?: string }) {
  const { t } = useTranslation("common");

  return (
    <section
      aria-label={title}
      className={cn("flex min-h-0 flex-col rounded-[var(--radius-pane)] bg-raised", className)}
    >
      <header className="flex items-center justify-between border-b border-separator px-3 py-2">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center gap-1">
          <PaneButton label={t("paneActions.popOut")}>
            <PictureInPicture2 size={15} aria-hidden />
          </PaneButton>
          <PaneButton label={t("paneActions.closePane")}>
            <X size={15} aria-hidden />
          </PaneButton>
        </div>
      </header>
      <div className="grid flex-1 place-items-center">
        <span className="rounded-full bg-surface px-3 py-1 text-xs text-muted-foreground">
          {t("inDevelopment")}
        </span>
      </div>
    </section>
  );
}

function PaneButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      aria-label={label}
      title={label}
      className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-60"
    >
      {children}
    </button>
  );
}
```

`src/routes/practice.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { PracticePlaceholder } from "@/features/practice/PracticePlaceholder";

export const Route = createFileRoute("/practice")({ component: PracticePlaceholder });
```

- [x] **Step 5: Run the tests**

Run: `pnpm test PracticePlaceholder`
Expected: PASS, 4 tests

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(practice): add the static three-pane placeholder"
```

---

### Task 2: History

**Files:**
- Create: `src/features/history/HistoryPlaceholder.tsx`, `src/features/history/HistoryPlaceholder.test.tsx`
- Modify: `src/routes/history.tsx`, `src/locales/en/common.json`

- [x] **Step 1: Add the strings**

Add to `src/locales/en/common.json`:

```json
  "search": "Search",
  "filter": "Filter",
  "history": { "name": "Name", "lastPractised": "Last practised", "rowActions": "Row actions", "rowMenu": "Row menu", "sessions": "Practice sessions" }
```

- [x] **Step 2: Write the failing test**

`src/features/history/HistoryPlaceholder.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/app/i18n";
import { HistoryPlaceholder } from "./HistoryPlaceholder";

function renderHistory() {
  return render(
    <I18nextProvider i18n={i18n}>
      <HistoryPlaceholder />
    </I18nextProvider>,
  );
}

describe("HistoryPlaceholder", () => {
  it("shows the search field from the mockup, not editable", () => {
    renderHistory();
    expect(screen.getByRole("searchbox", { name: /search/i })).toHaveAttribute("readonly");
  });

  it("names the table", () => {
    renderHistory();
    expect(screen.getByRole("table", { name: /practice sessions/i })).toBeInTheDocument();
  });

  it("disables the filter control", () => {
    renderHistory();
    expect(screen.getByRole("button", { name: /filter/i })).toBeDisabled();
  });

  it("hides the decorative skeleton rows from assistive technology", () => {
    const { container } = renderHistory();
    const skeletons = container.querySelectorAll('[data-slot="skeleton"], .animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
    for (const node of skeletons) {
      expect(node.closest("[aria-hidden='true']")).not.toBeNull();
    }
  });

  it("has no accessibility violations", async () => {
    const { container } = renderHistory();
    await expect(container).toHaveNoAxeViolations();
  });
});
```

- [x] **Step 3: Run and watch it fail**

Run: `pnpm test HistoryPlaceholder`
Expected: FAIL — cannot resolve `./HistoryPlaceholder`

- [x] **Step 4: Implement**

`src/features/history/HistoryPlaceholder.tsx`:

```tsx
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
              <th scope="col" className="border-s border-separator p-3 text-start text-sm font-medium">
                <FileText size={16} aria-hidden className="inline-block" />
                <span className="sr-only">{t("history.name")}</span>
              </th>
              <th scope="col" className="border-s border-separator p-3 text-start text-sm font-medium">
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
              <tr key={i} className="border-t border-separator bg-raised">
                <td className="p-3">
                  <div className="h-5 w-5 rounded border border-foreground/70" />
                </td>
                <td className="border-s border-separator p-3">
                  {i < FILLED && <Skeleton className="h-4 w-64" />}
                </td>
                <td className="border-s border-separator p-3">
                  {i < FILLED && <Skeleton className="h-4 w-48" />}
                </td>
                <td className="p-3 text-muted-foreground">
                  {i < FILLED && <Menu size={18} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

`src/routes/history.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { HistoryPlaceholder } from "@/features/history/HistoryPlaceholder";

export const Route = createFileRoute("/history")({ component: HistoryPlaceholder });
```

- [x] **Step 5: Run the tests**

Run: `pnpm test HistoryPlaceholder`
Expected: PASS, 5 tests

- [x] **Step 6: Compare against the mockup**

Run `pnpm app`, open History, and put `docs/design/history-route.png` beside it. Check the search field height, the filter button, the column layout and the row separators.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(history): add the static table placeholder"
```

---

### Task 3: Gate check

- [x] **Step 1: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
Expected: all exit 0.

- [x] **Step 2: Confirm no deferred dependency crept in**

Run: `grep -E '"(@tanstack/react-(table|virtual|query)|react-resizable-panels|pdfjs-dist)"' package.json || echo "no deferred dependencies installed"`
Expected: `no deferred dependencies installed`

- [x] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify placeholder gates" --allow-empty
```

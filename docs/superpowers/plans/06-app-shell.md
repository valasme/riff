# 06 — Application Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The frame from the mockups — custom title bar, collapsible sidebar, routed content — with translation, routing and error containment in place before any feature uses them.

**Architecture:** TanStack Router on **hash history**, because Tauri's asset protocol serves no SPA fallback and a reload on `/settings/general` would otherwise 404. Routes are file-based and code-generated. Every route is wrapped in its own error boundary so one broken screen cannot take down the shell.

**Tech Stack:** `@tanstack/react-router`, `@tanstack/router-plugin`, `i18next`, `react-i18next`, `react-error-boundary`, `sonner`, `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§6.1, §8.1, §10, §11, §12)

## Global Constraints

- **Every user-visible string** goes through `t()`, including `aria-label`, tooltips, toasts and errors. English only; `src/locales/en/*.json` is the only populated locale.
- **Layout uses CSS logical properties** — `ps-*`, `pe-*`, `ms-*`, `me-*`, `border-s`, never `left`/`right`. Adding an RTL language later must be a translation task, not a rewrite.
- **Metrics:** title bar 44px; sidebar 224px expanded / 56px rail; nav item 40px tall, 12px radius; content padding 24px.
- **Icons:** `lucide-react` only.
- **The webview's only capability is `core:default`.**
- **Never install:** `eslint`, `prettier`, any HTTP client, `@tanstack/react-query`.
- `@tanstack/router-plugin` must be pinned to the **exact same version** as `@tanstack/react-router`; a skew between them produces route-generation bugs that look like application bugs.
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/i18n.ts` | i18next initialisation |
| `src/locales/en/*.json` | `common`, `nav`, `settings`, `onboarding`, `errors`, `palette` |
| `src/app/router.tsx` | Router instance, hash history, type registration |
| `src/app/providers.tsx` | i18n, tooltips, toasts, root error boundary |
| `src/routes/__root.tsx` | Shell layout, route announcer |
| `src/routes/index.tsx` | Redirect to the configured startup route |
| `src/routes/{practice,history,settings}.tsx` | Route stubs; Plans 07 and 10 fill them |
| `src/features/window/TitleBar.tsx` | Drag region, wordmark, palette trigger, window controls |
| `src/features/window/WindowControls.tsx` | Minimise, maximise, close |
| `src/components/Sidebar.tsx` | Primary navigation and its collapse toggle |
| `src/components/RouteError.tsx` | Per-route error screen |

---

### Task 1: i18n

**Interfaces:**
- Produces: `@/app/i18n` default-exporting the configured `i18n` instance; namespaces `common`, `nav`, `settings`, `onboarding`, `errors`, `palette`.

**Files:**
- Create: `src/app/i18n.ts`, `src/locales/en/*.json`, `src/app/i18n.test.ts`

- [ ] **Step 1: Install**

```bash
pnpm add i18next@26.4 react-i18next@17.0
pnpm add -D i18next-parser
```

Create `i18next-parser.config.mjs`:

```js
export default {
  locales: ["en"],
  input: ["src/**/*.{ts,tsx}"],
  output: "src/locales/$LOCALE/$NAMESPACE.json",
  defaultNamespace: "common",
  keySeparator: ".",
  namespaceSeparator: ":",
  sort: true,
  // Never blank out an existing translation and never silently drop a key a
  // human wrote. CI compares the result against what is committed.
  keepRemoved: true,
  createOldCatalogs: false,
};
```

Add to `package.json` scripts:

```json
    "i18n:extract": "i18next -c i18next-parser.config.mjs",
```

- [ ] **Step 2: Create the locale files**

`src/locales/en/common.json`:

```json
{
  "appName": "Riff",
  "cancel": "Cancel",
  "confirm": "Confirm",
  "close": "Close",
  "back": "Back",
  "continue": "Continue",
  "openFolder": "Open folder",
  "copied": "Copied to clipboard"
}
```

`src/locales/en/nav.json`:

```json
{
  "practice": "Practice",
  "history": "History",
  "settings": "Settings",
  "toggleSidebar": "Toggle sidebar",
  "expandSidebar": "Expand sidebar",
  "collapseSidebar": "Collapse sidebar",
  "skipToContent": "Skip to content",
  "primary": "Primary",
  "settingsSections": "Settings sections",
  "routeAnnouncement": "Navigated to {{name}}"
}
```

`src/locales/en/errors.json`:

```json
{
  "title": "Something went wrong",
  "description": "Riff hit an unexpected problem. Your settings are safe.",
  "reload": "Reload",
  "openLogs": "Open log folder",
  "copyDiagnostics": "Copy diagnostics",
  "technicalDetails": "Technical details",
  "code": {
    "io": "Riff could not read or write a file.",
    "parse": "A file on disk is not valid JSON.",
    "validation": "That value is not allowed.",
    "not-found": "Riff could not find what it needed.",
    "denied": "Your system refused that action.",
    "unknown": "An unexpected error occurred."
  },
  "settingsRecovered": "Your settings file could not be read. Riff started from defaults and kept the original at {{path}}.",
  "settingsWriteFailed": "Riff could not save your settings. Your choices are still applied, and it will try again on the next change.",
  "decorationsRefused": "Your window manager refused to draw system decorations, so Riff kept its own title bar."
}
```

Create `src/locales/en/settings.json`, `src/locales/en/onboarding.json` and `src/locales/en/palette.json` as `{}` for now; Plans 07, 08 and 09 populate them.

- [ ] **Step 3: Write the failing test**

Create `src/app/i18n.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n from "./i18n";

describe("i18n", () => {
  it("initialises with english as the only locale", () => {
    expect(i18n.language).toBe("en");
    expect(Object.keys(i18n.options.resources ?? {})).toEqual(["en"]);
  });

  it("resolves keys from every declared namespace", () => {
    expect(i18n.t("common:appName")).toBe("Riff");
    expect(i18n.t("nav:practice")).toBe("Practice");
    expect(i18n.t("errors:code.denied")).toBe("Your system refused that action.");
  });

  it("interpolates", () => {
    expect(i18n.t("nav:routeAnnouncement", { name: "History" })).toBe("Navigated to History");
  });

  it("returns the key rather than blank text when one is missing", () => {
    expect(i18n.t("common:doesNotExist")).toBe("doesNotExist");
  });
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `pnpm test src/app/i18n`
Expected: FAIL — cannot resolve `./i18n`

- [ ] **Step 5: Implement**

Create `src/app/i18n.ts`:

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import common from "@/locales/en/common.json";
import errors from "@/locales/en/errors.json";
import nav from "@/locales/en/nav.json";
import onboarding from "@/locales/en/onboarding.json";
import palette from "@/locales/en/palette.json";
import settings from "@/locales/en/settings.json";

/**
 * English is bundled statically. With one locale, lazy loading adds a loading
 * state and a failure mode in exchange for nothing. When a second locale
 * arrives, this is where a resource backend goes.
 */
void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "nav", "settings", "onboarding", "errors", "palette"],
  resources: { en: { common, nav, settings, onboarding, errors, palette } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test src/app/i18n`
Expected: PASS, 4 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(i18n): initialise i18next with the english namespaces"
```

---

### Task 2: The router

**Interfaces:**
- Produces: `@/app/router` exporting `router`; the generated `src/routeTree.gen.ts`; routes `/practice`, `/history`, `/settings`.

**Files:**
- Create: `src/app/router.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/{practice,history,settings}.tsx`
- Modify: `vite.config.ts`, `.gitignore`

- [ ] **Step 1: Install, pinning both to the same version**

```bash
pnpm add @tanstack/react-router@1.170.32
pnpm add -D @tanstack/router-plugin@1.170.32
```

If that exact plugin version does not exist, install the newest matching **minor** of both and record the pair in the commit message. A skew here produces route-generation bugs that look like application bugs.

- [ ] **Step 2: Add the plugin to Vite**

In `vite.config.ts`, import and place it **before** the React plugin — it generates the route tree the React plugin then compiles:

```ts
import { tanstackRouter } from "@tanstack/router-plugin/vite";
```

```ts
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react({ babel: { plugins: [["babel-plugin-react-compiler", { target: "19" }]] } }),
    tailwindcss(),
  ],
```

The generated tree **is committed**: CI type-checks without running Vite, and a stale tree should show up as a reviewable diff rather than a mystery build failure.

- [ ] **Step 3: Create the routes**

`src/routes/__root.tsx` — deliberately self-contained. Tasks 3, 4 and 5 each
add one piece to it. Building it against components that do not exist yet
would leave the repository uncompilable at three task boundaries, and every
task in this plan has to end green:

```tsx
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createRootRoute({
  component: RootLayout,
  // Task 3 adds `errorComponent: RouteError`.
});

function RootLayout() {
  const { t, i18n } = useTranslation("nav");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [announcement, setAnnouncement] = useState("");

  // A client-side route change is silent to a screen reader. This is the
  // only thing that tells one the destination changed.
  // §10 requires both, and `dir` is what makes adding an RTL locale a
  // translation task rather than a rewrite.
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = i18n.dir();
  }, [i18n.language]);

  useEffect(() => {
    const name = pathname.split("/").filter(Boolean)[0] ?? "practice";
    setAnnouncement(t("routeAnnouncement", { name: t(name, { defaultValue: name }) }));
  }, [pathname, t]);

  return (
    <div className="flex h-screen flex-col bg-surface text-foreground">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:z-50 focus-visible:m-2 focus-visible:rounded-md focus-visible:bg-raised focus-visible:px-3 focus-visible:py-2"
      >
        {t("skipToContent")}
      </a>
      {/* Task 4 replaces this with <TitleBar />; Plan 07 makes it conditional
          on `appearance.titleBar`, because "System decorations" has to hide
          Riff's own bar or the window ends up with two. */}
      <header className="h-[var(--spacing-titlebar)] shrink-0" data-tauri-drag-region />
      {/* The container the sidebar's breakpoint measures. Chrome is rem-sized,
          so raising the UI scale shrinks this in px and the query fires —
          which a viewport media query could never do. */}
      <div className="@container/shell flex min-h-0 flex-1">
        {/* Task 5 replaces this with <Sidebar />. */}
        <main id="main" className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
```

`src/routes/index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // Plan 07 replaces this constant with the persisted startup route.
  beforeLoad: () => {
    throw redirect({ to: "/practice" });
  },
});
```

`src/routes/practice.tsx` and `src/routes/history.tsx` — stubs that Plan 10 replaces:

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/practice")({
  component: () => <div className="p-[var(--content-padding)]" />,
});
```

`src/routes/settings.tsx` — a stub that Plan 07 replaces:

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: () => <div className="p-[var(--content-padding)]" />,
});
```

- [ ] **Step 4: Create the router instance**

`src/app/router.tsx`:

```tsx
import { createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";

/**
 * Hash history, not browser history. Tauri's asset protocol serves no SPA
 * fallback, so reloading on a deep path like /settings/general would 404.
 * The URL is never visible — the window has no address bar.
 */
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] **Step 5: Verify the tree generates and the shell compiles**

Run: `pnpm dev` briefly, then stop it.
Expected: `src/routeTree.gen.ts` exists and lists `/practice`, `/history`, `/settings`.

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(router): add tanstack router on hash history with file routes"
```

---

### Task 3: Providers, error containment and mount

**Files:**
- Create: `src/app/providers.tsx`, `src/components/RouteError.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Install**

```bash
pnpm add react-error-boundary@6.1 sonner@2.0
```

- [ ] **Step 2: Write the error screen**

`src/components/RouteError.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ipc, isRiffError } from "@/lib/ipc";

export function RouteError({ error }: { error: unknown }) {
  const { t } = useTranslation("errors");
  const code = isRiffError(error) ? error.code : "unknown";
  const detail = error instanceof Error ? error.stack : JSON.stringify(error, null, 2);

  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground">{t(`code.${code}`, { defaultValue: t("code.unknown") })}</p>
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>{t("reload")}</Button>
        <Button variant="secondary" onClick={() => void ipc.openPath("logs")}>
          {t("openLogs")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void navigator.clipboard.writeText(String(detail))}
        >
          {t("copyDiagnostics")}
        </Button>
      </div>
      <details className="max-w-full">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          {t("technicalDetails")}
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-raised p-3 font-mono text-xs">
          {detail}
        </pre>
      </details>
    </div>
  );
}
```

- [ ] **Step 3: Write the providers**

`src/app/providers.tsx`:

```tsx
import { ErrorBoundary } from "react-error-boundary";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import type { ReactNode } from "react";
import i18n from "@/app/i18n";
import { RouteError } from "@/components/RouteError";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={400}>
        <ErrorBoundary FallbackComponent={RouteError}>{children}</ErrorBoundary>
        {/* sonner defaults to theme="light". Without this every toast is a
            white card on a #242424 application. Plan 07 replaces the literal
            with the persisted theme once the store exists. */}
        <Toaster theme="dark" position="bottom-end" closeButton />
      </TooltipProvider>
    </I18nextProvider>
  );
}
```

- [ ] **Step 4: Mount**

Overwrite `src/main.tsx`:

```tsx
import "@/styles/globals.css";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { Providers } from "@/app/providers";
import { router } from "@/app/router";
import { ipc } from "@/lib/ipc";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </React.StrictMode>,
);

// Reveal the window once something has painted. Rust shows it after three
// seconds regardless, so a failure here delays startup rather than preventing it.
requestAnimationFrame(() => {
  void ipc.appReady().catch(() => {});
});
```

- [ ] **Step 5: Wire the error component into the root route**

In `src/routes/__root.tsx`, add the import and the option the Task 2 comment
reserved:

```tsx
import { RouteError } from "@/components/RouteError";
```
```tsx
export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
});
```

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm app`
Expected: a dark window with an empty shell, no console errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): add providers, toasts and per-route error containment"
```

---

### Task 4: The title bar

**Interfaces:**
- Produces: `@/features/window/TitleBar` and `@/features/window/WindowControls`.

**Files:**
- Create: `src/features/window/TitleBar.tsx`, `src/features/window/WindowControls.tsx`, `src/features/window/TitleBar.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/features/window/TitleBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/app/i18n";

const windowMinimize = vi.fn();
const windowToggleMaximize = vi.fn();
const windowClose = vi.fn();
vi.mock("@/lib/ipc", () => ({
  ipc: { windowMinimize, windowToggleMaximize, windowClose },
  isRiffError: () => false,
}));

const { TitleBar } = await import("./TitleBar");

function renderBar() {
  return render(
    <I18nextProvider i18n={i18n}>
      <TitleBar />
    </I18nextProvider>,
  );
}

describe("TitleBar", () => {
  it("exposes every window control as a named button", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /minimi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maximi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("invokes the matching command", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: /minimi/i }));
    expect(windowMinimize).toHaveBeenCalledOnce();
  });

  it("marks the drag region so the window can be moved", () => {
    const { container } = renderBar();
    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderBar();
    await expect(container).toHaveNoAxeViolations();
  });
});
```

Add to `src/locales/en/nav.json`:

```json
  "minimize": "Minimize",
  "maximize": "Maximize",
  "restore": "Restore",
  "closeWindow": "Close window",
  "openPalette": "Search or jump to"
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test src/features/window`
Expected: FAIL — cannot resolve `./TitleBar`

- [ ] **Step 3: Implement the controls**

`src/features/window/WindowControls.tsx`:

```tsx
import { Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";

const BUTTON =
  "grid h-8 w-11 place-items-center text-foreground transition-colors hover:bg-raised";

export function WindowControls({ maximized = false }: { maximized?: boolean }) {
  const { t } = useTranslation("nav");
  return (
    <div className="flex items-center">
      <button type="button" className={BUTTON} aria-label={t("minimize")} onClick={() => void ipc.windowMinimize()}>
        <Minus size={16} aria-hidden />
      </button>
      <button
        type="button"
        className={BUTTON}
        // Telling a screen-reader user the button maximizes a window that is
        // already maximized is worse than not labelling it at all.
        aria-label={maximized ? t("restore") : t("maximize")}
        onClick={() => void ipc.windowToggleMaximize()}
      >
        <Square size={13} aria-hidden />
      </button>
      <button type="button" className={BUTTON} aria-label={t("closeWindow")} onClick={() => void ipc.windowClose()}>
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Implement the bar**

`src/features/window/TitleBar.tsx`:

```tsx
import { PanelLeft, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WindowControls } from "./WindowControls";

const ICON_BUTTON =
  "grid h-8 w-8 place-items-center rounded-md text-foreground transition-colors hover:bg-raised";

export function TitleBar({
  onToggleSidebar,
  onOpenPalette,
}: {
  onToggleSidebar?: () => void;
  onOpenPalette?: () => void;
}) {
  const { t } = useTranslation("nav");

  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--spacing-titlebar)] shrink-0 items-center gap-2 bg-surface ps-2 pe-0"
    >
      <button type="button" className={ICON_BUTTON} aria-label={t("toggleSidebar")} onClick={onToggleSidebar}>
        <PanelLeft size={18} aria-hidden />
      </button>

      {/* The wordmark is the one place Playfair appears. */}
      <span className="select-none font-display text-[1.375rem] italic leading-none">riff</span>

      {/* The mouse equivalent of Alt+K. Plan 09 supplies the handler. */}
      <button type="button" className={ICON_BUTTON} aria-label={t("openPalette")} onClick={onOpenPalette}>
        <Search size={16} aria-hidden />
      </button>

      <div data-tauri-drag-region className="h-full flex-1" />
      <WindowControls />
    </header>
  );
}
```

- [ ] **Step 5: Replace the placeholder header in the shell**

In `src/routes/__root.tsx`, swap the reserved `<header>` for the real bar:

```tsx
import { TitleBar } from "@/features/window/TitleBar";
```
```tsx
      <TitleBar />
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test src/features/window && pnpm typecheck`
Expected: PASS, 4 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(window): add the custom title bar and window controls"
```

---

### Task 5: The sidebar

**Files:**
- Create: `src/components/Sidebar.tsx`, `src/components/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/Sidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/app/i18n";

// `ReactNode` is imported explicitly: `React.*` in a module resolves to a UMD
// global and fails typecheck under `verbatimModuleSyntax`.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouterState: () => "/history",
}));

const { Sidebar } = await import("./Sidebar");

function renderSidebar(collapsed = false) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Sidebar collapsed={collapsed} />
    </I18nextProvider>,
  );
}

describe("Sidebar", () => {
  it("names its navigation landmark", () => {
    renderSidebar();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
  });

  it("marks the active route with aria-current", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Practice" })).not.toHaveAttribute("aria-current");
  });

  it("keeps every destination reachable when collapsed to the rail", () => {
    renderSidebar(true);
    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSidebar();
    await expect(container).toHaveNoAxeViolations();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test src/components/Sidebar`
Expected: FAIL — cannot resolve `./Sidebar`

- [ ] **Step 3: Implement**

`src/components/Sidebar.tsx`:

```tsx
import { Link, useRouterState } from "@tanstack/react-router";
import { AudioWaveform, FolderClock, Settings as SettingsIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

type Destination = { to: string; icon: LucideIcon; labelKey: string };

const PRIMARY: Destination[] = [
  { to: "/practice", icon: AudioWaveform, labelKey: "practice" },
  { to: "/history", icon: FolderClock, labelKey: "history" },
];

const FOOTER: Destination[] = [{ to: "/settings", icon: SettingsIcon, labelKey: "settings" }];

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation("nav");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label={t("primary")}
      className={cn(
        "flex shrink-0 flex-col justify-between border-e border-separator bg-surface py-3 transition-[width]",
        // Below 900px of available width the sidebar drops to its rail
        // regardless of the setting (§7.4), because at 1.5x scale in a
        // minimum-size window the chrome would otherwise leave the content
        // column unusable. The user's own collapse choice still wins above it.
        "@max-[900px]/shell:w-[var(--spacing-sidebar-rail)] @max-[900px]/shell:px-2",
        collapsed ? "w-[var(--spacing-sidebar-rail)] px-2" : "w-[var(--spacing-sidebar)] px-3",
      )}
    >
      <ul className="flex flex-col gap-[var(--row-gap)]">
        {PRIMARY.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} pathname={pathname} />
        ))}
      </ul>
      <ul className="flex flex-col gap-[var(--row-gap)]">
        {FOOTER.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}

function NavItem({
  item,
  collapsed,
  pathname,
}: {
  item: Destination;
  collapsed: boolean;
  pathname: string;
}) {
  const { t } = useTranslation("nav");
  const label = t(item.labelKey);
  const active = pathname.startsWith(item.to);
  const Icon = item.icon;

  return (
    <li>
      <Link
        to={item.to}
        aria-current={active ? "page" : undefined}
        title={label}
        // The accessible name is on the attribute unconditionally: below the
        // rail breakpoint the visible text is display:none, and a hidden
        // <span> contributes nothing to the accessible name.
        aria-label={label}
        className={cn(
          "flex h-[var(--row-height)] items-center gap-3 rounded-[var(--radius-nav)] px-3 text-[0.9375rem] font-medium",
          "transition-colors hover:bg-raised",
          active && "bg-raised",
          collapsed && "justify-center px-0",
          "@max-[900px]/shell:justify-center @max-[900px]/shell:px-0",
        )}
      >
        <Icon size={18} aria-hidden className="shrink-0" />
        {!collapsed && <span className="truncate @max-[900px]/shell:hidden">{label}</span>}
      </Link>
    </li>
  );
}
```

- [ ] **Step 4: Wire the sidebar and its collapse state into the root layout**

In `src/routes/__root.tsx`, replace the `{/* Task 5 replaces this ... */}`
comment with `<Sidebar collapsed={collapsed} />`, and hold the collapsed flag
locally for now — Plan 07 replaces it with the persisted setting:

```tsx
const [collapsed, setCollapsed] = useState(false);
```

Pass `onToggleSidebar={() => setCollapsed((v) => !v)}` to `<TitleBar />` and `collapsed={collapsed}` to `<Sidebar />`.

- [ ] **Step 5: Run the tests**

Run: `pnpm test src/components/Sidebar`
Expected: PASS, 4 tests

- [ ] **Step 6: Verify in the application**

Run: `pnpm app`
Expected: the sidebar matches the mockup; clicking the panel icon collapses it to a rail; Practice and History navigate.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(shell): add the primary sidebar with a collapsible rail"
```

---

### Task 6: Gate check

- [ ] **Step 1: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
Expected: all exit 0.

- [ ] **Step 2: Confirm no physical-direction utilities crept in**

Run: `grep -rEn '\b(ml|mr|pl|pr|left|right)-[0-9]' src/components src/features src/routes || echo "logical properties only"`
Expected: `logical properties only`. Physical direction classes make RTL a rewrite instead of a translation.

- [ ] **Step 3: Confirm no untranslated user-visible strings**

Run: `grep -rEn '>[A-Z][a-z]{3,}' src/components src/features --include='*.tsx' | grep -v 't(' || echo "all strings translated"`
Expected: `all strings translated`, ignoring any hit that is a component name rather than copy.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: verify app shell gates" --allow-empty
```

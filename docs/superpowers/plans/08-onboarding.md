# 08 — Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A three-step first run — welcome, theme, privacy — that appears exactly once and can be replayed on demand.

**Architecture:** Onboarding is a route, not a modal, guarded in the root route's `beforeLoad`. The decision of whether to show it is a pure function over the persisted `onboarding` object, so every edge — never completed, completed at an older version, completed at a newer one — is unit-tested rather than reasoned about.

**Tech Stack:** TanStack Router, Zustand, shadcn primitives.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§8.2)

## Global Constraints

- **Full window, title bar retained** so the window stays closable. No sidebar.
- **The pre-selected theme is a real answer.** It is applied on arrival at the step and committed if the user continues without clicking, so nobody lands in a default they never saw.
- **Every user-visible string** goes through `t()`.
- **Logical properties only.** **No accent hue.** **`lucide-react` only.**
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/features/onboarding/gate.ts` | `shouldShowOnboarding`, `preferredTheme` |
| `src/features/onboarding/OnboardingFlow.tsx` | Step machine, progress dots, Back/Continue |
| `src/features/onboarding/steps/{Welcome,ThemeStep,Privacy}.tsx` | The three panels |
| `src/routes/onboarding.tsx` | Route, no sidebar |
| `src/routes/__root.tsx` | The guard |

---

### Task 1: The gate

**Interfaces:**
- Produces: `@/features/onboarding/gate` exporting `shouldShowOnboarding(onboarding: Onboarding, currentVersion: number): boolean` and `preferredTheme(): Theme`.

**Files:**
- Create: `src/features/onboarding/gate.ts`, `src/features/onboarding/gate.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/features/onboarding/gate.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { preferredTheme, shouldShowOnboarding } from "./gate";

const CURRENT = 1;

describe("shouldShowOnboarding", () => {
  it("shows on a fresh install", () => {
    expect(shouldShowOnboarding({ completedAt: null, version: 0 }, CURRENT)).toBe(true);
  });

  it("does not show once completed at the current version", () => {
    expect(
      shouldShowOnboarding({ completedAt: "2026-08-28T10:00:00Z", version: 1 }, CURRENT),
    ).toBe(false);
  });

  it("shows again when completed at an older version", () => {
    expect(
      shouldShowOnboarding({ completedAt: "2026-08-28T10:00:00Z", version: 0 }, CURRENT),
    ).toBe(true);
  });

  it("does not show when completed at a newer version after a downgrade", () => {
    expect(
      shouldShowOnboarding({ completedAt: "2026-08-28T10:00:00Z", version: 99 }, CURRENT),
    ).toBe(false);
  });
});

describe("preferredTheme", () => {
  it("suggests light when the desktop prefers it", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(preferredTheme()).toBe("light");
  });

  it("suggests dark otherwise, matching riff's own default", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    expect(preferredTheme()).toBe("dark");
  });

  it("suggests dark when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(preferredTheme()).toBe("dark");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm test onboarding/gate`
Expected: FAIL — cannot resolve `./gate`

- [ ] **Step 3: Implement**

`src/features/onboarding/gate.ts`:

```ts
import type { Onboarding, Theme } from "@/lib/ipc";

/**
 * Bump this to present onboarding again to existing users after adding a step
 * worth showing them. Exported because the root route's guard needs it too.
 */
export const ONBOARDING_VERSION = 1;

/**
 * A version LOWER than current re-presents onboarding — that is how a new
 * step is introduced to existing users. A version HIGHER is left alone: a
 * downgraded install must not force a wizard the user already finished.
 */
export function shouldShowOnboarding(onboarding: Onboarding, currentVersion: number): boolean {
  if (onboarding.completedAt === null) return true;
  return onboarding.version < currentVersion;
}

/**
 * A suggestion only. Riff has no System theme (the user answers once), but
 * opening the theme step already matching their desktop is a courtesy.
 */
export function preferredTheme(): Theme {
  if (typeof matchMedia !== "function") return "dark";
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test onboarding/gate`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(onboarding): add the gate and theme suggestion"
```

---

### Task 2: The flow

**Files:**
- Create: `src/features/onboarding/OnboardingFlow.tsx`, `src/features/onboarding/OnboardingFlow.test.tsx`, `src/routes/onboarding.tsx`
- Modify: `src/locales/en/onboarding.json`, `src/routes/__root.tsx`

- [ ] **Step 1: Add the strings**

`src/locales/en/onboarding.json`:

```json
{
  "step": "Step {{current}} of {{total}}",
  "welcome": {
    "title": "Practice everything in one place",
    "body": "Riff keeps your score, your video and your audio side by side, so you stop juggling three windows and start playing."
  },
  "theme": {
    "title": "Pick a look",
    "body": "You can change this at any time in Settings.",
    "dark": "Dark",
    "light": "Light",
    "preview": "{{name}} theme preview"
  },
  "privacy": {
    "title": "Everything stays here",
    "body": "Riff has no accounts, no telemetry and makes no network connections at all. Your files never leave this machine. Here is exactly where Riff keeps things:",
    "done": "Start practising"
  }
}
```

- [ ] **Step 2: Write the failing test**

`src/features/onboarding/OnboardingFlow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const patch = vi.fn().mockResolvedValue(undefined);
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/stores/settings", () => ({
  useSettings: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      patch,
      paths: { configDir: "/c", dataDir: "/d", cacheDir: "/k", logDir: "/l", stateDir: "/s" },
    }),
}));
vi.mock("@/lib/ipc", () => ({ ipc: { openPath: vi.fn() } }));

const { OnboardingFlow } = await import("./OnboardingFlow");

function renderFlow() {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true })); // desktop prefers light
  return render(
    <I18nextProvider i18n={i18n}>
      <OnboardingFlow />
    </I18nextProvider>,
  );
}

describe("OnboardingFlow", () => {
  beforeEach(() => {
    patch.mockClear();
    navigate.mockClear();
  });

  it("starts on welcome and reports progress", () => {
    renderFlow();
    expect(screen.getByText(/Practice everything in one place/)).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("applies the suggested theme on arrival at the theme step", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(patch).toHaveBeenCalledWith({ appearance: { theme: "light" } });
  });

  it("commits the suggestion when the user continues without choosing", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i })); // → theme
    patch.mockClear();
    await user.click(screen.getByRole("button", { name: /continue/i })); // → privacy
    await user.click(screen.getByRole("button", { name: /start practising/i }));

    const completion = patch.mock.calls.at(-1)?.[0];
    expect(completion.onboarding.completedAt).toEqual(expect.any(String));
    expect(completion.onboarding.version).toBe(1);
  });

  it("applies the other theme instantly when chosen", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    patch.mockClear();
    await user.click(screen.getByRole("radio", { name: /^Dark/ }));
    expect(patch).toHaveBeenCalledWith({ appearance: { theme: "dark" } });
  });

  it("can go back", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("navigates away once finished", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /start practising/i }));
    expect(navigate).toHaveBeenCalledWith({ to: "/practice" });
  });

  it("has no accessibility violations", async () => {
    const { container } = renderFlow();
    await expect(container).toHaveNoAxeViolations();
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm test OnboardingFlow`
Expected: FAIL — cannot resolve `./OnboardingFlow`

- [ ] **Step 4: Implement**

`src/features/onboarding/OnboardingFlow.tsx`:

```tsx
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ipc, type Theme } from "@/lib/ipc";
import { PATH_KINDS, pathFor } from "@/lib/paths";
import { useSettings } from "@/stores/settings";
import { ONBOARDING_VERSION, preferredTheme } from "./gate";

const STEPS = ["welcome", "theme", "privacy"] as const;

export function OnboardingFlow() {
  const { t } = useTranslation(["onboarding", "common", "settings"]);
  const navigate = useNavigate();
  const patch = useSettings((s) => s.patch);
  const paths = useSettings((s) => s.paths);
  const [index, setIndex] = useState(0);
  const [theme, setTheme] = useState<Theme>(preferredTheme);

  // Applied on arrival, so the step opens already looking like the
  // recommendation rather than describing it.
  useEffect(() => {
    if (STEPS[index] === "theme") void patch({ appearance: { theme } });
    // biome-ignore lint/correctness/useExhaustiveDependencies: only on entering
    // the step; choosing a card calls choose() directly. ESLint is not installed,
    // so an eslint-disable comment here would be inert and the rule would fire.
  }, [index]);

  function choose(next: Theme) {
    setTheme(next);
    void patch({ appearance: { theme: next } });
  }

  async function finish() {
    await patch({
      appearance: { theme },
      onboarding: { completedAt: new Date().toISOString(), version: ONBOARDING_VERSION },
    });
    navigate({ to: "/practice" });
  }

  const step = STEPS[index];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <p className="font-mono text-xs text-muted-foreground">
        {t("onboarding:step", { current: index + 1, total: STEPS.length })}
      </p>

      <div className="w-full max-w-2xl text-center">
        {step === "welcome" && (
          <>
            <p className="font-display text-5xl italic">riff</p>
            <h1 className="mt-6 text-2xl font-semibold">{t("onboarding:welcome.title")}</h1>
            <p className="mt-3 text-muted-foreground">{t("onboarding:welcome.body")}</p>
          </>
        )}

        {step === "theme" && (
          <>
            <h1 className="text-2xl font-semibold">{t("onboarding:theme.title")}</h1>
            <p className="mt-2 text-muted-foreground">{t("onboarding:theme.body")}</p>
            <div
              role="radiogroup"
              aria-label={t("onboarding:theme.title")}
              className="mt-8 flex justify-center gap-6"
            >
              {(["dark", "light"] as Theme[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={theme === option}
                  onClick={() => choose(option)}
                  className={cn(
                    "w-64 rounded-[var(--radius-card)] border-2 p-3 transition-colors",
                    theme === option ? "border-ring" : "border-border-subtle",
                  )}
                >
                  <ThemePreview variant={option} />
                  <span className="mt-3 block text-sm font-medium">
                    {t(`onboarding:theme.${option}`)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "privacy" && (
          <>
            <h1 className="text-2xl font-semibold">{t("onboarding:privacy.title")}</h1>
            <p className="mt-3 text-muted-foreground">{t("onboarding:privacy.body")}</p>
            <ul className="mx-auto mt-6 flex max-w-lg flex-col gap-2 text-start">
              {PATH_KINDS.map((kind) => (
                <li key={kind} className="flex items-center justify-between gap-4">
                  <code className="truncate font-mono text-xs text-muted-foreground">
                    {pathFor(kind, paths)}
                  </code>
                  <Button variant="ghost" size="sm" onClick={() => void ipc.openPath(kind)}>
                    {t("common:openFolder")}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {STEPS.map((name, i) => (
          <span
            key={name}
            aria-hidden
            className={cn("h-2 w-2 rounded-full", i === index ? "bg-foreground" : "bg-raised")}
          />
        ))}
      </div>

      <div className="flex gap-3">
        {index > 0 && (
          <Button variant="ghost" onClick={() => setIndex((i) => i - 1)}>
            {t("common:back")}
          </Button>
        )}
        {index < STEPS.length - 1 ? (
          <Button onClick={() => setIndex((i) => i + 1)}>{t("common:continue")}</Button>
        ) : (
          <Button onClick={() => void finish()}>{t("onboarding:privacy.done")}</Button>
        )}
      </div>
    </div>
  );
}

/** A miniature of the real shell, so the choice is shown rather than named. */
function ThemePreview({ variant }: { variant: Theme }) {
  const { t } = useTranslation("onboarding");
  return (
    <div
      data-theme={variant}
      role="img"
      aria-label={t("theme.preview", { name: t(`theme.${variant}`) })}
      className="flex h-28 overflow-hidden rounded-md bg-surface"
    >
      <div className="w-1/4 bg-surface p-1.5">
        <div className="h-3 rounded bg-raised" />
        <div className="mt-1 h-3 rounded bg-raised opacity-50" />
      </div>
      <div className="flex-1 p-1.5">
        <div className="h-full rounded bg-card" />
      </div>
    </div>
  );
}
```

`src/routes/onboarding.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";

export const Route = createFileRoute("/onboarding")({ component: OnboardingFlow });
```

- [ ] **Step 5: Add the guard and hide the shell**

In `src/routes/__root.tsx`:

```tsx
export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  beforeLoad: ({ location }) => {
    const { onboarding } = useSettings.getState().settings;
    const needed = shouldShowOnboarding(onboarding, ONBOARDING_VERSION);
    if (needed && location.pathname !== "/onboarding") {
      throw redirect({ to: "/onboarding" });
    }
    if (!needed && location.pathname === "/onboarding") {
      throw redirect({ to: "/practice" });
    }
  },
});
```

And in `RootLayout`, hide the sidebar while onboarding — the title bar stays so the window remains closable:

```tsx
const onboardingActive = pathname === "/onboarding";
```
```tsx
{!onboardingActive && <Sidebar collapsed={effectiveCollapsed} />}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test OnboardingFlow`
Expected: PASS, 7 tests

- [ ] **Step 7: Verify by hand**

```bash
rm -rf ~/.config/riff && pnpm app
```
Expected: onboarding appears; picking a theme retints instantly; finishing lands on Practice. Quit and relaunch — onboarding does not reappear. Settings → General → Run setup shows it again.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(onboarding): add the three-step first run"
```

---

### Task 3: Gate check

- [ ] **Step 1: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
Expected: all exit 0.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: verify onboarding gates" --allow-empty
```

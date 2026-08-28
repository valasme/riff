# 05 — Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The visual language from the mockups, expressed as tokens that four independent settings — theme, density, contrast, scale — can vary without any component knowing they exist.

**Architecture:** One CSS variable layer holds the raw values; Tailwind v4's `@theme inline` points its utilities at those variables rather than copying them, so overriding a variable under `[data-theme="light"]` retints the whole application. The only JavaScript is a pure function that writes four attributes onto `<html>` — which is therefore the only part with tests.

**Tech Stack:** Tailwind CSS 4.3, shadcn/ui 4.19 on Radix, Fontsource, `lucide-react`, `clsx`, `tailwind-merge`.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§7)

## Global Constraints

- **Colour tokens** (dark / light): surface `#242424` / `#fafafa`; card `#323232` / `#f2f2f2`; raised `#3c3c3c` / `#eaeaea`; border `#4d4d4d` / `#d4d4d4`; separator `#313131` / `#e6e6e6`; foreground `#e4e4e4` / `#1c1c1c`; muted-foreground `#9a9a9a` / `#5f5f5f`. High contrast: border → `#6d6d6d` / `#8a8a8a`, muted-foreground → `#b0b0b0` / `#4a4a4a`.
- **There is no accent hue.** Focus is a neutral ring. Do not introduce a brand colour.
- **Type:** Outfit Variable (UI), Playfair Display Italic 700 (wordmark only), JetBrains Mono Variable (paths, versions). Self-hosted; no runtime font fetch — the CSP forbids it.
- **Icons:** `lucide-react` only.
- **Metrics** (expressed in `rem` so `--ui-scale` carries them; px shown at the 16px default): title bar 2.75rem/44px; sidebar 14rem/224px expanded, 3.5rem/56px rail; settings sub-navigation 15rem/240px; nav item 2.5rem/40px tall, 0.75rem/12px radius; content padding 1.5rem/24px; card radius 0.75rem/12px; pane radius 0.625rem/10px; focus ring 2px with 2px offset.
- **Every user-visible string** goes through `t()`.
- **Never install:** `eslint`, `prettier`, any HTTP client.
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/styles/fonts.css` | Fontsource imports, isolated so the font set is auditable |
| `src/styles/globals.css` | Token layer, theme/density/contrast overrides, base element styles |
| `src/lib/cn.ts` | `clsx` + `tailwind-merge` class combinator |
| `src/lib/appearance.ts` | `applyAppearance`, `resolveMotion` — the only scripted part |
| `src/components/ui/*` | shadcn primitives, re-skinned to the tokens |
| `components.json` | shadcn configuration |

---

### Task 1: Fonts

**Files:**
- Create: `src/styles/fonts.css`
- Modify: `src/styles/globals.css`

- [x] **Step 1: Install**

```bash
pnpm add @fontsource-variable/outfit@5.3 @fontsource/playfair-display@5.3 @fontsource-variable/jetbrains-mono@5.3
```

- [x] **Step 2: Import exactly what is used**

Create `src/styles/fonts.css`:

```css
/* Self-hosted. The CSP has no `font-src` beyond 'self', so a runtime fetch
   from a font CDN is not merely discouraged — it is blocked. */

/* UI. Variable, so every weight costs one file. */
@import "@fontsource-variable/outfit/latin.css";

/* Wordmark only. Italic 700 is the single cut the mark uses; importing the
   whole family would ship eight faces to render four letters. */
@import "@fontsource/playfair-display/700-italic.css";

/* Paths, versions and diagnostics. */
/* `latin.css`, not `index.css`: index pulls every unicode subset — latin-ext,
   cyrillic, vietnamese — which is roughly fifteen woff2 files bundled to
   render an English-only interface. §7.2 says only the cuts in use. */
@import "@fontsource-variable/jetbrains-mono/latin.css";
```

- [x] **Step 3: Verify the faces are emitted and self-hosted**

Add `@import "./fonts.css";` as the second line of `src/styles/globals.css` (after the Tailwind import), then:

Run: `pnpm build && ls dist/assets/*.woff2 | head -3`
Expected: woff2 files present in the build output.

Run: `grep -ro 'https://fonts' dist/ | head -1`
Expected: no output — nothing points at a remote font host.

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(design): self-host outfit, playfair display and jetbrains mono"
```

---

### Task 2: The token layer

**Files:**
- Modify: `src/styles/globals.css`

- [x] **Step 1: Write the stylesheet**

Overwrite `src/styles/globals.css`:

```css
@import "tailwindcss";
@import "./fonts.css";

/* ---------------------------------------------------------------------------
   Raw values. Four independent axes vary these: theme, contrast, density and
   scale. Components never read them directly — they use the Tailwind
   utilities below, which point at these variables by reference.
   --------------------------------------------------------------------------- */

:root {
  --surface: #242424;
  --card: #323232;
  --raised: #3c3c3c;
  --border-subtle: #4d4d4d;
  --separator: #313131;
  --fg: #e4e4e4;
  --fg-muted: #9a9a9a;
  --ring: #e4e4e4;

  /* Density-driven spacing. Adjusts space, never font size, so density and
     UI scale stay orthogonal controls.
     These three are the ONLY things Compact changes, so every component that
     has a row, a gap or page padding must read them. A hardcoded `h-10` or
     `py-4` is a component opting out of the density setting, which is how a
     control ends up persisting perfectly and doing nothing. */
  --row-height: 2.5rem;
  --row-gap: 0.25rem;
  --content-padding: 1.5rem;
  --section-gap: 1.5rem;

  --ui-scale: 1;
}

[data-theme="light"] {
  --surface: #fafafa;
  --card: #f2f2f2;
  --raised: #eaeaea;
  --border-subtle: #d4d4d4;
  --separator: #e6e6e6;
  --fg: #1c1c1c;
  --fg-muted: #5f5f5f;
  --ring: #1c1c1c;
}

/* The source palette's borders measure 1.8:1 against the surface, below the
   3:1 WCAG 1.4.11 wants for control boundaries. Rather than repaint the
   design for everyone, this raises them for users who ask. #6d6d6d is exactly
   3.0:1 on #242424 — computed, not guessed. */
[data-contrast="high"] {
  --border-subtle: #6d6d6d;
  --fg-muted: #b0b0b0;
}

[data-theme="light"][data-contrast="high"] {
  --border-subtle: #8a8a8a;
  --fg-muted: #4a4a4a;
}

/* Honoured by default for the same reason `prefers-reduced-motion` is: it is
   an unambiguous accessibility declaration the desktop makes on the user's
   behalf. Theme has no System option because colour scheme is a taste
   question the user was already asked once (D2); contrast is not. The
   explicit setting still wins, via [data-contrast]. */
@media (prefers-contrast: more) {
  :root:not([data-contrast="normal"]) {
    --border-subtle: #6d6d6d;
    --fg-muted: #b0b0b0;
  }
  [data-theme="light"]:not([data-contrast="normal"]) {
    --border-subtle: #8a8a8a;
    --fg-muted: #4a4a4a;
  }
}

[data-density="compact"] {
  --row-height: 2.125rem;
  --row-gap: 0.125rem;
  --content-padding: 1rem;
  --section-gap: 1rem;
}

/* ---------------------------------------------------------------------------
   Tailwind tokens. `inline` makes the generated utilities reference the
   variables above rather than copying their values, which is what allows a
   theme switch to be a single attribute change with no recompilation.
   --------------------------------------------------------------------------- */

@theme inline {
  --color-surface: var(--surface);
  --color-card: var(--card);
  --color-raised: var(--raised);
  --color-border-subtle: var(--border-subtle);
  --color-separator: var(--separator);
  --color-foreground: var(--fg);
  --color-muted-foreground: var(--fg-muted);
  --color-ring: var(--ring);

  --font-sans: "Outfit Variable", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Playfair Display", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;

  /* rem, not px, and that is the whole point. `--ui-scale` multiplies the
     root font size, so a px value here would leave the title bar, sidebar and
     sub-navigation frozen while the text inside them grew — large type in a
     fixed frame, which is worse than either extreme. §6.3 requires every
     dimension in rem; these are the ones it is easiest to get wrong.
     At the 16px default: 0.625rem = 10px, 2.75rem = 44px, 14rem = 224px,
     3.5rem = 56px, 15rem = 240px. */
  --radius-pane: 0.625rem;
  --radius-card: 0.75rem;
  --radius-nav: 0.75rem;

  --spacing-titlebar: 2.75rem;
  --spacing-sidebar: 14rem;
  --spacing-sidebar-rail: 3.5rem;
  --spacing-subnav: 15rem;
}

/* ---------------------------------------------------------------------------
   Base
   --------------------------------------------------------------------------- */

html {
  /* Every dimension in the application is in rem, so this one line scales
     the entire interface rather than only its text. */
  font-size: calc(16px * var(--ui-scale, 1));
}

body {
  margin: 0;
  background-color: var(--surface);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 0.875rem;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  overflow: hidden; /* the shell scrolls its own panes */
}

/* Focus is never removed, only restyled. The ring is 12.2:1 on the dark
   surface, so it needs no accent colour to be unmistakable. */
:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  /* No `border-radius` here. The outline already follows the element's own
     radius; setting one would snap a 12px nav pill to 4px on keyboard focus,
     changing the shape of the thing being focused. */
}

/* Honour the desktop's declaration, and let the setting force it either way. */
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion="full"]) *,
  :root:not([data-motion="full"]) *::before,
  :root:not([data-motion="full"]) *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

[data-motion="reduced"] *,
[data-motion="reduced"] *::before,
[data-motion="reduced"] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}

/* Anything genuinely off-screen but announced. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border-width: 0;
}
```

- [x] **Step 2: Verify the theme override actually retints a utility**

Run: `pnpm build && grep -c 'data-theme="light"' dist/assets/*.css`
Expected: at least `1`.

- [x] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(design): add the token layer with theme, contrast and density axes"
```

---

### Task 3: `applyAppearance`

**Interfaces:**
- Produces: `@/lib/appearance` exporting `applyAppearance(root: HTMLElement, appearance: Appearance): void` and `resolveMotion(preference: ReduceMotion): "reduced" | "full"`.

**Files:**
- Create: `src/lib/appearance.ts`, `src/lib/appearance.test.ts`

- [x] **Step 1: Write the failing tests**

Create `src/lib/appearance.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Appearance } from "@/lib/ipc";
import { applyAppearance, resolveMotion } from "./appearance";

const base: Appearance = {
  theme: "dark",
  density: "comfortable",
  uiScale: 1,
  reduceMotion: "system",
  highContrast: false,
  titleBar: "custom",
  sidebar: { collapsed: false, rememberCollapsed: true },
};

function mockPrefersReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
}

describe("applyAppearance", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("html");
    mockPrefersReducedMotion(false);
  });

  it("writes every axis as an attribute", () => {
    applyAppearance(root, { ...base, theme: "light", density: "compact", highContrast: true });
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.density).toBe("compact");
    expect(root.dataset.contrast).toBe("high");
  });

  it("marks normal contrast explicitly rather than omitting the attribute", () => {
    applyAppearance(root, base);
    expect(root.dataset.contrast).toBe("normal");
  });

  it("sets the scale as a custom property", () => {
    applyAppearance(root, { ...base, uiScale: 1.25 });
    expect(root.style.getPropertyValue("--ui-scale")).toBe("1.25");
  });

  it("clamps a scale outside the supported range", () => {
    applyAppearance(root, { ...base, uiScale: 9 });
    expect(root.style.getPropertyValue("--ui-scale")).toBe("1.5");
    applyAppearance(root, { ...base, uiScale: 0.1 });
    expect(root.style.getPropertyValue("--ui-scale")).toBe("0.8");
  });

  it("follows the desktop when motion preference is system", () => {
    mockPrefersReducedMotion(true);
    expect(resolveMotion("system")).toBe("reduced");
    mockPrefersReducedMotion(false);
    expect(resolveMotion("system")).toBe("full");
  });

  it("lets the setting override the desktop in both directions", () => {
    mockPrefersReducedMotion(true);
    expect(resolveMotion("never")).toBe("full");
    mockPrefersReducedMotion(false);
    expect(resolveMotion("always")).toBe("reduced");
  });
});
```

- [x] **Step 2: Run and watch them fail**

Run: `pnpm test src/lib/appearance`
Expected: FAIL — cannot resolve `./appearance`

- [x] **Step 3: Implement**

Create `src/lib/appearance.ts`:

```ts
import type { Appearance, ReduceMotion } from "@/lib/ipc";

const SCALE_MIN = 0.8;
const SCALE_MAX = 1.5;

/**
 * `system` defers to the desktop's `prefers-reduced-motion`, which is an
 * unambiguous accessibility declaration made on the user's behalf. Theme has
 * no equivalent System option on purpose: colour scheme is a taste question
 * the user already answered during onboarding.
 */
export function resolveMotion(preference: ReduceMotion): "reduced" | "full" {
  if (preference === "always") return "reduced";
  if (preference === "never") return "full";
  const prefersReduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return prefersReduced ? "reduced" : "full";
}

/**
 * The single place appearance settings become DOM state. The same four
 * attributes are written by the Rust bootstrap script before React mounts,
 * so the first painted frame already matches.
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  root.dataset.theme = appearance.theme;
  root.dataset.density = appearance.density;
  root.dataset.contrast = appearance.highContrast ? "high" : "normal";
  root.dataset.motion = resolveMotion(appearance.reduceMotion);

  const scale = Number.isFinite(appearance.uiScale)
    ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, appearance.uiScale))
    : 1;
  root.style.setProperty("--ui-scale", String(scale));
}
```

- [x] **Step 4: Run the tests**

Run: `pnpm test src/lib/appearance`
Expected: PASS, 6 tests

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(design): apply appearance settings as html attributes"
```

---

### Task 4: shadcn primitives

**Files:**
- Create: `components.json`, `src/lib/cn.ts`, `src/components/ui/*`

- [x] **Step 1: Add the class combinator**

```bash
pnpm add clsx tailwind-merge@3.6 lucide-react@1.34
```

Create `src/lib/cn.ts`:

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [x] **Step 2: Initialise shadcn**

```bash
pnpm dlx shadcn@4.19.0 init
```

Answer: TypeScript **yes**, style **new-york**, base colour **neutral** (there is no accent hue — see Global Constraints), CSS file `src/styles/globals.css`, CSS variables **yes**, alias `@/components`, utils `@/lib/cn`.

If the initialiser rewrites `src/styles/globals.css`, restore it from git and keep only any `@layer base` block it added that shadcn genuinely needs:

```bash
git diff src/styles/globals.css
```

- [x] **Step 3: Add only the primitives this milestone uses**

```bash
pnpm dlx shadcn@4.19.0 add button dialog switch slider radio-group tooltip \
  skeleton label sonner command
```

Nothing beyond this list, and the list is shorter than the spec's §6.4 draft
on purpose. `select`, `dropdown-menu`, `scroll-area`, `separator` and `input`
were on it and no plan ever imports them — General uses a native `<select>`
for a three-option list and History a native `<input>`. A primitive with no
consumer is dead code that still has to be maintained and audited, and that
rule has to apply to this list too.

`sonner` ships a component that imports `next-themes`. Delete that import and
drive it from Riff's own store instead; pulling a Next.js dependency into a
Vite application to read a theme Riff already owns is not a trade worth
making.

shadcn's Tailwind-v4 components use `animate-in`, `fade-in-0` and
`zoom-in-95`, which come from `tw-animate-css`. If `shadcn init` adds
`@import "tw-animate-css";` to `globals.css`, keep that line when you restore
the file in Step 2 and add the package — otherwise every overlay animation is
silently a no-op, with no build error to tell you.

- [x] **Step 4: Retint the primitives to the tokens**

In every file under `src/components/ui/`, replace shadcn's default token names with Riff's:

| shadcn | Riff |
|---|---|
| `bg-background` | `bg-surface` |
| `bg-popover`, `bg-card` | `bg-card` |
| `bg-secondary`, `bg-muted`, `bg-accent` | `bg-raised` |
| `text-foreground` | `text-foreground` (unchanged) |
| `text-muted-foreground` | `text-muted-foreground` (unchanged) |
| `border-input`, `border-border` | `border-border-subtle` |
| `ring-ring` | `ring-ring` (unchanged) |
| `bg-primary`, `text-primary-foreground` | `bg-raised`, `text-foreground` |

Delete any `bg-destructive` styling and replace with `bg-raised text-foreground` plus a bold label — the palette has no red, and the destructive action (Reset all settings) is guarded by a confirmation dialog rather than by colour.

- [x] **Step 5: Write a smoke test**

Create `src/components/ui/ui.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

describe("ui primitives", () => {
  it("renders a button with no accessibility violations", async () => {
    const { container } = render(<Button>Open settings</Button>);
    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
    await expect(container).toHaveNoAxeViolations();
  });

  it("renders a labelled switch", async () => {
    const { container } = render(
      <>
        <label htmlFor="probe">Confirm before quitting</label>
        <Switch id="probe" />
      </>,
    );
    expect(screen.getByRole("switch", { name: "Confirm before quitting" })).toBeInTheDocument();
    await expect(container).toHaveNoAxeViolations();
  });

  it("uses riff tokens rather than shadcn defaults", () => {
    const { container } = render(<Button variant="secondary">Probe</Button>);
    const className = container.firstElementChild?.className ?? "";
    expect(className).not.toMatch(/bg-(background|primary|secondary|accent)\b/);
  });
});
```

- [x] **Step 6: Run it**

Run: `pnpm test src/components/ui`
Expected: PASS, 3 tests

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(design): add shadcn primitives retinted to the riff tokens"
```

---

### Task 5: Gate check

- [x] **Step 1: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
Expected: all exit 0.

- [x] **Step 2: Confirm density is actually wired**

Run: `grep -rn 'var(--row-height)\|var(--section-gap)\|var(--content-padding)' src/ | wc -l`
Expected: at least one consumer per token once Plans 06, 07 and 10 have run. A
token defined and never read means Compact changes nothing, which is a setting
that persists perfectly and does nothing — the exact bug this milestone keeps
finding.

- [x] **Step 3: Confirm every chrome dimension scales**

Run: `grep -nE '\-\-(spacing|radius)-[a-z-]+: [0-9]+px' src/styles/globals.css || echo "all chrome tokens are in rem"`
Expected: `all chrome tokens are in rem`. A px value here silently opts that
dimension out of the UI-scale slider.

- [x] **Step 4: Confirm no accent hue crept in**

Run: `grep -rEo '#[0-9a-fA-F]{6}' src/styles/ src/components/ui/ | sort -u`
Expected: only greys — every value has equal red, green and blue components. Any coloured hex is either a mistake or a decision that needs recording in the spec first.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: verify design system gates" --allow-empty
```

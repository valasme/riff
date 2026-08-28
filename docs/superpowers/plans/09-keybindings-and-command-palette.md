# 09 — Keybindings and Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alt+K opens a navigation palette; every other shortcut comes from the same registry that the palette displays.

**Architecture:** One registry of `{ id, chord, description, run }`. A single window-level listener resolves a chord string from the event and looks it up — so chord matching is a pure function with tests, and the listener is four lines. Building the registry now is why a future Shortcuts settings page is nearly free: it already knows every binding and its description.

**Tech Stack:** `cmdk` via the shadcn `command` primitive, Radix Dialog.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§9)

## Global Constraints

- **Bindings are suppressed while focus is in a text input or `contenteditable`**, except `Escape`. Nothing is more hostile than a shortcut firing mid-sentence.
- **Every user-visible string** goes through `t()`, including each binding's description.
- **`lucide-react` only.** **No accent hue.**
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/features/keybindings/chord.ts` | `chordFromEvent`, `isTypingTarget`, `formatChord` |
| `src/features/keybindings/keymap.ts` | The registry and its duplicate check |
| `src/features/keybindings/useKeybindings.ts` | The single window listener |
| `src/features/palette/CommandPalette.tsx` | The dialog |
| `src/routes/__root.tsx` | Mounts both |

---

### Task 1: Chord resolution

**Interfaces:**
- Produces: `chordFromEvent(event: KeyboardEvent): string`, `isTypingTarget(target: EventTarget | null): boolean`, `formatChord(chord: string): string`.

**Files:**
- Create: `src/features/keybindings/chord.ts`, `src/features/keybindings/chord.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/features/keybindings/chord.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chordFromEvent, formatChord, isTypingTarget } from "./chord";

function key(init: Partial<KeyboardEventInit> & { key: string }) {
  return new KeyboardEvent("keydown", init);
}

describe("chordFromEvent", () => {
  it("lowercases a plain key", () => {
    expect(chordFromEvent(key({ key: "K" }))).toBe("k");
  });

  it("orders modifiers deterministically", () => {
    expect(chordFromEvent(key({ key: "k", altKey: true, ctrlKey: true, shiftKey: true }))).toBe(
      "ctrl+alt+shift+k",
    );
  });

  it("handles punctuation used by real bindings", () => {
    expect(chordFromEvent(key({ key: ",", ctrlKey: true }))).toBe("ctrl+,");
  });

  it("names escape consistently", () => {
    expect(chordFromEvent(key({ key: "Escape" }))).toBe("escape");
  });
});

describe("isTypingTarget", () => {
  it("recognises inputs, textareas and contenteditable", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isTypingTarget(editable)).toBe(true);
  });

  it("does not treat a checkbox as typing", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isTypingTarget(checkbox)).toBe(false);
  });

  it("treats anything else as not typing", () => {
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("formatChord", () => {
  it("renders a chord for display", () => {
    expect(formatChord("alt+k")).toBe("Alt+K");
    expect(formatChord("ctrl+,")).toBe("Ctrl+,");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm test keybindings/chord`
Expected: FAIL — cannot resolve `./chord`

- [ ] **Step 3: Implement**

`src/features/keybindings/chord.ts`:

```ts
/** Modifier order is fixed so a chord string is comparable by equality. */
export function chordFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (event.metaKey) parts.push("meta");
  parts.push(event.key.toLowerCase());
  return parts.join("+");
}

const TYPING_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "password",
  "number",
  "tel",
  "",
]);

/**
 * A shortcut firing while someone types is the fastest way to make an
 * application feel broken. `Escape` is exempt, because closing an overlay is
 * exactly what a typing user reaches for.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TYPING_INPUT_TYPES.has(target.type);
  return false;
}

export function formatChord(chord: string): string {
  return chord
    .split("+")
    .map((part) => (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    .join("+");
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test keybindings/chord`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(keys): add deterministic chord resolution"
```

---

### Task 2: The registry and listener

**Interfaces:**
- Produces: `createKeymap(context: KeymapContext): Keybinding[]` where `Keybinding = { id, chord, descriptionKey, group, run }`, and `useKeybindings(bindings: Keybinding[]): void`.

**Files:**
- Create: `src/features/keybindings/keymap.ts`, `src/features/keybindings/keymap.test.ts`, `src/features/keybindings/useKeybindings.ts`

- [ ] **Step 1: Add the strings**

`src/locales/en/palette.json`:

```json
{
  "placeholder": "Search or jump to…",
  "empty": "Nothing matches that.",
  "groups": { "navigation": "Navigation", "appearance": "Appearance", "application": "Application" },
  "commands": {
    "nav.practice": "Go to Practice",
    "nav.history": "Go to History",
    "nav.settings": "Go to Settings",
    "nav.about": "Go to About",
    "ui.toggleSidebar": "Toggle the sidebar",
    "ui.togglePalette": "Open this palette",
    "appearance.toggleTheme": "Switch between dark and light",
    "appearance.toggleDensity": "Switch between comfortable and compact",
    "appearance.toggleContrast": "Toggle high contrast",
    "app.openConfig": "Open the settings folder",
    "app.openLogs": "Open the log folder",
    "ui.closeOverlay": "Close the topmost overlay",
    "app.quit": "Quit Riff"
  }
}
```

- [ ] **Step 2: Write the failing test**

`src/features/keybindings/keymap.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createKeymap } from "./keymap";

function context() {
  return {
    navigate: vi.fn(),
    togglePalette: vi.fn(),
    toggleSidebar: vi.fn(),
    patch: vi.fn(),
    settings: {
      appearance: { theme: "dark" as const, density: "comfortable" as const, highContrast: false },
    },
    openPath: vi.fn(),
    quit: vi.fn(),
    closeOverlay: vi.fn(),
  };
}

describe("createKeymap", () => {
  it("binds every chord from the spec", () => {
    const chords = createKeymap(context()).map((b) => b.chord);
    for (const chord of ["alt+k", "ctrl+b", "ctrl+,", "alt+1", "alt+2", "alt+3", "ctrl+q"]) {
      expect(chords).toContain(chord);
    }
  });

  it("assigns no chord twice", () => {
    const chords = createKeymap(context())
      .map((b) => b.chord)
      .filter(Boolean);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("lists each action once, so cmdk values stay unique", () => {
    const shown = createKeymap(context()).filter((b) => !b.hidden);
    const labels = shown.map((b) => b.descriptionKey);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("gives every binding a translatable description", () => {
    for (const binding of createKeymap(context())) {
      expect(binding.descriptionKey).toMatch(/^palette:commands\./);
    }
  });

  it("routes alt+1 to practice", () => {
    const ctx = context();
    createKeymap(ctx).find((b) => b.chord === "alt+1")?.run();
    expect(ctx.navigate).toHaveBeenCalledWith({ to: "/practice" });
  });

  it("flips the theme from whatever is current", () => {
    const ctx = context();
    createKeymap(ctx).find((b) => b.id === "appearance.toggleTheme")?.run();
    expect(ctx.patch).toHaveBeenCalledWith({ appearance: { theme: "light" } });
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm test keybindings/keymap`
Expected: FAIL — cannot resolve `./keymap`

- [ ] **Step 4: Implement**

`src/features/keybindings/keymap.ts`:

```ts
import type { DeepPartial, PathKind, Settings } from "@/lib/ipc";

export interface KeymapContext {
  navigate: (options: { to: string }) => void;
  togglePalette: () => void;
  toggleSidebar: () => void;
  patch: (patch: DeepPartial<Settings>) => void;
  settings: {
    appearance: { theme: "dark" | "light"; density: "comfortable" | "compact"; highContrast: boolean };
  };
  openPath: (kind: PathKind) => void;
  quit: () => void;
  closeOverlay: () => void;
}

export interface Keybinding {
  id: string;
  /** Empty means palette-only: no chord, still runnable by name. */
  chord: string;
  descriptionKey: string;
  group: "navigation" | "appearance" | "application";
  /** An alternative chord for an action already listed. Bound, not shown. */
  hidden?: boolean;
  run: () => void;
}

/**
 * The single source of truth for what Riff can do from the keyboard. The
 * palette renders this list, so a command added here is discoverable without
 * touching the palette, and a future Shortcuts settings page is nearly free.
 */
export function createKeymap(ctx: KeymapContext): Keybinding[] {
  const { appearance } = ctx.settings;

  return [
    { id: "nav.practice", chord: "alt+1", group: "navigation", descriptionKey: "palette:commands.nav.practice", run: () => ctx.navigate({ to: "/practice" }) },
    { id: "nav.history", chord: "alt+2", group: "navigation", descriptionKey: "palette:commands.nav.history", run: () => ctx.navigate({ to: "/history" }) },
    { id: "nav.settings", chord: "alt+3", group: "navigation", descriptionKey: "palette:commands.nav.settings", run: () => ctx.navigate({ to: "/settings/general" }) },
    // Second chord for the same action. `hidden` keeps it out of the palette:
    // two rows reading "Go to Settings" would carry the same cmdk `value`, and
    // duplicate values make cmdk select both at once.
    { id: "nav.settingsAlt", chord: "ctrl+,", group: "navigation", hidden: true, descriptionKey: "palette:commands.nav.settings", run: () => ctx.navigate({ to: "/settings/general" }) },
    { id: "nav.about", chord: "", group: "navigation", descriptionKey: "palette:commands.nav.about", run: () => ctx.navigate({ to: "/settings/about" }) },

    { id: "ui.togglePalette", chord: "alt+k", group: "application", descriptionKey: "palette:commands.ui.togglePalette", run: ctx.togglePalette },
    { id: "ui.toggleSidebar", chord: "ctrl+b", group: "application", descriptionKey: "palette:commands.ui.toggleSidebar", run: ctx.toggleSidebar },

    { id: "appearance.toggleTheme", chord: "", group: "appearance", descriptionKey: "palette:commands.appearance.toggleTheme", run: () => ctx.patch({ appearance: { theme: appearance.theme === "dark" ? "light" : "dark" } }) },
    { id: "appearance.toggleDensity", chord: "", group: "appearance", descriptionKey: "palette:commands.appearance.toggleDensity", run: () => ctx.patch({ appearance: { density: appearance.density === "comfortable" ? "compact" : "comfortable" } }) },
    { id: "appearance.toggleContrast", chord: "", group: "appearance", descriptionKey: "palette:commands.appearance.toggleContrast", run: () => ctx.patch({ appearance: { highContrast: !appearance.highContrast } }) },

    { id: "app.openConfig", chord: "", group: "application", descriptionKey: "palette:commands.app.openConfig", run: () => ctx.openPath("config") },
    { id: "app.openLogs", chord: "", group: "application", descriptionKey: "palette:commands.app.openLogs", run: () => ctx.openPath("logs") },
    { id: "app.quit", chord: "ctrl+q", group: "application", descriptionKey: "palette:commands.app.quit", run: ctx.quit },

    // Radix already closes its own overlays on Escape, so this binds nothing
    // new — it is here because §9 lists Escape, and a Shortcuts page built
    // from this registry has to be able to show it. `hidden` keeps it out of
    // the palette, where "close this palette" would be noise.
    { id: "ui.closeOverlay", chord: "escape", group: "application", hidden: true, descriptionKey: "palette:commands.ui.closeOverlay", run: ctx.closeOverlay },
  ];
}
```

- [ ] **Step 5: Implement the listener**

`src/features/keybindings/useKeybindings.ts`:

```ts
import { useEffect } from "react";
import { chordFromEvent, isTypingTarget } from "./chord";
import type { Keybinding } from "./keymap";

/** One listener for every binding. Adding a shortcut never adds a listener. */
export function useKeybindings(bindings: Keybinding[]): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const chord = chordFromEvent(event);
      if (chord !== "escape" && isTypingTarget(event.target)) return;

      const binding = bindings.find((b) => b.chord !== "" && b.chord === chord);
      if (!binding) return;

      event.preventDefault();
      binding.run();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings]);
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test keybindings`
Expected: PASS, 14 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(keys): add the keybinding registry and listener"
```

---

### Task 3: The command palette

**Files:**
- Create: `src/features/palette/CommandPalette.tsx`, `src/features/palette/CommandPalette.test.tsx`
- Modify: `src/routes/__root.tsx`

- [ ] **Step 1: Write the failing test**

`src/features/palette/CommandPalette.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";
import type { Keybinding } from "@/features/keybindings/keymap";
import { CommandPalette } from "./CommandPalette";

const run = vi.fn();
const bindings: Keybinding[] = [
  { id: "nav.practice", chord: "alt+1", group: "navigation", descriptionKey: "palette:commands.nav.practice", run },
  { id: "nav.history", chord: "alt+2", group: "navigation", descriptionKey: "palette:commands.nav.history", run },
  { id: "app.quit", chord: "ctrl+q", group: "application", descriptionKey: "palette:commands.app.quit", run },
];

function renderPalette(onOpenChange = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CommandPalette open bindings={bindings} onOpenChange={onOpenChange} />
    </I18nextProvider>,
  );
}

describe("CommandPalette", () => {
  it("lists every command with its shortcut", () => {
    renderPalette();
    expect(screen.getByText("Go to Practice")).toBeInTheDocument();
    expect(screen.getByText("Alt+1")).toBeInTheDocument();
  });

  it("filters as you type", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole("combobox"), "hist");
    expect(screen.getByText("Go to History")).toBeInTheDocument();
    expect(screen.queryByText("Quit Riff")).not.toBeInTheDocument();
  });

  it("runs a command and closes", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPalette(onOpenChange);
    await user.click(screen.getByText("Go to History"));
    expect(run).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("has no accessibility violations", async () => {
    renderPalette();
    // document.body, not `container`. Radix portals the dialog out of the
    // render container, so asserting on the container inspects an empty div
    // and passes no matter how broken the dialog is.
    await expect(document.body).toHaveNoAxeViolations();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test CommandPalette`
Expected: FAIL — cannot resolve `./CommandPalette`

- [ ] **Step 3: Implement**

`src/features/palette/CommandPalette.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { formatChord } from "@/features/keybindings/chord";
import type { Keybinding } from "@/features/keybindings/keymap";

const GROUPS = ["navigation", "appearance", "application"] as const;

export function CommandPalette({
  open,
  bindings,
  onOpenChange,
}: {
  open: boolean;
  bindings: Keybinding[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("palette");

  return (
    // `title` and `description` are required, not decorative: Radix renders
    // the dialog's accessible name from them, and without one axe reports
    // aria-dialog-name — which the container-scoped assertion below could
    // never catch, because the dialog is portalled to <body>.
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("placeholder")}
      description={t("empty")}
    >
      <CommandInput placeholder={t("placeholder")} />
      <CommandList>
        <CommandEmpty>{t("empty")}</CommandEmpty>
        {GROUPS.map((group) => {
          const items = bindings.filter((b) => b.group === group && !b.hidden);
          if (items.length === 0) return null;
          return (
            <CommandGroup key={group} heading={t(`groups.${group}`)}>
              {items.map((binding) => (
                <CommandItem
                  key={binding.id}
                  // cmdk matches on this string, which is why the translated
                  // label rather than the id is used.
                  value={t(binding.descriptionKey, { ns: undefined })}
                  onSelect={() => {
                    binding.run();
                    onOpenChange(false);
                  }}
                >
                  {t(binding.descriptionKey, { ns: undefined })}
                  {binding.chord && <CommandShortcut>{formatChord(binding.chord)}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
```

- [ ] **Step 4: Mount it in the shell**

In `src/routes/__root.tsx`:

```tsx
const [paletteOpen, setPaletteOpen] = useState(false);
const navigate = useNavigate();
const settings = useSettings((s) => s.settings);
const patch = useSettings((s) => s.patch);

const bindings = useMemo(
  () =>
    createKeymap({
      navigate,
      togglePalette: () => setPaletteOpen((v) => !v),
      toggleSidebar,
      patch: (p) => void patch(p),
      settings,
      openPath: (kind) => void ipc.openPath(kind),
      quit: () => void ipc.windowClose(),
    }),
  [navigate, toggleSidebar, patch, settings],
);

useKeybindings(bindings);
```

Pass `onOpenPalette={() => setPaletteOpen(true)}` to `<TitleBar />` and render:

```tsx
<CommandPalette open={paletteOpen} bindings={bindings} onOpenChange={setPaletteOpen} />
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test CommandPalette`
Expected: PASS, 4 tests

- [ ] **Step 6: Verify by hand**

Run `pnpm app`. Press Alt+K; click the title bar's search icon; press Ctrl+B; press Alt+2. Type into the palette's input and confirm Alt+1 does **not** navigate while typing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(palette): add the alt+k navigation palette"
```

---

### Task 4: The shell's own tests

`__root.tsx` has accumulated the route announcer, `lastRoute` writing, sidebar
collapse, `subscribeToBackend`, the keymap, the palette, the quit dialog and
the onboarding guard — across Plans 06, 07, 08 and this one. It is the densest
file in the frontend and, until now, the only one with no test at all. Two of
the tests spec §14 names by hand live here.

**Files:**
- Create: `src/routes/__root.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const patch = vi.fn().mockResolvedValue(undefined);
const settings = {
  general: { startupRoute: "practice", lastRoute: "/practice", restoreWindowState: true, confirmOnQuit: false, language: "en" },
  appearance: { theme: "dark", density: "comfortable", uiScale: 1, reduceMotion: "system", highContrast: false, titleBar: "custom", sidebar: { collapsed: false, rememberCollapsed: true } },
  onboarding: { completedAt: "2026-08-28T10:00:00Z", version: 1 },
};

vi.mock("@/stores/settings", () => ({
  useSettings: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ settings, patch }),
    { getState: () => ({ settings, patch }) },
  ),
  useAppearance: () => settings.appearance,
  useTitleBarStyle: () => settings.appearance.titleBar,
  subscribeToBackend: () => Promise.resolve(() => {}),
  reportRecovery: () => {},
}));

const { RootLayout } = await import("./__root");

describe("the shell", () => {
  it("announces the destination on a route change", async () => {
    render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByText(/Navigated to/)).toBeInTheDocument(),
    );
  });

  it("opens the palette on alt+k", async () => {
    const user = userEvent.setup();
    render(<RootLayout />);
    await user.keyboard("{Alt>}k{/Alt}");
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });

  it("does not fire a shortcut while the palette input has focus", async () => {
    const user = userEvent.setup();
    render(<RootLayout />);
    await user.keyboard("{Alt>}k{/Alt}");
    const input = await screen.findByRole("combobox");
    input.focus();
    await user.keyboard("{Alt>}1{/Alt}");
    // Still open: alt+1 must not navigate out from under someone typing.
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("hides riffs own title bar when system decorations are chosen", async () => {
    settings.appearance.titleBar = "system";
    const { container } = render(<RootLayout />);
    expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
    settings.appearance.titleBar = "custom";
  });

  it("has no accessibility violations, dialogs included", async () => {
    render(<RootLayout />);
    await expect(document.body).toHaveNoAxeViolations();
  });
});
```

Export `RootLayout` from `__root.tsx` so it can be rendered without a router —
the route object stays the default export path, the component becomes testable.

- [ ] **Step 2: Run, implement the export, run again**

Run: `pnpm test __root`
Expected: PASS, 5 tests

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(shell): cover the root layout, keymap suppression and title bar"
```

---

### Task 5: Gate check

- [ ] **Step 1: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
Expected: all exit 0.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: verify keybinding gates" --allow-empty
```

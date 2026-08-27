# Riff — Application Foundation Design

- **Date:** 2026-08-28
- **Status:** Approved for planning
- **Repository:** https://github.com/valasme/riff
- **License:** MIT, © 2026 valasme
- **Scope of this milestone:** complete application foundation with a fully functional Settings area. Practice and History are static placeholders.

---

## 1. Product summary

Riff is a Linux-only desktop application for musicians who practise with several materials at once: a PDF score, a video lesson, and an audio backing track, side by side on one page. It is entirely local — no accounts, no telemetry, no network. Updates are manual: the user downloads a new release themselves.

This milestone builds everything except the media itself. When it is finished the application launches, onboards, navigates, themes itself, persists every setting durably, and survives corrupt files and external edits. Practice and History render exactly as designed but do nothing.

### 1.1 In scope

- First-run onboarding: welcome → theme → privacy (full-window, three steps)
- Application shell: custom title bar with window controls, collapsible sidebar, routed content area
- Settings: General, Appearance, About — all controls functional and persisted
- Dark and light themes, applied without flash on launch
- Keyboard layer with a central registry, and an Alt+K navigation palette
- Rust-owned persistence: atomic writes, schema migration, corruption recovery, live external-edit reload
- i18n infrastructure with English as the only populated locale
- Error handling, logging, accessibility, testing, CI, packaging, and open-source repository hygiene

### 1.2 Out of scope (deliberately deferred)

- PDF rendering, video playback, audio playback
- Practice pane interaction: resizing, closing, popping out
- History data: recording sessions, search, filter, sort, pagination
- Any network access whatsoever, including update checks
- Localisation into languages other than English
- End-to-end tests

---

## 2. Decisions

Settled during brainstorming. Each entry is binding for implementation.

| # | Decision | Rationale |
|---|---|---|
| D1 | Settings sections: **General, Appearance, About** | Matches the mockup's sub-navigation plus About. Shortcuts and Playback sections are deferred. |
| D2 | Themes: **Dark and Light. No "System" option.** Chosen during onboarding. | The user makes one explicit choice rather than inheriting an ambiguous desktop setting. |
| D3 | Type: **Outfit** (UI), **Playfair Display Italic** (wordmark), **JetBrains Mono** (paths, diagnostics) | Matched pixel-by-pixel against the mockups. All OFL, all self-hosted. |
| D4 | Locales: **English only**, full i18n plumbing in place | No machine-translated locales shipping as if reviewed. |
| D5 | Onboarding: **welcome + theme + privacy**, full-window, three steps | Theme needs room for two preview cards; the privacy step is the trust statement for a local-first app. |
| D6 | History storage: **`history.jsonl`, append-only** | Appending a session is one atomic write instead of rewriting the file, so a crash cannot corrupt earlier sessions. Still plain text. |
| D7 | Network: **none, ever** | No HTTP client is compiled in. CSP forbids outbound connections. No update check. |
| D8 | Practice and History: **completely static placeholders** | Pixel-faithful, inert. Layout and table engines are not installed until they are needed. |
| D9 | Testing: **Rust unit + frontend unit/component**, no E2E | Data-loss risk lives in the Rust persistence layer and is fully covered there. |
| D10 | State ownership: **Rust owns settings; React renders them** | One place for validation, migration and atomic writes; the webview gets no filesystem permissions. |
| D11 | **No TanStack Query** this milestone | It earns its keep on cached, paginated, refetched data. One always-loaded local document does not qualify. |
| D12 | **No** `react-resizable-panels`, `@tanstack/react-table`, `@tanstack/react-virtual`, `pdfjs-dist` | D8 makes them unused code. Recorded here as the seams to add later. |
| D13 | **Everything — CI and all three bundles — on `ubuntu-24.04`.** Fedora and Debian appear as verification containers, never as build hosts. | Not a preference; the constraint decides it. Tauri v2 needs webkit2gtk **4.1**, whose earliest Ubuntu series is 24.04 — `libwebkit2gtk-4.1-dev` does not exist in 22.04. So 24.04 is simultaneously the oldest image that can build Riff and, near enough, the oldest system that can run it: building there leaves no compatibility unclaimed. Building on 26.04 instead would raise the glibc floor and lock out 24.04 users for nothing. |
| D14 | Bundles: **deb, rpm, AppImage** | All three, every release, with checksums. |
| D15 | Repository accepts **no external code contributions** | Bug reports via issues are welcome; pull requests are declined. MIT still permits forks. |

### 2.1 Deviations from the mockups

Two, both deliberate.

1. **Command palette affordance in the title bar.** Alt+K needs a mouse-reachable equivalent. A compact icon button, styled identically to the existing `panel-left` button, sits immediately to the right of the `riff` wordmark. Chosen over a wide centred command bar because it preserves the title bar's austerity and keeps the drag region large for floating window managers.
2. **High contrast toggle in Appearance.** See §7.3. The source palette's `#4d4d4d` borders measure 1.8:1 against the surface, below the 3:1 that WCAG 1.4.11 requires for control boundaries. Rather than repaint the design for everyone, an opt-in toggle raises borders and muted text for users who need it.

---

## 3. Architecture

```
┌──────────────────────── Webview (React 19) ─────────────────────────┐
│  routes/          TanStack Router, hash history, file-based          │
│  features/        settings · onboarding · palette · keybindings ·    │
│                   window · practice(static) · history(static)        │
│  stores/          useSettings (Zustand) · useUi (Zustand)            │
│  lib/ipc/         bindings.ts — GENERATED by tauri-specta            │
└───────────────────────────────┬──────────────────────────────────────┘
                    typed commands │ events
┌───────────────────────────────┴──────────────────────────────────────┐
│                          Rust (Tauri 2.11)                            │
│  commands/     settings · paths · app · window · licenses             │
│  settings/     model · defaults · store · migrate · watcher           │
│  storage/      atomic write · quarantine · backup rotation            │
│  paths.rs      XDG resolution + env overrides                         │
│  error.rs      RiffError → { code, details }                          │
│  logging.rs    tracing → rolling file + frontend bridge               │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
              ~/.config/riff · ~/.local/share/riff · ~/.local/state/riff
```

**The invariant:** the webview never touches the filesystem. It has no `fs` capability. Everything on disk goes through a typed command, which means validation, migration and atomic writes exist in exactly one place, and that place is covered by `cargo test`.

### 3.1 Boot sequence

Eliminating the flash of unthemed content is a hard requirement, not a nicety.

1. Rust starts. `paths::resolve()` determines the XDG directories, creating them if absent. If neither `$HOME` nor the `RIFF_*` overrides yield a usable location, Riff shows a native error dialog naming the variables it looked for and exits — silently falling back to the working directory would scatter configuration wherever the user launched from.
2. `SettingsStore::load()` reads and validates `settings.json` (§4.3). **This happens before `tauri::Builder` is constructed**, because step 3 needs the settings as a string at plugin-registration time.
3. A Tauri plugin registers a `js_init_script` — confirmed available on `tauri::plugin::Builder` in 2.11 — which assigns `window.__RIFF_BOOTSTRAP__ = { settings, paths, appInfo }` before any page script runs.
4. The window is created with `"visible": false` and `backgroundColor` set to the resolved theme's surface colour, so even the pre-paint frame is the right colour.
5. `index.html` runs a small synchronous inline script in `<head>`, before any stylesheet, that reads `__RIFF_BOOTSTRAP__` and sets `data-theme`, `data-density`, `data-contrast` and `--ui-scale` on `<html>`.
6. React mounts, hydrating `useSettings` from the same object. Zero IPC round-trips, no loading state, no spinner.
7. Window geometry is restored by `tauri-plugin-window-state` **before** the window is shown, so it never appears at a default size and then jumps.
8. After first paint the frontend calls `app_ready()`; Rust shows the window.

Two failure paths, because both are silent and fatal if unhandled:

- **The bootstrap object is missing** (the init script failed). The frontend falls back to an async `settings_get()` and logs a warning. Slower start, never a broken one.
- **`app_ready()` never arrives** (React threw before its first effect). A 3-second watchdog in Rust reveals the window regardless. Without it, a frontend crash is indistinguishable from the application failing to launch — the user sees nothing at all, with no window to read an error in. The window must always become visible; what it contains is the error boundary's problem.

An optimisation must never be able to prevent the application from appearing.

---

## 4. Storage and persistence

### 4.1 Locations

XDG Base Directory specification, using the plain name `riff` rather than the reverse-DNS identifier, because these are files users are expected to open and edit.

| Path | Contents |
|---|---|
| `$XDG_CONFIG_HOME/riff/settings.json` | User settings. Hand-editable. |
| `$XDG_CONFIG_HOME/riff/settings.schema.json` | JSON Schema generated from the Rust types via `schemars`. Written at launch **only when its content differs** from what is already there, so an unchanged launch touches no file. |
| `$XDG_DATA_HOME/riff/history.jsonl` | Practice sessions, one JSON object per line. Created empty; unused this milestone. |
| `$XDG_DATA_HOME/riff/window-state.json` | Managed by `tauri-plugin-window-state`. |
| `$XDG_STATE_HOME/riff/logs/riff.log` | Rolling daily, seven retained. |
| `$XDG_CACHE_HOME/riff/` | Created for future thumbnails and waveform peaks. |

Defaults follow the specification: `~/.config`, `~/.local/share`, `~/.local/state`, `~/.cache`. `RIFF_CONFIG_HOME` and `RIFF_DATA_HOME` override both, for tests and portable installations.

### 4.2 Settings schema, version 1

```jsonc
{
  "$schema": "./settings.schema.json",
  "version": 1,
  "general": {
    "startupRoute": "practice",        // "practice" | "history" | "last-used"
    "lastRoute": "/practice",          // written only when startupRoute is "last-used"
    "restoreWindowState": true,
    "confirmOnQuit": false,
    "language": "en"
  },
  "appearance": {
    "theme": "dark",                   // "dark" | "light"
    "density": "comfortable",          // "comfortable" | "compact"
    "uiScale": 1.0,                    // 0.8 – 1.5, step 0.05
    "reduceMotion": "system",          // "system" | "always" | "never"
    "highContrast": false,
    "titleBar": "custom",              // "custom" | "system"
    "sidebar": { "collapsed": false, "rememberCollapsed": true }
  },
  "onboarding": {
    "completedAt": null,               // RFC 3339 timestamp
    "version": 1                       // bump to re-present onboarding after a major change
  }
}
```

Rust representation: `#[serde(default, rename_all = "camelCase")]` on every struct, so a file missing any key still loads. The root struct carries `#[serde(flatten)] unknown: serde_json::Map<String, Value>`, preserving keys it does not recognise through a read-modify-write cycle — a user who downgrades and upgrades again does not lose settings written by the newer version.

Validation is by construction. `uiScale` is a newtype clamping to its range on deserialisation; enums reject unknown variants and fall back to the default with a logged warning rather than failing the whole load. One bad key never costs the user their whole configuration.

### 4.3 Read path

```
settings.json missing        → write defaults immediately, so the file is visible and editable
parse fails                  → rename to settings.json.corrupt-<RFC3339>, load defaults,
                               log at ERROR, emit settings://recovered → non-blocking toast
version < CURRENT            → copy to settings.json.bak-v<n>, run migration chain, write result
version > CURRENT            → load with defaults for unknown fields, preserve everything,
                               warn once per launch, keep writing normally
```

The application never silently overwrites a file it failed to understand. The quarantined copy is the user's data and stays on disk.

### 4.4 Write path

```
1. mutate in memory under RwLock<Settings>
2. mark dirty; schedule a coalescing flush 250 ms out
3. flush:  serde_json::to_writer_pretty → NamedTempFile in the SAME directory
           file.flush() → file.sync_all() → persist(path)   (atomic rename)
           → fsync the parent directory
4. record the bytes just written, for watcher self-suppression (§4.5)
5. on RunEvent::ExitRequested, force a synchronous flush before exit
```

The temp file must share a directory with the target, because `rename` is only atomic within a filesystem. Fsyncing the parent directory is what makes the rename itself durable across power loss — omitting it is the classic mistake.

Dragging the UI-scale slider produces one write, not forty.

**When a write fails** — read-only filesystem, full disk, wrong permissions — the in-memory state is authoritative and is kept. Riff logs at ERROR, raises one toast per failure cause rather than one per attempt, and retries on the next change. The application stays fully usable with unsaved settings; it never crashes and never silently reverts the user's choice in the interface, which would be a lie about what is on disk.

**Concurrent instances** are prevented with `tauri-plugin-single-instance`: a second launch focuses the existing window instead of starting a rival process. Two processes would each hold their own `RwLock<Settings>` and overwrite each other on flush, and the file watcher would make them fight. Focusing the first window is also what users expect from a desktop application.

### 4.5 External edits

A `notify` watcher on the config directory, debounced 300 ms, reloads `settings.json` when it changes on disk and emits `settings://changed`; the frontend store patches itself in place. Editing the JSON in a text editor updates the running application live.

Two filters, both load-bearing. The watcher must **match on `settings.json` by name** — `notify` reports directory-level events, so writing `settings.schema.json` or leaving a `settings.json.corrupt-*` file behind would otherwise trigger a spurious reload on every launch. And self-suppression compares the new file bytes against the bytes of our own last write, so our own flush does not bounce back through the watcher and re-enter the store. Byte comparison rather than hashing: the file is a few kilobytes, and it avoids a dependency for no measurable gain.

### 4.6 History

The format is fixed now so that later work has nothing to renegotiate; **no history code is written this milestone**. Path resolution creates the empty file, and that is all.

One JSON object per line, appended with `O_APPEND` so concurrent appends cannot interleave. Compaction will rewrite the file atomically once deleted entries exceed 25% or the file exceeds 10 MB. When it is built it goes behind a `HistoryRepository` trait, so a SQLite backend could replace the file backend without the UI knowing — but writing that trait against zero callers today would be speculative, so it waits.

---

## 5. IPC contract

Every command returns `Result<T, RiffError>`. TypeScript bindings are generated by `tauri-specta` 1.0 into `src/lib/ipc/bindings.ts`, committed, regenerated by `cargo test export_bindings`, and CI fails if the committed file differs from a fresh generation.

| Command | Signature | Notes |
|---|---|---|
| `settings_get` | `() -> Settings` | Fallback only; boot uses the injected object. |
| `settings_patch` | `(SettingsPatch) -> Settings` | `SettingsPatch` mirrors `Settings` with every field `Option`, applied recursively, so a caller sends only what changed and `None` never means "clear this". Returns the full validated result, which is what the store adopts — the frontend never assumes its optimistic guess was right. |
| `settings_reset` | `(Option<Section>) -> Settings` | One section, or everything. |
| `settings_export` | `(PathBuf) -> ()` | Writes the current settings to a user-chosen path. |
| `settings_import` | `(PathBuf) -> Settings` | Runs the imported file through the full §4.3 read path — migration, unknown-field preservation, newer-version tolerance — before applying. A file that fails validation is rejected with a `Validation` error and current settings are left untouched. |
| `paths_get` | `() -> AppPaths` | Config, data, state, cache, log directories. |
| `open_path` | `(PathKind) -> ()` | Opens one of our own directories. Enum, never a raw path. |
| `open_external` | `(ExternalLink) -> ()` | Enum of fixed destinations. See §12. |
| `app_info` | `() -> AppInfo` | App, Tauri and WebKitGTK versions, build date, git SHA. |
| `licenses_get` | `() -> Vec<LicenseEntry>` | Reads the bundled third-party notices resource. |
| `app_ready` | `() -> ()` | Reveals the window. |
| `window_minimize` / `window_toggle_maximize` / `window_close` | `() -> ()` | Custom title bar controls. |

Errors serialise discriminated:

```rust
#[derive(thiserror::Error, Debug, Serialize, specta::Type)]
#[serde(tag = "code", content = "details", rename_all = "kebab-case")]
pub enum RiffError {
    Io { path: String, message: String },
    Parse { path: String, message: String, line: Option<u32> },
    Validation { field: String, reason: String },
    NotFound { what: String },
    Denied { what: String },
}
```

`code` selects a localised message on the frontend; `details` populates a collapsible technical panel. Raw Rust error strings are never shown as primary UI text.

Events: `settings://changed`, `settings://recovered`.

---

## 6. Frontend architecture

### 6.1 Routing

TanStack Router with `@tanstack/router-plugin/vite` for file-based, fully typed routes, using **hash history**. Tauri's asset protocol serves no SPA fallback, so reloading on a deep path like `/settings/general` would 404 under browser history.

```
__root.tsx                 providers, error boundary, onboarding guard
  index.tsx                redirect per general.startupRoute
  practice.tsx             static placeholder
  history.tsx              static placeholder
  settings.tsx             sub-navigation layout
    settings.general.tsx
    settings.appearance.tsx
    settings.about.tsx
  onboarding.tsx           own layout: title bar only, no sidebar
```

`__root.beforeLoad` redirects to `/onboarding` while `onboarding.completedAt` is null, and away from it once set. When `startupRoute` is `last-used`, the router writes `general.lastRoute` on navigation, debounced.

### 6.2 State

Two Zustand stores, and nothing else.

`useSettings` hydrates synchronously from `window.__RIFF_BOOTSTRAP__`. Its `patch()` applies optimistically, calls `settings_patch`, and on failure rolls back to the pre-patch snapshot and raises a toast. It subscribes to `settings://changed` for external edits.

`useUi` holds state that must not persist: palette open, transient sidebar collapse when `rememberCollapsed` is false, active toasts.

Persisted settings are read through selector hooks (`useTheme()`, `useDensity()`) so components never subscribe to the whole object and re-render on unrelated changes.

### 6.3 Theming

Tailwind CSS v4, CSS-first `@theme`. Themes are attribute-scoped, not class-scoped, so `data-theme`, `data-density` and `data-contrast` compose independently:

```css
@theme { --color-surface: #242424; /* … */ }
[data-theme="light"]     { --color-surface: #fafafa; /* … */ }
[data-contrast="high"]   { --color-border: #6d6d6d; --color-muted-foreground: #b0b0b0; }
```

UI scale is one variable: `html { font-size: calc(16px * var(--ui-scale)); }`. Every dimension in the application is expressed in `rem`, so the slider scales the entire interface proportionally rather than only text. Density adjusts spacing tokens only, never font size — the two controls stay orthogonal.

### 6.4 Components

shadcn/ui on Radix, installed with `pnpm dlx shadcn@4`, re-skinned to the tokens in §7. Only what is used: `button`, `dialog`, `dropdown-menu`, `select`, `switch`, `slider`, `radio-group`, `tooltip`, `separator`, `scroll-area`, `skeleton`, `input`, `label`, `sonner`, `command`.

Application components live in `src/components/`; feature-owned components live under their feature. A component that only one feature uses belongs to that feature.

---

## 7. Design system

### 7.1 Colour

Sampled directly from the mockups.

| Token | Dark | Light | Usage |
|---|---|---|---|
| `surface` | `#242424` | `#fafafa` | Title bar, sidebar and content — one flat shade, as designed |
| `card` | `#323232` | `#f2f2f2` | Settings panels |
| `raised` | `#3c3c3c` | `#eaeaea` | Active nav pill, placeholder panes, buttons, table, skeletons |
| `border` | `#4d4d4d` | `#d4d4d4` | Input and table outlines |
| `separator` | `#313131` | `#e6e6e6` | Row dividers |
| `foreground` | `#e4e4e4` | `#1c1c1c` | Primary text and icons |
| `muted-foreground` | `#9a9a9a` | `#5f5f5f` | Secondary text |
| `ring` | `#e4e4e4` | `#1c1c1c` | Focus indicator |

High contrast overrides: `border` → `#6d6d6d` / `#8a8a8a`, `muted-foreground` → `#b0b0b0` / `#4a4a4a`.

Deliberately absent: any accent hue. The mockups are purely neutral and stay that way. Focus is communicated by a two-pixel neutral ring at 12.2:1, which reads clearly without introducing a colour the design does not have.

### 7.2 Typography

| Role | Face | Size / weight |
|---|---|---|
| Wordmark | Playfair Display Italic 700 | 22px |
| UI | Outfit Variable | 15px / 500 nav, 14px / 400 body, 13px descriptions |
| Section headings | Outfit Variable | 16px / 600 |
| Paths, versions, diagnostics | JetBrains Mono Variable | 12.5px |

Self-hosted through Fontsource, subset to `latin` and `latin-ext`, preloaded, `font-display: swap`. No network at runtime — this is a hard requirement, not a performance preference.

### 7.3 Contrast audit

Measured against WCAG 2.2, and recorded because it drove a design decision.

| Pair | Ratio | Requirement | Result |
|---|---|---|---|
| `#e4e4e4` on `#242424` | 12.2:1 | 4.5:1 text | Pass |
| `#9a9a9a` on `#242424` | 5.3:1 | 4.5:1 text | Pass — `#8a8a8a` is the exact floor, so this keeps margin |
| `#4d4d4d` on `#242424` | 1.8:1 | 3:1 boundaries | **Fail** |
| `#3c3c3c` on `#242424` | 1.4:1 | 3:1 boundaries | **Fail** |
| Ring `#e4e4e4` on `#3c3c3c` | 8.6:1 | 3:1 | Pass |

Resolution: controls remain identifiable without relying on their borders — every one carries a text label or an `aria-label` plus a tooltip, and hover and focus states change fill, not only outline. The High contrast toggle raises borders to `#6d6d6d` (3.0:1) for users who need boundary contrast. The default keeps the design intact; nobody is locked out.

### 7.4 Layout metrics

The mockups are drawn on a 1920×1089 canvas at a scale larger than a real window. These are the implementation values, preserving the proportions that carry the design's character.

| Element | Value |
|---|---|
| Window default / minimum | 1280×832 / 960×640 |
| Title bar height | 44px |
| Sidebar width | 224px expanded, 56px icon rail collapsed |
| Settings sub-navigation width | 240px |
| Nav item | 40px tall, 12px radius, 12px padding, 18px icon, 12px gap |
| Content padding | 24px |
| Card radius / pane radius | 12px / 10px |
| Focus ring | 2px, 2px offset |

Because UI scale multiplies the root font size and every dimension is in `rem`, the chrome grows with it: at 1.5× the sidebar and settings sub-navigation together claim roughly 700px of a 960px minimum window, leaving the settings content column unusably narrow. Two container-query breakpoints handle it, keyed to available width rather than window width so they behave correctly at any scale: below 900px the sidebar drops to its 56px icon rail; below 700px the settings sub-navigation becomes a horizontal segmented control above the content. Neither is a mobile layout — they are the honest response to a legitimate combination of settings.

Collapsing the sidebar yields an icon-only rail rather than hiding it entirely, so navigation and `aria-current` remain available. Tooltips supply the labels.

### 7.5 Icons

`lucide-react`, confirmed as the mockups' source. `panel-left` (sidebar toggle), `search` (palette), `audio-waveform` (Practice), `folder-clock` (History), `settings` (Settings), `house` (General), `palette` (Appearance), `info` (About), `filter`, `file-text`, `clock`, `picture-in-picture-2`, `x`, `minus`, `square`.

---

## 8. Screens

### 8.1 Title bar

`decorations: false`. Layout: `[panel-left] riff [search] · · · drag region · · · [− □ ✕]`.

The drag region uses `data-tauri-drag-region`. Double-click-to-maximise is verified against Tauri 2.11's built-in drag-region behaviour first, and only hand-implemented if it turns out not to be covered — writing the handler unconditionally risks toggling maximise twice per double-click. Window controls are 44×32 hit targets with `aria-label`s. Setting `appearance.titleBar` to `system` calls `set_decorations(true)` and hides the custom bar live, with no restart — this matters on GNOME and KDE, where users expect their own decorations. Under Wayland, whether a compositor honours the request is up to the compositor; Hyprland and others may ignore it entirely. Riff therefore reads `is_decorated()` back after the call, and if the window manager refused, reverts to the custom bar and says so in a toast rather than leaving the user with a window that has no title bar at all and a setting that claims otherwise.

### 8.2 Onboarding

Full window, title bar retained so the window can still be closed. Three steps with progress dots and Back/Next.

1. **Welcome** — the Playfair wordmark, one line of description.
2. **Theme** — two large cards, each a miniature static render of the real interface in dark and light. The card matching the desktop's `prefers-color-scheme` is pre-selected as a courtesy; the user still confirms. Clicking applies immediately, so the choice is felt rather than described.
3. **Privacy** — plain statement: everything stays on this machine, no telemetry, no accounts, no network connections at all. Lists the exact directories, each with an Open button.

Finishing writes `onboarding.completedAt` and routes to `general.startupRoute`. Re-runnable from Settings → General.

### 8.3 Practice — static placeholder

Faithful to the mockup: one tall pane on the left, two stacked on the right, each with a header carrying `picture-in-picture-2` and `x` icons. Panes are `raised` on `surface` with 10px radii. Nothing is interactive. Each pane centres a muted label naming its future content — Score, Video, Audio — and the route carries a single "In development" marker so the state is honest rather than broken-looking.

### 8.4 History — static placeholder

Search input with `search` icon, `filter` button, and a table with checkbox, document, and clock columns plus a per-row menu affordance. Skeleton rows exactly as drawn. Inert: the input is `readOnly`, controls are `disabled` with `aria-disabled`, and the skeletons carry `aria-hidden` so screen readers are not read a wall of nothing.

### 8.5 Settings

Three-column shell: sidebar, 240px sub-navigation (General, Appearance, About), content card at `#323232`.

Every control writes through `useSettings.patch()` and takes effect immediately. There is no Save button and no dirty state — a settings screen that can be abandoned half-applied is a settings screen with a bug in it.

The sections are written by hand, **not generated** from the JSON Schema. Fifteen controls do not repay a rendering framework, and a generator would immediately need escape hatches for the UI-scale slider's live preview, the destructive-reset confirmation and the licence viewer. Hand-written sections stay readable and are trivially testable; a generator would be the more impressive and worse decision.

**General** — Startup route; Restore window size and position; Confirm before quitting; Data locations with per-directory Open buttons; Export settings; Import settings; Reset all settings (destructive confirmation dialog); Re-run onboarding.

**Appearance** — Theme (Dark / Light); Density; UI scale slider with live preview and a Reset affordance; Reduce motion; High contrast; Title bar style; Remember sidebar state.

Reduce motion offers a System option although Theme deliberately does not (D2), and the asymmetry is intentional: `prefers-reduced-motion` is an unambiguous accessibility declaration that the desktop makes on the user's behalf and that Riff should honour by default, whereas colour scheme is a taste question the user was already asked once, during onboarding.

**About** — Version, Tauri and WebKitGTK versions, build date and git SHA, each copyable; MIT licence text in full; third-party notices generated from npm and cargo, searchable; repository and issue links; a Copy diagnostics button producing a paste-ready report for bug reports, with the home directory rewritten to `$HOME` so pasting it into a public issue does not disclose the user's account name. A privacy-first application should not leak identity through its own bug-report affordance.

The language selector is intentionally absent: a picker with one option is noise. `general.language` exists in the schema and is honoured; the control appears when a second locale ships.

---

## 9. Keyboard and command palette

One registry in `src/features/keybindings/keymap.ts`:

```ts
type Keybinding = {
  id: string;                       // "nav.practice"
  chord: string;                    // "alt+1"
  scope: "global" | "dialog";
  descriptionKey: string;           // i18n key
  run: (ctx: KeybindingContext) => void;
};
```

| Chord | Action |
|---|---|
| `Alt+K` | Open the navigation palette |
| `Ctrl+B` | Toggle the sidebar |
| `Ctrl+,` | Open Settings |
| `Alt+1` / `Alt+2` / `Alt+3` | Practice / History / Settings |
| `Ctrl+Q` | Quit, honouring `confirmOnQuit` |
| `Escape` | Close the topmost overlay |

A single window-level `keydown` listener resolves chords against the registry. Bindings are suppressed while focus is in a text input or `contenteditable`, except `Escape`. A development-time assertion fails on duplicate chords. The registry is what the palette displays and what a future Shortcuts settings page will render — building it once now is why that page will be nearly free.

The palette is `cmdk` inside a Radix dialog: fuzzy search, arrow-key navigation, correct ARIA combobox semantics, focus trap, focus restored to the invoking element on close. Groups: **Navigation** (Practice, History, Settings, About), **Appearance** (switch theme, toggle density, toggle high contrast), **Application** (open config folder, open log folder, quit). Each row shows its shortcut, read from the registry.

---

## 10. Internationalisation

`i18next` with `react-i18next`. English is bundled statically — with one locale, lazy loading adds indirection and no benefit; the loader seam is documented for when a second arrives.

Every user-visible string goes through `t()`, including `aria-label`s, tooltips, toasts and error messages. Error codes from §5 map to localised strings, which is why `RiffError` is a discriminated enum rather than a formatted message.

`i18next-parser` extracts keys into `src/locales/en/*.json` by namespace (`common`, `settings`, `onboarding`, `errors`, `palette`). CI runs extraction and fails if the committed files are stale or any key is missing a value.

Layout uses CSS logical properties throughout — `padding-inline`, `margin-inline-start`, Tailwind's `ps-*`/`pe-*`/`ms-*`/`me-*` — never physical left/right. `<html lang>` and `dir` are set from the active locale. Adding an RTL language later is then a translation task rather than a rewrite. Dates and numbers use `Intl`, never hand-formatted.

---

## 11. Accessibility

Radix supplies keyboard behaviour and ARIA for every primitive; the work is not undoing it.

- Landmarks: one `<nav>` per navigation region with a distinguishing `aria-label`, one `<main>`, a skip-to-content link as the first focusable element
- `aria-current="page"` on the active navigation item
- A polite live region announcing the destination on route change, since a client-side route change is silent to a screen reader
- Visible focus on every interactive element; focus is never removed, only restyled
- `prefers-reduced-motion` honoured, with `appearance.reduceMotion` able to force or override it
- Interactive targets at least 24×24 CSS pixels (WCAG 2.2 §2.5.8)
- No information conveyed by colour alone
- The UI-scale slider is operable by keyboard with announced values
- Disabled placeholder controls use `aria-disabled` with an explanatory label rather than vanishing from the accessibility tree

`axe-core` 4.13 asserts zero violations on every route and every dialog in component tests, driven by a ~15-line local Vitest matcher. Not `vitest-axe`: it sits at 0.1.0 with a `vitest >=0.16` peer range, and taking an unmaintained wrapper as a dependency to save fifteen lines is a bad trade against Vitest 4. Biome's a11y rules run on every commit. The two catch different classes of problem, which is why both are present.

---

## 12. Error handling, logging, security

**Rust.** `thiserror` for typed errors, no `unwrap` outside tests — enforced by `clippy::unwrap_used` at deny level. `expect_used` is deliberately *not* denied: a genuine invariant should be stated with a message explaining why it holds, and banning that only pushes people back to `unwrap`. A panic hook writes the payload and backtrace to the log unconditionally, then attempts a native dialog on a best-effort, non-blocking basis — a blocking dialog raised from a panic on the GTK main thread can deadlock, turning a crash report into a hang. Logging always succeeds; the dialog is a courtesy, because an application that vanishes silently is indistinguishable from one the user broke.

**Frontend.** `react-error-boundary` at the root plus a TanStack Router `errorComponent` per route, so one broken screen does not take down the shell. The crash screen shows the error code, a Copy diagnostics button, Open logs, and Reload. `window.onerror` and `unhandledrejection` forward to the log file through `tauri-plugin-log`. Recoverable problems use `sonner` toasts and never block.

**Logging.** `tracing` with `tracing-appender`, daily rotation, seven files retained. Default level `info`, overridable with `RIFF_LOG`. File paths are logged; file contents never are.

**Security.** Content Security Policy, replacing the scaffold's `null`:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data: asset: http://asset.localhost;
media-src 'self' asset: http://asset.localhost;
connect-src ipc: http://ipc.localhost;
object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';
```

`connect-src` admits the IPC origins and nothing else, so D7 is enforced by the runtime rather than by discipline. `style-src 'unsafe-inline'` is required by Radix's inline positioning styles; `script-src` stays strict, which is where it matters.

Capabilities are minimal: `core:default`, `opener:default`, `dialog:default`, `log:default`, `window-state:default`. No `fs`, no `shell`, no `http`. `open_path` and `open_external` accept enums, never caller-supplied strings — there is no path or URL a compromised frontend could pass that we would open. `asset:` and `media-src` appear in the CSP now so that the media work in §15 does not later require loosening policy under deadline pressure.

---

## 13. Performance

- React Compiler via `babel-plugin-react-compiler`, removing hand-written memoisation
- Route-level code splitting through TanStack Router's lazy routes
- Vite `build.target: "safari16"` — Riff requires **webkit2gtk 4.1** (libsoup3) and **glibc ≥ 2.39**. The 4.1 ABI, not a version number, is the binding constraint: it is what excludes Ubuntu 22.04 and Debian 12 no matter how Riff is built. Stated in the README, declared by the deb and rpm packages, asserted by `glibc-floor`
- Selector-based Zustand subscriptions; no component subscribes to the whole settings object
- Debounced writes (§4.4) so slider drags produce one write
- Fonts subset, preloaded, self-hosted; no runtime font fetch is even possible under the CSP
- `rollup-plugin-visualizer` on demand, with a CI budget failing the build if the initial chunk exceeds 250 KB gzipped — the projected dependency set lands near 140 KB, so the ceiling is a real constraint with headroom rather than a number nothing will ever approach
- Blocking filesystem work runs on `spawn_blocking`, never on the async runtime's threads

Startup target: window visible with correct theme in under 400 ms on the reference machine, achieved by §3.1 rather than by measurement after the fact.

---

## 14. Testing

Test-driven throughout: a failing test precedes the implementation.

**Rust — where data loss would actually happen.**

- Defaults are written when `settings.json` is absent
- An atomic write leaves either the old or the new file, never a truncated one
- A corrupt file is quarantined with its timestamp, defaults load, the event fires
- The migration runner against a synthetic v0 fixture, leaving a rotated backup behind — schema version 1 has no predecessor yet, so this exercises the machinery, not a real migration
- Unknown keys survive a read-modify-write cycle
- An unknown enum variant falls back to default without failing the whole load
- `uiScale` outside its range clamps rather than throwing
- Debounced writes coalesce; exit forces a flush
- The watcher ignores our own write and fires on a genuine external edit
- XDG resolution, including `RIFF_CONFIG_HOME` override
- A failed write keeps in-memory state, surfaces once, and retries on the next change
- The reveal watchdog shows the window when `app_ready()` never arrives
- The watcher ignores `settings.schema.json` and `settings.json.corrupt-*` writes
- `RiffError` serialises to the documented shape

All against `tempfile` directories; no test touches a real configuration.

**Frontend — Vitest, Testing Library, jsdom.**

- `useSettings` optimistic apply, rollback on IPC failure, patch on external change
- Theme, density, scale and contrast attributes applied to `<html>`
- Keymap resolution: chords, input-focus suppression, duplicate detection
- Palette filtering, keyboard navigation, focus restoration
- Every settings control renders its persisted value and writes on change
- Onboarding gating: redirect while incomplete, redirect away once complete
- Router redirect honours `startupRoute`
- `axe-core` on every route and dialog, via the local matcher

Coverage gate: 80% of lines across `src/features` and `src/lib`, enforced in CI. IPC is mocked at the generated-bindings boundary, so tests exercise real store logic against a typed fake.

---

## 15. Media architecture (recorded, not built)

Documented now so that Practice drops in without redesign.

Video and audio play in ordinary `<video>` and `<audio>` elements. WebKitGTK decodes through **GStreamer**, so the supported format set is whatever plugins the user has installed — `gst-plugins-good`, `-bad`, `-ugly` and `gst-libav` together cover H.264/AAC in MP4, VP9/Opus in WebM, MKV, HEVC, AC3, FLAC, MP3, WAV, AIFF, Ogg Vorbis and more. This is why "support every format" is achievable without shipping a decoder.

Files are handed to the element through `convertFileSrc()`, which serves them over the asset protocol with HTTP range support. Seeking is instant and a four-gigabyte video never enters JavaScript memory. The asset scope starts **empty**; `FsExt::allow_file` grants access to exactly the file the user picked in a dialog, and nothing else.

When a file fails to play, a `canPlayType` matrix plus a `gst-inspect-1.0` probe produces a message naming the actual package to install for the user's distribution, rather than a silent black rectangle. If `ffmpeg` happens to be on `$PATH`, Riff can offer a cached proxy transcode into `$XDG_CACHE_HOME/riff/proxies/`. It is never bundled — size, and patent-encumbered codecs in an MIT project.

PDF rendering will use `pdfjs-dist` with the worker bundled locally.

---

## 16. Tooling and repository

| Concern | Choice |
|---|---|
| Package manager | pnpm 11, `packageManager` field, `--frozen-lockfile` in CI |
| Node | 26, pinned in `.nvmrc` |
| Rust | 1.98, pinned in `rust-toolchain.toml` with `rustfmt` and `clippy` |
| Lint and format (TS/TSX/JSON/CSS) | **Biome 2.5** — replaces ESLint and Prettier, includes the a11y rules, and is fast enough to run on every save |
| Rust quality | `cargo fmt --check`, `cargo clippy -- -D warnings` |
| Licence compliance | `cargo-deny`, allowing MIT/Apache-2.0/BSD/ISC/Unicode/MPL-2.0 and denying GPL and AGPL, so a copyleft transitive dependency cannot silently enter an MIT binary |
| Git hooks | `lefthook` — pre-commit: Biome on staged files, `cargo fmt --check`, `tsc --noEmit`; pre-push: full test suite |
| Commits | Conventional Commits, enforced by commitlint, consumed by `git-cliff` for the changelog |
| Versioning | `package.json` is the single source; `tauri.conf.json` reads `"version": "../package.json"`; CI asserts `Cargo.toml` matches |

Biome rather than ESLint plus Prettier: one tool, one config, one pass, and its a11y and React Hooks coverage is sufficient here. If a rule genuinely only exists as an ESLint plugin, adding a narrow ESLint config later is cheap; starting with both is not.

### 16.1 Directory layout

```
src/
  app/            providers, boot, root layout
  routes/         TanStack Router file routes
  features/
    settings/     schema types, hooks, sections/
    onboarding/   steps/
    palette/
    keybindings/  keymap.ts, useKeybindings.ts
    window/       TitleBar, WindowControls
    practice/     static placeholder
    history/      static placeholder
  components/     Sidebar, PageHeader, EmptyState, SettingRow …
  components/ui/  shadcn primitives
  lib/            ipc/bindings.ts (generated), errors, logger, cn
  locales/en/     common · settings · onboarding · errors · palette
  styles/         globals.css, theme.css
src-tauri/src/
  lib.rs  bootstrap.rs  error.rs  logging.rs  paths.rs
  commands/{settings,paths,app,window,licenses}.rs
  settings/{model,defaults,store,migrate,watcher}.rs
  storage/atomic.rs
```

A file that outgrows roughly 200 lines is a signal it is doing two things.

---

## 17. CI, packaging, distribution

**`ci.yml`** on push and pull request, running on `ubuntu-24.04`:

| Job | Contents |
|---|---|
| `lint` | `biome ci`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo deny check` |
| `typecheck` | `tsc --noEmit`, router route-tree freshness, specta bindings freshness, i18n extraction freshness |
| `test-web` | `vitest run --coverage`, 80% gate |
| `test-rust` | `cargo test` |
| `build` | `tauri build --no-bundle`, plus the bundle-size budget |

System dependencies: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf`. No app-indicator package: Riff has no tray icon, and installing dependencies "because the template did" is how build times rot. Caching via `Swatinem/rust-cache` and pnpm's store cache.

No newer-runner canary job. The development machine runs Arch with glibc and WebKitGTK newer than any Ubuntu image, so it already exercises the newest toolchain daily; a CI job asserting the same thing would be a permanently-ignorable check, and ignorable checks train you to ignore checks.

### 17.1 Release

`release.yml` fires on `v*` tags. **One build job**, on `ubuntu-24.04`, producing all three bundles through `tauri-apps/tauri-action@v1`.

Splitting the build per format is tempting and wrong. A binary links against the glibc of its build host and runs on anything newer, never older — so the only question is which host is oldest, and webkit2gtk-4.1 answers it: Ubuntu 24.04 or nothing. Building the RPM on Fedora would be strictly worse, raising the glibc floor while changing no dependency metadata, because Tauri's RPM bundler writes `Requires` from `bundle.rpm.depends` in configuration rather than scanning the binary the way `rpmbuild` would. The declared dependencies are ours either way; only the linkage would suffer.

Fedora and Debian belong in verification instead, where they are genuinely load-bearing:

| Job | Environment | Asserts |
|---|---|---|
| `glibc-floor` | build host | `objdump -T` reports no required symbol newer than `GLIBC_2.39` |
| `verify-rpm` | `fedora:latest` container | `dnf install ./riff*.rpm` resolves, then `ldd` finds no missing libraries |
| `verify-deb` | `debian:trixie` container | `apt install ./riff*.deb` resolves, then the same `ldd` check |
| `verify-appimage` | bare container, `APPIMAGE_EXTRACT_AND_RUN=1` | the AppImage extracts and its payload links cleanly without FUSE |
| `publish` | `ubuntu-24.04` | `sha256sums.txt`, draft release with `git-cliff` notes |

`glibc-floor` is the important one. It turns "these binaries are portable" from an assumption into an assertion, so a future runner-image bump cannot silently narrow the audience — that class of regression is otherwise only discovered from a user's bug report. The three install checks exist because "the package built" and "the package installs and its libraries resolve" are different claims, and only the second matters to anyone downloading it.

**Dependabot** monthly, grouped by ecosystem, for npm, cargo and actions.

Desktop integration: a `.desktop` entry in the Audio/Music categories that deliberately claims **no** video or audio MIME types — quietly becoming someone's default media player is hostile — and an AppStream `metainfo.xml` so the application appears correctly in software centres.

`Name=Riff`, capitalised, while the binary and `productName` stay lowercase `riff`. The entry also sets `StartupWMClass=riff` to match the window's application ID: without it, Wayland compositors including Hyprland fail to associate the running window with its desktop entry, and the application shows a generic placeholder icon in docks and switchers. It is a one-line fix for a bug that otherwise looks like a broken icon install.

---

## 18. Legal and repository hygiene

- `LICENSE` — MIT, © 2026 valasme
- `THIRD-PARTY-LICENSES.md` — generated from `pnpm licenses list` and `cargo about`, and shipped as a resource so About can render it offline
- `README.md` — screenshots, what Riff is, install instructions for all three package formats, required runtime packages including the GStreamer plugin sets, build-from-source steps, the privacy statement, and the contribution policy
- `SECURITY.md` — private disclosure route and supported-version statement
- `CHANGELOG.md` — Keep a Changelog, generated by `git-cliff`
- `.github/ISSUE_TEMPLATE/` — bug report and question forms; `config.yml` disables blank issues
- `.github/PULL_REQUEST_TEMPLATE.md` — states plainly that pull requests are not accepted, with thanks and a note that MIT permits forks (D15)
- No `CONTRIBUTING.md` or `CODE_OF_CONDUCT.md`: both promise a collaboration model this project is not offering, and publishing them anyway wastes contributors' time
- `.editorconfig`, `CLAUDE.md` for future agent sessions

---

## 19. Dependency manifest

Every package is pinned to the version verified current on 2026-08-28. Nothing is listed that this milestone does not use.

**Runtime (npm)** — `react` 19.1, `react-dom` 19.1, `@tanstack/react-router` 1.170, `zustand` 5.0, `i18next` 26.4, `react-i18next` 17.0, `lucide-react` 1.34, `cmdk` 1.1, `sonner` 2.0, `radix-ui` 1.6, `class-variance-authority` 0.7, `clsx`, `tailwind-merge` 3.6, `react-error-boundary` 6.1, `@fontsource-variable/outfit` 5.3, `@fontsource/playfair-display` 5.3, `@fontsource-variable/jetbrains-mono` 5.3, `@tauri-apps/api` 2, `@tauri-apps/plugin-{opener,dialog,log,window-state}` 2.

**Development (npm)** — `vite` 7, `@vitejs/plugin-react` 4.6, `babel-plugin-react-compiler` 1.0, `tailwindcss` 4.3, `@tailwindcss/vite` 4.3, `@tanstack/router-plugin` pinned to the **exact same version** as `@tanstack/react-router` — the plugin generates the route tree the runtime consumes, and a version skew between them produces generation bugs that look like application bugs, `@tanstack/router-devtools`, `typescript` 5.8, `@biomejs/biome` 2.5, `vitest` 4.1, `@vitest/coverage-v8`, `jsdom`, `@testing-library/react` 16.3, `@testing-library/user-event`, `@testing-library/jest-dom`, `axe-core` 4.13, `lefthook` 2.1, `@commitlint/{cli,config-conventional}`, `i18next-parser`, `rollup-plugin-visualizer`, `@tauri-apps/cli` 2.11, `shadcn` 4.19.

**Rust** — `tauri` 2.11, `tauri-plugin-{opener,dialog,log,window-state,single-instance}` 2, `serde` 1, `serde_json` 1, `thiserror` 2.0, `tracing` 0.1, `tracing-subscriber` 0.3, `tracing-appender` 0.2, `notify` 8.2, `schemars` 1.2, `directories` 6.0, `tempfile` 3.27, `specta` 1.0, `tauri-specta` 1.0, `time` 0.3.

**Explicitly not installed** — `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `react-resizable-panels`, `pdfjs-dist`, `eslint`, `prettier`, `vitest-axe`, any HTTP client in either language. Each is either deferred with the feature that needs it (D11, D12) or forbidden outright (D7).

---

## 20. Risks

| Risk | Handling |
|---|---|
| The source palette fails WCAG boundary contrast | High contrast toggle; controls identifiable without borders (§7.3) |
| The webkit2gtk-4.1 requirement excludes Ubuntu 22.04 and Debian 12 | Unavoidable — it is Tauri v2's own floor, not a build choice. Stated plainly in the README, and declared as a package dependency so apt and dnf refuse the install with a clear message instead of the application failing to start |
| A future runner-image bump silently raises the glibc floor | The `glibc-floor` job fails the release if any required symbol exceeds `GLIBC_2.39` |
| WebKitGTK CSS gaps versus Chromium | `build.target: safari16`; no `backdrop-filter`, no bleeding-edge selectors; verified on the WebKitGTK 2.52 development machine |
| `js_init_script` failing would break themed boot | Frontend falls back to an async `settings_get()` and logs a warning; startup is slower, never broken |
| Static placeholders drift from the eventual real implementation | Placeholders are presentational only, with no state of their own to unwind |
| React Compiler bailouts | Build-time diagnostics reviewed; correctness never depends on the compiler |

---

## 21. Definition of done

- Launching with no configuration presents onboarding; completing it writes `completedAt` and never shows it again
- Every Settings control persists, survives a restart, and reflects an external edit to `settings.json` live
- A deliberately corrupted `settings.json` is quarantined, defaults load, and the user is told
- Theme, density, UI scale and high contrast apply instantly, and the correct theme is present on the very first painted frame
- Alt+K and the title-bar button both open the palette; every listed shortcut works
- Practice and History match the mockups and are inert
- `axe` reports zero violations on every route; the application is fully operable by keyboard alone
- No string reaches the user outside `t()`
- CI is green: lint, typecheck, both test suites, build, coverage gate, licence check
- A tagged release produces deb, rpm and AppImage with checksums; the rpm installs in a fresh Fedora container and the deb in Debian trixie, both with no unresolved libraries, and no binary requires a glibc symbol newer than 2.39
- Killing the frontend before `app_ready()` still results in a visible window
- A second launch focuses the existing window rather than starting a second process
- The running application opens no network connection — verifiable with `ss -tup`

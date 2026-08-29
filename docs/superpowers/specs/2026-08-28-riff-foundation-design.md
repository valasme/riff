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
| D2 | Themes: **Dark, Darker and Light. No "System" option.** Chosen during onboarding. | The user makes one explicit choice rather than inheriting an ambiguous desktop setting. Darker was added after the foundation shipped: Dark's `#242424` is a soft charcoal, and a near-black step down is a different answer to a different room, not a preference slider. |
| D3 | Type: **Outfit** (UI), **Playfair Display Italic** (wordmark), **JetBrains Mono** (paths, diagnostics) | Matched pixel-by-pixel against the mockups. All OFL, all self-hosted. |
| D4 | Locales: **English only**, full i18n plumbing in place | No machine-translated locales shipping as if reviewed. |
| D5 | Onboarding: **welcome + theme + privacy**, full-window, three steps | Theme needs room for three preview cards; the privacy step is the trust statement for a local-first app. |
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

1. **Command palette affordance in the title bar.** Alt+K needs a mouse-reachable equivalent. This began as a bare `search` icon beside the wordmark and became a centred, field-shaped trigger carrying the placeholder text and an `Alt K` key hint. The icon-button form failed for a reason worth recording: at the gap an icon button wants, it read as part of the wordmark rather than as a control, and a 16px glyph is not a discoverable home for the application's search. The centred trigger names itself, and the drag region stays large because the two flanking clusters — which is what centres it — are themselves drag regions.
2. **High contrast toggle in Appearance.** See §7.3. The source palette's `#4d4d4d` borders measure 1.8:1 against the surface, below the 3:1 that WCAG 1.4.11 requires for control boundaries. Rather than repaint the design for everyone, an opt-in toggle raises borders and muted text for users who need it.

---

## 3. Architecture

```
┌──────────────────────── Webview (React 19) ─────────────────────────┐
│  routes/          TanStack Router, hash history, file-based          │
│  features/        settings · onboarding · palette · keybindings ·    │
│                   window · practice(static) · history(static)        │
│  stores/          useSettings (Zustand) · useUi (Zustand)            │
│  lib/ipc/         hand-written typed facade over invoke()            │
└───────────────────────────────┬──────────────────────────────────────┘
                    typed commands │ events
┌───────────────────────────────┴──────────────────────────────────────┐
│                          Rust (Tauri 2.11)                            │
│  commands/     settings · paths · app · window · licenses · diagnostics│
│  settings/     model · defaults · store · migrate · watcher           │
│  storage/      atomic write · quarantine · backup rotation            │
│  paths.rs      XDG resolution + env overrides                         │
│  error.rs      RiffError → { code, details }                          │
│  logging.rs    tracing → per-launch session dir + frontend bridge      │
│  diagnostics/  probe · banner · health · bundle                        │
│  cli.rs        doctor · repair · logs · config · paths · history       │
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
| `$XDG_STATE_HOME/riff/logs/<timestamp>-<pid>/riff.log` | **One directory per launch**, ten retained. `panic.txt` lands beside it. |
| `$XDG_STATE_HOME/riff/logs/latest` | Symlink to the current session, so `tail -f .../latest/riff.log` needs no lookup. |
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
    "theme": "dark",                   // "dark" | "darker" | "light"
    "density": "comfortable",          // "comfortable" | "compact"
    "uiScale": 1.0,                    // 0.8 – 1.5, step 0.05
    "reduceMotion": "system",          // "system" | "always" | "never"
    "highContrast": false,
    "titleBar": "custom",              // "custom" | "system"
    "sidebar": { "collapsed": false, "rememberCollapsed": true }
  },
  "onboarding": {
    "completedAt": null,               // RFC 3339 timestamp
    "version": 1                       // see below
  }
}
```

`onboarding.version` records which onboarding the user completed. If it is **lower** than the current one, onboarding is presented again — that is the mechanism for re-introducing first-run after adding a step worth showing existing users. If it is **higher**, onboarding is skipped and the value left untouched; a downgraded install must not force a wizard the user already finished. Bumping it is a deliberate act, never automatic.

`general.lastRoute` is validated on read against the live route table and falls back to `/practice` if it does not resolve. Two cases make this necessary rather than defensive: it can hold `/onboarding`, which would trap the user in a completed wizard on every launch, and it can hold a route removed by an update.

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

Every command returns `Result<T, RiffError>`. The TypeScript facade in `src/lib/ipc/` is **written by hand**, not generated.

`tauri-specta` was the obvious choice and is the wrong one here. Its Tauri-v2 line has sat at `2.0.0-rc` for twenty-five releases with the API churning between them, and the stable `1.0.x` on crates.io targets Tauri v1 — it will not compile against 2.11. Taking a pre-release dependency on the application's most load-bearing seam contradicts rejecting `vitest-axe` for immaturity two sections later. Twelve commands carrying simple types cost roughly eighty lines of TypeScript to declare by hand.

The guarantee that would have been lost — Rust and TypeScript agreeing — is recovered without codegen: a Rust test serialises one representative value of every command payload and error variant to `src-tauri/tests/fixtures/ipc-shapes.json`, which is committed. Any change to a Rust type fails that test loudly and points at the TypeScript that must follow. One test file replaces a code generator, a generated artifact, and a CI freshness job.

| Command | Signature | Notes |
|---|---|---|
| `settings_get` | `() -> Settings` | Fallback only; boot uses the injected object. |
| `settings_patch` | `(SettingsPatch) -> Settings` | `SettingsPatch` mirrors `Settings` with every field `Option`, applied recursively, so a caller sends only what changed and `None` never means "clear this". Returns the full validated result, which is what the store adopts — the frontend never assumes its optimistic guess was right. |
| `settings_reset` | `(Option<Section>) -> Settings` | One section, or everything. "Everything" means General and Appearance; `onboarding` is preserved, because resetting preferences is not the same request as being made to redo first-run. Re-running onboarding is its own explicit action. |
| `settings_export` | `() -> Option<PathBuf>` | Opens the native save dialog **in Rust**, writes the file, and returns the chosen path for a confirmation toast. `None` means the user cancelled. |
| `settings_import` | `() -> Option<Settings>` | Opens the native open dialog in Rust, then runs the file through the full §4.3 read path — migration, unknown-field preservation, newer-version tolerance. A file that fails validation is rejected with a `Validation` error and current settings are left untouched. `None` means cancelled. If the imported file has `onboarding.completedAt` null, the current completion state is **kept**: importing someone's appearance preferences must not throw you back into a first-run wizard. |
| `paths_get` | `() -> AppPaths` | Config, data, state, cache, log directories. |
| `open_path` | `(PathKind) -> ()` | Opens one of our own directories. Enum, never a raw path. |
| `open_external` | `(ExternalLink) -> ()` | Enum of fixed destinations. See §12. |
| `app_info` | `() -> AppInfo` | App, Tauri and WebKitGTK versions, build date, git SHA. |
| `licenses_get` | `() -> Vec<LicenseEntry>` | Reads the bundled third-party notices resource. |
| `app_ready` | `() -> ()` | Reveals the window. |
| `diagnostics_export` | `() -> Option<PathBuf>` | Opens the save dialog in Rust and writes the redacted bundle (§18). Same output as `riff logs export`. |
| `log_write` | `(LogLevel, String, Option<Value>) -> ()` | Frontend diagnostics into the session log. Without it a React crash leaves no trace on disk. |
| `window_minimize` / `window_toggle_maximize` / `window_close` | `() -> ()` | Custom title bar controls. |

Neither import nor export accepts a path. The picker is opened by Rust, so no filesystem path is ever chosen by, passed through, or visible to the webview — the same rule `open_path` and `open_external` follow. An earlier draft had these two taking `PathBuf` from the frontend, which quietly contradicted that rule and would have been the one hole in it.

Errors serialise discriminated:

```rust
#[derive(thiserror::Error, Debug, Serialize)]
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

Events: `settings://changed`, `settings://recovered`, `settings://write-failed`, `app://confirm-quit`.

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

Persisted settings are read through **primitive** selector hooks — `useTheme()`, `useDensity()`, `useUiScale()` — so components never subscribe to the whole object and re-render on unrelated changes. Object selectors would not achieve this: `adopt` replaces `settings` wholesale, so `s.settings.appearance` returns a fresh identity every time and Zustand's default equality always sees a change. The settings screens themselves use section hooks, having nothing to gain from a narrower subscription.

### 6.3 Theming

Tailwind CSS v4, CSS-first `@theme`. Themes are attribute-scoped, not class-scoped, so `data-theme`, `data-density` and `data-contrast` compose independently:

```css
:root, [data-theme="dark"] { --surface: #242424; /* … */ }
[data-theme="darker"]      { --surface: #101010; /* … */ }
[data-theme="light"]       { --surface: #fafafa; /* … */ }

/* Derived tokens re-resolve inside any themed subtree — see §7.1. */
:root, [data-theme]        { --line: color-mix(in srgb, var(--fg) 11%, transparent); /* … */ }
[data-contrast="high"]     { --border-subtle: #6d6d6d; --fg-muted: #b0b0b0; /* … */ }
```

The dark palette is declared on `:root, [data-theme="dark"]` rather than `:root` alone so that a `data-theme="dark"` subtree inside a light-themed document still resolves to dark values; without the second selector the theme previews would inherit whatever the root happened to be.

UI scale is one variable: `html { font-size: calc(16px * var(--ui-scale)); }`. Every dimension in the application is expressed in `rem`, so the slider scales the entire interface proportionally rather than only text. Density adjusts spacing tokens only, never font size — the two controls stay orthogonal.

### 6.4 Components

shadcn/ui on Radix, installed with `pnpm dlx shadcn@4`, re-skinned to the tokens in §7. Only what is used: `button`, `dialog`, `switch`, `slider`, `radio-group`, `tooltip`, `skeleton`, `label`, `sonner`, `command`. `select`, `dropdown-menu`, `scroll-area`, `separator` and `input` are deliberately absent — a three-option list is a native `<select>` and a read-only search field is a native `<input>`, so installing those primitives would ship five components with no consumer.

Application components live in `src/components/`; feature-owned components live under their feature. A component that only one feature uses belongs to that feature.

---

## 7. Design system

### 7.1 Colour

Dark and Light are sampled directly from the mockups. Darker is a computed
near-black step below Dark (D2).

| Token | Dark | Darker | Light | Usage |
|---|---|---|---|---|
| `surface` | `#242424` | `#101010` | `#fafafa` | Title bar, sidebar and page background |
| `card` | `#323232` | `#191919` | `#f2f2f2` | Settings groups, panes, dialogs, popovers |
| `raised` | `#3c3c3c` | `#232323` | `#eaeaea` | Secondary buttons, select triggers |
| `border-subtle` | `#4d4d4d` | `#3a3a3a` | `#d4d4d4` | Control outlines: inputs, unchecked radios, checkbox shapes |
| `foreground` | `#e4e4e4` | `#e8e8e8` | `#1c1c1c` | Primary text and icons |
| `muted-foreground` | `#9a9a9a` | `#9e9e9e` | `#5f5f5f` | Secondary text |
| `ring` | `#e4e4e4` | `#e8e8e8` | `#1c1c1c` | Focus indicator |

High contrast overrides `border-subtle` and `muted-foreground` per theme:
`#6d6d6d`/`#b0b0b0` on Dark, `#606060`/`#b8b8b8` on Darker, `#8a8a8a`/`#4a4a4a`
on Light. Each border value is the computed 3.0:1 point on that theme's own
surface.

**Lines and fills are mixed from `foreground`, not written as hex.** Three
weights, and every rule in the application uses one of them:

| Token | Value | Usage |
|---|---|---|
| `line` | `foreground` at 11% | Structural chrome: title bar rule, sidebar and sub-nav edges, card and dialog outlines, table frame |
| `separator` | `foreground` at 7% | Row dividers *inside* a list, table or settings card |
| `hover` | `foreground` at 8% | Hover fills, recessed strips, key chips |
| `active-fill` | `foreground` at 13% | The current nav item, the selected segment, the highlighted palette row |

The reason they are mixes rather than hexes is the failure they replaced. A
flat `separator: #313131` is invisible on `#323232` cards and nearly invisible
on `#242424`, while a flat `#4d4d4d` chrome edge glares on the same surface —
so the sidebar's edge and the settings sub-navigation's edge, the same kind of
boundary, were drawn in two different colours and neither at the intended
strength. Mixing from `foreground` makes a rule keep the same *relative*
strength wherever it sits, which is the property that actually reads as
consistency. High contrast raises `line` to 28% and `separator` to 20%.

These derived tokens are declared on `:root, [data-theme]` rather than `:root`
alone. A custom property containing `var()` is substituted where it is
*declared*, so a single root declaration would keep resolving against the root
theme's `foreground` inside a `[data-theme]` subtree — and the theme previews
in Settings and onboarding, which are real shells rendered under their own
`data-theme`, would draw the wrong rules.

Deliberately absent: any accent hue. The mockups are purely neutral and stay
that way. Focus is communicated by a two-pixel neutral ring at 12.2:1, and the
one emphatic button in the design inverts `foreground` and `surface` rather
than introducing a colour the palette does not have.

### 7.2 Typography

| Role | Face | Size / weight |
|---|---|---|
| Wordmark | Playfair Display Italic 500 | 22px, +0.025em tracking |
| UI | Outfit Variable | 15px / 500 nav, 14px / 400 body, 13px descriptions |
| Section headings | Outfit Variable | 16px / 600 |
| Paths, versions, diagnostics | JetBrains Mono Variable | 12.5px |

The wordmark is 500, not 700, and that is a correction rather than a taste. In Playfair's italic the double-f carries both a tall ascender and a deep descender while `ri` sits entirely at x-height, so weight lands almost entirely on the f's and the mark reads as two large letters with something small in front of them. Dropping one step of weight and adding tracking fixes the balance without touching the letterforms. Trailing padding, not a parent `gap`, separates it from what follows: the italic leans right, so the final f overhangs its own advance width and no gap measured from that width ever looks even.

Self-hosted through Fontsource with `font-display: swap`. Only the cuts in use are imported — Playfair contributes italic 500 alone, because importing the family would ship eight faces to render four letters. No `<link rel="preload">`: the window stays hidden until first paint, so there is no visible flash for preloading to prevent, and preload hints for fonts that may not be used on the first screen cost more than they save. No network at runtime — a hard requirement, not a performance preference.

### 7.3 Contrast audit

Measured against WCAG 2.2, and recorded because it drove a design decision.

| Pair | Ratio | Requirement | Result |
|---|---|---|---|
| `#e4e4e4` on `#242424` | 12.2:1 | 4.5:1 text | Pass |
| `#9a9a9a` on `#242424` | 5.3:1 | 4.5:1 text | Pass — `#8a8a8a` is the exact floor, so this keeps margin |
| `#e8e8e8` on `#101010` | 15.5:1 | 4.5:1 text | Pass (Darker) |
| `#9e9e9e` on `#101010` | 7.1:1 | 4.5:1 text | Pass (Darker) |
| `#4d4d4d` on `#242424` | 1.8:1 | 3:1 boundaries | **Fail** |
| `#3a3a3a` on `#101010` | 1.7:1 | 3:1 boundaries | **Fail** (Darker, by the same design choice) |
| `#3c3c3c` on `#242424` | 1.4:1 | 3:1 boundaries | **Fail** |
| Ring `#e4e4e4` on `#3c3c3c` | 8.6:1 | 3:1 | Pass |

Riff also honours `prefers-contrast: more` by default, for the same reason it honours `prefers-reduced-motion`: it is an unambiguous accessibility declaration the desktop makes on the user's behalf. Theme has no System option because colour scheme is a taste question the user was asked once (D2); contrast is not a taste question. The explicit setting still wins.

Resolution: controls remain identifiable without relying on their borders — every one carries a text label or an `aria-label` plus a tooltip, and hover and focus states change fill, not only outline. The High contrast toggle raises borders to the computed 3.0:1 point on each theme's own surface (`#6d6d6d` on Dark, `#606060` on Darker, `#8a8a8a` on Light) for users who need boundary contrast. The default keeps the design intact; nobody is locked out.

Two states that carry meaning are drawn so they survive the low-contrast
default. A switch is a *filled* track when on and an *outlined* one when off,
so the difference is fill and not a shade of grey; a segmented control fills
only the selected chip and leaves its track outlined, for the same reason. The
earlier switch styled both states with `data-checked:`/`data-unchecked:` —
which Tailwind compiles to `[data-checked]`, an attribute Radix never emits
(it emits `data-state="checked"`) — so neither rule matched, the track took no
background at all, and every switch in Settings rendered as one dark dot with
no on state and no off state. Every `data-*` variant in `components/ui` is
therefore written out in full.

### 7.4 Layout metrics

The mockups are drawn on a 1920×1089 canvas at a scale larger than a real window. These are the implementation values, preserving the proportions that carry the design's character.

| Element | Value |
|---|---|
| Window default / minimum | 1280×832 / 960×640 |
| Title bar height | 52px, with a `line` rule along its bottom edge |
| Sidebar width | 240px expanded, 56px icon rail collapsed |
| Settings sub-navigation width | 248px |
| Settings content column | 736px maximum, centred |
| Nav item | 40px tall, 10px radius, 10px padding, 18px icon, 12px gap |
| Content padding | 24px |
| Card / pane / control radius | 12px / 10px / 8px |
| Focus ring | 2px, 2px offset |
| Motion | 110ms and 170ms, `cubic-bezier(0.2, 0, 0, 1)` — two durations, one curve, for everything that moves |

Nothing that changes the size of a layout container is animated, and the
sidebar is the case that proves the rule. Transitioning its width drags the
entire content column along for the duration: the practice panes reflow frame
by frame and the text being read slides sideways. A width change is not a
thing worth watching, it is a thing worth having already happened. Only
colours transition — hover, active and focus states on the items themselves.

The title bar gained 8px and a bottom rule together. At 44px with no rule it
was the same flat `surface` as the content below it with nothing between them,
so the window read as one undifferentiated slab; the extra height is what lets
the toggle tile, the wordmark and the search trigger sit on a common baseline
without crowding.

Because UI scale multiplies the root font size and every dimension is in `rem`, the chrome grows with it: at 1.5× the sidebar and settings sub-navigation together claim roughly 700px of a 960px minimum window, leaving the settings content column unusably narrow. Two container-query breakpoints handle it: below **56rem** of available width the sidebar drops to its 56px icon rail, and below **44rem** the settings sub-navigation becomes a horizontal strip above the content. Neither is a mobile layout — they are the honest response to a legitimate combination of settings.

The thresholds are in `rem`, and that is the entire mechanism rather than a formatting choice. A container query written in `px` measures the same window width at every UI scale, so `@max-[900px]` could only ever fire below the 960px minimum window — that is, never. In `rem` the threshold *grows* with the scale while the window stays the same number of pixels, which is what makes the rail appear exactly when the chrome would otherwise crowd the content.

Collapsing the sidebar yields an icon-only rail rather than hiding it entirely, so navigation and `aria-current` remain available. Tooltips supply the labels, and the transition between the two widths is instant.

### 7.5 Icons

`lucide-react`. `panel-left-close` / `panel-left-open` (sidebar toggle, one per direction), `search` (palette), `music-4` (Practice), `history` (History), `settings` (Settings), `sliders-horizontal` (General), `palette` (Appearance), `info` (About), `file-music` / `video` / `audio-lines` (the three practice panes), `filter`, `file-text`, `clock`, `timer`, `ellipsis-vertical` (row actions), `folder-open`, `download`, `upload`, `rotate-ccw`, `wand-2`, `external-link`, `file-down`, `chevron-right`, `chevron-down`, `check`, `copy`, `x`.

Three choices changed after the foundation shipped, each because the glyph described the wrong thing. `audio-waveform` and `folder-clock` named the file formats Practice will open and the folder History will list rather than what either screen is *for*; `music-4` and `history` name the screens. `house` for General meant "home", and General is not the home of anything — it is the section full of switches, so `sliders-horizontal`. And `panel-left` was a single glyph for a two-state control, so the sidebar toggle never said which way it was about to go.

The window controls are the deliberate exception: minimise, maximise, restore and close are drawn as four inline SVG paths on a 12px grid rather than imported. Lucide draws on a 24px grid with a 2px stroke, and scaled to the 12px a window control wants, `square` becomes a heavy blob and `minus` a short fat bar. Real title bars use hairlines.

---

## 8. Screens

### 8.1 Title bar

`decorations: false`. Layout, in three parts:

```
[ ⟨toggle⟩ riff  · · · ]  [ ⌕ Search or jump to…  Alt K ]  [ · · ·  − □ ✕ ]
```

The two flanking clusters are `flex: 1 1 0`, so they take an equal share of
the free space and centre the search trigger between them without a magic
margin — and both are themselves drag regions, which is what keeps the
draggable area large. Below 44rem of title-bar width the trigger collapses to
its icon alone.

The sidebar toggle sits on a filled tile rather than floating as a bare glyph:
a lone icon in the corner reads as decoration, and a tile gives hover and
focus something to land on. Its icon and its label both follow the sidebar's
state (`panel-left-close` / `panel-left-open`, "Collapse" / "Expand"), and it
carries `aria-expanded`.

The drag region uses `data-tauri-drag-region`. Double-click-to-maximise is verified against Tauri 2.11's built-in drag-region behaviour first, and only hand-implemented if it turns out not to be covered — writing the handler unconditionally risks toggling maximise twice per double-click. Window controls are 32×32 rounded hit targets with `aria-label`s, inset 8px from the window edge — flush controls put the close button's hover fill on the window corner. The maximise control subscribes to the real window state through `is_maximized` and a resize listener (both inside `core:default`, so no new capability), because the window manager can maximise the window without the button: a double-click on the drag region, a keyboard shortcut, a tiling rule. Its glyph and its label follow. Setting `appearance.titleBar` to `system` calls `set_decorations(true)` and hides the custom bar live, with no restart — this matters on GNOME and KDE, where users expect their own decorations. Under Wayland, whether a compositor honours the request is up to the compositor; Hyprland and others may ignore it entirely. Riff therefore reads `is_decorated()` back after the call, and if the window manager refused, reverts to the custom bar and says so in a toast rather than leaving the user with a window that has no title bar at all and a setting that claims otherwise.

### 8.2 Onboarding

Full window, title bar retained so the window can still be closed. Three steps with progress dots and Back/Next.

1. **Welcome** — the Playfair wordmark, one line of description.
2. **Theme** — three large cards, each a miniature render of the real interface in dark, darker and light. The miniature is built from the same tokens as the application under its own `data-theme`, so it cannot drift from what choosing that theme actually does, and a fourth theme would need no work there. The card matching the desktop's `prefers-color-scheme` is pre-selected as a courtesy and is applied on arrival, so the step opens already looking like the recommendation rather than describing it. Clicking another card applies it instantly. Continuing without touching either commits whatever is currently applied — the pre-selection is a real answer, not a hint the user can accidentally skip past into a default they never saw.
3. **Privacy** — plain statement: everything stays on this machine, no telemetry, no accounts, no network connections at all. Lists the exact directories, each with an Open button.

Finishing writes `onboarding.completedAt` and routes to `general.startupRoute`. Re-runnable from Settings → General.

### 8.3 Practice — static placeholder

Faithful to the mockup: one tall pane on the left, two stacked on the right, each with a header carrying `picture-in-picture-2` and `x` icons. Panes are `raised` on `surface` with 10px radii. Nothing is interactive. Each pane centres a glyph, one sentence naming what will eventually open there, and an "In development" chip — a bare chip on an empty rectangle said the feature was unfinished but not what the feature was.

### 8.4 History — static placeholder

A heading, a search input with a `search` icon, a `filter` button, and a table with select, name, last-practised and duration columns plus a per-row menu affordance. Inert: the input is `readOnly`, controls are `disabled` with `aria-disabled`, and the skeletons carry `aria-hidden` so screen readers are not read a wall of nothing.

Three revisions to the mockup, all in service of the same thing — a table that reads as a preview rather than as a table that failed:

- **Three skeleton rows, not eight rows of which five are empty.** The empty checkbox rows existed to make the grid fill the panel; they read as five sessions that did not load.
- **The card takes its height from its contents.** Stretched to the viewport, three rows sat above half a screen of empty card.
- **The header carries words, not only glyphs.** The mockup's icon-only header meant the one thing a table has to tell you — what each column is — was a guess. The icons stay as anchors for the eye.

A strip along the bottom of the card states plainly that Riff records nothing yet and that the rows show the shape History will take when playback lands.

### 8.5 Settings

Three-column shell: sidebar, 248px sub-navigation (General, Appearance, About), and a centred content column of grouped cards.

The content is **grouped**, not one long card. General splits into Startup / Data / Settings file / Start over; Appearance into Theme / Layout / Motion and contrast / Window; About into Build / Legal / Support. Fifteen undifferentiated rows in a single panel made "where is the title bar setting" a scanning problem; one small heading per three or four rows makes it a reading problem.

Three control types carry the sections:

- **Segmented controls** for every two- or three-way choice (density, reduce motion, title bar). A row of loose radio dots and labels reads as a form to be filled in and submitted, which is exactly wrong for a screen with no Save button. It is still a Radix radio group underneath, so arrow keys, the roving tabindex and the group name are the primitive's behaviour rather than a re-implementation.
- **Theme cards** with live miniatures, shared with onboarding (§8.2). Theme is the one setting whose effect can be shown instead of described.
- **A themed listbox**, never `<select>`. GTK draws the native popup, not Riff, so it ignored every token in the design system and rendered as light-on-light on the dark themes — a control the user could operate but not read. There is no CSS that fixes that, because the popup is not in the document.

Every control writes through `useSettings.patch()` and takes effect immediately. There is no Save button and no dirty state — a settings screen that can be abandoned half-applied is a settings screen with a bug in it.

The sections are written by hand, **not generated** from the JSON Schema. Fifteen controls do not repay a rendering framework, and a generator would immediately need escape hatches for the UI-scale slider's live preview, the destructive-reset confirmation and the licence viewer. Hand-written sections stay readable and are trivially testable; a generator would be the more impressive and worse decision.

**General** — Startup route; Restore window size and position; Confirm before quitting; Data locations with per-directory Open buttons; Export settings; Import settings; Reset all settings (destructive confirmation dialog); Re-run onboarding.

Window *position* restore is a request, not a guarantee: under Wayland the compositor owns placement and Hyprland, the primary development target, ignores it outright. Size is honoured everywhere. The control's description says so plainly rather than promising behaviour the user's desktop will quietly discard — the same honesty the title bar setting applies in §8.1.

**Appearance** — Theme (Dark / Darker / Light); Density; UI scale slider with a Reset affordance; Reduce motion; High contrast; Title bar style; Remember sidebar state.

The UI scale slider applies **when the gesture ends**, not on every pointer move, and that is forced by the control's own subject matter. Radix caches the slider's bounding rect on pointer-down and maps the pointer through it for the whole drag; applying the scale live changes the root font size, which changes the slider's own width *and* its position — the settings column is centred and the sub-navigation grows beside it. From the first pixel of the drag the cached rect describes an element that has moved, so the thumb (placed by percentage of the new track) separates from the cursor: the handle stops following the pointer while the percentage keeps climbing, which reads as a broken control. Holding the value locally until release breaks the loop. The thumb and the readout both follow the draft, so the drag is still live feedback; the interface resizes once, on release. Arrow keys are unaffected — Radix commits on every step key — so the keyboard path applies immediately.

**Remember sidebar state** governs the *next launch*, not the current one. With it off, Riff opens with the sidebar expanded and the toggle is session-only; seeding that session value from the persisted one made "don't remember" remember. Flipping the setting never moves the sidebar: whichever value stops being the live one adopts what is currently on screen first, or the switch resurrects a stale value from whenever that side was last in charge.

Reduce motion offers a System option although Theme deliberately does not (D2), and the asymmetry is intentional: `prefers-reduced-motion` is an unambiguous accessibility declaration that the desktop makes on the user's behalf and that Riff should honour by default, whereas colour scheme is a taste question the user was already asked once, during onboarding.

**About** — Version, Tauri and WebKitGTK versions, build date and git SHA, each copyable individually plus one Copy all; MIT licence text in full; third-party notices generated from npm and cargo, filterable by name or licence, rendered as collapsed rows that expand one licence at a time — several hundred entries of full licence text mounted at once would be the only place in this application capable of janking, and it would do so on the one screen nobody profiles; repository and issue links; a Copy diagnostics button producing a paste-ready report for bug reports, with the home directory rewritten to `$HOME` so pasting it into a public issue does not disclose the user's account name. A privacy-first application should not leak identity through its own bug-report affordance.

The language selector is intentionally absent: a picker with one option is noise. `general.language` exists in the schema and is honoured; the control appears when a second locale ships.

---

## 9. Keyboard and command palette

One registry in `src/features/keybindings/keymap.ts`:

```ts
type Keybinding = {
  id: string;                       // "nav.practice"
  chord: string;                    // "alt+1"; empty means palette-only
  group: "navigation" | "appearance" | "application";
  descriptionKey: string;           // i18n key
  icon: LucideIcon;                 // rendered by the palette
  hidden?: boolean;                 // bound, but not listed
  run: () => void;
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

The icon lives in the registry rather than in a lookup table beside the palette, so that this file stays the whole answer to "what can Riff do" — a command added here arrives complete.

The palette is `cmdk` inside a Radix dialog: fuzzy search, arrow-key navigation, correct ARIA combobox semantics, focus trap, focus restored to the invoking element on close. Groups: **Navigation** (Practice, History, Settings, About), **Appearance** (cycle theme, toggle density, toggle high contrast), **Application** (open config folder, open log folder, quit). Each row carries its icon and, read from the registry, its shortcut — rendered as one key chip per key, because "Alt+1" is two keys and a run of mono-spaced punctuation beside a 15px label reads as a typo. A footer states the keyboard model rather than leaving it to be discovered.

The theme command **cycles** Dark → Darker → Light rather than flipping between two. With three themes a two-way toggle has no meaning, and an order that skipped one would feel broken to whoever chose the one it skipped.

Two details of the palette's presentation are load-bearing:

- **The search field has no border and no focus ring of its own.** It spans the dialog and takes focus the instant the dialog opens, so a ring on it painted a white box around the palette on every single use, with no key pressed. The dialog is the focused thing; keyboard focus stays completely visible because the highlighted command row is what moves.
- **The backdrop dims to 66%** (42% in Light, where the same veil over a near-white surface reads far heavier). At the original 10% the whole application stayed legible behind the palette, so it read as a floating card rather than as the thing with focus.

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
- `prefers-reduced-motion` and `prefers-contrast: more` both honoured by default, each with a setting able to force or override it
- Interactive targets at least 24×24 CSS pixels (WCAG 2.2 §2.5.8)
- No information conveyed by colour alone
- The UI-scale slider is operable by keyboard with announced values
- Disabled placeholder controls use `aria-disabled` with an explanatory label rather than vanishing from the accessibility tree
- Riff is a desktop application, so **no control shows the pointing-hand cursor.** The arrow is correct over a button and the I-beam is correct only where there is text to select or type; the hand is the browser tell that makes a Tauri application feel like a web page. `not-allowed` goes with it — a control that is dimmed and unresponsive has already said so. This is set once at the root rather than per component, because one component forgetting is exactly how the hand comes back
- Where a control's visible text is a fragment of its accessible name — an icon-only Open button in a row labelled "Settings" — the name comes from `aria-label` and the row supplies `aria-describedby`, so the announcement is "Open folder, Settings" rather than four identically-named buttons

`axe-core` 4.13 asserts zero violations on every route and every dialog in component tests, driven by a ~15-line local Vitest matcher. Not `vitest-axe`: it sits at 0.1.0 with a `vitest >=0.16` peer range, and taking an unmaintained wrapper as a dependency to save fifteen lines is a bad trade against Vitest 4. Biome's a11y rules run on every commit. The two catch different classes of problem, which is why both are present.

---

## 12. Error handling, logging, security

**Rust.** `thiserror` for typed errors, no `unwrap` outside tests — enforced by `clippy::unwrap_used` at deny level. `expect_used` is deliberately *not* denied: a genuine invariant should be stated with a message explaining why it holds, and banning that only pushes people back to `unwrap`. A panic hook writes the payload and backtrace to the log unconditionally, then attempts a native dialog on a best-effort, non-blocking basis — a blocking dialog raised from a panic on the GTK main thread can deadlock, turning a crash report into a hang. Logging always succeeds; the dialog is a courtesy, because an application that vanishes silently is indistinguishable from one the user broke.

**Frontend.** `react-error-boundary` at the root plus a TanStack Router `errorComponent` per route, so one broken screen does not take down the shell. The crash screen shows the error code, a **Copy error details** button, Open logs, and Reload — named distinctly from About's **Export diagnostics** (§18.2), because two buttons sharing a label while doing different things is its own bug. `window.onerror`, `unhandledrejection` and every error-boundary catch forward to the session log through `log_write`, so a frontend crash leaves a trace on disk rather than only on a console the user cannot open. Recoverable problems use `sonner` toasts and never block.

**Logging.** `tracing` with `tracing-appender`, **one directory per launch** rather than one file per day — rotating by date interleaves several runs into one file, and "which run was this?" is the first question every bug report has to answer. Ten sessions are retained and `latest` symlinks to the current one. Every session opens with a banner recording version, git SHA, build date, Tauri and WebKitGTK versions, distribution, kernel, architecture, session type, desktop, compositor, locale, resolved paths with their writability, and the settings load outcome. Boot phases are timed, so the 400 ms target in §13 is falsifiable rather than aspirational. A clean shutdown writes `shutdown complete` as its last line, which makes "did it crash?" a single `tail -1`. Default level `info`, overridable by `RIFF_LOG`, by `riff --log-level`, or live from a `tracing_subscriber::reload` handle. File paths are logged; file contents never are, and the environment is read from an allow-list rather than dumped.

**Security.** Content Security Policy, replacing the scaffold's `null`:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data:;
media-src 'none';
connect-src ipc: http://ipc.localhost;
object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';
```

`connect-src` admits the IPC origins and nothing else, so D7 is enforced by the runtime rather than by discipline. `style-src 'unsafe-inline'` is required by Radix's inline positioning styles; `script-src` stays strict, which is where it matters.

`media-src 'none'` is accurate rather than anticipatory: no media exists this milestone. When §15 lands it becomes `media-src asset: http://asset.localhost`, and that one line is the whole change. Granting a permission now for a feature that does not exist is dead permission, and "we would have had to add it later anyway" is not a security argument.

The webview holds exactly one capability: `core:default`. That is the entire list — `tauri-plugin-log` is not installed, because it writes to a directory of its own and `log_write` carries frontend diagnostics into the session log instead. The `opener`, `dialog` and `window-state` plugins are used **only from Rust**, so the webview needs no capability for any of them — a plugin's JS permission is required only if JavaScript calls it, and none of ours does. No `fs`, no `shell`, no `http`. `open_path` and `open_external` accept enums, never caller-supplied strings, so there is no path or URL a compromised frontend could pass that we would open.

---

## 13. Performance

- React Compiler via `babel-plugin-react-compiler`, removing hand-written memoisation
- Route-level code splitting through TanStack Router's lazy routes
- Vite `build.target: "safari16"` — Riff requires **webkit2gtk 4.1** (libsoup3) and **glibc ≥ 2.39**. The 4.1 ABI, not a version number, is the binding constraint: it is what excludes Ubuntu 22.04 and Debian 12 no matter how Riff is built. Stated in the README, declared by the deb and rpm packages, asserted by `glibc-floor`
- Selector-based Zustand subscriptions; no component subscribes to the whole settings object
- Debounced writes (§4.4) so slider drags produce one write
- Fonts self-hosted and latin-subset only; no `<link rel="preload">` (§7.2), and no runtime font fetch is even possible under the CSP
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
- `settings_reset(None)` restores General and Appearance defaults while leaving `onboarding` untouched
- An imported file with `onboarding.completedAt` null does not clear the current completion
- `onboarding.version` lower than current re-presents onboarding; higher skips it and preserves the value
- `general.lastRoute` holding `/onboarding`, or a route that no longer exists, falls back to `/practice`
- `RiffError` serialises to the documented shape
- Every command payload and error variant matches the committed `ipc-shapes.json` fixture, so a Rust type change cannot silently diverge from the hand-written TypeScript

All against `tempfile` directories; no test touches a real configuration.

**Frontend — Vitest, Testing Library, jsdom.**

- `useSettings` optimistic apply, rollback on IPC failure, patch on external change
- Theme, density, scale and contrast attributes applied to `<html>`
- Keymap resolution: chords, input-focus suppression, duplicate detection
- Palette filtering, keyboard navigation, focus restoration
- Every settings control renders its persisted value and writes on change
- Onboarding gating: redirect while incomplete, redirect away once complete
- The theme pre-selected on arrival at step 2 is what gets committed if the user presses Continue without clicking
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

One packaging lever is worth recording now: Tauri's AppImage bundler exposes `bundle.linux.appimage.bundleMediaFramework`, which packs GStreamer and its plugins into the AppImage so playback works on systems missing them. It stays `false` this milestone — it adds well over a hundred megabytes to carry a decoder for media that does not exist yet — and becomes the obvious switch to flip when Practice grows real playback.

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
  lib/            ipc/ (typed invoke facade), errors, logger, cn
  locales/en/     common · settings · onboarding · errors · palette
  styles/         globals.css, theme.css
src-tauri/src/
  lib.rs  bootstrap.rs  cli.rs  error.rs  logging.rs  paths.rs
  commands/{settings,paths,app,window,licenses,diagnostics}.rs
  settings/{model,defaults,store,migrate,watcher}.rs
  diagnostics/{probe,banner,health,bundle}.rs
  storage/atomic.rs
```

A file that outgrows roughly 200 lines is a signal it is doing two things.

### 16.2 Scaffold removal and assets

The repository is `create-tauri-app` output, and the template's demo code must be deleted rather than left to rot around the real application. Explicitly: the `greet` command in `src-tauri/src/lib.rs` and its `invoke_handler` entry, `src/App.tsx`, `src/App.css`, `src/assets/react.svg`, `public/tauri.svg`, `public/vite.svg`, and the `index.html` title and favicon still reading "Tauri + React + Typescript". None of it is load-bearing, and a dead `greet` command in a shipped binary is a small but real IPC surface nobody meant to expose.

Icons are generated from the `icon.png` already in the repository root with `pnpm tauri icon`, which produces the full `src-tauri/icons/` set replacing the template's placeholders. The Linux packages install into the hicolor theme at the sizes the desktop actually asks for, which together with `StartupWMClass` (§17) is what makes the icon appear correctly in docks, switchers and software centres. The root `icon.png` stays as the source of truth; the generated set is committed so a clean checkout builds without needing the generator.

The three design mockups in the repository root are moved to `docs/design/` — reference material belongs in the tree, not scattered at top level where it reads like build output.

---

## 17. CI, packaging, distribution

**`ci.yml`** on push and pull request, running on `ubuntu-24.04`:

| Job | Contents |
|---|---|
| `lint` | `biome ci`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo deny check` |
| `typecheck` | `tsc --noEmit`, router route-tree freshness, i18n extraction freshness |
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

## 18. Diagnostics, log export and the command line

Riff updates manually and has no telemetry, so the only way a problem reaches
the developer is a user describing it. Everything here exists to make that
description complete on the first attempt.

### 18.1 What is logged

One directory per launch (§4.1), opening with a banner that answers the
questions a bug report otherwise takes four round trips to establish: Riff
version, git SHA, build date and profile; Tauri and WebKitGTK versions, the
latter read from the runtime via `tauri::webview_version()` rather than
`pkg-config`, which is a build tool users do not have installed; distribution,
kernel and architecture; session type, desktop and compositor; locale; every
resolved path with whether it is writable; and the settings load outcome.

Beyond the banner: boot phase timings, every IPC call with its duration and
result at `debug`, every settings write with its byte count, watcher decisions
including suppressed ones, window lifecycle events, appearance changes, and —
through `log_write` — `window.onerror`, unhandled rejections, error-boundary
catches and every caught `RiffError`. A panic writes `panic.txt` beside the
log. A clean exit writes `shutdown complete`; its absence is how you know the
run crashed.

Environment variables are read from an **allow-list**, never dumped. A full
environment routinely contains credentials, and this file is designed to be
pasted in public.

### 18.2 Export

Settings → About → **Export diagnostics** opens the save dialog in Rust and
writes one plain-text file: banner, current `settings.json`, then every
retained session newest-first. `$HOME` and the username are rewritten, and the
whole thing is capped at 5 MB, truncating the oldest sessions first because
the newest is the one that explains the bug. `riff logs export` produces the
identical file from a terminal — one format, one code path.

Plain text rather than an archive: it opens with no tool, pastes into an
issue, and costs no compression dependency.

Redaction happens at export, not at write. The on-disk log keeps real paths so
the user can grep their own machine.

### 18.3 The command line

`riff` with no arguments opens the window. Everything else is a subcommand,
dispatched **before `tauri::Builder` is constructed** for two reasons:
`tauri-plugin-single-instance` forwards a second process's arguments to the
running window and exits, so `riff --help` typed while Riff is open would
otherwise print nothing; and nothing here needs GTK, a webview or a display,
so `riff doctor` works over SSH on a machine whose window will not open —
which is exactly when somebody runs it.

| Command | Does |
|---|---|
| `riff --help` / `--version` | Usage; version with git SHA and build date |
| `riff doctor` | Checks directories, permissions, `settings.json` and quarantine build-up. Exit 3 if anything is broken |
| `riff repair` | Fixes what `doctor` found. Never deletes a file it has not first copied aside |
| `riff logs --path\|--list\|--tail N` | Locate, enumerate or follow sessions |
| `riff logs export [-o PATH]` | The bundle from §18.2 |
| `riff config --path\|--show\|--validate` | Inspect `settings.json` |
| `riff paths` | Every directory Riff uses |
| `riff history --path\|--count` | The history file. Thin this milestone, because history is not written yet (D8) — reporting zero honestly beats reporting fiction |

`--json` is global, so `riff doctor --json` is a support instruction that
produces something parseable. Exit codes are 0 success, 1 failure, 2 usage,
3 unhealthy.

Accepting `--output <path>` here does **not** contradict the rule that no
caller-supplied path crosses IPC (§5). That rule constrains a compromised
webview; this is the user's own shell, already able to write any file they
can write.

`clap` 4 rather than a hand-rolled parser: the entire value of a support CLI
is being pleasant to somebody already annoyed, which is `--help` quality,
"did you mean", and consistent exit codes. It also generates the man page and
shell completions the deb and rpm ship, whose absence is a packaging lint
failure in both Debian and Fedora.

---

## 19. Legal and repository hygiene

- `LICENSE` — MIT, © 2026 valasme
- `THIRD-PARTY-LICENSES.md` plus a machine-readable `third-party-licenses.json`, generated from `pnpm licenses list` and `cargo about`, **including each dependency's full licence text and copyright line** — a table of SPDX identifiers does not satisfy MIT's requirement that the notice travel with every copy. Both are **committed**, not generated at build time: they are declared in `bundle.resources`, so a build that generates them on the fly would fail on a clean checkout before the generator had run, and would make release artifacts depend on network access to resolve licence metadata. A CI job regenerates them and fails if the committed copies are stale — the same freshness pattern used for the route tree
- `README.md` — screenshots, what Riff is, install instructions for all three package formats, required runtime packages including the GStreamer plugin sets, build-from-source steps, the privacy statement, and the contribution policy
- `SECURITY.md` — private disclosure route and supported-version statement
- `CHANGELOG.md` — Keep a Changelog, generated by `git-cliff`
- `.github/ISSUE_TEMPLATE/` — bug report and question forms; `config.yml` disables blank issues
- `.github/PULL_REQUEST_TEMPLATE.md` — states plainly that pull requests are not accepted, with thanks and a note that MIT permits forks (D15)
- No `CONTRIBUTING.md` or `CODE_OF_CONDUCT.md`: both promise a collaboration model this project is not offering, and publishing them anyway wastes contributors' time
- `.editorconfig`, `CLAUDE.md` for future agent sessions

---

## 20. Dependency manifest

Every package is pinned to the version verified current on 2026-08-28. Nothing is listed that this milestone does not use.

**Runtime (npm)** — `react` 19.1, `react-dom` 19.1, `@tanstack/react-router` 1.170, `zustand` 5.0, `i18next` 26.4, `react-i18next` 17.0, `lucide-react` 1.34, `cmdk` 1.1, `sonner` 2.0, `radix-ui` 1.6, `class-variance-authority` 0.7, `clsx`, `tailwind-merge` 3.6, `react-error-boundary` 6.1, `@fontsource-variable/outfit` 5.3, `@fontsource/playfair-display` 5.3, `@fontsource-variable/jetbrains-mono` 5.3, `@tauri-apps/api` 2 — and no plugin JS package at all, because `opener`, `dialog` and `window-state` are driven entirely from Rust and logging goes through our own `log_write` command (§12).

**Development (npm)** — `vite` 7, `@vitejs/plugin-react` 4.6, `babel-plugin-react-compiler` 1.0, `tailwindcss` 4.3, `@tailwindcss/vite` 4.3, `@tanstack/router-plugin` pinned to the **exact same version** as `@tanstack/react-router` — the plugin generates the route tree the runtime consumes, and a version skew between them produces generation bugs that look like application bugs, `@tanstack/router-devtools`, `typescript` 5.8, `@types/node`, `@biomejs/biome` 2.5, `vitest` 4.1, `@vitest/coverage-v8`, `jsdom`, `@testing-library/react` 16.3, `@testing-library/user-event`, `@testing-library/jest-dom`, `axe-core` 4.13, `lefthook` 2.1, `@commitlint/{cli,config-conventional}`, `i18next-parser`, `rollup-plugin-visualizer`, `@tauri-apps/cli` 2.11, `shadcn` 4.19.

**Rust** — `tauri` 2.11, `tauri-plugin-{opener,dialog,window-state,single-instance}` 2, `clap` 4 (derive) with `clap_mangen` and `clap_complete` as build dependencies, `serde` 1, `serde_json` 1, `thiserror` 2.0, `tracing` 0.1, `tracing-subscriber` 0.3, `tracing-appender` 0.2, `notify` 8.2, `schemars` 1.2, `directories` 6.0, `tempfile` 3.27, `time` 0.3, `rfd` 0.15 (the fatal-startup dialog, before a Tauri application exists).

**Explicitly not installed** — `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `react-resizable-panels`, `pdfjs-dist`, `eslint`, `prettier`, `vitest-axe`, `tauri-specta`, `specta`, any HTTP client in either language. Each is either deferred with the feature that needs it (D11, D12) or forbidden outright (D7).

---

## 21. Risks

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

## 22. Definition of done

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
- Compact density visibly changes row heights and gaps, not only page padding
- At 1.5× UI scale in a 960px window the sidebar drops to its rail and the settings sub-navigation becomes a horizontal strip
- Importing settings asks first; so does resetting them
- The MIT licence text and the third-party notices are readable inside the application, with no network
- A second launch focuses the existing window rather than starting a second process
- The running application opens no network connection — verifiable with `ss -tup`
- Every launch writes its own log directory, opening with a banner naming the version, distribution, desktop and session type, and `latest` points at it
- A frontend crash appears in that log, not only on a console the user cannot open
- `riff doctor` runs with no display, reports a deliberately corrupted `settings.json`, and exits 3; `riff repair` quarantines it and the next `doctor` exits 0
- `riff --help` prints while the window is open, proving CLI dispatch precedes single-instance
- `riff logs export` and Settings → About → Export diagnostics produce the same file, and `grep -c "$USER"` on it prints 0

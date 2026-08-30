# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Riff

A local-first practice workspace for musicians. Tauri 2 + React 19, Linux only. No accounts, no telemetry, no network — a product promise, not a slogan.

`docs/superpowers/specs/2026-08-28-riff-foundation-design.md` is the source of truth, and the twelve plans in `docs/superpowers/plans/` record how each part was built. Read the relevant section there before making an architectural decision — this file is a map, not a duplicate. The `§n` references below point into that spec.

The comments in this codebase are unusually load-bearing: most non-obvious lines carry the reason they are that way and the bug that made them so. Read the comment before changing the line.

## Status

The foundation — onboarding, theming, navigation, keyboard palette, settings, diagnostics, CLI, packaging — is complete. Plan 13 added **pop-out windows**: any of the three practice panes can leave the grid for a window of its own and come back (`docs/superpowers/specs/2026-08-29-pane-popout-design.md`).

**Practice and History are still visual placeholders**: PDF, video and audio playback do not exist yet. §15 records that design so it drops in without a rewrite — the window seam was built first so those players arrive in panes that already know how to travel.

## Commands

```bash
pnpm app                                    # the real application (tauri dev)
pnpm dev                                    # vite alone — see the warning below
pnpm test src/lib/appearance                # one test file, by path fragment
pnpm test -t "rolls back"                   # one test, by name
cargo test --manifest-path src-tauri/Cargo.toml quarantine   # one Rust test
```

`pnpm dev` serves the frontend in a browser, where there is no `window.__RIFF_BOOTSTRAP__` and no `invoke`. `useSettings` falls back to hard-coded defaults and every write fails silently — fine for pure CSS work, misleading for anything else.

The gates, all of which CI runs:

```bash
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo deny check
```

Add `pnpm licenses:generate` before any commit touching dependencies or the CLI shape; CI regenerates and fails if `third-party-licenses.json` drifted. CI also fails on a stale `src/routeTree.gen.ts`, a `t()` key missing from `src/locales/en/`, an empty translation value, or an entry chunk over 250 KB gzipped.

`RIFF_CONFIG_HOME` and `RIFF_DATA_HOME` name Riff's own directories verbatim (not a parent to append `riff` to). Point them at a temp directory to run against a scratch config instead of your real one — `RIFF_DATA_HOME` carries `state_dir`, `log_dir` and `cache_dir` with it, so a scratch run cannot take the `latest` symlink, overwrite `riff.pid`, or let `prune_sessions` evict your own log sessions.

## Architecture

The invariant everything hangs off: **the webview never touches the filesystem.** It holds one capability, `core:default` — no `fs`, no `shell`, no `http`. Everything on disk goes through a typed command, so validation, migration and atomic writes exist in exactly one place, and that place is covered by `cargo test`.

Riff runs **three windows at most**: `main`, and one `popout-{pane}` per popped-out practice pane. They share one webview bundle and one capability entry, `["main", "popout-*"]`. Note what that capability does *not* do — Riff has no `src-tauri/permissions/`, so Tauri's ACL gate never applies to Riff's own commands and every window can call every one of them regardless. Adding a permissions manifest makes that file load-bearing overnight.

### Boot sequence (§3.1)

`src-tauri/src/lib.rs::run()` is ordered, and the order *is* the design:

1. `paths::resolve()` — XDG directories, or a native error dialog and exit. Never a silent fallback to the working directory.
2. `cli::dispatch()` — **before `tauri::Builder` exists**, and before step 3, because a second launch must still be able to print `riff --help` rather than raise the running window and exit, and because nothing in `doctor`/`repair`/`logs` needs GTK or a display. That is exactly when someone runs them. Given no subcommand it touches nothing.
3. `instance::acquire()` — the first line of `start()`, and the reason steps 4–5 are inside it. A second launch is refused **here**, before anything writes: it used to clear `practice.poppedOut` and flush it — closing the live instance's pop-out windows — steal the `latest` symlink and overwrite `riff.pid` before `tauri-plugin-single-instance` exited it from inside `.build()`. See `docs/adr/0002-single-instance-runs-before-anything-touches-disk.md`.
4. `logging::start_session()` — one directory per launch under `~/.local/state/riff/logs/`, with `latest` symlinked at it. Everything after this point leaves a trail.
5. `SettingsStore::load()` — also before the builder, because step 6 needs the settings as a *string* at plugin-registration time.
6. `bootstrap::init()` — a `js_init_script` that assigns `window.__RIFF_BOOTSTRAP__` and writes `data-theme`, `data-density`, `data-contrast`, `data-motion` and `--ui-scale` onto `<html>`. Doing it here rather than in an inline `<script>` is what lets the CSP keep `script-src 'self'`.
7. React mounts and hydrates from that same object. Zero IPC round-trips, no loading state.
8. The window is created `visible: false`; the frontend calls `app_ready()` after its first commit and Rust reveals it. A three-second watchdog reveals it regardless — a React crash must still produce a window to read the error in.

The two failure paths (missing bootstrap object → async `settings_get()`; missing `app_ready()` → watchdog) are deliberate, not defensive noise. An optimisation must never be able to stop the application appearing.

### The IPC seam (§5)

The TypeScript facade is **hand-written**, not generated — tauri-specta's Tauri-v2 line has been a release candidate for twenty-five versions. Adding or changing a command touches four places, and skipping any one of them fails a gate:

1. the `#[tauri::command]` in `src-tauri/src/commands/`
2. the `riff_handlers!` list in `src-tauri/src/commands/mod.rs` — the only way a command becomes callable, and therefore the audit surface
3. `ipc` and its types in `src/lib/ipc/`
4. `src-tauri/tests/fixtures/ipc-shapes.json`, regenerated with `RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes`

That fixture is what replaces codegen: `tests/ipc_shapes.rs` serialises one value of every type crossing the boundary and fails loudly when Rust drifts from the hand-written TypeScript.

No caller-supplied path or URL crosses IPC. `open_path` and `open_external` take enums; `settings_import`, `settings_export` and `diagnostics_export` open the native picker **in Rust** and return only the chosen result — which is also why the webview needs no `dialog` capability.

Errors are one adjacently-tagged enum, `{ code, details }`. `code` selects a localised message, `details` fills a technical panel; raw Rust prose is never primary UI text. Events run one way, Rust → webview: `settings://changed`, `settings://write-failed`, `settings://edit-invalid`, `app://confirm-quit`, `practice://panes-changed`.

**`emit` broadcasts to every webview; `emit_to` does not.** With pop-outs open that is the difference between one dialog and three. `app://confirm-quit` is targeted for exactly this reason.

### Settings, end to end (§4)

`src/stores/settings.ts` → `settings_patch` → `src-tauri/src/settings/`. Three asymmetries carry the behaviour:

- **Optimistic, but Rust wins.** `patch()` merges locally for instant feedback, then adopts whatever the command returns. A monotonic ticket discards stale replies, so two quick toggles cannot revert each other.
- **A validation failure is not a write failure.** Validation returns `Err` and the store rolls back. A failed *disk write* keeps the value applied and reports out of band via `settings://write-failed`, because reverting the control would misrepresent what the user chose.
- **`null` means "not supplied", never "clear".** `settings/patch.rs` diverges from RFC 7386 on purpose and `src/lib/merge.ts` mirrors it. Clearing is `settings_reset`, a separate explicit operation.

Writes are debounced 250 ms and coalesced (a slider drag is one fsync), forced synchronously on exit, and always atomic: temp file in the same directory → fsync → rename → **fsync the parent directory**, the step everyone omits. `settings/watcher.rs` reloads hand edits live, filtering by filename and by last-written bytes so our own flush cannot bounce back through it.

### Frontend shape (§6)

TanStack Router, file-based, **hash history** — the asset protocol serves no SPA fallback, so `/settings/general` would 404 under browser history. Files in `src/routes/` prefixed with `-` are not routes, which is how the tests for `__root.tsx` live beside it.

State is one Zustand store plus local component state. The spec's `useUi` never became a file: palette visibility and transient sidebar collapse live in `__root.tsx`. Persisted values are read through **primitive** selector hooks (`useTheme()`, `useDensity()`, …) because `adopt` replaces `settings` wholesale — an object selector returns a fresh identity every time and re-renders for changes it does not care about.

`src/features/keybindings/keymap.ts` is the single source of truth for what Riff can do. The palette renders that list, so a command added there arrives bound *and* discoverable. A binding may carry a `scope` — a pop-out has no navigation and no sidebar toggle, and scoping removes the binding rather than disabling it, so the chord is dead rather than silently doing nothing.

**Pop-out windows are created in Rust** (`src-tauri/src/practice/`), and Rust owns which panes are out. That is forced, not stylistic: `core:default` carries no window-creation permission, and a compositor can destroy a window without the webview ever hearing about it. `practice::sync_windows` reconciles the windows to the set, which is what `settings_reset`, `settings_import` and the settings-file watcher all need. See `docs/adr/0001-pop-out-windows-are-created-in-rust.md`.

### Theming and layout (§6.3, §7)

Attribute-scoped, never class-scoped, so the axes compose independently: `data-theme` (dark/darker/light) × `data-contrast` × `data-density` × `data-motion` × `--ui-scale`. Two rules cost real time when broken:

- **Every dimension is in `rem`.** `html { font-size: calc(16px * var(--ui-scale)) }` is the entire scale implementation; one `px` value freezes that piece of chrome while the text inside it grows. Breakpoints are container queries written in rem for the same reason — a viewport media query cannot see UI scale at all.
- **Density is spacing only.** `--row-height`, `--row-gap`, `--content-padding`, `--section-gap` and `--field-padding` are the *only* things Compact changes. A hard-coded `h-10` or `py-4` is a component quietly opting out of the setting.

`data-motion` carries **three** values and JavaScript must never collapse them. `"reduced"` and `"full"` override the desktop in either direction; `"system"` is passed through untouched so the `prefers-reduced-motion` query in `globals.css` keeps deciding, live. Resolving `"system"` in JS freezes the preference at whatever it happened to be during startup, and `"full"` is exactly what the stylesheet reads as "the user said no". A Rust test and a Vitest case both fail if you do it.

Colour tokens are declared on `:root, [data-theme]` rather than `:root` alone, so a themed subtree — the theme preview cards — recomputes its own derived values instead of inheriting the root's.

### Diagnostics and the CLI (§18)

`riff doctor | repair | logs | config | paths | history`, defined in `src-tauri/src/cli_defs.rs`: a dependency-free file `include!`d by both `cli.rs` and `build.rs`, so the man page and shell completions in `src-tauri/dist-extra/` come from the same clap derive the binary uses. Changing the CLI shape regenerates them; commit the result.

`riff logs export` and the About section's Export button produce an identical bundle through `diagnostics::current_bundle`, with `$HOME` and the username redacted.

## Invariants that must never break

Settings (§4, plan 03):

1. A file Riff failed to **understand** is never overwritten — it is renamed aside and kept. Parsing and deserialising are two different failures and both count: one wrong *type* (`"confirmOnQuit": "true"`) is enough. If quarantine itself fails, writing is blocked entirely.
2. A failed write never discards in-memory state and never crashes.
3. Loading settings cannot fail. The worst outcome is defaults plus a warning.
4. Keys Riff does not recognise survive a read-modify-write cycle — on every section, not only the root.

Security (§12):

5. No caller-supplied path or URL crosses IPC.
6. The webview holds exactly one capability, `core:default`.
7. Zero network at runtime. No HTTP client is compiled in, and the CSP's `connect-src` admits only the IPC origins.

Windows (§5 of the pop-out design, plan 13):

8. Closing a pop-out means "dock this pane back". It never asks "Really quit?", and it never quits.
9. Closing `main` quits, and takes the pop-outs with it — without recording those closes as dock-backs, which would destroy the state the next launch offers back.

## Conventions and traps

- **`h-full` is not inherited from a parent that had it.** A pane is stretched for free as a grid item and collapses to its content anywhere else; the same trap waits for anything moved out of the grid into a window.
- **jsdom has no layout engine.** `getBoundingClientRect()` is always zero and container queries never evaluate, so the Vitest suite is blind to UI-scale and breakpoint bugs — two real ones (a settings column computing to `width: 0` at 1.5×, a 668 px centring gap at 2560 px) passed the entire suite. Measure in the real engine instead: WebKit2GTK 4.1 via PyGObject is exactly what Tauri ships on Linux. Do not add Playwright.
- Tests mock at `@/lib/ipc`, not at `@tauri-apps/api`, so real store logic runs against a typed fake. Coverage gate: 80% lines, functions and statements, 70% branches, over `src/features`, `src/lib`, `src/stores` and `src/routes/__root.tsx`.
- Test names are sentences stating the guarantee — `a_corrupt_file_is_quarantined_and_never_overwritten`, not `test_load_2`.
- Every user-visible string goes through `t()` with a key in `src/locales/en/`.
- Clippy denies `unwrap_used` and `unsafe_code` (`expect` with a reason is allowed); Biome errors on `any` and non-null assertions.
- British spelling in prose and comments: behaviour, colour, licence, recognise.
- Radix primitives live in `src/components/ui/` and are installed only when something uses them. A component only one feature uses belongs to that feature.

## Repository policy

Conventional Commits, enforced by commitlint; one logical change per commit. lefthook runs Biome, `tsc` and `cargo fmt` pre-commit, and both test suites pre-push.

No external code contributions — bug reports are welcome, pull requests are declined (`.github/PULL_REQUEST_TEMPLATE.md`).

**Releases are built and published by hand**, one artifact per distribution. There is no `release.yml` and none should be added; `ci.yml` is the whole of CI by design.

## Agent skills

### Issue tracker

GitHub Issues on `valasme/riff`, through the `gh` CLI; external PRs are not a request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one root `CONTEXT.md` (not yet written) plus `docs/adr/`. See `docs/agents/domain.md`.

# Riff Foundation — Plan Index

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md`

Twelve plans, executed in order. Each ends with the application in a working, committed state — you can stop after any of them and the repository builds, lints and tests clean.

| # | Plan | Delivers | Depends on |
|---|---|---|---|
| 01 | `01-project-setup-and-toolchain.md` | Template removed, toolchain pinned, Biome, Vitest, axe matcher, lefthook, cargo-deny | — |
| 02 | `02-rust-core-paths-errors-logging.md` | XDG path resolution, `RiffError`, one log directory per launch, retention, live level, panic hook | 01 |
| 03 | `03-rust-settings-store.md` | Settings model, atomic writes, corruption quarantine, migration, debounce, file watcher | 02 |
| 04 | `04-ipc-bootstrap-and-window-lifecycle.md` | Commands, hand-written TS facade, shape fixture, CSP, capabilities, bootstrap injection, reveal watchdog, boot timings | 03 |
| 05 | `05-design-system.md` | Tailwind v4 tokens, dark/light/contrast/density/scale, fonts, shadcn primitives | 01 |
| 06 | `06-app-shell.md` | i18n, TanStack Router on hash history, title bar, sidebar, error boundaries | 04, 05 |
| 07 | `07-settings-frontend.md` | Zustand settings store, General / Appearance / About | 06 |
| 08 | `08-onboarding.md` | Three-step first run, route guard, theme cards | 07 |
| 09 | `09-keybindings-and-command-palette.md` | Keybinding registry, Alt+K palette | 06 |
| 10 | `10-static-placeholders.md` | Practice and History, pixel-faithful and inert | 06 |
| 11 | `11-diagnostics-and-cli.md` | System probe, session banner, health checks, redacted export bundle, `riff doctor/repair/logs/config/paths/history`, frontend log bridge | 07 |
| 12 | `12-packaging-ci-and-legal.md` | Icons, `.desktop`, AppStream, man page, CI, release, licences, README | all |

## Ordering rationale

02 → 03 → 04 is the durability spine and comes first because everything else assumes settings can be read before the window exists. 05 is independent of the Rust work and could run in parallel with 02–04 if you had two people; sequentially it is cheapest here, where its output is needed next.

10 is deliberately late. The placeholders are the least valuable code in the milestone and the most likely to be discarded, so they are built once the shell they sit in is settled.

11 needs the settings store and the About screen to exist, but nothing after it — and it is the plan that makes every earlier plan debuggable in the field, so it lands before packaging rather than after.

12 is last because packaging a moving target wastes runs.

## Deviations from the spec recorded during planning

Three, all resolved in the spec rather than left outstanding.

1. **`tauri-specta` was dropped.** Its Tauri-v2 line is `2.0.0-rc.25` after twenty-five candidates and its stable `1.0.x` targets Tauri v1. The TypeScript IPC facade is hand-written and guarded by a committed shape fixture (Task 4.4).
2. **`settings_patch` takes a JSON merge patch**, not the typed `SettingsPatch` struct §5 first described. The patch is re-deserialised through the full model on arrival, so clamping, lenient enums and unknown-key capture still run; the typed mirror bought nothing the round trip does not already give.
3. **The boot theme script lives in the Rust init script**, not an inline `<script>` in `index.html` as §3.1 step 5 described. An inline script would force `script-src 'unsafe-inline'` into the CSP, which is the one directive worth keeping strict.

---

## After the foundation

The twelve plans above are closed; the foundation shipped. Later milestones are indexed here and
carry their own specs.

| # | Plan | Spec | Delivers | Depends on |
|---|---|---|---|---|
| 13 | `13-pane-popout.md` | `specs/2026-08-29-pane-popout-design.md` | A practice pane can leave the grid for its own window and come back, on multi-monitor setups | 10 |

13 comes before §15's media rather than after it deliberately. Pop-out is a *window* feature —
creation, capability, lifecycle, cross-window state — and none of it needs a decoded frame. Built
first, the players in §15 drop into panes that already know how to travel; built second, they are
retrofitted into a layout that assumed one window.

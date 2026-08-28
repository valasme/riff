# Riff Foundation — Plan Index

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md`

Eleven plans, executed in order. Each ends with the application in a working, committed state — you can stop after any of them and the repository builds, lints and tests clean.

| # | Plan | Delivers | Depends on |
|---|---|---|---|
| 01 | `01-project-setup-and-toolchain.md` | Template removed, toolchain pinned, Biome, Vitest, axe matcher, lefthook, cargo-deny | — |
| 02 | `02-rust-core-paths-errors-logging.md` | XDG path resolution, `RiffError`, tracing to a rolling file, panic hook | 01 |
| 03 | `03-rust-settings-store.md` | Settings model, atomic writes, corruption quarantine, migration, debounce, file watcher | 02 |
| 04 | `04-ipc-bootstrap-and-window-lifecycle.md` | Commands, hand-written TS facade, shape fixture, CSP, capabilities, bootstrap injection, reveal watchdog | 03 |
| 05 | `05-design-system.md` | Tailwind v4 tokens, dark/light/contrast/density/scale, fonts, shadcn primitives | 01 |
| 06 | `06-app-shell.md` | i18n, TanStack Router on hash history, title bar, sidebar, error boundaries | 04, 05 |
| 07 | `07-settings-frontend.md` | Zustand settings store, General / Appearance / About | 06 |
| 08 | `08-onboarding.md` | Three-step first run, route guard, theme cards | 07 |
| 09 | `09-keybindings-and-command-palette.md` | Keybinding registry, Alt+K palette | 06 |
| 10 | `10-static-placeholders.md` | Practice and History, pixel-faithful and inert | 06 |
| 11 | `11-packaging-ci-and-legal.md` | Icons, `.desktop`, AppStream, CI, release, licences, README | all |

## Ordering rationale

02 → 03 → 04 is the durability spine and comes first because everything else assumes settings can be read before the window exists. 05 is independent of the Rust work and could run in parallel with 02–04 if you had two people; sequentially it is cheapest here, where its output is needed next.

10 is deliberately late. The placeholders are the least valuable code in the milestone and the most likely to be discarded, so they are built once the shell they sit in is settled.

11 is last because packaging a moving target wastes runs.

## Deviations from the spec recorded during planning

None outstanding. One was resolved while writing these plans and the spec was amended: `tauri-specta` was dropped, because its Tauri-v2 line is `2.0.0-rc.25` after twenty-five release candidates and its stable `1.0.x` targets Tauri v1 and will not compile against 2.11. The TypeScript IPC facade is hand-written and guarded by a committed shape fixture (Task 4.7).

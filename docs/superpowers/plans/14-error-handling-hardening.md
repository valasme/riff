# 14 — Error Handling and Fallbacks Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Use `mattpocock-skills:tdd` per task — every finding below has an obvious failing test, and most of them are cheap.

**Goal:** No failure in Riff is silent, and no failure destroys data. Every `Err` Rust returns either reaches the user or is a deliberate, documented no-op; every crash leaves a window you can read, move and close.

**Architecture:** Nothing new. The pieces already exist and are not wired together — `RiffError` has five codes, `errors.json` has a localised message for each, `health::run_checks` knows what is wrong with an installation, and `AppPaths.home_dir` is carried expressly so the frontend can redact it. This plan connects what is already built and fixes three paths that lose data.

**Tech Stack:** No new npm dependency, no new crate, no new Tauri plugin, no new capability.

**Source:** the error-handling audit of 2026-08-29. Findings are numbered **F1–F16** and referenced per task.
**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§3.1 boot order, §4 settings, §5 IPC, §12 security)
**Decision record to write:** `docs/adr/0002-single-instance-runs-before-anything-touches-disk.md` (Task 1)

## Global Constraints

- **Invariant 1 grows a sibling.** "A file Riff failed to parse is never overwritten" becomes "a file Riff failed to *understand* is never overwritten". Parsing and deserialising are two different failures and only one of them was protected.
- **Every user-visible string goes through `t()`.** The five `errors:code.*` messages already exist; new states get new keys, not English in a component.
- **No new IPC surface unless a task says so.** Where a task adds a command it also touches `riff_handlers!`, `src/lib/ipc/`, and `src-tauri/tests/fixtures/ipc-shapes.json` — all four places, per CLAUDE.md.
- **`h-full` is not inherited.** Task 4 exists partly because the crash screen forgot this.
- **British spelling. Test names are sentences stating the guarantee.**
- **Commits:** Conventional Commits, one per task.

## The seams

Borrowed from `to-spec`: name where this is tested before writing it. Three existing seams take almost all of it, and no new seam is proposed.

| Seam | Covers | Prior art |
|---|---|---|
| `SettingsStore::load` over a `tempfile::tempdir` | F2, F8, F9 — every load outcome, including the two that currently have no name | `a_corrupt_file_is_quarantined_and_never_overwritten` |
| `@/lib/ipc` mocked, real store and component logic running | F4, F11, F12 — a rejecting command must produce a toast | `src/stores/settings.test.ts` |
| Rendering `RouteError` directly under jsdom | F5–F7, F13–F15 — the component has **no test today** and is outside the coverage `include` | `src/components/Sidebar.test.tsx` |

Two findings cannot be reached from any of them and are verified by hand, in the real engine, exactly as plan 13 did: **F1** (needs two processes and a session bus) and **F3** (needs the real XDG environment). Their reproductions are recorded in the appendix so nobody has to re-derive them.

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/lib.rs` | Boot order: single-instance before anything touches disk (F1) |
| `src-tauri/src/paths.rs` | `state_dir` honours the override (F3) |
| `src-tauri/src/settings/store.rs` | A document that parses but does not deserialise is quarantined, not discarded (F2); `LoadOutcome` grows the two cases the frontend cannot currently see (F8) |
| `src-tauri/src/settings/watcher.rs` | An invalid hand edit is reported, not swallowed at `debug` (F9) |
| `src-tauri/src/practice/mod.rs` | `sync_windows` reconciles every pane and broadcasts even when one fails (F10) |
| `src-tauri/src/bootstrap.rs` | Carries the load outcome, not just a recovery path (F2, F8) |
| `src/lib/ipc/index.ts` | One place that turns a rejection into a localised toast (F4) |
| `src/components/RouteError.tsx` | Keeps its own chrome, scrolls, redacts, and offers a way out of a crash loop (F5–F7, F14, F18) |
| `index.html` | Static fallback markup inside `#root` (F5) |
| `src/app/router.tsx` | `defaultNotFoundComponent` (F13) |
| `vite.config.ts` | `src/components/**` enters the coverage gate (F15) |
| `src/locales/en/errors.json` | New states get names; the unused `description` key goes (F16) |

---

### Task 1: The second launch stops destroying the first

**Findings:** F1 — verified live; see the appendix.

`cli::dispatch`, `logging::start_session`, `take_pending_reopen` and the pid write all run before `tauri_plugin_single_instance` registers. The plugin's "already running" branch calls `std::process::exit(0)` from inside `.build()`, so a doomed second process has already cleared `practice.poppedOut`, flushed it (which makes the live instance's watcher close every pop-out window), stolen the `latest` symlink, overwritten `riff.pid` with a pid that dies seconds later, and burnt one of the ten retained log sessions.

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `docs/adr/0002-single-instance-runs-before-anything-touches-disk.md`

- [ ] **Step 1:** Decide the mechanism and record it in the ADR *before* writing code. §3.1's boot order is deliberate and documented, so changing it needs a reason on the record. The two candidates: acquire the DBus well-known name ourselves, before step 2, and keep the plugin only for argument forwarding; or keep the plugin and make steps 2–4 idempotent-and-harmless for a process that is about to exit. Prefer the first — it makes "am I the only instance?" answerable before anything touches disk, which is the actual invariant.
- [ ] **Step 2:** Nothing that mutates state runs before that answer. In particular `take_pending_reopen` must not clear `practice.poppedOut` in a process that will not open a window, `start_session` must not create a session directory or move `latest`, and the pid file must not be written.
- [ ] **Step 3:** A forwarded launch still focuses the running window — that behaviour is correct today and must survive.
- [ ] **Step 4:** `riff --help` typed while Riff is open must still print. This is the reason the CLI runs early in the first place; do not regress it while moving things around.
- [ ] **Step 5:** Update the boot sequence in `CLAUDE.md` §3.1 to match, including *why* the order changed.

**Tests:** `a_second_launch_leaves_the_popped_out_set_alone`, `a_second_launch_does_not_move_the_latest_symlink`, `a_second_launch_does_not_overwrite_the_pid_of_the_running_instance`, and the existing CLI dispatch tests still green. The end-to-end proof is by hand — the appendix has the exact commands.

---

### Task 2: A file that parses but does not deserialise is kept, not discarded

**Findings:** F2 — the worst data-loss path found. Verified with a probe; see the appendix.

`store.rs:87` falls back to `Settings::default()` with a `warn` when `from_value` fails, and reports the outcome as `Loaded`. One wrong *type* on any plain `bool`/`String`/`u32` — `"confirmOnQuit": "true"` is enough — silently reverts every setting, wipes `onboarding.completedAt` so first run returns, does **not** quarantine the file, and lets the next ordinary setting change overwrite it with pure defaults. `lenient` covers enums and `UiScale` clamps; nothing covers this.

**Files:**
- Modify: `src-tauri/src/settings/store.rs`, `src-tauri/src/settings/model.rs`, `src-tauri/src/bootstrap.rs`, `src/stores/settings.ts`, `src/locales/en/errors.json`

- [ ] **Step 1:** Treat a failed `from_value` exactly as a failed `from_slice`: quarantine the file, fall back to defaults, and report `Recovered`. Invariant 1 covers both failures or it covers neither.
- [ ] **Step 2:** Prefer salvage over surrender where it is cheap. A wrong type in `general` should not cost the user `appearance`. Section-level tolerance (each section falling back independently, as `lenient` already does per field) is the smaller, more honest fix than an all-or-nothing document. Decide and record which, in a comment on the line.
- [ ] **Step 3:** `onboarding.completedAt` is not a preference and must survive a defaulted load wherever it is readable at all — being dropped back into the welcome wizard is the most visible symptom of this bug.
- [ ] **Step 4:** The recovery toast already exists (`errors:settingsRecovered`) and fires from the bootstrap payload. Make sure this path reaches it.

**Tests:** `a_file_that_parses_but_does_not_deserialise_is_quarantined_like_one_that_does_not_parse`, `a_wrong_type_in_one_section_does_not_cost_the_others`, `a_defaulted_load_never_silently_replays_first_run`, `the_users_file_is_never_overwritten_before_it_has_been_kept`.

---

### Task 3: The state directory honours the override

**Findings:** F3 — verified live.

`paths.rs:110` reads `state_dir` from `XdgRoots::state` whenever `XDG_STATE_HOME` resolves, so `RIFF_DATA_HOME` never redirects it. CLAUDE.md tells you to point these at a temp directory "to run against a scratch config instead of your real one"; in practice logs, `riff.pid` and the `latest` symlink go to the real `~/.local/state/riff`, and `prune_sessions` evicts real sessions. Every scratch and CI run competes with the developer's own diagnostics — including, today, the diagnostics for the bug being reproduced.

**Files:**
- Modify: `src-tauri/src/paths.rs`, `CLAUDE.md`

- [ ] **Step 1:** Make the override reach `state_dir` (and therefore `log_dir`). Decide whether that means deriving state from `RIFF_DATA_HOME` or adding `RIFF_STATE_HOME`; prefer the former — two variables already fully describe "somewhere else", and a third is a third thing to forget.
- [ ] **Step 2:** `resolve` stays pure over `XdgRoots` and `PathOverrides`, so this is a unit test, not an env-var test.
- [ ] **Step 3:** Correct the CLAUDE.md paragraph, which currently promises something the code does not do.

**Tests:** `an_override_redirects_the_state_and_log_directories_too`, `a_scratch_run_cannot_prune_the_real_log_sessions`.

---

### Task 4: The crash screen survives its own crash

**Findings:** F5, F6, F7, F13, F14, F15, and the crash-loop escape hatch.

`RouteError` is the least-tested and most load-bearing component in the frontend. Today: it takes the title bar with it, so on a `decorations: false` window the user cannot move, minimise or close the thing (F6); it uses `h-full` under a `#root` that has no height, and `body { overflow: hidden }` means the Reload button goes off-screen in a pop-out or at 1.5× scale (F7); an import-time throw leaves a blank `#242424` rectangle because `index.html` has nothing but an empty `#root` (F5); "Copy error details" does not redact `$HOME` despite `AppPaths.home_dir` being carried expressly for it (F14); and a deterministic crash means Reload → crash → Reload with no way out.

**Files:**
- Modify: `src/components/RouteError.tsx`, `index.html`, `src/app/router.tsx`, `vite.config.ts`, `src/locales/en/errors.json`
- Create: `src/components/RouteError.test.tsx`

- [ ] **Step 1:** Static fallback markup inside `#root` in `index.html`, saying Riff failed to start and where the logs are. `createRoot().render()` clears it, so a healthy launch never shows it — and the window is `visible: false` until `app_ready()`, so the only thing that can reveal it is the three-second watchdog. No script: `script-src 'self'` stays strict, and `style-src` already permits inline.
- [ ] **Step 2:** The crash screen keeps window controls. Either the title bar renders outside the boundary, or `RouteError` draws its own minimise/close. A window that cannot be closed from inside itself is the wrong thing to hand someone whose application has just crashed.
- [ ] **Step 3:** `RouteError` owns its own scroll container and does not depend on an ancestor's height. Verify at the two sizes that break it today: a pop-out at its 360×320 minimum, and 1.5× UI scale.
- [ ] **Step 4:** Redact `home_dir` and the username from anything the Copy button puts on the clipboard. `bundle::redact` already does this in Rust; mirror the rule, do not re-invent it.
- [ ] **Step 5:** A crash-loop escape. Count crashes in `sessionStorage`; a second crash within a short window offers **Start with default settings** instead of another Reload, and names `riff repair` for the case where even that will not do. One deterministic crash must not be a locked door.
- [ ] **Step 6:** `defaultNotFoundComponent` on the router. TanStack's fallback is a bare untranslated `<p>Not Found</p>`, and in a pop-out there is no navigation to leave by.
- [ ] **Step 7:** Add `src/components/**` to the coverage `include`. The component that catches every crash was outside the gate that measures the code.

**Tests:** `a_crash_leaves_a_window_that_can_still_be_closed`, `the_reload_button_is_reachable_in_a_popout_sized_window`, `copied_error_details_carry_no_home_directory_and_no_username`, `a_second_crash_offers_defaults_rather_than_another_reload`, `an_unknown_route_gets_riffs_own_screen_not_the_routers`, plus the axe pass every other screen has.

---

### Task 5: Every IPC failure reaches the user

**Findings:** F4 — around twenty call sites.

Every IPC call in the frontend is `void ipc.x()` or a bare `async` handler with no rejection path, so a failure produces a log line and nothing on screen. The worst are the ones a user reaches for deliberately: **Import** (Rust has a test asserting it rejects a malformed file; the frontend drops that rejection on the floor — the dialog just closes), **Export** and **Export diagnostics** (silent on an unwritable target — and the last is pressed precisely when something is already wrong), **Open folder** and the repository links (dead button on a machine without `xdg-utils` or a browser), and **licences** (a search box over a permanently empty list, no loading state, no error, no retry).

**Files:**
- Modify: `src/lib/ipc/index.ts`, `src/features/settings/sections/GeneralSection.tsx`, `src/features/settings/sections/AboutSection.tsx`, `src/features/settings/sections/AppearanceSection.tsx`, `src/features/practice/PracticeGrid.tsx`, `src/features/practice/PopoutPane.tsx`, `src/features/practice/usePoppedOut.ts`, `src/features/window/WindowControls.tsx`, `src/routes/__root.tsx`, `src/features/onboarding/OnboardingFlow.tsx`

- [ ] **Step 1:** One helper, next to `isRiffError`, that turns a rejection into the right localised toast — `errors:code.*` keyed by `RiffError.code`, falling back to `code.unknown` for the string rejections Tauri produces for a panicking or missing command. The mapping already exists in `stores/settings.ts`; lift it rather than copy it.
- [ ] **Step 2:** Apply it to every call site. A deliberate silence stays silent but says why in a comment — `appReady` and `logWrite` are the two that genuinely have nowhere to report to, and both already say so.
- [ ] **Step 3:** `licensesGet` gets a loading and an error state. An empty list and a failed fetch currently render identically.
- [ ] **Step 4:** `setTitleBar` handles a rejection as well as a `false` return. `errors:decorationsRefused` exists and is unreachable when the command errors rather than answering.
- [ ] **Step 5:** Consider making the lint enforce it, so call site twenty-one does not reintroduce this. If Biome cannot express it cheaply, skip it and say so — a rule nobody can read is worse than the convention.

**Tests:** `a_rejected_import_tells_the_user_and_changes_nothing`, `a_failed_export_says_so_rather_than_looking_like_success`, `a_folder_that_cannot_be_opened_reports_it`, `the_licence_list_distinguishes_empty_from_failed`.

---

### Task 6: Reconciliation that does not give up halfway

**Findings:** F10.

`practice/mod.rs:221` — `open_window(app, pane)?` returns on the first failure, skipping the remaining panes *and* the `broadcast`. Because `pop_out` records the set before reconciling, a failed window build leaves the file claiming a pane is out, no window, the grid still showing it docked, the frontend never told, and the next launch offering to reopen a pane that never left.

**Files:**
- Modify: `src-tauri/src/practice/mod.rs`

- [ ] **Step 1:** Reconcile every pane, collect failures, and broadcast the set that actually exists. `sync_windows` is a reconciler; a reconciler that stops at the first problem is a reconciler that leaves the world half-corrected.
- [ ] **Step 2:** A pane whose window could not be built comes out of the set, so the file and the compositor agree again.
- [ ] **Step 3:** Report the failure — it reaches the frontend as a rejection, which Task 5 has by then given a voice.
- [ ] **Step 4:** `let _ = window.close()` in the same loop deserves the same treatment: a window that refuses to close means the pane is both docked and open.

**Tests:** `a_pane_whose_window_cannot_be_built_does_not_strand_the_other_two`, `the_set_and_the_windows_agree_after_a_failed_reconcile`.

---

### Task 7: The quiet states get a voice

**Findings:** F8, F9.

Two states are correct in Rust and invisible in the interface. When quarantine itself fails, `write_blocked` is set and every flush returns `Denied` forever — but `lib.rs:162` collapses `Recovered { quarantined: None }` to `recovered_from: None`, so the frontend cannot tell it from "nothing happened", and the user gets the generic `settingsWriteFailed` toast promising *"it will try again on the next change"*, which is false. And `watcher.rs:63` treats every failed deserialisation as a half-written editor save, logging at `debug` — so a genuinely invalid hand edit produces no feedback at all, and the next in-app change overwrites it.

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/bootstrap.rs`, `src-tauri/src/settings/watcher.rs`, `src/stores/settings.ts`, `src/locales/en/errors.json`

- [ ] **Step 1:** The bootstrap payload distinguishes "recovered and kept your file", "recovered but could not keep your file, so writing is off", and "nothing happened". Three states, three messages; the second one names the file and says what to do about it.
- [ ] **Step 2:** The watcher tells the difference between a half-written save and a finished invalid one. A short settle before deciding is enough, and the second case earns a toast naming the field — the settings file is a documented editing surface, so an edit that did nothing must say so.
- [ ] **Step 3:** The watcher runs `migrate::run` like the load path does, so a hand edit that also lowers `version` is migrated rather than read raw.
- [ ] **Step 4:** While here: surface `health::run_checks` somewhere in the interface. It is a good pure function reachable only from a terminal, and a GUI-first user whose config directory went read-only has no in-app way to learn why saving stopped working. About is the obvious home.

**Tests:** `a_file_that_could_not_be_quarantined_tells_the_user_writing_is_off`, `an_invalid_hand_edit_is_reported_rather_than_ignored`, `a_half_written_save_is_still_ignored`.

---

### Task 8: One failure, one toast

**Findings:** F11, F12.

`lib.rs:209` emits `settings://write-failed` with `emit`, which broadcasts to every webview — the exact `emit`/`emit_to` distinction CLAUDE.md documents for `app://confirm-quit`, unapplied here. And `reportRecovery()` (`__root.tsx:176`) runs on every window's mount while `recoveredFrom` is baked into the init script for the whole process lifetime, so every pane popped out during a recovered session re-announces that the settings file was corrupt.

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src/routes/__root.tsx`, `src/stores/settings.ts`

- [ ] **Step 1:** `settings://write-failed` goes to `main`, like `app://confirm-quit`. A pop-out is one pane and has no settings interface to explain the failure in. `settings://changed` stays a broadcast — every window must adopt it.
- [ ] **Step 2:** The recovery toast is announced once per launch, not once per window. The reopen prompt beside it already gets this right (`offered` ref plus a `popoutPane` guard); match it.

**Tests:** `a_failed_write_raises_one_toast_no_matter_how_many_windows_are_open`, `popping_out_a_pane_does_not_re_announce_a_recovery`.

---

### Task 9: Sweep

**Findings:** F16 and the two loose ends.

- [ ] **Step 1:** `FlushScheduler::flush_now` is defined and never called — the exit path calls `store.flush_if_dirty()` directly. Delete it and `Message::FlushNow`, or call it. Clippy cannot see it because both are `pub`.
- [ ] **Step 2:** `errors:description` is in the catalogue and read by nothing. Remove it.
- [ ] **Step 3:** `binding.run()` (`useKeybindings.ts:16`) throws into the event loop, not into the boundary, so a broken shortcut fails silently. Wrap it, or record why not.
- [ ] **Step 4:** Re-read `lib.rs` and `practice/mod.rs` for `let _ =` on anything now worth reporting, given Tasks 5–7 gave the frontend somewhere to put it.

---

## Final verification

- [ ] `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`
- [ ] `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo deny check`
- [ ] Walk the two hand-verified reproductions in the appendix and confirm both are fixed.
- [ ] `pnpm app`, then deliberately break things: rename `settings.json` to something unparseable, make the config directory read-only, and force a render throw. Each one should produce a screen you can read and leave.

---

## Appendix: the two reproductions

Recorded so nobody re-derives them. Both were run on 2026-08-29 against the debug binary with a scratch config.

### F1 — the doomed second instance

```bash
SCRATCH=/tmp/riff-audit
export RIFF_CONFIG_HOME="$SCRATCH/config" RIFF_DATA_HOME="$SCRATCH/data"
setsid ./src-tauri/target/debug/riff &          # first instance
# pop two panes out by hand-editing settings.json; the watcher opens the windows
./src-tauri/target/debug/riff                   # second instance: exits 0 immediately
```

Observed:

```
before:  Riff | Riff — Score | Riff — Video     poppedOut: ["score","video"]
after:   Riff                                    poppedOut: []
latest   -> …-50118 (the dead second process)    riff.pid = 50118 (dead)
```

The second process's entire log is three lines — it never reached `setup` — yet it had already cleared the set, flushed it, taken `latest`, and taken the pid file. The live instance's watcher picked up the write 2 ms later and closed both windows.

### F2 — one typo resets everything

A `settings.json` whose only defect is `"confirmOnQuit": "true"` instead of `true`:

```
outcome              = Loaded          ← not Recovered: no toast, no recoveredFrom
theme                = Dark            (file said light)
uiScale              = 1.0             (file said 1.25)
startupRoute         = Practice        (file said last-used)
onboarding.completed = None            (file said 2026-01-01) ← first run returns
quarantined?         = false           ← the user's file is NOT kept
--- after one unrelated setting change, the file on disk ---
theme = "dark"   startupRoute = "practice"   onboarding = null
```

---

## What the plan did not predict

_(Fill in as it is built, as plan 13 did. Each surprise that changed the shape of the result goes here rather than being lost.)_

# 13 — Practice Pane Pop-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A practice pane can leave the grid for its own window and come back, and three windows behave as one application.

**Architecture:** Rust owns the set of popped-out panes and every window in it, because a compositor can close a window without the webview hearing about it. The frontend mirrors that set through a one-way `practice://panes-changed` event, the same shape `settings://changed` already has. No layout engine: the grid rule is "the panes still docked share it evenly".

**Tech Stack:** Nothing new in either language. No new npm dependency, no new crate, no new Tauri plugin.

**Spec:** `docs/superpowers/specs/2026-08-29-pane-popout-design.md`
**Decision record:** `docs/adr/0001-pop-out-windows-are-created-in-rust.md`

## Global Constraints

- **Still no media.** The panes carry the same placeholder content in a pop-out window as in the grid. `media-src 'none'` does not change, and `pdfjs-dist` is not installed.
- **One word.** "Pop out" / "popped out" / "dock back". `detached` appears nowhere. The launch prompt says **Reopen**, never "Restore" — that word is taken twice already.
- **No caller-supplied strings cross IPC.** Pane and window targets are enums, as `PathKind` and `ExternalLink` are.
- **`closePane` stays inert**, and its `disabled` / `aria-disabled` pair stays with it.
- **Every dimension in `rem`.** Density changes spacing only. The strip and the empty state are as bound by §7 of the foundation spec as anything else.
- **Commits:** Conventional Commits, one per task.

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/practice/mod.rs` | The popped-out set, window creation and destruction, `practice://panes-changed` |
| `src-tauri/src/commands/practice.rs` | `practice_pop_out`, `practice_dock_back`, `practice_dock_all`, `practice_focus`, `practice_state` |
| `src-tauri/src/settings/model.rs` | New `Practice` section holding `poppedOut` |
| `src-tauri/capabilities/default.json` | Window list becomes `["main", "popout-*"]` |
| `src/features/practice/PracticeGrid.tsx` | Reflow rule, chip strip, empty state |
| `src/features/practice/PopoutPane.tsx` | What a pop-out window renders |
| `src/features/practice/usePoppedOut.ts` | Mirror of the Rust set |
| `src/routes/popout.$pane.tsx` | The pop-out route |
| `src/features/window/PopoutQuitDialog.tsx` | Dock back or quit |
| `src/features/keybindings/keymap.ts` | Command scope |

---

### Task 1: The settings section

**Files:**
- Modify: `src-tauri/src/settings/model.rs`, `src-tauri/src/settings/patch.rs`, `src-tauri/src/settings/mod.rs`, `src/lib/ipc/types.ts`, `src/lib/merge.ts`, `src-tauri/tests/fixtures/ipc-shapes.json`

- [x] **Step 1:** Add `Pane` (`score` | `video` | `audio`, kebab-case) and a `Practice` section carrying `popped_out: Vec<Pane>` and its own `unknown` map — on the section, not only the root, per invariant 4.
- [x] **Step 2:** Add `Practice` to the `Section` enum behind `settings_reset`. Resetting `practice` docks every pane back. *(Built without the failing-test-across-tasks step: lefthook runs both suites pre-push, so a deliberately red tree could not have been committed. `settings_reset` calls `practice::sync_windows`, and no `settings:general.reset.practice` string was needed — the only reset control in the UI resets everything, and its copy now says panes dock back.)*
- [x] **Step 3:** Mirror in `src/lib/ipc/types.ts` and `src/lib/merge.ts`. `null` still means "not supplied".
- [x] **Step 4:** `RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes`, then `cargo test` and `pnpm test` green.

**Tests:** `a_practice_section_survives_a_round_trip_with_unknown_keys`, and the existing `unknown_keys_inside_a_section_survive_too` extended to `practice`.

---

### Task 2: Rust owns the windows

**Files:**
- Create: `src-tauri/src/practice/mod.rs`, `src-tauri/src/commands/practice.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/capabilities/default.json`

- [x] **Step 1:** Widen the capability to `["main", "popout-*"]`. Add a comment recording that Riff's own commands are **not** ACL-gated today because there is no `src-tauri/permissions/`, and that adding one makes this file load-bearing at once.
- [x] **Step 2:** `practice::pop_out(app, pane)` builds `popout-{pane}` at `index.html#/popout/{pane}`, `visible: false`, title `Riff — Score`, decorations following `appearance.title_bar` exactly as `main` does.
- [x] **Step 3:** Generalise the reveal watchdog beyond `main`: one per window, three seconds, reveal regardless. `app_ready` already shows the calling window and needs no change.
- [x] **Step 4:** Handle `CloseRequested` for `popout-*` — remove from the set, emit `practice://panes-changed`, persist through the flush scheduler. **This is the path a compositor `killactive` takes**, and it is the reason the set lives here.
- [x] **Step 5:** Filter the existing `confirmOnQuit` handler to `window.label() == "main"`. Without it, closing a pop-out asks "Really quit?".
- [x] **Step 6:** Closing `main` closes every pop-out and exits.
- [x] **Step 7:** Register `practice_pop_out`, `practice_dock_back`, `practice_dock_all`, `practice_focus` and `practice_state` in `riff_handlers!`, add them to `src/lib/ipc/`, regenerate the fixture. *(Seven, not five: Task 6 needs `practice_pending_reopen` and `practice_reopen`.)*

**Tests:** `a_popped_out_pane_is_recorded_and_persisted`, `closing_a_popout_window_docks_the_pane_back`, `closing_a_popout_never_asks_to_quit`, `a_popout_that_never_signals_readiness_is_revealed_anyway`.

---

### Task 3: The pop-out route and window

**Files:**
- Create: `src/routes/popout.$pane.tsx`, `src/features/practice/PopoutPane.tsx`
- Modify: `src/routes/__root.tsx`

- [x] **Step 1:** `__root.tsx` suppresses the sidebar on `/popout/*`, as it already does for onboarding, and keeps the `TitleBar` with the pane icon in place of the sidebar toggle.
- [x] **Step 2:** `PopoutPane` renders the same pane content as the grid, full bleed, with the header `⧉` reading **Dock back**.
- [x] **Step 3:** Verify by hand in the real engine that the pop-out's first painted frame carries the right `data-theme`, `data-density`, `data-contrast`, `data-motion` and `--ui-scale`. The bootstrap script is a `js_init_script`, so it runs per webview and should need nothing — **confirm rather than assume.** jsdom cannot see this.

**Tests:** `a_popout_route_renders_one_pane_and_no_sidebar`, plus axe.

---

### Task 4: The grid, the strip and the empty state

**Files:**
- Create: `src/features/practice/PracticeGrid.tsx`, `src/features/practice/usePoppedOut.ts`
- Modify: `src/features/practice/PracticePlaceholder.tsx`, `src/locales/en/common.json`

- [x] **Step 1:** `usePoppedOut` seeds from `practice_state` and subscribes to `practice://panes-changed`.
- [x] **Step 2:** The reflow rule as a pure function — docked panes share the grid evenly; three keeps today's arrangement. Test it directly; it is the one piece of layout logic jsdom *can* judge.
- [x] **Step 3:** The chip strip: one chip per popped-out pane, click focuses that window, each carrying dock-back. Absent when nothing is out.
- [x] **Step 4:** The empty state with **Bring all back**.
- [x] **Step 5:** `settings_reset` for `practice` (or for everything) docks every pane back — completing Task 1 Step 2.

**Tests:** `the_grid_reflows_evenly_when_a_pane_pops_out`, `the_strip_is_absent_when_nothing_is_popped_out`, `bring_all_back_docks_every_pane`, axe on the empty state.

---

### Task 5: Keyboard, palette and the quit dialog

**Files:**
- Create: `src/features/window/PopoutQuitDialog.tsx`
- Modify: `src/features/keybindings/keymap.ts`, `src/features/palette/CommandPalette.tsx`, `src/locales/en/palette.json`

- [x] **Step 1:** Give `Keybinding` a scope. In a pop-out: appearance toggles, `openConfig`, `openLogs`, `togglePalette`, `app.quit` and **Dock pane back**. Absent with dead chords: every `nav.*`, and `toggleSidebar`.
- [x] **Step 2:** Main-window commands: `Pop out Score / Video / Audio` (focusing the window when already out), `Bring all panes back`.
- [x] **Step 3:** `PopoutQuitDialog` — *Dock this pane back into Riff, or quit Riff entirely?* → [Dock back] [Quit Riff] [Cancel]. **Quit Riff** sets `QuitApproved` so `confirmOnQuit` does not raise a second modal for one intent.

**Tests:** `navigation_commands_are_absent_from_a_popout_palette`, `ctrl_q_in_a_popout_offers_dock_back_or_quit`, `quitting_from_a_popout_does_not_ask_twice`.

---

### Task 6: The launch prompt

**Files:**
- Modify: `src/routes/__root.tsx`, `src/locales/en/common.json`

- [x] **Step 1:** After the main window is revealed and never before it, if `practice.poppedOut` is non-empty, toast: *Score and Video were in their own windows last time.* **[Reopen] [Not now]**.
- [x] **Step 2:** Declining **or ignoring** clears the list, so the offer is made exactly once.
- [x] **Step 3:** Suppressed while onboarding is active. Offered regardless of `startupRoute`, and accepting does not navigate the main window.

**Tests:** `the_reopen_prompt_appears_once_and_not_again_after_declining`, `the_reopen_prompt_is_suppressed_during_onboarding`, `the_prompt_never_delays_the_reveal`.

---

### Task 7: Gate check

- [x] `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`
- [x] `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo deny check`
- [x] `pnpm app`, and walk the Definition of Done in the spec — including `hyprctl dispatch killactive` on a pop-out, and a relaunch after quitting with panes out.

---

## What the plan did not predict

Recorded here rather than lost, because each one changed the shape of the result.

- **`sync_windows` replaced an open path and a close path.** Three callers need
  reconciliation rather than an instruction — `settings_reset` empties the set before
  the windows are asked to follow, an import replaces the document wholesale, and the
  settings-file watcher arrives with no idea what changed. Wiring the watcher to it was
  not in the plan and makes a hand edit to `practice.poppedOut` move real windows, which
  is the premise of a hand-editable settings file.
- **`app://confirm-quit` was broadcast.** `Emitter::emit` reaches every webview, so with
  pop-outs open one quit raised three modals. It is `emit_to` now.
- **`window_quit_confirmed` closed the calling window.** From a pop-out that merely docked
  a pane back, under a button labelled *Quit Riff*. It closes `main`.
- **`window_set_decorations` applied to one window.** `settings://changed` fires only for
  external file edits, so a pop-out could not have learnt about the setting any other way.
- **`general.lastRoute` would have recorded `/popout/score`,** so `startupRoute: last-used`
  launched the main window onto a single pane with no sidebar to leave by.
- **A pop-out is exempt from the onboarding redirect.** Re-running first-time setup does
  not close the pop-out windows.
- **`practice` is stripped on import,** like `onboarding`. Which panes were out describes
  one machine's monitors — the entire premise of the feature.
- **The pane did not fill its pop-out window.** In the grid it is a grid item and is
  stretched for free. Found by running it; jsdom cannot see it.
- **The reopen prompt timed out after four seconds.** An offer made exactly once must not
  dismiss itself.

### Verified in the real engine, not the suite

Driven from a shell against `RIFF_CONFIG_HOME=/tmp/…`, using the settings watcher to move
panes and `hyprctl` to destroy windows: pop-out creation at `index.html#/popout/{pane}`,
the reveal, correct theme and chrome on the first frame, the OS title `Riff — Score`, a
compositor destroying a pop-out returning the pane to the grid and persisting it, closing a
pop-out never asking "Really quit?" with `confirmOnQuit` on, and the reopen prompt after a
`SIGKILL`.

Still needs a keyboard and a pointer: `Ctrl+Q` in a pop-out, clicking **Reopen**, closing
main with pop-outs open, and the empty state's **Bring all back**.

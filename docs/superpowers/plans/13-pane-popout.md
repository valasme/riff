# 13 — Practice Pane Pop-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

- [ ] **Step 1:** Add `Pane` (`score` | `video` | `audio`, kebab-case) and a `Practice` section carrying `popped_out: Vec<Pane>` and its own `unknown` map — on the section, not only the root, per invariant 4.
- [ ] **Step 2:** Add `Practice` to the `Section` enum behind `settings_reset`, and a `settings:general.reset.practice` string. Resetting `practice` docks every pane back (Task 4), so wire that after Task 4 exists and leave a failing test here.
- [ ] **Step 3:** Mirror in `src/lib/ipc/types.ts` and `src/lib/merge.ts`. `null` still means "not supplied".
- [ ] **Step 4:** `RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes`, then `cargo test` and `pnpm test` green.

**Tests:** `a_practice_section_survives_a_round_trip_with_unknown_keys`, and the existing `unknown_keys_inside_a_section_survive_too` extended to `practice`.

---

### Task 2: Rust owns the windows

**Files:**
- Create: `src-tauri/src/practice/mod.rs`, `src-tauri/src/commands/practice.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/capabilities/default.json`

- [ ] **Step 1:** Widen the capability to `["main", "popout-*"]`. Add a comment recording that Riff's own commands are **not** ACL-gated today because there is no `src-tauri/permissions/`, and that adding one makes this file load-bearing at once.
- [ ] **Step 2:** `practice::pop_out(app, pane)` builds `popout-{pane}` at `index.html#/popout/{pane}`, `visible: false`, title `Riff — Score`, decorations following `appearance.title_bar` exactly as `main` does.
- [ ] **Step 3:** Generalise the reveal watchdog beyond `main`: one per window, three seconds, reveal regardless. `app_ready` already shows the calling window and needs no change.
- [ ] **Step 4:** Handle `CloseRequested` for `popout-*` — remove from the set, emit `practice://panes-changed`, persist through the flush scheduler. **This is the path a compositor `killactive` takes**, and it is the reason the set lives here.
- [ ] **Step 5:** Filter the existing `confirmOnQuit` handler to `window.label() == "main"`. Without it, closing a pop-out asks "Really quit?".
- [ ] **Step 6:** Closing `main` closes every pop-out and exits.
- [ ] **Step 7:** Register `practice_pop_out`, `practice_dock_back`, `practice_dock_all`, `practice_focus` and `practice_state` in `riff_handlers!`, add them to `src/lib/ipc/`, regenerate the fixture.

**Tests:** `a_popped_out_pane_is_recorded_and_persisted`, `closing_a_popout_window_docks_the_pane_back`, `closing_a_popout_never_asks_to_quit`, `a_popout_that_never_signals_readiness_is_revealed_anyway`.

---

### Task 3: The pop-out route and window

**Files:**
- Create: `src/routes/popout.$pane.tsx`, `src/features/practice/PopoutPane.tsx`
- Modify: `src/routes/__root.tsx`

- [ ] **Step 1:** `__root.tsx` suppresses the sidebar on `/popout/*`, as it already does for onboarding, and keeps the `TitleBar` with the pane icon in place of the sidebar toggle.
- [ ] **Step 2:** `PopoutPane` renders the same pane content as the grid, full bleed, with the header `⧉` reading **Dock back**.
- [ ] **Step 3:** Verify by hand in the real engine that the pop-out's first painted frame carries the right `data-theme`, `data-density`, `data-contrast`, `data-motion` and `--ui-scale`. The bootstrap script is a `js_init_script`, so it runs per webview and should need nothing — **confirm rather than assume.** jsdom cannot see this.

**Tests:** `a_popout_route_renders_one_pane_and_no_sidebar`, plus axe.

---

### Task 4: The grid, the strip and the empty state

**Files:**
- Create: `src/features/practice/PracticeGrid.tsx`, `src/features/practice/usePoppedOut.ts`
- Modify: `src/features/practice/PracticePlaceholder.tsx`, `src/locales/en/common.json`

- [ ] **Step 1:** `usePoppedOut` seeds from `practice_state` and subscribes to `practice://panes-changed`.
- [ ] **Step 2:** The reflow rule as a pure function — docked panes share the grid evenly; three keeps today's arrangement. Test it directly; it is the one piece of layout logic jsdom *can* judge.
- [ ] **Step 3:** The chip strip: one chip per popped-out pane, click focuses that window, each carrying dock-back. Absent when nothing is out.
- [ ] **Step 4:** The empty state with **Bring all back**.
- [ ] **Step 5:** `settings_reset` for `practice` (or for everything) docks every pane back — completing Task 1 Step 2.

**Tests:** `the_grid_reflows_evenly_when_a_pane_pops_out`, `the_strip_is_absent_when_nothing_is_popped_out`, `bring_all_back_docks_every_pane`, axe on the empty state.

---

### Task 5: Keyboard, palette and the quit dialog

**Files:**
- Create: `src/features/window/PopoutQuitDialog.tsx`
- Modify: `src/features/keybindings/keymap.ts`, `src/features/palette/CommandPalette.tsx`, `src/locales/en/palette.json`

- [ ] **Step 1:** Give `Keybinding` a scope. In a pop-out: appearance toggles, `openConfig`, `openLogs`, `togglePalette`, `app.quit` and **Dock pane back**. Absent with dead chords: every `nav.*`, and `toggleSidebar`.
- [ ] **Step 2:** Main-window commands: `Pop out Score / Video / Audio` (focusing the window when already out), `Bring all panes back`.
- [ ] **Step 3:** `PopoutQuitDialog` — *Dock this pane back into Riff, or quit Riff entirely?* → [Dock back] [Quit Riff] [Cancel]. **Quit Riff** sets `QuitApproved` so `confirmOnQuit` does not raise a second modal for one intent.

**Tests:** `navigation_commands_are_absent_from_a_popout_palette`, `ctrl_q_in_a_popout_offers_dock_back_or_quit`, `quitting_from_a_popout_does_not_ask_twice`.

---

### Task 6: The launch prompt

**Files:**
- Modify: `src/routes/__root.tsx`, `src/locales/en/common.json`

- [ ] **Step 1:** After the main window is revealed and never before it, if `practice.poppedOut` is non-empty, toast: *Score and Video were in their own windows last time.* **[Reopen] [Not now]**.
- [ ] **Step 2:** Declining **or ignoring** clears the list, so the offer is made exactly once.
- [ ] **Step 3:** Suppressed while onboarding is active. Offered regardless of `startupRoute`, and accepting does not navigate the main window.

**Tests:** `the_reopen_prompt_appears_once_and_not_again_after_declining`, `the_reopen_prompt_is_suppressed_during_onboarding`, `the_prompt_never_delays_the_reveal`.

---

### Task 7: Gate check

- [ ] `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`
- [ ] `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo deny check`
- [ ] `pnpm app`, and walk the Definition of Done in the spec — including `hyprctl dispatch killactive` on a pop-out, and a relaunch after quitting with panes out.

# 15 — Score Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** The Score pane opens a PDF and is a usable score reader — continuous scroll, fit, zoom, rotate, spread, search, dim, auto-scroll and pin — pages turn from a commodity pedal, and the score survives a pop-out, a dock-back and a relaunch.

**Architecture:** pdf.js renders in the webview; Rust reads the file and hands over bytes, so no path and no URL crosses IPC inbound and the asset protocol is never built. Rust owns which score is open and its view, in `workspace.json` in the data directory, held in memory with the file as durability — the same asymmetry `SettingsStore` already has. The webview mirrors the *identity* through `score://changed` and keeps the *view* local to the viewer component.

**Tech Stack:** One new npm dependency, `pdfjs-dist` (Apache-2.0). No new Radix primitive — see Task 6 — no new crate, no new Tauri plugin, no new capability.

**Spec:** `docs/superpowers/specs/2026-08-30-score-viewer-design.md`
**Decision records:** `docs/adr/0003`, `docs/adr/0004`, `docs/adr/0005`
**Vocabulary:** `CONTEXT.md` — score, workspace, view, dim, pin, auto-scroll, smooth scroll

**Task order is risk order.** Tasks 1 and 2 exist to find out, before anything is built on top of
them, whether module workers run under WebKitGTK and whether `font-src data:` behaves in a packaged
build. If either answer is no, it is cheaper to learn it in the second commit than the fourteenth.

## Global Constraints

- **One word each.** A **score** is the PDF; the **Score pane** is where it opens. The **workspace** is what is open. `document`, `file`, `session` and `restore` are all taken or wrong — see `CONTEXT.md`.
- **No caller-supplied path or URL crosses IPC.** The picker opens in Rust; drag-and-drop is received in Rust. The webview never learns a filesystem path.
- **Every task adds its own `t()` keys**, to `src/locales/en/`, in the same commit as the strings. There is no i18n sweep at the end: CI fails on a missing key or an empty value, and a task that defers its strings is a task that hardcoded them.
- **`csp` and `devCsp` change together.** They already disagree about `font-src data:`, and that disagreement is invisible until a packaged build.
- **Every dimension in `rem` — except inside `pdf_viewer.css`**, where the pixels are raster alignment. ADR 0005. The Riff override layer is the only place viewer dimensions may change.
- **Container queries, never viewport media queries.** A media query cannot see UI scale, and the Score pane's width varies with grid shape, sidebar, density, UI scale and pop-out.
- **`pdfjs-dist` is imported only from the practice and pop-out routes.** A static import from anywhere shared puts 131.5 KB gzipped into a 127 KB entry chunk and fails the 250 KB gate.
- **`axe-core` stays at zero violations on `/practice`.** It is already asserted there; the viewer must not regress it.
- **Nothing plays.** `media-src` stays `'none'`; Video and Audio stay placeholders.
- **`space` stays unbound.** Audio will want it, and §6.1 of the spec records the cost.
- **Commits:** Conventional Commits, one per task.

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/tests/fixtures/scores/` | The sample PDFs, and a README recording each one's provenance |
| `src-tauri/src/workspace/mod.rs` | The open score and its view; atomic write, no quarantine, no watcher |
| `src-tauri/src/commands/score.rs` | `score_open`, `score_bytes`, `score_close`, `score_state`, `score_view_patch`, `score_pending_reopen`, `score_reopen` |
| `src-tauri/src/paths.rs` | `workspace_file()` beside `history_file()` |
| `src-tauri/src/lib.rs` | `WindowEvent::DragDrop` on `main` and `popout-score` |
| `src-tauri/src/error.rs` | `ScoreMissing`, `ScoreEncrypted`, `ScoreUnreadable` |
| `src-tauri/tauri.conf.json` | `font-src 'self' data:`, `img-src 'self' data: blob:`, in both CSPs |
| `src/features/practice/score/pdfjs.ts` | The one module that imports `pdfjs-dist`; worker URL, `getDocument` options |
| `src/features/practice/score/ScoreViewer.tsx` | The `PDFViewer` instance, its teardown, cancellation and `ResizeObserver` |
| `src/features/practice/score/ScoreToolbar.tsx` | The toolbar row and its overflow |
| `src/features/practice/score/geometry.ts` | Fit modes, page arithmetic, pages-per-minute, overflow thresholds |
| `src/features/practice/score/useOpenScore.ts` | Read-only mirror of Rust, shaped like `usePoppedOut.ts` |
| `src/features/practice/score/score.css` | The Riff override layer over `pdf_viewer.css` |
| `src/features/practice/PracticePane.tsx` | Empty state with the Open affordance; a live `×` |
| `src/features/keybindings/keymap.ts` | `available?`, and the score commands |
| `src/features/keybindings/chord.ts` | `formatChord` cases for the page-turn keys |
| `src/styles/globals.css` | `scroll-behavior: auto` in both reduced-motion rules |
| `src/routes/__root.tsx` | The merged reopen offer |

---

### Task 1: Score fixtures

Nothing downstream can be tested without these, and half the error paths in spec §9 are otherwise
unreachable. Smallest possible file in every case.

**Files:**
- Create: `src-tauri/tests/fixtures/scores/` and its `README.md`

- [ ] **Step 1:** Six fixtures: engraved with embedded fonts, scanned with no text layer, encrypted, truncated mid-object, a non-PDF carrying a `.pdf` extension, and one containing an external `https://` link.
- [ ] **Step 2:** A README beside them recording where each came from and under what licence. All public domain or generated — Riff's legal hygiene applies to committed bytes as much as to dependencies, and a fixture nobody can account for is a fixture that has to be deleted later.
- [ ] **Step 3:** Keep them small. These are parsed by tests, not read by humans; a two-page excerpt proves everything a 200-page score would.

**Tests:** none of its own. This task exists so every later task has something to assert against.

---

### Task 2: The seam, proven end to end

**The riskiest task, deliberately second.** It answers three questions that would invalidate the
architecture if the answer were no, and it answers them in a packaged build because that is the only
place two of them can be answered.

**Files:**
- Modify: `package.json`, `src-tauri/tauri.conf.json`, `third-party-licenses.json`
- Create: `src/features/practice/score/pdfjs.ts`

- [ ] **Step 1:** `pnpm add pdfjs-dist`, then `pnpm licenses:generate`. CI regenerates and fails on drift.
- [ ] **Step 2:** `pdfjs.ts` is the **only** module that imports `pdfjs-dist`. Worker via `import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"` — same-origin, so `worker-src` falls back through `script-src 'self'` and needs no CSP rule.
- [ ] **Step 3:** Fix the `getDocument` options in one place: `useWorkerFetch: false`, `useWasm: false`, no `cMapUrl`, no `standardFontDataUrl`. Comment recording that these are what keep `connect-src` from moving, and that the fix if a CJK score appears is a Riff command, not a CSP token (ADR 0003).
- [ ] **Step 4:** Both CSPs gain `font-src 'self' data:` and `img-src 'self' data: blob:`. Comment above them recording that pdf.js installs a PDF's embedded fonts as `data:` `@font-face` rules, and that dev and production had already diverged on exactly this line.
- [ ] **Step 5:** Temporary scaffolding: render page one of the engraved fixture into the Score pane. Task 5 replaces it. Its only job is to make steps 6 and 7 possible.
- [ ] **Step 6:** **In a packaged build, not `pnpm app`:** the fixture renders, and it renders in its own embedded fonts. This is the one class of bug dev structurally cannot show.
- [ ] **Step 7:** Confirm the module worker actually starts under WebKitGTK 2.52.6, and measure the entry chunk gzipped — it must still be far under 256000 bytes. If pdf.js is in it, an import escaped the route.
- [ ] **Step 8:** Establish pdf.js's real WebKitGTK floor and put it in `depends` for both deb and rpm. Both currently name an unversioned `libwebkit2gtk-4.1-0` / `webkit2gtk4.1`, which was honest while Riff shipped nothing newer than the webview — Vite copies the worker verbatim, since `build.target` does not reach a `?url` asset.
- [ ] **Step 9:** Require the worker, and report a failure to start it with the runtime WebKitGTK version against the minimum, reusing `webkit_version()` from `app_info`. pdf.js's default fallback is a main-thread "fake worker", which converts a clean failure into a frozen pane; a blank rectangle with no diagnostic is the one outcome that must not ship.

**Tests:** the existing CI entry-chunk gate covers step 7's second half; steps 6 and 7 are manual measurements against a packaged artifact, recorded in Task 14.

---

### Task 3: Rust owns the workspace, and the three error codes

**Files:**
- Create: `src-tauri/src/workspace/mod.rs`
- Modify: `src-tauri/src/paths.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/error.rs`, `src/locales/en/errors.json`

- [ ] **Step 1:** `paths.rs` gains `workspace_file()` → `data_dir/workspace.json`, beside `history_file()`. It follows `RIFF_DATA_HOME`, so a scratch run cannot touch the real one.
- [ ] **Step 2:** The `Workspace` struct: the open score's path, and its view — the six values in spec §6.4 (page, scale, rotation, spread, scroll mode, auto-scroll speed). Whether auto-scroll is *running* and whether a page is *pinned* are deliberately not among them. `#[serde(default)]` throughout, and an `unknown` map so a downgrade does not discard a newer Riff's keys.
- [ ] **Step 3:** Held in memory, written through `storage::write_atomic`, coalesced by a `FlushScheduler` and forced on exit — the settings pattern, reused.
- [ ] **Step 4:** **No quarantine and no watcher.** A parse failure is discarded and logged at WARN. Comment recording that invariant 1 protects a file the user authored, and that quarantining derived state leaves litter the user never wrote (ADR 0004).
- [ ] **Step 5:** Read once at launch into a `PendingWorkspace`, then clear the file — the `PendingReopen` shape, and for the same reason: the offer must happen exactly once whether or not it is answered.
- [ ] **Step 6:** `ScoreMissing`, `ScoreEncrypted`, `ScoreUnreadable` on `RiffError`, each with its localised message in `errors.json` in this commit. Three, because a code earns its existence only when it changes what the user does next; everything else goes in `details`.

**Tests:** `a_corrupt_workspace_file_is_discarded_and_never_quarantined`, `the_workspace_is_cleared_at_launch_so_the_offer_happens_once`, `unknown_workspace_keys_survive_a_round_trip`, `a_failed_workspace_write_never_discards_the_open_score`, `every_score_error_code_has_a_message`.

---

### Task 4: Opening a score

**Files:**
- Create: `src-tauri/src/commands/score.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src/lib/ipc/index.ts`, `src/lib/ipc/types.ts`, `src-tauri/tests/fixtures/ipc-shapes.json`

- [ ] **Step 1:** `score_open` opens the native picker **in Rust** via `tauri-plugin-dialog`, filtered to `pdf`, exactly as `settings_import` does. Returns the score's metadata; never a path.
- [ ] **Step 2:** `score_bytes` returns `tauri::ipc::Response::new(Vec<u8>)`. TypeScript types it `ArrayBuffer`, because `ipc-protocol.js` decodes any non-JSON content type with `.arrayBuffer()`. **Re-reads from disk every call.** Comment recording that this is deliberate: one copy in memory, and a score deleted while open then fails honestly instead of succeeding from a stale cache.
- [ ] **Step 3:** `WindowEvent::DragDrop` on `main` and `popout-score` only; first `.pdf` in the drop wins, other windows ignore it. Comment recording that Tauri hands Rust a position and Rust cannot know where the Score pane is on screen, so routing is by window.
- [ ] **Step 4:** `score://changed` on open and close, **broadcast with `emit`**, like `practice://panes-changed`. Every window needs to know whether a score is open — Task 12's `available?` depends on it — and only the window hosting the pane mounts a viewer, so a broadcast cannot double-load. Comment recording that `app://confirm-quit` is targeted for the opposite reason: three dialogs would appear, where a state mirror wants all three windows told.
- [ ] **Step 5:** The score opens where the pane is, not where the drop was: dropped on `main` while Score is popped out, it opens in `popout-score`, and that window is then focused through the same mechanism `practice_focus` uses.
- [ ] **Step 6:** `score_view_patch` writes the view. **No throttle on the command**; only the disk write is coalesced. Comment recording that page-number granularity means this fires on page turns, and that throttling it would open the pop-out staleness race it looks like it closes.
- [ ] **Step 7:** Log a score by **basename and byte count, never by directory** — `riff.log` is in the diagnostics bundle and `$HOME` redaction does not hide a filename.
- [ ] **Step 8:** All seven commands into `riff_handlers!` and `src/lib/ipc/`. `Score`, `View` and `Workspace` go into the shapes fixture; `RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes`.
- [ ] **Step 9:** **`score_bytes` cannot go in the fixture** — `tauri::ipc::Response` has no serde representation, so it is the one command the drift guard cannot see. Add a Rust test asserting it answers with raw bytes rather than JSON, and a comment in `ipc_shapes.rs` saying why that command is absent, so its absence reads as recorded rather than forgotten.

**Tests:** `a_score_path_never_crosses_ipc_inbound`, `score_bytes_answers_with_raw_bytes_not_json`, `score_bytes_rereads_from_disk`, `a_missing_score_reports_score_missing`, `an_encrypted_score_reports_score_encrypted`, `a_truncated_score_reports_score_unreadable`, `a_non_pdf_drop_is_ignored`, `a_drop_on_the_video_window_is_ignored`.

---

### Task 5: The viewer

**Files:**
- Create: `src/features/practice/score/ScoreViewer.tsx`, `score.css`, `useOpenScore.ts`
- Modify: `src/features/practice/PracticePane.tsx`

- [ ] **Step 1:** `useOpenScore()` mirrors Rust — seed through `score_state`, updates through `score://changed`, with the `heard` ref guard `usePoppedOut.ts` uses so an early event cannot be overwritten by a late seed.
- [ ] **Step 2:** `ScoreViewer` builds `PDFViewer` with an `EventBus` and a `PDFLinkService` in an effect against a container ref. Replace Task 2's scaffolding.
- [ ] **Step 3:** **Teardown that survives StrictMode**: `loadingTask.destroy()`, viewer teardown and event-bus detach in the cleanup. Comment recording that without it the second mount leaves two workers alive and the first document renders into the second viewer's DOM.
- [ ] **Step 4:** The same teardown keyed on the open score's identity, so opening a second score cancels the first load. Cancellation and the StrictMode fix are one mechanism, not two. The bytes are fetched per load and **never held in a ref** — `getDocument({data})` transfers the buffer to the worker and detaches it.
- [ ] **Step 5:** External links off, and **set in the right place**: `externalLinkEnabled` is a public field on `PDFLinkService`, assigned *after* construction. Its constructor destructures only `eventBus`, `externalLinkTarget`, `externalLinkRel` and `ignoreDestinationZoom`, so passing it there is silently ignored and the default `true` stands; setting it on `PDFViewer` does nothing at all. A test must prove the anchor is dead, because nothing else will.
- [ ] **Step 6:** `annotationMode: AnnotationMode.ENABLE` — the default is `ENABLE_FORMS`, so leaving it alone gives a score interactive form fields. `enableScripting: false` too, which is already the default and is set anyway because a default is not a guarantee. Comment recording that CSP does not govern top-level navigation, so a live `https://` anchor navigates the webview out of Riff and strands it with no network and no way back — and that this follows from invariant 5 rather than working around it.
- [ ] **Step 7:** A `ResizeObserver` on the container recomputing the fit mode. Comment recording that `PDFViewer` listens to `window` resize, and that sidebar collapse, density, UI scale and popping out all change the pane's width without it.
- [ ] **Step 8:** Import `pdfjs-dist/web/pdf_viewer.css`, scoped to the viewer container, with `score.css` layered on top for the gap between pages, the border, the gutter — and a cursor reset, because an imported stylesheet is exactly how the pointing hand comes back. Comment pointing at ADR 0005.
- [ ] **Step 9:** The loading state: the score's name and a spinner, no progress bar. Comment recording why there is no honest percentage, and that the escape hatch if it ever matters is a `tauri::ipc::Channel`.
- [ ] **Step 10:** The empty state gains the Open affordance, and `×` becomes live: it closes the score, not the pane. Replace the "still inert" comment; the reason it was inert has expired. An error returns the pane here with the message in place.
- [ ] **Step 11:** `canvas` is `aria-hidden`; the text layer is the accessible content. Where there is none, say so rather than presenting an empty region.

**Tests:** `the_viewer_is_destroyed_once_per_mount_under_strict_mode`, `opening_a_second_score_cancels_the_first_load`, `closing_a_score_returns_the_pane_to_its_empty_state`, `an_external_link_in_a_score_carries_no_href`, `a_score_renders_no_interactive_form_fields`, `the_fit_mode_is_recomputed_when_the_pane_resizes_without_the_window`, `a_scan_says_it_has_no_searchable_text`.

---

### Task 6: The toolbar, and turning pages

**Files:**
- Create: `src/features/practice/score/ScoreToolbar.tsx`, `geometry.ts`
- Modify: `src/features/keybindings/chord.ts`

- [ ] **Step 1:** A labelled group of ordinary tabbable buttons — **not** `role="toolbar"`, and no new Radix primitive. The ARIA toolbar pattern moves focus with the arrow keys, which Step 4 binds to turning pages, and `chord.ts` knows only `isTypingTarget`, not "focus is inside a roving group". Comment recording this, because `role="toolbar"` looks like an obvious improvement and would silently break the pedal.
- [ ] **Step 2:** One toolbar row **beneath the pane header**, which is left exactly as it is. Twelve controls do not go beside `⧉` and `×`.
- [ ] **Step 3:** Page indicator with a typeable number, previous and next. Announce page changes in a polite live region, reusing the route announcer's pattern.
- [ ] **Step 4:** **Page turning is bound to Page Up / Page Down and Left / Right; Up / Down keep scrolling.** `chordFromEvent` is `event.key.toLowerCase()`, so the chord strings are `"pageup"`, `"pagedown"`, `"arrowleft"` and `"arrowright"` — `"left"` would parse fine and never fire. Comment recording that this is what makes a commodity page-turner pedal work with no pedal-specific code, and that it is why those chords are not available to anything else.
- [ ] **Step 5:** `formatChord` gains cases for those four, or the palette renders "Pagedown" and "Arrowright". It currently upper-cases the first letter of any multi-character key, which was correct while every chord was a letter or a modifier.
- [ ] **Step 6:** No guard is needed against typing: `useKeybindings` already skips every chord but `escape` when `isTypingTarget` matches, and `"number"` and `"text"` are both in its set, so arrows in the page field move the caret rather than the score. Recorded so nobody solves it twice.
- [ ] **Step 7:** `geometry.ts` holds every calculation as a pure function — page arithmetic, fit-mode selection, zoom stepping, overflow thresholds. This is what keeps `ScoreViewer` and `ScoreToolbar` thin enough to clear the coverage gate.
- [ ] **Step 8:** Overflow by **container query in `rem`**: page indicator, prev/next, fit toggle and search always visible; the rest collapse into one menu below the threshold. Controls stay at least 24×24 CSS pixels in both densities — Compact tightens gaps, never targets.

**Tests:** `page_turning_is_bound_to_the_keys_a_pedal_sends`, `the_page_turn_chords_match_what_chord_from_event_produces`, `the_palette_renders_page_up_legibly`, `arrows_in_the_page_field_do_not_turn_the_page`, `the_toolbar_overflows_rather_than_shrinking_its_targets`, `page_arithmetic_clamps_at_both_ends`.

---

### Task 7: Zoom, fit, rotate, spread

**Files:**
- Modify: `ScoreToolbar.tsx`, `ScoreViewer.tsx`, `geometry.ts`

- [ ] **Step 1:** Fit width, fit page and free zoom through `currentScaleValue`. Free zoom leaves the fit mode rather than fighting it.
- [ ] **Step 2:** Rotation in 90° steps through `pagesRotation`, applied to the whole score.
- [ ] **Step 3:** Spread — none, odd, even — through `SpreadMode`.
- [ ] **Step 4:** Scroll mode — continuous or one page at a time — through `ScrollMode.VERTICAL` and `ScrollMode.PAGE`. It is on the toolbar because the two modes suit two users: continuous is what auto-scroll is for, page-at-a-time is what a pedal user wants. Task 10 defines what auto-scroll means in each.
- [ ] **Step 5:** All five persist through `score_view_patch`, so they survive a pop-out and a relaunch.

**Tests:** `fit_width_scales_to_the_pane_not_the_window`, `zoom_leaves_the_fit_mode`, `rotation_spread_and_scroll_mode_survive_a_view_round_trip`.

---

### Task 8: Dim

**Files:**
- Modify: `src-tauri/src/settings/model.rs`, `src/lib/ipc/types.ts`, `src/lib/merge.ts`, `src-tauri/tests/fixtures/ipc-shapes.json`, `src/features/settings/sections/`, `score.css`

- [ ] **Step 1:** `appearance.scoreDim`, 0 to 0.4, default 0, clamped by a newtype the way `UiScale` is. Zero means off, so no separate toggle.
- [ ] **Step 2:** `filter: brightness(…)` on **`canvas`**, not on `.page`. Comment recording that this leaves search highlights at full strength, costs no re-render, works on scans, and is *not* pdf.js's `pageColors` — which inverts to light-on-dark and is a feature Riff does not have.
- [ ] **Step 3:** The Appearance section gains the slider, beside contrast, keyboard-operable with announced values per foundation §11. It does **not** engage automatically under the dark themes: with a magnitude control, auto-engaging fights a number the user chose.
- [ ] **Step 4:** Mirror in `types.ts` and `merge.ts`; regenerate the fixture.

**Tests:** `score_dim_clamps_out_of_range_values`, `dim_leaves_search_highlights_at_full_strength`, `dim_does_not_follow_the_theme`.

---

### Task 9: Search

**Files:**
- Modify: `ScoreViewer.tsx`, `ScoreToolbar.tsx`

- [ ] **Step 1:** `PDFFindController` on the shared `EventBus`. The text layer needs no configuration — `textLayerMode` already defaults to `TextLayerMode.ENABLE`, so matches have somewhere to land as long as nothing turns it off.
- [ ] **Step 2:** Search is a toggle revealing a row beneath the toolbar — query, match count, next, previous — dismissed by `Escape`. A permanent field costs more width than the feature is worth at 650 px.
- [ ] **Step 3:** `FindState` drives "not found" and "wrapped", each through `t()`. The **count is announced**, not only highlighted: the highlight is inside a canvas overlay a screen-reader user is not looking at.
- [ ] **Step 4:** A scanned score has no text layer. Reuse Task 5's sentence rather than reporting zero matches, which reads as a broken search.
- [ ] **Step 5:** Jumping to a match uses smooth scroll, which Task 10 makes respect reduced motion.

**Tests:** `a_score_without_a_text_layer_says_so_rather_than_finding_nothing`, `match_navigation_wraps_and_says_that_it_wrapped`, `the_match_count_is_announced_not_only_highlighted`.

---

### Task 10: Auto-scroll, pin, and the reduced-motion split

**Files:**
- Modify: `src/styles/globals.css`, `ScoreViewer.tsx`, `ScoreToolbar.tsx`, `geometry.ts`

- [ ] **Step 1:** `globals.css` gains `scroll-behavior: auto` in **both** reduced-motion rules — the `@media` one and the `[data-motion="reduced"]` one. Those rules zero animation and transition durations and do not touch scrolling, so smooth scroll currently survives reduced motion everywhere in Riff. An app-wide fix that happens to be found here.
- [ ] **Step 2:** Auto-scroll as a `requestAnimationFrame` loop on the container's `scrollTop`, speed in pages per minute, 0.1 to 10, default 1, persisted with the view.
- [ ] **Step 3:** **In `ScrollMode.PAGE` it advances one page every `60 / speed` seconds** instead of scrolling, because there is nothing to scroll. Same control, same unit, and switching scroll mode does not reset the speed.
- [ ] **Step 4:** **Auto-scroll is exempt from reduced motion, and says why in a comment**: it is a function the musician started and can stop at any moment, from the chord, the palette or the toolbar — and it is that stoppability the exemption rests on. Without the comment this looks like an oversight and will be "fixed".
- [ ] **Step 5:** It pauses on any manual scroll and stops at the last page. Start and stop are announced; the pages between are not.
- [ ] **Step 6:** Pin holds the current page, or in spread mode the current **spread** — releasing onto one half of a spread would be worse than not pinning. Scrolling by hand still works.
- [ ] **Step 7:** Speed lives in a popover on the play/pause control, plus `±` chords. A slider inline would eat the toolbar.
- [ ] **Step 8:** Speed persists in the view; **whether auto-scroll is running, and whether a page is pinned, do not**. A score that began scrolling the moment it reopened would be alarming, and a pin is something you do to practise this passage now. Both start off, every time.

**Tests:** `auto_scroll_survives_reduced_motion`, `smooth_scroll_does_not_survive_reduced_motion`, `auto_scroll_advances_by_page_in_page_scroll_mode`, `auto_scroll_pauses_when_the_user_scrolls`, `a_pinned_spread_does_not_auto_advance`, `pages_per_minute_is_stable_across_zoom_levels`.

---

### Task 11: The pop-out round trip

The one behaviour that no earlier task builds and every earlier task assumes. It mostly falls out of
Tasks 3 and 5, and "mostly falls out" is where the bugs are.

**Files:**
- Modify: `src/features/practice/PopoutPane.tsx`, `ScoreViewer.tsx`

- [ ] **Step 1:** The leaving window tears down cleanly mid-flight — including while a load is still in progress, which is the case a hurried user hits. **It does not write on unmount**: every change was already written, so a farewell patch has nothing new to say and can overwrite an arriving window that has already mounted.
- [ ] **Step 2:** The arriving window mounts, reads `score_state` (**the in-memory value**, so it cannot be behind the flush scheduler), then `score_bytes`, then restores the six values in spec §6.4. Task 5's loading state covers the gap.
- [ ] **Step 3:** **Suppress the restore echo.** Setting `currentPageNumber` makes `PDFViewer` emit `pagechanging`, and the handler listening for it is the one that calls `score_view_patch` — so restoring writes straight back. Comment drawing the parallel to `settings/watcher.rs`, which filters its own last-written bytes for the same reason.
- [ ] **Step 4:** `h-full` on the viewer as well as the wrapper. `PopoutPane.tsx` already carries this trap in a comment for the placeholder; a viewer that collapses to the height of its toolbar is the same bug with more to look at.
- [ ] **Step 5:** A compositor closing `popout-score` outright takes the same path, because Rust learns from `CloseRequested` and the workspace is already current. Verify with `hyprctl dispatch killactive` while a score is open.
- [ ] **Step 6:** Scroll position within the page is deliberately not restored. Comment saying so, so its absence is not read as a bug.

**Tests:** `a_score_survives_popping_out_and_docking_back`, `the_arriving_window_reads_the_in_memory_view_not_the_file`, `an_unmounting_viewer_does_not_write_the_view`, `restoring_the_view_does_not_write_it_back`, `tearing_down_mid_load_leaves_no_worker_running`.

---

### Task 12: Keyboard and palette

**Files:**
- Modify: `src/features/keybindings/keymap.ts`, `src/locales/en/palette.json`

- [ ] **Step 1:** `Keybinding` gains `available?: (ctx) => boolean`, which **removes** the binding. `createKeymap` already ends with `bindings.filter((b) => b.scope === undefined || b.scope === ctx.scope)`, so this extends that one line rather than adding a mechanism — same doctrine, where a filtered-out chord is dead rather than disabled. It is the only change in the plan that touches a file every other feature depends on, and it commits separately from the score commands if you want it isolated.
- [ ] **Step 2:** `KeymapContext` gains the open score from `useOpenScore()`. The *identity* is mirrored state; the *view* stays local to the viewer. Comment recording that putting the view in the store would re-render every primitive selector subscriber on every page turn.
- [ ] **Step 3:** The score commands, with the chords Task 6 fixed. Everything else is `chord: ""` — palette-only, discoverable, unbound.
- [ ] **Step 4:** "Open score…" is always available. Everything else is available only when a score is open, so the palette does not grow fourteen dead rows in an empty workspace.
- [ ] **Step 5:** No pane focus model. Comment recording that score bindings are live wherever a score is open in both windows, that a window-level keymap is what makes a pedal work at all, and that the debt comes due when Video lands.

**Tests:** `score_commands_are_absent_from_the_palette_when_no_score_is_open`, `open_score_is_available_with_an_empty_workspace`, `a_score_chord_is_dead_rather_than_disabled_in_settings`.

---

### Task 13: The merged reopen offer

**Files:**
- Modify: `src/routes/__root.tsx`, `src/locales/en/common.json`

- [ ] **Step 1:** One offer, not two. The existing panes prompt and the score prompt become a single toast covering the whole workspace, with one action that reopens both. Two `duration: Infinity` toasts stacked at launch is a launch that asks two open-ended questions.
- [ ] **Step 2:** With only panes out, the wording is what it says today. The existing behaviour is a case of the new one, not a casualty of it.
- [ ] **Step 3:** Copy says **Reopen**, never "Restore" — taken twice already, by `nav.restore` and `general.restoreWindowState`.
- [ ] **Step 4:** Still suppressed in pop-out windows and during onboarding, still `duration: Infinity`, still asked exactly once.
- [ ] **Step 5:** The offer is made from the recorded path **without stat-ing it first**. Checking at launch trades a guaranteed-correct error at the moment of use for a race; a score that has moved reports `ScoreMissing` when the user accepts.

**Tests:** `one_toast_offers_both_the_panes_and_the_score`, `panes_only_still_reads_as_it_did_before`, `a_score_that_has_moved_reports_score_missing_when_the_offer_is_accepted`, `the_offer_is_not_made_in_a_popout_window`.

---

### Task 14: Gate check, and the measurements

- [ ] `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`
- [ ] `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo deny check`
- [ ] `pnpm licenses:generate` clean, `src/routeTree.gen.ts` current, entry chunk under 256000 bytes gzipped, `axe-core` at zero violations on `/practice` with a score open and with search open.
- [ ] `pnpm app`, and walk the Definition of Done in the spec — including `hyprctl dispatch killactive` on `popout-score` while a score is open, and a relaunch after quitting with a score open and a pane out.
- [ ] **With a real pedal, or a keyboard pretending to be one:** Page Up / Page Down and Left / Right turn pages while the toolbar has focus, while the canvas has focus, and while nothing in particular has focus.
- [ ] **In the real engine, not the suite** (`project_webkit_layout_harness`): fit width at 1.5× UI scale; text-layer alignment at 0.8×, 1.0× and 1.5×; toolbar overflow at the narrowest feature-shape pane in both densities; spread mode in a narrow pop-out; dim at 0.4.
- [ ] **Performance, recorded not gated** (spec §11): 20 MB score to first paint; pop-out and dock-back with it open; resident memory across 50 pages of a 300-page score; peak RSS with a 100 MB score.
- [ ] Confirm Task 2's packaged-build measurements still hold on the final artifact, including the `depends` floor and the worker-failure message.
- [ ] Install the deb or rpm on the oldest distribution release the `depends` floor claims to support, and open a score on it. This is the only step that tests the claim rather than the intention.

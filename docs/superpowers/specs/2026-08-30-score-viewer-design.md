# Riff — Score Viewer Design

**Status:** design of record for the Score pane.
**Narrows:** foundation spec §15, "PDF rendering will use `pdfjs-dist` with the worker bundled
locally." That sentence is kept; this document is what it grew into, and `docs/adr/0003` records
where it diverges.
**Decision records:** `docs/adr/0003`, `0004`, `0005`.
**Vocabulary:** `CONTEXT.md`. This document uses those words and no synonyms.

---

## 1. Why

The Score pane has been a placeholder since plan 10 — a glyph, a sentence and an "In development"
chip. Plan 13 gave it a window seam before giving it contents, on the reasoning that a player
which learns to travel afterwards is a rewrite. It has travelled. This is the contents.

The user is a musician with an instrument in their hands. That is the whole design constraint, and
it decides more here than any of the architecture does: it is why page turning is bound the way §6.1
binds it, why auto-scroll exists at all, and why auto-scroll is the one animation reduced motion
does not take away.

### 1.1 In scope

- Opening a score from a native picker and by dropping a file on the window.
- Rendering it: continuous scroll, page virtualisation, fit width, fit page, free zoom, rotation,
  two-page spread.
- Reading it: text search where the score carries text, dim, auto-scroll, pin, smooth scroll.
- Turning pages with a **commodity page-turner pedal**, which needs no code beyond choosing the
  right chords.
- Keeping it: the workspace persists, travels with a popping-out pane, and is offered back at the
  next launch.

### 1.2 Out of scope

Each of these was considered. They are listed so a reader can tell a decision from an oversight.

- **Video and audio.** The other two panes stay placeholders. `media-src` stays `'none'`.
- **Annotation** — fingerings, breath marks, circled accidentals. It is the obvious next feature
  and nothing here forecloses it: when it lands it writes a **sidecar file**, because Riff must
  never rewrite the user's PDF. That is why the bytes path is read-only and why no writeback
  command exists to be tempted by.
- **Cropping and margin trimming.** Publisher PDFs carry margins that cost a third of a laptop
  screen, and every mature score reader trims them. It needs a persisted crop rectangle and
  content-bounds detection, which is its own milestone rather than a control on this toolbar.
- **The PDF outline.** `getOutline()` is one call, and for a 400-page fake book it is the only
  navigation that works. It waits because a per-score sidebar is a layout decision the pane has not
  had to make yet, and "go to page" covers a single piece.
- **Recent scores and setlists.** The reopen offer remembers the last one; History owns the rest.
- **Printing and export.** Riff opens a score; the user's own reader prints it.
- **More than one score at a time.** One score, one Score pane. Riff has no tabs.
- **A CLI argument.** `riff score.pdf` would have to hand the file to a running instance and exit,
  which reopens `instance::acquire()`. ADR 0002 is too recent to disturb in the same change that
  introduces a renderer.
- **A pane focus model.** See §8.

---

## 2. What is new, and what is only reused

Nothing about windows changes. A popped-out Score pane is the same window plan 13 built, running
the same route, and Rust still owns which panes are out. What is new is that the pane now has
contents worth carrying, and one file — `workspace.json` — that says what they are.

| | Owner |
|---|---|
| Which panes are popped out | Rust, in `settings.json` (unchanged) |
| Which score is open, and its view | Rust, in `workspace.json` (new) |
| Whether a score is open, in the webview | `useOpenScore()`, a read-only mirror |
| Scroll position within a page | The viewer component, and nowhere else |
| The rendered pixels | pdf.js, in the webview |

The last two rows are the ones that matter. Scroll position is deliberately not owned by Rust, not
persisted, and does not survive a pop-out — a pixel offset means nothing after the pane changes
width or the scale changes, and "where I was" in a score means a page. And the *identity* of the
open score is mirrored state while the *view* is local, because a value that changes on every page
turn has no business in a store whose subscribers are primitive selectors.

---

## 3. How a score reaches the screen

```
  user picks a file            Rust opens the native picker      no path crosses IPC inbound
  or drops one on a window     Rust receives WindowEvent::DragDrop
        │
        ▼
  score_open()                 Rust records path + metadata in the workspace,
                               broadcasts score://changed, focuses the host window
        │
        ▼
  score_bytes()                Rust reads the file, returns Response::new(Vec<u8>)
        │                      → ipc-protocol.js decodes it with .arrayBuffer()
        ▼
  getDocument({ data })        pdf.js parses; the buffer transfers to the worker
        │
        ▼
  PDFViewer                    renders, virtualised, into the pane
```

Five properties of that path are load-bearing.

**No caller-supplied path or URL crosses IPC** (invariant 5). The picker opens in Rust, as
`settings_import` already does. A drag-and-drop is delivered to Rust by Tauri, not to the webview by
the DOM, so it does not become an exception — Rust holds the paths and the webview is only told
that a score arrived. See ADR 0003.

**The bytes are genuinely binary.** Tauri's IPC posts to `ipc://` with `fetch` and decodes the
reply by content type: `application/json` through `.json()`, everything else through
`.arrayBuffer()`. `InvokeResponseBody::Raw` therefore arrives as an `ArrayBuffer` — no base64, no
array-of-numbers. This is verified against `tauri-2.11.5/scripts/ipc-protocol.js`, not assumed.

**`getDocument({ data })` takes the buffer.** It is transferred to the worker and detached on the
main thread. A held reference reused on a later render throws on a detached `ArrayBuffer`, so the
bytes are fetched per load and never cached in a ref.

**`score_bytes` re-reads from disk every time.** Rust does not cache the file. One copy in memory,
and a score deleted while open fails honestly rather than succeeding from a stale cache. The cost
is a re-read on every pop-out and dock-back, warm in the page cache.

**Drops are routed by window, not by position.** Tauri gives Rust a drop position in physical
pixels, and Rust has no idea where the Score pane is on screen. So `main` and `popout-score` accept
a dropped `.pdf` and every other window ignores it; the first PDF in a multi-file drop wins.
Routing a score dropped on the Video window into a pane in a different window would be worse than
ignoring it.

**The score opens where the pane is, not where the drop was.** If Score is popped out and the file
is dropped on `main`, it opens in `popout-score` — Rust records that a score is open and whichever
window hosts the pane renders it. That window is then focused, through the mechanism
`practice_focus` already uses, so the score is not opened into a window behind another application.

**`score://changed` broadcasts.** Not `emit_to`: every window needs to know *whether* a score is
open, because §8's `available?` and the palette depend on it, and only the hosting window mounts a
viewer — so a broadcast cannot cause a second load. This is `practice://panes-changed`'s shape, not
`app://confirm-quit`'s. That one is targeted because three dialogs would appear; a state mirror has
the opposite requirement.

### 3.1 The CSP moves in both places or in neither

pdf.js installs a PDF's embedded fonts as `@font-face` rules carrying `data:` URLs. Production
`csp` has `font-src 'self'`; `devCsp` already has `font-src 'self' data:`. Change only production
and dev diverges silently; change only dev and every packaged build renders embedded-font scores in
the wrong glyphs while `pnpm app` looks perfect.

The delta is `font-src 'self' data:` and `img-src 'self' data: blob:`, and nothing else.
`connect-src` does not move — it already admits `ipc:`, which is what the IPC `fetch` needs. The
worker needs no rule: `worker-src` falls back through `script-src 'self'`, and Vite emits the worker
same-origin.

pdf.js therefore runs with `useWorkerFetch: false`, `useWasm: false`, no `cMapUrl` and no
`standardFontDataUrl`. ADR 0003 records what that costs and what the fix is if it ever bites.

### 3.2 One gap in the drift guard, named

`src-tauri/tests/ipc_shapes.rs` serialises one serde *value* per boundary type. `score_bytes`
returns `tauri::ipc::Response`, which has no serde representation, so **it is the one command the
fixture cannot cover**. The mitigation is explicit rather than implied: the `Score`, `View` and
`Workspace` types and the new `RiffError` variants all go in the fixture as normal, and a Rust test
asserts `score_bytes` returns raw bytes rather than JSON, because that is the property the fixture
would otherwise have guarded.

---

## 4. The viewer

`PDFViewer` from `pdfjs-dist/web/pdf_viewer.mjs`, not the bare core API. It brings page
virtualisation, `ScrollMode`, `SpreadMode`, `pagesRotation`, `currentScaleValue` and
`PDFFindController` — and the find controller, with cross-page matches and highlight navigation, is
the single hardest thing on the feature list.

Six things about driving it are not optional.

**It is torn down properly, or StrictMode makes two of everything.** `main.tsx` mounts under
`React.StrictMode`, so every effect runs twice. Without `loadingTask.destroy()` and an explicit
viewer teardown in the cleanup, the second mount leaves two workers alive and a race in which the
first document's render lands in the second viewer's DOM.

**The same teardown is what cancels.** Open a large score, change your mind, open another: the
first `loadingTask` must be destroyed or its pages arrive into a viewer showing a different score.
The viewer keys off the open score's identity, so cancellation and the StrictMode fix are one
mechanism rather than two.

**Fit modes are recomputed on a `ResizeObserver`, not on `window` resize.** `PDFViewer` listens to
the window. Collapsing the sidebar, changing density, changing UI scale and popping a pane out all
change the pane's width without the window changing size at all. jsdom has no layout engine, so a
missing observer passes the whole suite and is obvious the moment a human collapses the sidebar.

**External links are disabled, and *where* that is set matters.** A PDF's annotation layer
renders real anchors; CSP does not govern top-level navigation, so a click on an `https://` link in
a score would navigate the webview out of Riff and, with no network, strand it on an error page
with no way back. Internal links — go to page 34 — keep working. This is not a workaround:
invariant 5 means Riff has no mechanism for opening an arbitrary URL, and `open_external` takes an
enum precisely so that it never will.

> **`externalLinkEnabled` is a public field on `PDFLinkService`, not a constructor option.** Its
> constructor destructures only `eventBus`, `externalLinkTarget`, `externalLinkRel` and
> `ignoreDestinationZoom`, so passing `externalLinkEnabled: false` to it is **silently ignored** and
> the default `true` stands. It has to be assigned after construction. Setting it on `PDFViewer`
> does nothing at all. This is a security property that fails quietly, which is why it is written
> down rather than left to the reader.

With it off, pdf.js still renders the anchor but sets `href` to the empty string, suppresses the
click, and writes `title = "Disabled: <url>"` — **untranslated English reaching the interface**, from
a library `t()` cannot enter. Accepted for the same reason `Pane::window_title` holds English in
Rust: i18n cannot reach it, and the alternative is worse than the blemish.

Two pdf.js defaults must be overridden rather than relied on. **`annotationMode` defaults to
`AnnotationMode.ENABLE_FORMS`**, so "rendered but not interactive" requires setting
`AnnotationMode.ENABLE` explicitly — leaving it alone gives a score interactive form fields.
`enableScripting` already defaults to `false`; it is set anyway, because a default is not a
guarantee.

> The same enum is the answer if "reveal this score in the file manager" is ever wanted: a
> `PathKind::CurrentScore` variant resolving against Rust-held state opens a path the user chose
> without any path crossing IPC. Recorded so nobody concludes the invariant forbids the feature.

**`pdf_viewer.css` is imported and not corrected.** See ADR 0005. Its pixel values are raster
alignment, and rewriting them in `rem` breaks text selection at every UI scale but 1.0 while every
gate stays green.

**A worker that will not start says why.** Riff ships deb and rpm against
`libwebkit2gtk-4.1-0` with **no minimum version**, and Vite copies `pdf.worker.min.mjs` verbatim
rather than transpiling it — `build.target: "safari16"` does not reach an asset imported with
`?url`. On an older distribution the worker can therefore fail to parse, and pdf.js's own fallback
is a "fake worker" on the main thread, which turns a hard failure into a frozen pane. So the worker
is required, and a failure to start it reports the user's WebKitGTK version against the minimum,
using the `webkit_version()` that `app_info` already reads from the runtime for exactly this class
of bug report. A blank rectangle is the one outcome that must not happen.

**Loading is indeterminate, and says which score.** There is no honest progress bar: with
`data:` there is no streaming, the IPC transfer reports nothing, and parsing is not instrumented.
So the pane shows the score's name and a spinner until page one paints. If a 200 MB scan ever makes
that unbearable, the escape hatch is a `tauri::ipc::Channel` streaming the file in chunks — named
here so it is not re-derived, and not built for a case nobody has hit.

---

## 5. The pane

The pane header is unchanged: title, `⧉`, `×`. The viewer adds **one toolbar row beneath it**
rather than crowding twelve controls in beside the pop-out button. `×` becomes live and closes the
score, not the pane; the reason it was inert has expired.

The toolbar is always visible. Auto-hiding chrome to win 32 px of score area is the kind of
cleverness that costs more in surprise than it returns in pixels.

### 5.1 What is on it, and what happens when there is no room

| Priority | Controls |
|---|---|
| Always | Page indicator (typeable), previous / next page, fit toggle, search |
| Next | Zoom out / in, scroll mode, spread, rotate |
| Last | Auto-scroll play/pause, pin |

Scroll mode — continuous or one page at a time — is on the toolbar rather than buried, because the
two modes suit two different users. Continuous is what auto-scroll is for; page-at-a-time is what a
pedal user wants, since a turn lands on a whole page rather than somewhere in the middle of two.
§6.3 defines what auto-scroll means in each.

Below a container-query threshold the lower priorities collapse into one overflow menu. **Container
queries in `rem`, never a viewport media query** — a media query cannot see UI scale at all, and
the Score pane is between roughly 650 px (feature shape, beside Video and Audio) and the full width
of a pop-out window, at any of five UI scales, in two densities. That range is the whole reason
this section exists.

Two controls do not live inline:

- **Search** is a toggle. It reveals a row beneath the toolbar with the query, match count and
  next/previous, and `Escape` dismisses it. A permanent text field costs more width than the
  feature is worth at 650 px.
- **Auto-scroll speed** lives in a small popover on the play/pause control, and on the `±` chords.
  A slider inline would eat the toolbar.

Target size stays at least 24×24 CSS pixels in **both** densities. Density changes spacing only;
a Compact toolbar has tighter gaps, not smaller buttons.

**It is a labelled group of buttons, not `role="toolbar"`.** The ARIA toolbar pattern moves focus
between its controls with the arrow keys, and §6.1 binds Left and Right to turning pages. Both
would fire on the same keystroke, and `chord.ts` has no notion of "focus is inside a roving group" —
only `isTypingTarget`, which covers text fields. A row of ordinary tabbable buttons under an
`aria-label` is fully accessible, costs a few tab stops, and removes the collision rather than
guarding it. Recorded because `role="toolbar"` looks like an obvious improvement and would silently
break the most important interaction in the application.

---

## 6. Reading controls

| Control | Behaviour |
|---|---|
| Fit width / fit page / free zoom | `currentScaleValue`; free zoom leaves the fit mode |
| Rotate | `pagesRotation`, 90° steps, applied to the whole score |
| Spread | none / odd / even, `SpreadMode` |
| Page indicator | Current page and total; typing a number goes there |
| Search | `PDFFindController`, only where the score carries a text layer |
| Dim | Settings → Appearance, not the toolbar. §6.2 |
| Auto-scroll, pin | §6.3 |

### 6.1 Turning pages, and the pedal

A musician's hands are on the instrument, so most page turns come from a Bluetooth pedal — AirTurn,
PageFlip and the rest. In keyboard mode they send ordinary key events, and which ones varies by
model: **Page Up / Page Down**, **Left / Right**, or **Up / Down**.

So page turning is bound to **Page Up / Page Down and Left / Right**, and **Up / Down are left to
scroll**. That covers every common pedal without a line of pedal-specific code, and it is the
reason those chords are not available for anything else.

`space` stays unbound. Some pedals send it, and Riff's audio player will want it; the conflict is
real and audio wins, because a pedal that sends space can almost always be configured to send
something else.

This also settles a question §8 leaves open. The keymap listens at the window, not at a focused
element, so a pedal works whenever Riff has focus — no pane focus model needed for the single most
important interaction in the application.

### 6.2 Dim

Dim is a **brightness reduction on the rendered page**, not an inversion. It is
`filter: brightness(…)` applied to the page canvas — not pdf.js's `pageColors`, which is an HCM
filter that renders light-on-dark and is a different feature Riff does not have.

Consequences of choosing the CSS filter:

- It costs no re-render. Changing dim while reading is instant, where `pageColors` would re-render
  every visible page.
- It works on scans as well as on engraved scores, because it filters the raster rather than
  recolouring text.
- It applies to `canvas`, not to `.page`, so **search highlights stay at full strength** while the
  page behind them dims. That is the desirable direction and it is worth not losing.

It is a magnitude, not a mode: `appearance.scoreDim`, a slider from 0 to 0.4 defaulting to 0,
clamped by a newtype the way `uiScale` already is. Zero means off, so there is no separate toggle.
It does **not** engage automatically under the dark themes — with a magnitude control,
auto-engaging means fighting a number the user chose.

### 6.3 Auto-scroll, pin, smooth scroll and reduced motion

Auto-scroll and smooth scroll are two mechanisms that take **opposite** answers to the same
question, which is why both are in the glossary.

- **Auto-scroll is exempt from reduced motion.** It is a `requestAnimationFrame` loop the musician
  started deliberately and can stop at any moment; it is the function, not decoration. That it is
  startable and stoppable by the user is precisely what makes the exemption defensible rather than
  an override of a stated preference.
- **Smooth scroll is not exempt.** Jumping across forty pages to a search hit is a large animated
  movement whose only point is the destination. Under reduced motion it becomes a jump.

`data-motion="reduced"` zeroes `animation-duration` and `transition-duration` on `*` and **does not
touch `scroll-behavior`**, so smooth scrolling survives reduced motion today, everywhere in Riff.
That is a gap in `globals.css`, not a viewer concern, and it is fixed in both reduced-motion rules.

Speed is in **pages per minute**, 0.1 to 10, default 1 — stable under zoom, where pixels per second
is not, and the unit a musician already thinks in. It pauses on any manual scroll and stops at the
last page.

**In `ScrollMode.PAGE` there is nothing to scroll**, so auto-scroll changes meaning rather than
breaking: it advances one page every `60 / speed` seconds. Same control, same unit, same speed
number, and the transition between scroll modes does not reset it.

**Pin** keeps auto-scroll on the current page, for looping one page while practising it. In spread
mode it holds the current **spread**, not one half of it — you are reading two pages, and releasing
you onto the second one alone would be worse than not pinning. Scrolling by hand still works: a pin
that snapped you back would be unusable.

### 6.4 What the view holds, and what it does not

The view is **page, scale, rotation, spread, scroll mode and auto-scroll speed**. Those six travel
with a popping-out pane and come back with a reopen offer.

Two things deliberately do not persist. **Whether auto-scroll is running**, because a score that
began scrolling the moment it reopened would be alarming rather than helpful. And **whether a page
is pinned**, because a pin is a thing you do to practise this passage now, not a property of the
score. Both start off, every time.

Speed lives in the view rather than in settings because a dense study and a sparse chorale want
different speeds, and the score is what knows which it is.

---

## 7. The workspace and the reopen offer

`$XDG_DATA_HOME/riff/workspace.json` holds the open score's path and its view. Rust owns it in
memory; the file is durability. See ADR 0004 for why it is not in `settings.json`.

**`appearance.scoreDim` is not a counter-example.** Dim is a preference — chosen once, about the
room and the monitor and the person, and the same for every score. The workspace is what happens to
be open right now. The line ADR 0004 draws is between configuration and derived state, not between
"about the score" and "not about the score".

**The view is written on every change, without a throttle.** Page-number granularity means it
changes when the page changes — roughly once every twenty seconds of reading, not once a frame.
Throttling the command would buy nothing and would introduce exactly one race: turn to page 34, pop
the pane out inside the throttle window, and the new window opens at page 30. Only the *disk write*
is coalesced, through the same `FlushScheduler` settings already use.

### 7.1 The round trip

Popping the Score pane out and docking it back is the same journey twice, and neither direction is
free:

1. The leaving window's viewer unmounts. `loadingTask.destroy()`, viewer teardown, worker gone.
   **It does not write on unmount.** Every change was written when it happened, so a farewell write
   has nothing new to say and everything to lose: the arriving window may already have mounted, and
   a parting patch from a dying viewer would overwrite it.
2. The arriving window mounts, calls `score_state` — the **in-memory** value, so it cannot be
   behind the flush scheduler — then `score_bytes`, then restores the six values in §6.4.
3. Restoring is itself a write hazard. Setting `currentPageNumber` makes `PDFViewer` emit
   `pagechanging`, and the handler that listens for it is the one that calls `score_view_patch` —
   so a restore echoes straight back as a change. It is suppressed while restoring, which is the
   same problem `settings/watcher.rs` solves by filtering its own last-written bytes.
4. Scroll position within the page is not restored, because it was never recorded.

The re-read and re-parse are the accepted cost of ADR 0003, and the arriving window shows §4's
loading state while they happen. A compositor killing `popout-score` outright takes the same path,
because Rust learns from `CloseRequested` and the workspace is already current.

### 7.2 The offer is merged, not stacked

Plan 13's launch prompt is a sonner toast with `duration: Infinity`, suppressed in pop-out windows
and during onboarding, offering popped-out panes back. A second infinite toast offering a score
back would stack on it, and a launch that asks two open-ended questions is worse than one that asks
one.

So there is **one** reopen offer covering the whole workspace — the panes that were out and the
score that was open — with one action that reopens both. Where only panes were out, it says exactly
what it says today. The wording stays **Reopen**, never "Restore"; that word is taken twice already.

The pending-reopen mechanism is unchanged and its properties are why it was reused: state is read
once at launch, held in memory, and cleared from the file immediately, so ignoring the prompt,
quitting before answering it, or crashing all leave nothing to re-offer. The offer happens exactly
once.

One button, two commands: the panes live in settings and the score lives in the workspace, and ADR
0004 is why they are not merged into one command to match the one button. They are independent, so
a failure in either is reported through `fire()` and the other still happens — reopening two panes
is not undone because a score has moved.

---

## 8. Keyboard and palette

`src/features/keybindings/keymap.ts` stays the single source of truth for what Riff can do, so all
of the score commands live there and the palette renders them.

A binding gains an optional **`available?: (ctx) => boolean`**, which *removes* it — the same
doctrine `scope` already follows, where a scoped-out binding is dead rather than disabled. Score
commands are available only when a score is open, so the palette does not grow fourteen dead rows
in an empty workspace. "Open score…" is always available.

Whether a score is open reaches `__root.tsx` through **`useOpenScore()`**, a read-only mirror of
Rust with the same shape as `usePoppedOut.ts`, including its seed-versus-event guard.

Chords go to opening, page turning (§6.1), zoom and search. Everything else is `chord: ""` —
palette-only, discoverable, unbound.

**There is no pane focus model, deliberately.** Score bindings are live wherever a score is open, in
`main` and in `popout-score` alike. Arbitrating focus between three panes is not worth designing
while two of them are inert placeholders, and `activeElement` over a canvas viewer is not a reliable
answer. §6.1 shows the upside — a window-level keymap is what makes a pedal work at all — and the
debt is real: it comes due when Video lands and two panes both want the same chord.

---

## 9. When a score will not open

Errors stay one adjacently-tagged enum of `{ code, details }`, where `code` selects a localised
message and raw Rust prose is never primary UI text. Three new codes, and the rule for why it is
three:

**A code earns its own existence only when it changes what the user does next.**

| Code | The user can act |
|---|---|
| `ScoreMissing` | The file has moved or been deleted. Find it, or open another. |
| `ScoreEncrypted` | The score is password-protected. Riff does not prompt for one. |
| `ScoreUnreadable` | Everything else — malformed, truncated, not a PDF at all. |

A malformed cross-reference table and a `.zip` renamed to `.pdf` both end at "this file cannot be
opened", so they share a code and put their difference in `details`.

`ScoreMissing` is the one that matters most, because §7 guarantees it will happen: quit with a score
open, move the file, and the next launch offers back something that is not there. The offer is made
from the recorded path **without stat-ing it first** — checking at launch would trade a
guaranteed-correct error at the moment of use for a race.

A failure returns the pane to its empty state with the message in place, so the Open affordance is
under the user's cursor rather than behind a dismissed dialog.

**No size limit.** A 600 MB scan is slow rather than refused. ADR 0003 records that whole-file
residency is the accepted cost of the transport; inventing a threshold would refuse somebody's
legitimate archive with no way to override.

---

## 10. Accessibility

`/practice` is already one of the routes `axe-core` asserts zero violations on, and a canvas plus a
transparent text layer plus a twelve-control toolbar is where that gate breaks. Foundation spec §11
applies unchanged; these are the additions it does not already cover.

- **The canvas is `aria-hidden`. The text layer is the accessible content**, which is what makes a
  vector score readable by a screen reader at all.
- **A scan has no text layer**, so the pane says so — "This score has no searchable text" — rather
  than presenting an empty region that reads as a rendering failure. The same sentence serves
  search, because it is the same cause.
- **Page changes are announced** in a polite live region, reusing the route announcer's pattern.
  Announcing every frame of auto-scroll would be intolerable, so auto-scroll announces its start
  and stop and nothing between.
- **The toolbar is a labelled group of tabbable buttons, not `role="toolbar"`.** §5.1 records why:
  the ARIA toolbar pattern's arrow-key roving focus collides with the page-turn chords, and a few
  extra tab stops is the cheaper side of that trade. `aria-label` on the group, an accessible name
  on every button.
- **Every control reaches 24×24 CSS pixels in both densities**, and the overflow menu in §5.1 is
  what protects that at narrow widths rather than shrinking the buttons.
- **No pointing-hand cursor**, per foundation §11 — it is set once at the root, and an imported stylesheet is
  exactly the way it comes back. The Riff override layer resets it.
- **Auto-scroll is stoppable from the keyboard** at any moment, from any of the three surfaces
  (chord, palette, toolbar). §6.3's reduced-motion exemption rests on that; without it the
  exemption would be indefensible.
- Search results announce a count, not just a highlight, because the highlight is inside a canvas
  overlay a screen-reader user is not looking at.

---

## 11. Performance

Targets, not gates. Foundation spec §13 gates startup because it had a baseline; these have none
yet, so they are measured and recorded in plan 15 rather than enforced in CI.

| | Target |
|---|---|
| Pick a 20 MB score → first page painted | under 1 s |
| Pop out or dock back with that score open | under 1 s, loading state throughout |
| Scrolling 50 pages of a 300-page score | resident memory does not grow monotonically |
| Peak RSS with a 100 MB score open | measured and recorded, not bounded |

The third is the one that catches a real bug rather than a slow one: a canvas that is never
released turns page virtualisation into a leak, and it looks fine for the first twenty pages.

---

## 12. What deliberately does not change

- **`media-src` stays `'none'`.** Nothing here plays.
- **The capability file is untouched.** Still `core:default`, still `["main", "popout-*"]`. Still no
  `src-tauri/permissions/`, so Riff's own commands remain un-gated and adding a manifest would still
  make that file load-bearing overnight.
- **No asset protocol.** ADR 0003.
- **`instance::acquire()` and the boot order.** ADR 0002 stands; no CLI argument is added.
- **The pop-out and dock-back contract.** Closing a pop-out still means dock back, still never asks
  "Really quit?", and closing `main` still takes the pop-outs without recording dock-backs.
- **`practice.poppedOut` stays in settings.** Only the workspace is new, and only it is elsewhere.
- **`depends` gains a WebKitGTK minimum**, once plan 15 establishes what pdf.js actually requires.
  Today both packages name an unversioned `libwebkit2gtk-4.1-0` / `webkit2gtk4.1`, which was
  honest while Riff used nothing newer than the webview itself. It stops being honest the moment a
  bundled worker does.
- **The 250 KB entry-chunk gate is unchanged, and is already the guard.** `pdf.min.mjs` is 131.5 KB
  gzipped against 127 KB of current entry chunk, so a static import from anywhere outside the
  practice route lands at roughly 259 KB and CI goes red on its own. No new check is needed; the
  existing one only works because the router code-splits.

---

## 13. Testing

jsdom has no canvas and no layout engine, so `PDFViewer` cannot run there at all and none of the
visual behaviour is observable in Vitest.

**Fixtures come first.** A PDF viewer with no sample PDFs tests nothing, and half the error paths
in §9 are unreachable without them. `src-tauri/tests/fixtures/scores/` carries the smallest
possible example of each: engraved with embedded fonts, scanned with no text layer, encrypted,
truncated, a non-PDF with a `.pdf` extension, and one carrying an external link. All are public
domain or generated, each recorded with its provenance in a README beside them — Riff's legal
hygiene applies to committed bytes as much as to dependencies.

**Pure modules, tested normally.** Page arithmetic, pages-per-minute to pixels-per-second in both
scroll modes, fit-mode selection, toolbar overflow thresholds, the `available?` predicates, error
mapping, workspace merge and validation. This is not a testing convenience — it is the design
constraint that keeps the viewer component thin, and it is what makes the 80/80/80/70 coverage gate
reachable over `src/features/practice` instead of something to be argued down.

**`PDFViewer` is mocked** in component tests, at `pdfjs-dist`, the way `@/lib/ipc` is mocked rather
than `@tauri-apps/api`. Real component logic against a typed fake.

**No canvas polyfill.** Installing `node-canvas` would assert that Cairo under Node draws what
WebKit will, which is a test that can pass while the application is broken.

**The real engine measures what the suite cannot.** WebKit2GTK 4.1 through PyGObject, as
`project_webkit_layout_harness` describes: fit width at 1.5× UI scale, text-layer alignment at
0.8×, 1.0× and 1.5×, toolbar overflow at the narrowest feature-shape pane in both densities, spread
mode in a narrow pop-out, dim at 0.4, and that `type: "module"` workers run under WebKitGTK 2.52.6.

**One measurement is only possible in a packaged build**: that a score with embedded fonts renders
in its own fonts. `devCsp` already permits what production did not, so this is the one class of bug
`pnpm app` structurally cannot show.

---

## 14. Definition of done

1. A score opens from the picker and from a dropped file, in `main` and in `popout-score`.
2. It renders with continuous scroll, and a 300-page score scrolls without stalling or leaking.
3. Fit width, fit page, free zoom, rotation and spread all work, and all survive a pane resize that
   is not a window resize.
4. Pages turn from **Page Up / Page Down and Left / Right**, so a commodity pedal works untouched.
5. Search finds and highlights across pages where the score carries text, and says plainly where it
   does not.
6. Dim, auto-scroll, pin and smooth scroll behave as §6 describes, including the reduced-motion
   split and the `ScrollMode.PAGE` variant.
7. The toolbar is usable at the narrowest feature-shape pane, at 1.5× UI scale, in Compact.
8. Popping the Score pane out and docking it back keeps the score, the page and the view.
9. Quitting with a score open and relaunching offers the whole workspace back, once, in one toast.
10. A missing, encrypted or unreadable score produces a localised message naming what to do.
11. `axe-core` reports zero violations on `/practice` with a score open and with search open.
12. Every gate green, including `pnpm licenses:generate` for `pdfjs-dist` (Apache-2.0) and the
    regenerated `ipc-shapes.json`.
13. The §13 harness measurements and the §11 performance numbers are recorded.

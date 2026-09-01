# Riff — PDF System Hardening Design

**Status:** approved architecture; implementation handoff in `docs/superpowers/plans/2026-09-01-pdf-system-hardening.md`.
**Date:** 2026-09-01.
**Supplements:** `docs/superpowers/specs/2026-08-30-score-viewer-design.md`. Where the two
documents conflict, this document wins.
**Decision records retained:** ADRs 0003–0005, with the corrections named in §15.
**Vocabulary:** `CONTEXT.md`.

---

## 1. Purpose

The Score pane now renders PDFs, but the system is not ready to ship. Its filesystem and network
boundary is sound; its lifecycle is not. A score can disappear across relaunch, a failed load can
remain behind an endless loading state, two different scores can share an identity, a late view
event can overwrite the wrong workspace, and keyboard commands stop at the webview boundary when
the pane is popped out. The declared WebKitGTK 2.36 floor is also not supported by the generic
PDF.js build in the production bundle.

This milestone hardens the existing architecture. It does not replace PDF.js, introduce the asset
protocol, or move PDF rendering into Rust. It makes the current design honest, race-safe,
responsive, recoverable, measurable, and suitable for a code-complete implementation handoff.

### 1.1 Success criteria

- Every open score has an opaque Rust-owned generation, and operations from an earlier generation
  cannot read, close, command, or persist over the current score.
- Opening, loading, first paint, ready, retry, and failure are explicit UI states. No failure can
  be displayed as an endless spinner.
- The one-time reopen offer includes both the score and popped-out panes, and applies them in an
  order that avoids loading the score twice.
- A command invoked from any focused Riff window reaches the window that currently hosts Score.
- All toolbar functions remain reachable at the narrowest supported pane width and 1.5× UI scale.
- Large score validation and reads do not block a Tauri window-event or command thread and do not
  read the complete file twice before first paint.
- The generic PDF.js build remains. Riff declares the oldest WebKitGTK version that the production
  bundle actually passes, and refuses older detected runtimes before evaluating PDF.js.
- The real WebKit engine, packaged CSP, accessibility tree, and performance targets have durable
  checks or recorded measurements rather than comments claiming they were checked.

### 1.2 Non-goals

- Video, audio, annotations, cropping, outlines, printing, recent scores, setlists, and multiple
  simultaneous scores remain out of scope.
- No native PDF renderer, PDF parser dependency, asset protocol, filesystem capability, arbitrary
  URL command, network origin, telemetry, or account is added.
- The user's PDF is never modified.
- There is still no hard PDF size limit. Whole-file residency remains the accepted consequence of
  ADR 0003; this milestone removes avoidable copies and blocking work instead.
- CMaps, standard-font assets, and WASM remain unbundled. The existing CJK and substituted-font
  limitation is documented and tested as a known product limitation, not silently presented as
  full coverage.

---

## 2. Invariants

The existing repository invariants remain load-bearing:

1. No caller-supplied path or URL crosses IPC. A score's path remains Rust-only.
2. The webview keeps only `core:default`; no permissions manifest is introduced.
3. Runtime network access remains zero. CSP `connect-src` and `media-src` do not expand.
4. `workspace.json` remains derived state in the data directory and is not added to diagnostics.
5. Closing a pop-out still docks its pane; closing `main` still quits every window without
   recording those closes as dock-backs.
6. Unknown workspace keys survive read-modify-write cycles.
7. Every user-visible string is localised. Technical details may supplement a message but never
   replace its localised primary text.
8. The PDF.js worker is required. Main-thread fake-worker fallback is never accepted.

The generation introduced below is not a filesystem identity and is not persisted. It exists only
to prove that an asynchronous operation still belongs to the score that started it.

---

## 3. Chosen approach

Riff keeps the generic `pdfjs-dist` build and bytes-over-IPC transport. The implementation will:

- harden the Rust workspace and IPC seam with generation-aware commands;
- centralise the frontend mirror of the open score;
- dynamically evaluate PDF.js only after a runtime-version preflight;
- route keymap and palette score commands through Rust to the hosting window;
- move filesystem validation and complete reads off event and command threads;
- replace implicit loading booleans with a recoverable state machine;
- complete the responsive, keyboard, search, accessibility, and reopen designs; and
- add the real-engine and packaged-build evidence the first implementation omitted.

Two alternatives remain rejected:

- **PDF.js legacy builds.** They retain older WebKit support but add bundle weight and global
  polyfill/prototype behaviour. Riff targets modern Linux and will publish an honest runtime floor
  instead.
- **Native rendering or a new asset-protocol path.** That would add native dependencies and
  recreate search, selection, internal links, and accessibility for no benefit to the defects in
  scope.

If the compatibility measurements show that no WebKitGTK version available to Riff's supported
Linux distributions can run the generic build, implementation stops and this design is revised.
The implementer must not silently switch to a legacy build or add ad-hoc polyfills.

---

## 4. Rust-owned score generation

### 4.1 Boundary shape

`OpenScore` gains an opaque string generation:

```rust
pub struct OpenScore {
    pub generation: String,
    pub score: Score,
    pub view: View,
}
```

Rust may produce the string from a session-local monotonic counter. TypeScript treats it only as a
string and compares it by equality. It never parses, increments, displays, logs, or persists it.
Using a string avoids JavaScript's integer precision boundary without adding identity semantics to
the value.

`OpenScoreRecord` remains the persisted path, metadata, view, and unknown fields. The in-memory
workspace holds the active record together with its generation, while serialisation writes only
the record. Opening or reopening a score allocates a fresh generation. Closing it removes the
active generation. A process restart cannot reuse a live generation because no earlier renderer
survives that restart.

The score commands become generation-aware:

```text
score_bytes(generation) -> raw ArrayBuffer response
score_close(generation) -> bool
score_state() -> OpenScore | null
score_view_patch(generation, view) -> View
score_command(generation, command) -> void
```

`score_open()` and `score_reopen()` return the newly generated `OpenScore`; the picker-cancel case
still returns `null`. `score_pending_reopen()` returns display-safe `Score` metadata only because
there is no active generation until the user accepts the offer.

### 4.2 Stale operations

Every generation-bearing command checks the active generation under the same workspace lock that
guards the active record.

- A stale byte request does not read whatever score happens to be current.
- A stale close does not close a newer score and returns `false`.
- A stale view patch does not mutate the workspace.
- A stale command is not emitted to a window.

Stale byte, view, and command calls return a typed `score-stale` error. The frontend recognises
that code as cancellation and does not show a toast. The error still has a localised fallback to
preserve the repository rule that every public error code is explainable, but normal UI never
surfaces it.

Failures in the score command/event delivery seam use `score-infrastructure`, distinct from a
preflight denial. This lets a picker caller suppress a normal error already presented in the Score
host—even when that host is another window—while still surfacing a missing target, closed picker
channel, or failed event delivery as an actionable global failure.

The generation is also carried in `score://changed` and `score://command` payloads. A viewer ignores
any event whose generation differs from its own even though Rust already guards the command.
Defence at both ends prevents a later refactor from reopening the race.

### 4.3 View validation

Rust canonicalises persisted views during load and validates every IPC patch:

- page: integer, minimum 1;
- custom scale: finite, clamped to 0.1–25.0;
- rotation: one of 0, 90, 180, or 270;
- spread and scroll mode: known enum values;
- auto-scroll speed: finite, clamped to 0.1–10.0 pages per minute.

Persisted malformed or unknown enum values fall back without discarding the rest of the workspace,
as they do today. Invalid IPC types remain validation errors. The frontend adopts the canonical
view returned by the latest patch reply and ignores replies for older local patch tickets.

---

## 5. One frontend score mirror per webview

`useOpenScore()` is replaced by a small Zustand score store. It owns only Rust-mirrored state and
operation errors:

```ts
interface ScoreState {
  initialised: boolean;
  open: OpenScore | null;
  operationError: ScoreFailure | null;
  subscribe(): Promise<() => void>;
  openFromPicker(): Promise<void>;
  close(generation: string): Promise<void>;
  reopen(): Promise<void>;
}
```

The root subscribes once in each webview. Components use primitive selectors and never register
their own Tauri listener or seed request.

Subscription order is normative:

1. await registration of `score://changed` and `score://open-failed` listeners;
2. request `score_state()`;
3. ignore that seed if a changed event arrived after listener registration;
4. set `initialised = true`.

Command results are adopted immediately; the later broadcast is idempotent confirmation. A lost
or delayed broadcast therefore cannot leave the initiating window stale. Other windows still
adopt the broadcast.

Until initialisation completes, the Score pane shows a small skeleton rather than briefly claiming
that no score is open. `operationError` is cleared when a new open/reopen starts, when an open
succeeds, or when the user dismisses it. Picker, drop, and reopen preflight failures use one
`score://open-failed` event targeted to the current Score host. The command still rejects for its
caller, but the initiating frontend suppresses duplicate presentation when the typed event is
expected. This gives the hosting store one error regardless of which window received the drop or
opened the picker.

---

## 6. Score-pane state machine and recovery UI

The pane distinguishes backend state from one viewer attempt:

```text
uninitialised
empty
loading(generation, attempt)
ready(generation, attempt)
load-error(generation, attempt, failure)
```

`ScoreSurface` owns the attempt number and is keyed by the score generation. `ScoreViewer` is keyed
by both generation and attempt, so a new score or Retry starts with fresh page, view, search, pin,
auto-scroll, announcements, PDF.js objects, and DOM:

```tsx
<ScoreViewer key={`${open.generation}:${attempt}`} open={open} />
```

The loading state remains visible until the first `pagerendered` event for the visible restored
page, not merely until `viewer.setDocument()`. It is not hard-coded to PDF page 1: a workspace that
reopens on page 50 must become ready when page 50 paints. Page count may appear earlier, but the
loading overlay is removed only when the user can see a page. A first-visible-page render failure
enters `load-error`.

After ten seconds without first paint, loading becomes an actionable slow-loading state. Parsing
continues, but the pane says that opening is taking longer than expected and offers Retry, Open
another score, and Close score. Retry cancels the current loading task and worker before remounting.
If the original attempt eventually paints, it becomes ready normally. This avoids an unbounded
spinner without imposing a hard timeout that would refuse a legitimate very large scan.

The error surface keeps the pane header and score name visible. It presents actions according to
the failure:

| Failure | Primary message | Actions |
|---|---|---|
| missing/unreadable/encrypted | Localised reason | Retry, Open another score, Close score |
| worker start or transient renderer failure | Renderer could not start | Retry, Close score |
| detected unsupported WebKitGTK | Required and installed versions | Close score |
| stale/cancelled attempt | None | None; the attempt disappears silently |
| unknown PDF.js failure | Could not open this score | Retry, Open another score, Close score; technical details collapsible |

Retry remounts the viewer for the same generation and re-reads the Rust-held path. Open another
uses the native picker and does not close the current score until the replacement has passed Rust's
preflight. Close is generation-aware, so an error surface from an old attempt cannot close a newer
score.

There is no modal error dialog. Recovery remains under the user's cursor in the pane, and a global
toast is reserved for failures not anchored to a viewer, such as drag/drop or workspace writes.

---

## 7. PDF runtime and compatibility floor

### 7.1 Dynamic evaluation

No module imported by the empty Practice route may evaluate `pdfjs-dist`. `ScoreSurface` is loaded
lazily only while a score is open. The runtime is split into a dynamically imported module that
owns all value imports from `pdfjs-dist`, `pdf.worker.min.mjs?url`, and
`pdfjs-dist/web/pdf_viewer.mjs`. Type-only imports may remain outside it because TypeScript erases
them.

Before dynamic import, Riff compares the bootstrapped runtime WebKitGTK version with
`MIN_WEBKITGTK`. When a known version is below the floor, it enters the unsupported-runtime error
state without evaluating PDF.js. When the runtime version is `unknown`, Riff attempts the dynamic
import and maps a module-evaluation failure to the compatibility error with an `unknown` installed
version.

This ordering is required because the generic PDF.js main-thread viewer uses modern built-ins too;
a worker-only guard runs too late.

### 7.2 Establishing the floor

The production output, not source modules or `pnpm dev`, establishes compatibility. The checked-in
WebKit harness must test candidate WebKitGTK minor series against the same minified main-thread
chunk and verbatim worker emitted by `pnpm build`.

A candidate passes only when all of these succeed without syntax errors, missing built-ins, fake
worker fallback, or main-thread exceptions:

1. dynamically import the score runtime;
2. start a real module worker;
3. open the engraved, scanned, external-link, and 300-page fixtures;
4. paint page one and turn at least one page;
5. destroy the loading task, worker, viewer, and webview without leaked work.

The declared floor is the lowest tested version after the last failing version, with at least one
newer minor series also passing. The exact measured version is written in four places in the same
change: `MIN_WEBKITGTK`, deb dependency, rpm dependency, and the measurement record. Those values
must agree in tests. The implementation does not retain 2.36 unless 2.36 passes this production
matrix.

### 7.3 Worker lifecycle

The worker capability check must not create and destroy a probe worker only for `getDocument()` to
create a second one. The runtime creates one `PDFWorker`, awaits it, proves `worker.port` is a real
`Worker`, and passes that worker to `getDocument`. Cleanup destroys both the loading task and the
explicit worker. Fake-worker fallback enters the renderer-failure state.

---

## 8. File opening and I/O

Rust separates cheap preflight from complete byte loading.

### 8.1 Preflight

Picker, drop, and reopen call one asynchronous preflight function on a blocking worker thread. It:

- opens and stats the path;
- maps not-found and permission errors to the existing localised score errors;
- reads at most the first 1,024 bytes and accepts `%PDF-` anywhere in that prefix;
- reads a small tail window to require a plausible `%%EOF`; and
- returns basename and byte count without returning or retaining the complete file.

It does not scan the complete file for `/Encrypt`. That heuristic can match unrelated bytes and is
not a PDF parser. PDF.js's `PasswordException` becomes the authoritative encrypted-score result.
A valid header with malformed internals may therefore enter the loading state before PDF.js reports
it unreadable; the explicit error state makes that honest and recoverable.

### 8.2 Complete read

`score_bytes(generation)` is asynchronous and performs the complete `std::fs::read` through
`spawn_blocking`. It checks the generation before selecting the Rust-held path. The frontend checks
cancellation immediately after every awaited boundary, including runtime import, worker start, and
the byte reply, so an obsolete attempt never passes returned bytes into PDF.js.

The picker path does not cross IPC. The raw response remains an `ArrayBuffer`; base64 and numeric
JSON arrays remain forbidden.

### 8.3 Competing opens

Picker, drop, and reopen each receive a monotonic open-request ticket before preflight. Only the
newest completed ticket may replace the active score. A slow validation from an earlier request
cannot overwrite a later choice. Cancellation of the native picker creates no ticketed mutation.

The active score remains visible while a replacement is being validated. A failed replacement
leaves the active score untouched. When there is no active score, the failure is the empty pane's
operation error; when a score is already visible, the failure uses one global toast so it does not
replace or cover the usable viewer. A successful replacement allocates a new generation,
broadcasts it, focuses the Score host, and schedules the workspace write.

Every preflight failure emits `score://open-failed` to the Score host before the initiating command
returns its typed error. The drag/drop event handler starts asynchronous work and returns
immediately. It never reads a PDF inside `on_window_event`.

---

## 9. Cross-window commands and keyboard behaviour

### 9.1 Command routing

Toolbar interactions remain direct calls into the viewer in their own window. Keymap and palette
commands use the new `score_command(generation, command)` IPC command. Rust determines the Score
host from the canonical popped-out set and emits one targeted `score://command` event to `main` or
`popout-score`.

The event includes the generation. If the target window is missing, Rust reports a typed error
rather than broadcasting. The main window is never focused merely to deliver a command; the user
may keep focus in any Riff window. This is especially important for commodity page-turner pedals.

### 9.2 Chords

The existing page-turn, zoom, search, and speed bindings remain discoverable. The following fixes
are normative:

- `Ctrl+Shift+Space` toggles auto-scroll.
- `Ctrl+Shift+=` and `Ctrl+Shift+-` remain the speed controls, but chord normalisation uses
  `KeyboardEvent.code` for the physical Equal and Minus keys when modifiers are present, so shifted
  punctuation does not become `+` or `_` before matching.
- A literal Space key normalises to `space` and is formatted as `Space` in shortcut UI.
- Global score bindings do not run from text inputs, textareas, selects, contenteditable elements,
  or elements with `role="slider"`. This prevents a speed-slider arrow key from also turning a
  page.
- Opening search or the speed control pauses auto-scroll. Therefore the auto-scroll safety chord
  does not need to override typing or slider interaction.

Page Up, Page Down, Left, and Right remain the pedal-compatible page-turn chords. The toolbar
remains a labelled group of ordinary tabbable controls rather than an ARIA toolbar, preserving the
existing decision that roving arrow-key focus must not collide with page turns.

---

## 10. Responsive toolbar

Previous page, page field, next page, fit, and search remain inline at every supported width. Other
controls retain two collapse tiers:

- at 46rem and wider: every control is inline and no overflow trigger is rendered;
- from 34rem to below 46rem: auto-scroll, speed, and pin move into overflow;
- below 34rem: zoom, scroll mode, spread, rotation, auto-scroll, speed, and pin move into overflow.

The implementation uses two CSS-selected overflow popovers: one containing only the last tier and
one containing both collapsing tiers. Exactly one is displayed at a narrow width, and neither is
displayed at full width. This avoids measuring layout in JavaScript and avoids trying to apply a
container query to portal content outside the toolbar container.

Each popover contains ordinary labelled controls and the real speed slider. It is not an empty menu
or a list of inert labels. Hidden duplicates use `display: none`, removing them from the
accessibility tree. Every target remains at least 24×24 CSS pixels in both densities. Thresholds
remain container queries in rem, so UI scale and popped-out width are measured correctly.

The overflow trigger has a localised accessible name equivalent to “More score controls”, returns
focus on close, and exposes pressed/current states for scroll mode, spread, auto-scroll, and pin.

---

## 11. Search, focus, announcements, and auto-scroll

### 11.1 Search

Search is no longer enabled or disabled from page one's text content. That test cannot classify a
mixed score and makes a scanned cover disable searchable later pages. Search is always available.
PDF.js searches the complete score when a query is made. Zero results are reported truthfully as
“No matches; scanned scores may not contain searchable text” rather than claiming Riff proved the
whole score has no text layer.

Opening search focuses the field and pauses auto-scroll. Escape and the close button both close the
row and restore focus to the search toggle. Query, match status, and highlights reset when the
generation or retry attempt changes.

### 11.2 Announcements

- No page announcement is emitted during initial load.
- Manual page turns and manual scrolling to a new current page update one polite page live region.
- Page changes caused while auto-scroll is active are not announced.
- Auto-scroll announces only actual transitions from stopped to running and running to stopped.
  Initial ready state does not announce “stopped”.
- Search counts remain in their own status region so a page announcement cannot overwrite them.

### 11.3 Auto-scroll lifecycle

The animation-frame delta is capped at 100 ms. When the document becomes hidden, auto-scroll pauses
and discards elapsed hidden time; restoring the window never jumps ahead. Manual scrolling, a
manual page turn, opening search, and opening the speed control pause it. Pin continues to constrain
the current page or spread without preventing manual scrolling.

Cleanup removes the visibility listener, scroll listener, and animation frame. Auto-scroll running
and pin remain transient and always start off for a new generation or retry.

---

## 12. Reopen offer and workspace write errors

### 12.1 One workspace offer

The root registers score listeners and then requests both pending reopen values. If either a score
or popped-out panes are pending, it shows one persistent reopen offer. The text names the score by
basename and formats the pane names with the existing `Intl.ListFormat` path. Declining does
nothing because Rust already removed both pending values from disk at launch.

`PendingReopen` owns its score behind a mutex. `score_reopen()` takes that option before starting
preflight, so a compromised or duplicated caller cannot reopen the same pending record twice. A
failed attempt does not put it back: the user proceeds through Retry on an active load error or Open
another score on a preflight error, and the one-time offer remains one-time.

Accepting performs the operations in this order:

1. await `practice_reopen()` so the Score pane reaches its final window;
2. call `score_reopen()` so the score loads only in that host;
3. adopt the returned generated score in the frontend mirror.

If pane reopening partially fails, the canonical result from Rust is kept and score reopening still
continues in the actual Score host. A missing file, denied read, or invalid preflight leaves the
reopened panes in place and the empty Score pane shows the operation error with Open another score.
Encryption or malformed PDF internals pass the cheap preflight, open a generated score, and then
enter the viewer's load-error surface when PDF.js classifies them. The offer is not repeated during
that launch.

### 12.2 Durability failure

Workspace flush failures emit `workspace://write-failed` to `main`. The frontend uses a fixed toast
identifier so repeated failed flushes update one persistent toast instead of producing a stream.
The message states that the current score remains open for this launch but may not return after
restart. It offers the existing Open data folder action for diagnosis.

The in-memory workspace is never reverted after a write failure. A later successful flush needs no
success toast. Non-`NotFound` errors reading `workspace.json` at launch are logged with the path and
reason; only a missing file is silently treated as an empty workspace.

---

## 13. CSS and component boundaries

The complete upstream `pdf_viewer.css` remains imported; its raster-alignment pixels are not
rewritten. It is, however, placed in a named low-priority CSS cascade layer. Riff-owned styles stay
unlayered and therefore win over global upstream selectors such as `.dialog`, `.primaryButton`, and
generic buttons. The stylesheet is **layered, not scoped**; ADR 0005 is corrected to say that
plainly.

The implementation splits responsibilities without unrelated refactoring:

- score store: Rust mirror, subscription, open/close/reopen operations, operation errors;
- score surface: empty/loading/ready/error orchestration and retry attempt;
- PDF runtime: dynamic imports, compatibility check, worker and loading-task lifecycle;
- viewer controller: PDF.js event wiring and view application;
- toolbar and overflow: controls only;
- search adapter: find events and focus restoration;
- auto-scroll hook: timing and pause policy;
- announcement hook/component: transition-based live-region text.

No component should need to understand both Tauri event races and PDF.js event wiring. The current
large files may be split only along these boundaries.

---

## 14. Performance requirements

The existing targets become recorded release evidence:

| Scenario | Requirement |
|---|---|
| Open Practice with no score | PDF.js main module and worker are not evaluated or started |
| Pick a 20 MB engraved score → first page painted | under 1 second on the recorded reference system |
| Pop out or dock back with that score open | under 1 second, with loading UI until paint |
| Open a large score | one complete file read before first paint; no complete validation read beforehand |
| Scroll 50 pages of a 300-page fixture | resident memory does not grow monotonically after virtualised pages leave view |
| Hide and reveal during auto-scroll | no jump; scrolling returns paused |
| 100 MB score | peak RSS and first-paint time measured and recorded; no hard pass threshold |

The measurement record includes CPU, RAM, distribution, WebKitGTK version, Riff commit, fixture
size/page count, production or packaged mode, and raw observations. A regression outside the
bounded targets blocks completion or is explicitly brought back for a design decision; it is not
buried in a comment.

---

## 15. Security and prior-document corrections

The following properties remain explicit and gain real-engine coverage:

- `PDFLinkService.externalLinkEnabled = false` is assigned after construction;
- internal PDF destinations continue to work;
- `annotationMode = AnnotationMode.ENABLE`, so form widgets render but are not interactive;
- `enableScripting = false`;
- `useWorkerFetch = false`, `useWasm = false`, and no remote asset URLs;
- CSP retains only local script/worker origins and the already approved embedded font/image data
  sources; and
- no score path appears in IPC fixtures, frontend state, logs, diagnostics, or UI errors.

The implementation updates documentation in the same milestone:

- the 2026-08-30 design is marked implemented but superseded where this hardening design conflicts;
- ADR 0003 is corrected to distinguish cheap preflight from the one complete byte read;
- ADR 0004 records visible, deduplicated workspace write failures without changing the derived-state
  decision;
- ADR 0005 says the upstream stylesheet is layered globally, not scoped;
- `CLAUDE.md` and `README.md` stop claiming the Score viewer is unbuilt; and
- plan 15 is labelled historical and partially implemented rather than leaving 93 unchecked boxes
  to imply that no work landed.

---

## 16. Verification strategy

### 16.1 Rust tests

Tests prove:

- generations are fresh, absent from `workspace.json`, and present in every `OpenScore` reply;
- same-basename/same-size scores still receive different generations;
- stale byte, close, view, and command operations cannot affect the current score;
- view bounds are canonical at load and IPC patch boundaries;
- preflight accepts a header within the first 1,024 bytes and does not classify a literal unrelated
  `/Encrypt` string as encryption;
- complete reads happen on the blocking pool and open preflight does not read the whole fixture;
- competing open requests obey newest-request-wins;
- drop handling returns from the window event before validation completes;
- the combined reopen sequence retains successful panes when score reopening fails;
- picker, drop, and reopen preflight failures target one `score://open-failed` event to the Score
  host, and the pending reopen record can be consumed only once;
- workspace read/write failures are logged or emitted to the correct target; and
- IPC shapes remain synchronised without exposing a path.

### 16.2 Frontend tests

Vitest tests prove:

- listener registration precedes the seed and events win every seed race;
- command return values are adopted even before a broadcast;
- a load rejection replaces the spinner with the correct recovery surface;
- ten seconds without first paint reveals slow-loading recovery actions while the original attempt
  is still allowed to finish;
- Retry remounts the same generation with a fresh attempt and opening another uses a fresh
  generation;
- a same-name/same-size replacement resets every transient viewer state;
- cancellation after runtime import, worker start, byte read, and document load never continues to
  the next stage;
- ready begins only after the first visible page's `pagerendered` event;
- keymap and palette commands invoke Rust routing and targeted events affect only the matching
  generation;
- Equal/Minus, Space, slider focus, and text-entry chord cases match the rules in §9;
- each container-query tier has a reachable, labelled overflow copy of every hidden control;
- search stays available for mixed and scanned fixtures and restores focus on close;
- initial ready state is silent, auto-scroll page changes are silent, and actual start/stop/manual
  page transitions announce once;
- visibility pause and the 100 ms delta cap prevent jumps; and
- axe reports zero violations with a score ready, search open, overflow open, loading, and error.

PDF.js remains mocked in jsdom. Tests assert the security options and external-link field against a
typed facade rather than recreating PDF.js internals in every component test.

### 16.3 Real WebKit and packaged checks

A checked-in PyGObject/WebKit2GTK 4.1 harness runs the production build, not a Node canvas shim. It
records:

- the compatibility matrix in §7;
- a real module worker rather than fake-worker fallback;
- first paint and teardown;
- fit width/page after container-only resize at 0.8×, 1.0×, and 1.5× UI scale;
- canvas/text-layer alignment and search highlights;
- toolbar overflow in both densities and a narrow pop-out;
- spread, rotation, dim, and scrolling memory behaviour;
- external-link clicks remain inside Riff while internal destinations work; and
- scanned and embedded-font fixtures render.

A packaged deb/rpm smoke check confirms production CSP permits embedded fonts and images and that
the package manager enforces the measured WebKitGTK floor. Playwright and `node-canvas` are not
added.

### 16.4 Repository gates

Completion requires:

```bash
pnpm licenses:generate
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo deny check
```

The generated licence file and IPC fixture must be clean after regeneration. The current local
environment lacking `cargo-deny` is an environment setup issue, not permission to omit the CI gate.

---

## 17. Definition of done

1. Opening through picker, drop, and reopen works in docked and popped-out Score panes.
2. Relaunch attempts one persistent workspace offer containing every pending pane and score before
   normal interaction; accepting or declining it does not make the offer repeat.
3. Same-name/same-size replacements, rapid replacements, Retry, pop-out, and dock-back never reuse
   transient viewer state or persist a stale view.
4. Missing, unreadable, encrypted, incompatible, and unexpected failures leave the spinner and
   present the specified recovery actions.
5. Commands issued from any focused Riff window reach the current Score host, including Page
   Up/Down and Left/Right pedal events.
6. Auto-scroll has a working chord, never jumps after suspension, pauses for conflicting manual
   interactions, and announces only actual start/stop transitions.
7. Every hidden toolbar control is reachable through overflow at the narrowest supported pane,
   1.5× scale, and both densities.
8. Search is not misclassified from page one, restores focus, and reports zero results honestly.
9. PDF file work does not block a window event, performs one complete read before first paint, and
   competing opens obey user order.
10. The generic PDF.js main module is not evaluated until a score opens, and the package/runtime
    floor equals the recorded production-WebKit measurement.
11. External links, forms, scripting, CSP, filesystem isolation, and zero-network guarantees pass
    both contract tests and real-engine checks.
12. Accessibility, memory, first-paint, packaged-font, and compatibility evidence is checked in.
13. Superseded comments and documentation no longer claim unfinished or unverified behaviour.
14. Every repository gate passes, including `cargo deny check`, with a clean worktree after the
    generated artefacts are committed.

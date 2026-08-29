# Riff — Practice Pane Pop-out Design

- **Date:** 2026-08-29
- **Status:** Approved for planning
- **Supersedes nothing.** Extends `2026-08-28-riff-foundation-design.md`, which listed
  "Practice pane interaction: resizing, closing, popping out" as deliberately deferred (§1.2).
- **Scope of this milestone:** a practice pane can leave the main window and live in its own,
  and come back. The panes are still the placeholders from §8.3 — **no PDF, no video, no audio.**

---

## 1. Why

A musician practising from a score, a lesson video and a backing track has three things
competing for one window. On a laptop that is cramped; on the two- and three-monitor setups
musicians actually practise at, it is absurd — the score wants a whole display to itself,
and it cannot have one while it is a quarter of a grid.

This milestone makes the grid optional. It does **not** make the panes play anything; §15 of
the foundation spec still owns that. The two are separable, and building the window seam first
means the players in §15 drop into panes that already know how to travel.

### 1.1 In scope

- Popping any of the three practice panes into its own window, and docking it back
- The main window reflowing to use the space a popped-out pane left behind
- Remembering which panes were out, and offering to reopen them once on the next launch
- Keyboard and palette commands for all of the above
- The window lifecycle that makes three windows behave as one application

### 1.2 Out of scope

- PDF, video and audio playback — unchanged, still §15
- `paneActions.closePane`. It stays inert this milestone (see §7)
- Resizing panes within the grid. The reflow rule in §4 is deliberately not a layout engine
- Placing a window on a chosen display. See §3 for why this is not a matter of effort

---

## 2. Vocabulary

The word on the button governs the whole feature. There is no second word for it.

| Term | Meaning |
|---|---|
| **Pane** | One of the three regions of Practice: Score, Video, Audio. The pane is the *thing*; where it currently lives is a separate question. |
| **Pop out** | The verb. Move a pane out of the grid into its own window. |
| **Popped out** | The state. A pane is popped out if and only if it currently has a window of its own. |
| **Pop-out window** | An OS window hosting exactly one popped-out pane. |
| **Dock back** | The inverse verb. Return a popped-out pane to the grid, destroying its window. |
| **Main window** | The window labelled `main`. There is exactly one, it always exists while Riff runs, and it is the only one that can quit the application. |

"Detached" is **not** a synonym in use anywhere — not in code, not in the settings file, not in
prose. A pane is popped out or it is not.

"Restore" is already spoken for twice: `nav.restore` is the un-maximise glyph in the title bar,
and `general.restoreWindowState` is window geometry. The launch prompt in §6 therefore says
**Reopen**, and no key under `practice` is named `restore*`.

---

## 3. What the compositor owns, and what Riff owns

Riff opens a pop-out as an ordinary window. The user drags it wherever they want it. That is
the entire placement story, and the reason is not laziness:

**No Wayland compositor lets a client set its own position.** There is no such request in
xdg-shell, so this is identical under Mutter, KWin, sway, niri and Hyprland — it is the protocol,
not a compositor's policy, and it is unaffected by whether that compositor tiles or floats.
Under **X11** the underlying `gtk_window_move()` works and position is restorable.

The practical consequence, which the UI never contradicts:

| | X11 | Wayland |
|---|---|---|
| Size remembered across launches | yes | yes |
| Position remembered across launches | yes | no — the compositor decides |

`tauri-plugin-window-state` already persists both per window label and applies them on
`on_window_ready`, so this costs no new code; on Wayland the position half is silently ignored
by the platform.

Riff ships **no "send to display" control.** A mechanism exists — `gtk_window_fullscreen_on_monitor`
does work under Wayland, reachable via `WebviewWindow::gtk_window()` — and it was considered and
rejected: it can only ever *fullscreen* onto an output, never place a normal window, so it would
be a control that solves a different problem from the one it appears to solve. See
`docs/adr/0001-pop-out-windows-are-created-in-rust.md`.

---

## 4. The grid, and the hole a pop-out leaves

One rule, not a lookup table: **the panes still in the grid share it evenly.**

| Panes docked | Layout |
|---|---|
| 3 | Today's arrangement — Score tall on the left, Video and Audio stacked right |
| 2 | Two full-height columns |
| 1 | Full bleed |
| 0 | An empty state: *All three panes are in their own windows*, with **Bring all back** |

While anything is popped out, a thin **strip** sits under the Practice header carrying one chip
per popped-out pane (`⧉ Score`). Clicking a chip **focuses that window**; each chip carries a
dock-back button. The strip is absent entirely when nothing is out.

A ghost placeholder in the vacated slot was rejected: it keeps the cramping and removes the
content, which is the opposite of the point.

---

## 5. Three windows, one application

### 5.1 Rust owns the set

The authoritative answer to "which panes are popped out" lives in Rust, and the webview mirrors
it. This is not symmetry with the settings store for its own sake — it is forced:

> A compositor can destroy a pop-out window without the webview ever hearing about it.
> `hyprctl dispatch killactive`, a window rule, a session ending. Rust learns from
> `CloseRequested`; nothing in JavaScript does.

The same reasoning is already written into `useWindowMaximized`: *the window manager can maximise
the window without going through the button at all.*

Rust therefore emits `practice://panes-changed` one way, Rust → webview, alongside the existing
`settings://changed`, `settings://write-failed` and `app://confirm-quit`.

### 5.2 Creation and reveal

Pop-out windows are created **in Rust**, by a typed command. The webview cannot create them:
`core:default` does not include `core:webview:allow-create-webview-window`, and granting it
would put window creation on the wrong side of the IPC seam. Labels are `popout-score`,
`popout-video`, `popout-audio`; the capability's window list becomes `["main", "popout-*"]`.

Each pop-out repeats §3.1's reveal dance in full — created `visible: false`, revealed by its own
`app_ready()`, forced visible by its own three-second watchdog. `app_ready` already shows *the
calling window*, so the fast path is free; only the watchdog needs generalising beyond `main`.
A pop-out that is created visible would show one frame of unthemed white, which is the exact
thing §3.1 exists to make impossible, and one whose React throws must still produce a window with
the error in it.

The OS window title is `Riff — Score`, so three Riff windows are distinguishable in a task
switcher and addressable by a compositor rule. The rendered title bar is unchanged from the
main window's (§5.3).

### 5.3 Chrome

A pop-out wears the same custom `TitleBar` as the main window — wordmark, palette field, window
controls — with the sidebar toggle replaced by the pane's icon, since there is no sidebar to
toggle. `useWindowMaximized` already reads `getCurrentWindow()`, so the maximise control is
correct per window with no change.

Dock-back is the pane header's existing `⧉` button, which flips meaning when the pane is popped
out. It is already drawn in the mockup and needs no new chrome.

### 5.4 Closing, and quitting

| Action | Result |
|---|---|
| Pop-out's `×`, or `Alt+F4` on a pop-out | The pane docks back. Silent — this is the common action and must stay one click. |
| `Ctrl+Q` in a pop-out | Asks: **Dock this pane back into Riff, or quit Riff entirely?** → [Dock back] [Quit Riff] [Cancel] |
| Main window closed | Riff quits, taking the pop-outs with it |

`Ctrl+Q` is muscle memory for *close the application*, and a command labelled "Quit Riff" that
silently folds a pane back into a grid is a mislabelled action. The dialog resolves the ambiguity
rather than picking a side.

Two consequences that must be built, not assumed:

- **`confirmOnQuit` is filtered to `main`.** The existing `on_window_event` handler fires for
  every window, so with pop-outs open, closing one would raise "Really quit?" over a dock-back.
- **Choosing *Quit Riff* in that dialog satisfies the confirmation.** Otherwise `confirmOnQuit`
  raises a second modal immediately after the first, for one expressed intent.

### 5.5 The palette in a pop-out

`keymap.ts` stays the single source of truth and gains a scope. In a pop-out:

- **Present:** appearance toggles (theme, density, contrast), `openConfig`, `openLogs`,
  `togglePalette`, and a new **Dock pane back**.
- **Absent, chords dead:** every `nav.*` command, and `toggleSidebar`.
- **`app.quit`** is present and genuinely quits, via §5.4's dialog.

Navigation is absent because the alternative is a score window that turns into the Settings
screen with no sidebar to escape by. A pop-out is a pane, not a second copy of the application.

---

## 6. Persistence

`practice.poppedOut` is a list of pane identifiers, written as it changes and coalesced by the
existing 250 ms flush scheduler, exactly like `general.lastRoute`. It is **state, not a preference**,
and so has no control in Settings — the same treatment `lastRoute` gets, for the same reason.

On launch, if the list is non-empty, a toast appears **after** the main window is revealed and
never before it:

> *Score and Video were in their own windows last time.* **[Reopen] [Not now]**

- Ignoring it or declining **reopens nothing and clears the list**, so the offer is made exactly
  once. A prompt that returns every launch until obeyed is a prompt that should have been a setting.
- It is suppressed entirely while onboarding is active — reachable only via `settings_reset`,
  but reachable.
- It is offered regardless of `general.startupRoute`. Accepting reopens the windows and does not
  navigate the main window: a pop-out is an independent window, which is the whole point of it.
- It is independent of `general.restoreWindowState`. That setting is about geometry; this is about
  which panes were out, and it is already an explicit ask.

`settings_reset` — for `practice` or for everything — **docks every pane back**. The alternative
leaves `practice.poppedOut: []` in the file while three windows sit open, and a reset that leaves
the practice layout untouched is a lie.

---

## 7. What deliberately does not change

- **`paneActions.closePane` stays inert.** Reflow makes it coherent for the first time, but a
  working `×` needs a way to bring a *closed* pane back, which is a layout feature rather than a
  pop-out one. Shipping pop-out complete beats shipping pop-out plus half of pane management.
- **No media.** The panes carry the same icon, sentence and "In development" chip in a pop-out
  window as in the grid.
- **`media-src 'none'`** stays. Nothing here plays anything.

---

## 8. Definition of done

- A pane pops out into its own window, and the grid reflows to use the space
- The pop-out paints with the correct theme, density, contrast and UI scale on its first frame
- Dragging the pop-out to another display works; its size returns next launch
- `hyprctl dispatch killactive` on a pop-out returns the pane to the grid
- Closing a pop-out docks the pane back and never asks "Really quit?"
- `Ctrl+Q` in a pop-out offers dock-back or quit, and quitting does not ask twice
- `Alt+3` in a pop-out does nothing; `Alt+3` in the main window still opens Settings
- With all three popped out, Practice shows its empty state and **Bring all back** works
- Quitting with panes out and relaunching offers to reopen them exactly once; declining and
  relaunching again offers nothing
- Resetting settings docks every pane back
- A pop-out whose frontend never signals readiness still appears within three seconds
- `cargo test`, `pnpm test:coverage`, `pnpm lint`, `pnpm typecheck` and `pnpm build` pass; the
  IPC shape fixture matches

# Pop-out windows are created in Rust, and Rust owns which panes are popped out

**Status:** accepted (2026-08-29)

Tauri's documented way to open a second window is `new WebviewWindow()` from JavaScript. Riff
does not do that. Pop-out windows are created by a typed Rust command, and the authoritative set
of popped-out panes lives in Rust, mirrored into the webview through a one-way
`practice://panes-changed` event.

Two findings forced it, neither visible from the calling code:

1. **The webview is not permitted to create windows.** `core:default` expands to
   `core:webview:default`, which grants only `allow-get-all-webviews`, `allow-webview-position`,
   `allow-webview-size` and `allow-internal-toggle-devtools` — **not**
   `allow-create-webview-window`. Granting it would put window creation on the webview's side of
   the IPC seam, against invariant 5's rule that privileged acts cross as typed commands.
2. **A compositor can destroy a window without the webview hearing about it.** `killactive`, a
   window rule, a session ending. Rust learns from `CloseRequested`; JavaScript learns nothing.
   Any design where the frontend holds the authoritative set is wrong the first time the user
   closes a pop-out with the keyboard.

## Considered and rejected

**A second, narrower capability file for `popout-*`.** It looks like defence in depth and is not.
Tauri's invoke dispatch only enforces the ACL when `plugin_command.is_some() || has_app_acl_manifest
|| !is_local`; Riff has no `src-tauri/permissions/`, so `has_app_acl_manifest` is false and **Riff's
own commands are not ACL-gated at all** — a window with zero capabilities could still call
`settings_patch`. A narrower file would advertise a protection it does not provide, while its
smaller permission set would have to be found by trial. One capability, `["main", "popout-*"]`.

> The moment anyone adds `src-tauri/permissions/`, every application command becomes ACL-gated at
> once, and that capability file becomes load-bearing in a way it is not today.

**A "send this pane to display 2" control.** No Wayland compositor lets a client set its own
position — there is no such request in xdg-shell, so it is identical under Mutter, KWin, sway,
niri and Hyprland, and unaffected by tiling versus floating. A mechanism does exist:
`gtk_window_fullscreen_on_monitor`, reachable through `WebviewWindow::gtk_window()`, works under
Wayland because `xdg_toplevel.set_fullscreen` takes an output. It was rejected because it can only
*fullscreen* onto a display, never place a normal window there — a control that appears to solve
placement while solving something else. Riff opens an ordinary window and the user drags it.

Recorded so nobody re-derives `fullscreen_on_monitor` from scratch and concludes it was missed.

## Consequences

- Adding or changing a pop-out behaviour touches the four-place IPC seam, not just React.
- Position is remembered on X11 and left to the compositor on Wayland. No UI claims otherwise.
- The reveal dance in foundation §3.1 generalises: every window is created hidden and revealed by
  its own `app_ready()`, with its own watchdog. It is no longer a property of `main` alone.

# The single-instance question is answered before anything touches disk

**Status:** accepted (2026-08-30)

Riff answers "am I the only instance?" by binding an abstract Unix socket, in `instance::acquire`,
between path resolution and the first line that writes anything. `tauri-plugin-single-instance` has
been removed.

## What was wrong

§3.1's boot order ran `logging::start_session`, `cli::dispatch`, `SettingsStore::load`,
`take_pending_reopen`, the initial flush and the `riff.pid` write **before**
`tauri_plugin_single_instance` was registered — and the plugin's "already running" branch calls
`std::process::exit(0)` from inside `.build()`, which is the last thing in `run()`.

A second launch of an already-running Riff therefore did all of this before discovering it was
doomed:

```
before:  Riff | Riff — Score | Riff — Video     poppedOut: ["score","video"]
after:   Riff                                    poppedOut: []
latest   -> …-50118 (the dead second process)    riff.pid = 50118 (dead)
```

It cleared `practice.poppedOut` and flushed it — which the live instance's watcher picked up 2 ms
later and obeyed, closing both pop-out windows. It stole the `latest` symlink, overwrote `riff.pid`
with a pid that died seconds afterwards, and burnt one of the ten retained log sessions on a process
whose entire log is three lines. `riff doctor` typed while Riff was open burnt one too.

## The decision

The question has to be answerable *before* step 2, because every one of those effects is a step-2
-to-4 effect. That rules out any mechanism that lives inside `tauri::Builder`.

**Abstract Unix socket, bound in `instance::acquire(&paths)`.** The name is derived from
`config_dir`, so `RIFF_CONFIG_HOME=/tmp/scratch riff` and the real Riff are different instances —
which is what CLAUDE.md already promises a scratch run. Binding is atomic, needs no crate, writes
nothing, and the abstract namespace has no filesystem entry to leave behind: the kernel releases the
name when the process dies, so there is no stale lock to break and no `repair` path to write.

The new order:

1. `paths::resolve` and `ensure_dirs` — unchanged.
2. `cli::dispatch` — **moved up**, and still ahead of the gate. `riff --help` typed while Riff is
   open must print rather than raise the window and exit, which is the reason the CLI ran early in
   the first place. Given no subcommand it touches nothing and returns; given one it exits. Its
   disk writes — `riff repair` — are the user asking for them.
3. `instance::acquire` — **new**, the first line of `lib.rs::start()`.
4. `logging::start_session`, settings, `take_pending_reopen`, the initial flush, `riff.pid`, the
   schema — the rest of `start()`, now reachable only by the process that owns the instance.
5. If `acquire` was refused: `instance::request_focus`, exit 0. Nothing in step 4 has run.

Steps 3 and 4 are one function so the ordering is a test rather than a reading of the source:
`a_second_launch_leaves_the_popped_out_set_alone` calls `start` twice against one scratch config,
and moving any line of step 4 above the gate turns it red. All four of those tests failed on the
old order, reproducing the table above without a compositor.

`logging::start_session` moving below `cli::dispatch` fixes a second copy of the same bug: `riff
doctor` typed while Riff is open used to create a session directory, take `latest`, and prune.

## Considered and rejected

**Keep the plugin and make steps 2–4 harmless for a doomed process.** This was the other candidate.
It leaves the invariant stated as a rule everyone has to remember at every future line rather than a
question already answered, and it cannot protect the CLI: `riff doctor` would still take `latest`.

**Keep the plugin for forwarding, and only detect early.** Riff's callback ignores `argv` and `cwd`
entirely — it unminimizes and focuses `main`, nothing more. Forwarding is not a feature Riff uses.
Worse, a process that exits at step 4 never reaches `.build()`, so the plugin's DBus call never
happens and the running window is never focused: keeping the plugin means the second process must
run to `.build()`, which is exactly what we are moving away from. Two mechanisms that can disagree —
the plugin does nothing when there is no session bus, and would then let a second full instance
boot — is worse than one that cannot.

**A pid file, or `flock` on a lock file.** Both are files. A pid file needs staleness handling and
`/proc` probing (`riff repair` already has that code, and it is best-effort by construction). A lock
file needs cleanup on kill -9. The abstract socket has neither problem and doubles as the channel
that focuses the running window.

## Consequences

- `tauri-plugin-single-instance` is gone from `Cargo.toml`. One fewer dependency in the licence
  bundle and in `cargo deny`'s scope.
- Riff is now single-instance on Linux only, by construction — abstract sockets are a Linux
  extension. Riff is Linux only.
- Two Riffs with different `RIFF_CONFIG_HOME` values run side by side, deliberately. Previously the
  DBus name was derived from the bundle identifier, so a scratch run and the real application were
  the same instance and the scratch one silently focused the real window instead of starting.
- `logging::start_session` now runs *after* `cli::dispatch`, so CLI subcommands have no tracing
  subscriber and no session directory of their own. Nothing in `cli.rs` logs — it prints, because
  its output is for the person who typed it — and a CLI panic reaches stderr, where they are
  already looking.

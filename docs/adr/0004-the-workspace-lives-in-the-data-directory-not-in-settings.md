# The workspace lives in the data directory, not in settings

**Status:** accepted (2026-08-30)

`practice.poppedOut` lives in `settings.json`, so the obvious home for "which score is open, and
at which page" is the section beside it. It is not there. The workspace lives in
`$XDG_DATA_HOME/riff/workspace.json`.

Three reasons, in ascending order of how much they would have cost to discover later:

1. `settings.json` is documented as hand-editable configuration and is described by a generated
   `settings.schema.json`. An absolute path that rewrites itself every time a file is opened is
   not configuration, and publishing it in the schema says that it is.
2. Every score opened would be a settings write, which `settings/watcher.rs` then has to filter
   out by last-written bytes. More traffic through the one path whose whole job is telling Riff's
   own writes apart from the user's.
3. **`diagnostics::current_bundle` includes `settings.json` verbatim**, redacting only `$HOME` and
   the account name. A score path there would put the user's filenames in every exported
   diagnostic bundle — `$HOME/Music/…` still names the piece. `workspace.json` is not in the
   bundle, and this is the reason, not a coincidence.

## Consequences

- **The workspace does not get the settings treatment.** Atomic write yes; quarantine no, watcher
  no. Invariant 1 protects a file the user authored. This one holds derived state, so a parse
  failure is discarded and logged rather than renamed aside — quarantining it would leave litter
  the user never wrote and would never think to delete.
- `settings_reset` and `settings_import` do **not** close the open score. They reconcile windows
  through `practice::sync_windows` because the popped-out set is settings; the workspace is not.
- Rust holds the workspace in memory and the file is a durability detail, the same asymmetry
  `SettingsStore` already has. A pane popping out reads the in-memory value through a command, so
  it can never see a page number the flush scheduler has not written yet.
- The file is `workspace.json`, not `session.json`. "Session" already means a log session
  (`logs/<timestamp>-<pid>/`, `prune_sessions`) and a practice session (one line of
  `history.jsonl`). A third meaning, in the same data directory as the second, would be
  indefensible.
- Logging obeys the same reasoning as point 3: `riff.log` **is** in the diagnostics bundle, so a
  score is logged by basename and byte count and never by directory.

# AGENTS.md

Riff keeps its agent instructions in one place: **[`CLAUDE.md`](./CLAUDE.md)**.

Read that file before touching the codebase. It covers the boot sequence, the
IPC seam, how settings flow end to end, the theming and layout rules, and the
invariants that must never break — plus the gate commands CI runs.

This file exists only so agents that look for `AGENTS.md` find their way there;
it is a pointer, not a second copy. Anything worth telling an agent belongs in
`CLAUDE.md`, so the two can never drift.

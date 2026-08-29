# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Riff is **single-context**: one `CONTEXT.md` at the repo root, one `docs/adr/`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`**: read the ADRs that touch the area you're about to work in

If either doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved. Riff has `docs/adr/` and no `CONTEXT.md` yet; that is the expected state, not a gap to fill on sight.

`CLAUDE.md` is not one of these. It is the repo map every agent already reads, and it points at `docs/superpowers/specs/` for the design of record. Domain docs sit alongside it; they do not replace it.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   └── 0001-pop-out-windows-are-created-in-rust.md
└── src/
```

If Riff ever splits into separate contexts, the layout changes to a root `CONTEXT-MAP.md` pointing at one `CONTEXT.md` per context, each with its own `src/<context>/docs/adr/` for context-scoped decisions. Re-run `/setup-matt-pocock-skills` to switch.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (pop-out windows are created in Rust), but worth reopening because…_

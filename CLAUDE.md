# Riff

A local-first practice workspace for musicians. Tauri 2 + React 19, Linux only. No accounts, no telemetry, no network — this is a product promise, not a slogan; see §17 below.

The spec is the source of truth: `docs/superpowers/specs/2026-08-28-riff-foundation-design.md`. Read the relevant section there before making an architectural decision — this file is a map, not a duplicate.

## Status

The application foundation (onboarding, theming, navigation, keyboard palette, settings, diagnostics, packaging) is done. Practice and History are visual placeholders; PDF, video and audio playback are not implemented yet (spec §15).

## Invariants that must never break

From the settings store (spec §4, plan 03):

1. A file Riff failed to parse is never overwritten — it is renamed aside and kept.
2. A failed write never discards in-memory state and never crashes.
3. Loading settings cannot fail. The worst outcome is defaults plus a warning.
4. Keys Riff does not recognise survive a read-modify-write cycle.

From security (spec §12):

5. No caller-supplied path or URL crosses IPC. `open_path`/`open_external` take enums, never strings — nothing a compromised webview sends can name a file it shouldn't.
6. The webview holds exactly one capability, `core:default`. No `fs`, no `shell`, no `http`.
7. Zero network at runtime. Nothing in the shipped application performs an HTTP request; the CSP's `connect-src` admits only the IPC origins.

## Gate commands

```bash
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo deny check
```

Run all of these, plus `pnpm licenses:generate` (fails if `third-party-licenses.json` drifts) before any commit that touches dependencies or the CLI shape.

## Repository policy

No external code contributions — bug reports are welcome, pull requests are declined (see `.github/PULL_REQUEST_TEMPLATE.md`). Commits are Conventional Commits, one logical change per commit.

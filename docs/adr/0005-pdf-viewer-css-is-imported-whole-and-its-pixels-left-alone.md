# `pdf_viewer.css` is imported whole, and its pixel values are left alone

**Status:** accepted (2026-08-30)

Riff's layout rule is that every dimension is in `rem`, because
`html { font-size: calc(16px * var(--ui-scale)) }` is the entire implementation of UI scaling and
a single `px` value freezes that piece of chrome while the text inside it grows. The score viewer
imports `pdfjs-dist/web/pdf_viewer.css` — 163 KB containing 74 instances of `2px`, 73 of `4px` and
66 of `16px` — and converts none of them.

**Most of those pixel values are correct, and converting them would break text selection.** The
text layer is a grid of absolutely-positioned transparent spans that has to align to the canvas
raster exactly, or selection, search highlighting and copied text all land in the wrong place. It
is sized from `--scale-factor`, which is a device-pixel quantity. A page canvas *is* a raster and
is supposed to be measured in device pixels. Rewriting those in `rem` makes the text layer drift
away from the image the moment UI scale leaves 1.0 — and **the Vitest suite cannot see it**,
because jsdom has no layout engine.

What is genuinely chrome — the gap between pages, the page border, the spread gutter, the shadow,
and everything outside the viewer — does obey Riff's rule, in a Riff-owned layer on top.

## Considered and rejected

**Forking the stylesheet down to the roughly ten per cent Riff uses.** It would drop about 25 KB
gzipped from a route chunk that no gate measures, in exchange for owning a file upstream keeps
fixing, and for re-deriving which values were raster alignment on every merge.

## Consequences

- A reader applying the `rem` rule mechanically to this one file will break text selection at every
  UI scale except 1.0, and every gate will stay green while they do it. That is the reason this
  ADR exists.
- The Riff override layer is the only place viewer dimensions may be changed. Editing the imported
  file is not an option, and neither is patching it.
- The viewer stylesheet is scoped to the viewer's container so its resets cannot reach Riff's own
  chrome.

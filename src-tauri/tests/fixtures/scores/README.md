# Score fixtures

Six PDFs, each the smallest file that exercises one path in the score viewer. None is a real
score — plan 15's Task 1 needs shapes, not sheet music — and every byte here is either generated
by a local tool from Riff-authored text or produced by this repository's own scripts. Nothing was
downloaded, so there is nothing to attribute beyond how it was made.

| File | What it exercises | Made with |
|---|---|---|
| `engraved.pdf` | The ordinary path: two pages, a text layer, an embedded, subsetted TrueType font (`pdffonts` confirms `emb yes`). | `soffice --headless --convert-to pdf` from a plain-text source, a form feed forcing the page break. |
| `scanned.pdf` | A score with no text layer — search and the accessible-text path both fall back on this. | `convert` (ImageMagick) rasterises a generated PNG straight into a PDF page; no font is embedded because no text operator is ever emitted. |
| `encrypted.pdf` | `ScoreEncrypted`. Requires the password `riffpractice` to open at all. | `qpdf --encrypt riffpractice riffpractice 256` over `engraved.pdf`. |
| `truncated.pdf` | `ScoreUnreadable` via a mid-object cut, not a clean EOF. | The first 60% of `engraved.pdf`'s bytes, sliced with Python — well past the header, short of `%%EOF`. |
| `not-a-pdf.pdf` | `ScoreUnreadable` via a file that fails at the very first byte. | Plain ASCII text, saved with a `.pdf` extension. |
| `external-link.pdf` | The `externalLinkEnabled` test: a `/Link` annotation whose `/A` is a `/URI` action pointing at `https://example.invalid/riff-fixture`. | Hand-written PDF object stream (no embedding tool adds real link annotations without also pulling in a document model), verified with `qpdf --check` and `pdftotext`. |

All six pass `qpdf --check` (or, for `not-a-pdf.pdf` and `truncated.pdf`, are confirmed to fail
exactly the way their name says). Total size is under 60 KB — these are parsed by tests, not read
by anyone, and a two-page excerpt proves everything a 200-page score would.

Regenerating any of them only needs tools already on a Riff dev machine: LibreOffice, ImageMagick,
`qpdf`, and Python's standard library. No fixture here required network access.

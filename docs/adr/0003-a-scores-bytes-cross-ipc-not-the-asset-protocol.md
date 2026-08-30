# A score's bytes cross IPC; the asset protocol stays unbuilt

**Status:** accepted (2026-08-30)

Spec §15 records that media files reach the webview through `convertFileSrc()` and Tauri's asset
protocol. The score viewer does not do that. Rust reads the file and returns its bytes as
`tauri::ipc::Response`, and pdf.js takes them as `getDocument({ data })`, which skips network
stream creation entirely and transfers the buffer to the worker.

§15's argument for the asset protocol is about size and nothing else — "a four-gigabyte video
never enters JavaScript memory". A score is one to twenty megabytes, so the argument does not
transfer, but the cost does: `assetProtocol.enable` in `tauri.conf.json`, `connect-src` admitting
`asset:`, a real filesystem path handed to the webview, and an `allow_file` grant per opened score
living for the rest of the process. Bytes over IPC cost none of that, and
`InvokeResponseBody::Raw` carries them without a base64 tax.

## Considered and rejected

**The asset protocol, as §15 records it.** Rejected above. It remains the right answer for video
and audio, where the file genuinely cannot be resident and range requests are what make seeking
instant. This ADR narrows §15 to the media it was reasoning about; it does not overturn it.

**Rasterising in Rust with poppler or pdfium**, handing the webview images. It keeps the CSP
exactly where it is and never puts a whole score in JavaScript memory. Rejected because it adds a
native PDF library to the `depends:` list of two hand-built distribution artifacts, adds a licence
class to review, and trades a bounded CSP amendment for hand-writing text search, text selection
and internal links — the three things pdf.js gives away.

## Consequences

- Invariants 5, 6 and 7 stay **literally** true, not true-with-an-asterisk. The webview never
  learns a filesystem path, holds no new capability, and `connect-src` does not move.
- The bytes arrive as a real `ArrayBuffer`. Tauri's IPC posts to `ipc://` with `fetch` and decodes
  the reply by content type — `application/json` through `.json()`, everything else through
  `.arrayBuffer()`. Verified against `tauri-2.11.5/scripts/ipc-protocol.js` rather than assumed,
  because the alternative (an array of numbers) would have been a tenfold memory cost and would
  have changed this decision.
- **`score_bytes` is the one command `ipc_shapes.rs` cannot guard.** That fixture serialises serde
  values, and `tauri::ipc::Response` has none. The metadata types are covered normally and a Rust
  test asserts the command answers with raw bytes rather than JSON, because that is the property
  the fixture would otherwise have held.
- The whole file is resident while a score is open. No size limit is imposed: a 600 MB scan is
  slow rather than refused, because any threshold would be wrong for somebody's archive.
- Popping the Score pane out re-reads the file from disk rather than reusing a cached copy in
  Rust. One copy in memory instead of two, and a score deleted while open then fails honestly
  instead of succeeding from a stale cache.
- **The CSP still moves, for an unrelated reason.** pdf.js installs the fonts embedded in a PDF as
  `@font-face` rules with `data:` URLs, so `font-src` must admit `data:`, and `img-src` must admit
  `blob:`. `csp` and `devCsp` must be changed **together**: `devCsp` already allows `font-src
  data:` and production does not, so embedded fonts would render correctly under `pnpm app` and
  fall back to the wrong glyphs in a packaged build — a bug that only exists in shipped artifacts.
- Because `connect-src` does not move, pdf.js is given no `cMapUrl` and no `standardFontDataUrl`,
  and runs with `useWorkerFetch: false` and `useWasm: false`. CJK scores and PDFs relying on
  non-embedded standard fonts render with substituted glyphs. If that has to be fixed, it is fixed
  by serving those files through a Riff command — auditable in `riff_handlers!` — and **not** by
  adding `'self'` to `connect-src`. A command is reviewable; a CSP token is not.

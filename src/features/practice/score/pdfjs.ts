/**
 * The only module that imports `pdfjs-dist`. Everything else in `score/`
 * comes through here, so a static import cannot escape the practice and
 * pop-out routes and land 131.5 KB gzipped in the entry chunk — see the
 * "pdfjs-dist is imported only from..." constraint in plan 15.
 */
// The bare specifier, not a `/build/pdf.mjs` subpath: `pdfjs-dist` ships no
// `.d.ts` beside that file, only beside the package root (`main`) and beside
// `web/pdf_viewer.mjs`. TypeScript's bundler resolution reads `main` and
// `types` from `package.json` for the bare specifier, so this is the one
// import path that is both the real runtime module and properly typed.
import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  InvalidPDFException,
  PasswordException,
  PDFWorker,
} from "pdfjs-dist";
// Vite copies this verbatim rather than transpiling it: `build.target:
// "safari16"` does not reach an asset pulled in with `?url`. That is also why
// ADR 0003 and Task 2 Step 8 need a real WebKitGTK floor in `depends` — an
// older runtime gets the actual worker file, unmodified.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
  SpreadMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";

export type { PDFWorker };
export {
  AnnotationMode,
  EventBus,
  getDocument,
  InvalidPDFException,
  PasswordException,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
  SpreadMode,
};

// Same-origin, so `worker-src` falls back through `script-src 'self'` and
// needs no CSP rule of its own.
GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Fixed in one place so every `getDocument` call agrees. `useWorkerFetch` and
 * `useWasm` off, and no `cMapUrl` or `standardFontDataUrl`, are what keep
 * `connect-src` from needing to move — see ADR 0003. If a CJK score ever
 * needs the predefined CMaps this omits, the fix is a Riff command that
 * copies them out of `pdfjs-dist` at build time, not a new CSP origin.
 */
export const SCORE_DOCUMENT_OPTIONS = {
  useWorkerFetch: false,
  useWasm: false,
  cMapUrl: undefined,
  standardFontDataUrl: undefined,
} as const;

/** Thrown by {@link ensureWorker} when the runtime cannot run a real worker. */
export class WorkerUnavailableError extends Error {
  constructor() {
    super("pdf.js could not start a module worker");
    this.name = "WorkerUnavailableError";
  }
}

let workerSequence = 0;

/**
 * Starts one real module worker for a score-viewer attempt.
 *
 * pdf.js's own fallback for a worker that fails to start — for any reason,
 * including a WebKitGTK too old to run `new Worker(url, { type: "module" })`
 * — is a "fake worker" that parses on the main thread with no error raised
 * anywhere. That turns a clean, reportable failure into a frozen pane with no
 * diagnostic, which is the one outcome that must not ship. `PDFWorker.port`
 * is the real `Worker` instance once started for real, and pdf.js's internal
 * `LoopbackPort` (not exported, and not worth importing privately) otherwise
 * — so `instanceof Worker` is the public way to tell which one happened.
 *
 * The caller passes this exact worker to `getDocument` and destroys it when
 * the attempt ends. Starting a probe and then creating a second worker can
 * leave WebKitGTK waiting on the second startup with no page ever rendered.
 */
export async function ensureWorker(): Promise<PDFWorker> {
  workerSequence += 1;
  const worker = PDFWorker.create({ name: `riff-score-${workerSequence}` });
  try {
    await worker.promise;
    if (typeof Worker === "undefined" || !(worker.port instanceof Worker)) {
      throw new WorkerUnavailableError();
    }
    return worker;
  } catch (error) {
    worker.destroy();
    throw error;
  }
}

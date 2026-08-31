import "pdfjs-dist/web/pdf_viewer.css";
import "./score.css";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fire, ipc, type OpenScore, type View } from "@/lib/ipc";
import { useScoreDim } from "@/stores/settings";
import {
  clampPage,
  PDFJS_SCROLL_MODE,
  PDFJS_SPREAD_MODE,
  scaleValue,
  steppedScale,
} from "./geometry";
import {
  AnnotationMode,
  EventBus,
  ensureWorker,
  getDocument,
  InvalidPDFException,
  PasswordException,
  PDFLinkService,
  PDFViewer,
  SCORE_DOCUMENT_OPTIONS,
  WorkerUnavailableError,
} from "./pdfjs";
import { ScoreToolbar } from "./ScoreToolbar";
import { scoreErrorMessage } from "./scoreError";
import { MIN_WEBKITGTK } from "./webkitVersion";

interface PageRenderedEvent {
  source: { canvas?: HTMLCanvasElement };
}

/**
 * Puts a whole `View` onto a `PDFViewer`. One function, used both when the
 * pages first exist and on every later change, so there is no second path
 * that could apply four of the five values.
 *
 * Scale last: `pagesRotation` and `spreadMode` both re-lay-out the pages,
 * and pdf.js re-applies `_currentScaleValue` itself afterwards — but only if
 * one has been set. Setting it first and letting the others follow is what
 * keeps a rotated score still fitted to the pane.
 */
function applyViewToViewer(viewer: InstanceType<typeof PDFViewer>, view: View) {
  viewer.pagesRotation = view.rotation;
  viewer.spreadMode = PDFJS_SPREAD_MODE[view.spread];
  viewer.scrollMode = PDFJS_SCROLL_MODE[view.scrollMode];
  // Stringified because that is what the setter stores anyway
  // (`newValue.toString()`) and what its `parseFloat` reads back — a number
  // reaches the same branch, but only the string is type-honest.
  viewer.currentScaleValue = String(scaleValue(view.scale));
}

/**
 * The `PDFViewer` instance for one open score. Mounts on an effect keyed on
 * the score's identity, so opening a second score tears the first down
 * rather than layering on top of it — the same mechanism that fixes
 * `React.StrictMode`'s double effect, per the design spec §4: without it the
 * second mount leaves two workers alive and a race in which the first
 * document's pages render into the second viewer's DOM.
 */
export function ScoreViewer({
  open,
  onLoadError,
}: {
  open: OpenScore;
  onLoadError: (message: string) => void;
}) {
  const { t } = useTranslation(["common", "errors"]);
  // A primitive selector, not `useAppearance()`: `adopt` replaces `settings`
  // wholesale, so an object selector would re-render the viewer on every
  // unrelated preference change.
  const dim = useScoreDim();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  // The live `PDFViewer`, reachable outside the effect that builds it so the
  // toolbar can drive it. Not state: replacing it does not re-render
  // anything, and putting it in state would rebuild the viewer on every
  // page turn.
  const pdfViewerRef = useRef<InstanceType<typeof PDFViewer> | null>(null);
  const [ready, setReady] = useState(false);
  const [hasText, setHasText] = useState(true);
  const [page, setPage] = useState(open.view.page);
  const [pageCount, setPageCount] = useState(0);
  const [view, setView] = useState<View>(open.view);
  // The callback is fresh every render; the effect below must not be, or
  // every render would tear the viewer down and rebuild it.
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on open.score identity only, by design — see the comment above the dependency array
  useEffect(() => {
    const container = containerRef.current;
    const viewerEl = viewerRef.current;
    if (!container || !viewerEl) return;

    setReady(false);
    setHasText(true);
    let cancelled = false;
    // `PDFViewer` accepts an `abortSignal` option that disconnects its own
    // internal `ResizeObserver` and scroll listener on `abort()` — the
    // documented teardown path, not one improvised here.
    const abortController = new AbortController();
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    // A public field, not a constructor option: `PDFLinkService`'s
    // constructor destructures only `eventBus`, `externalLinkTarget`,
    // `externalLinkRel` and `ignoreDestinationZoom`, so passing
    // `externalLinkEnabled` there is silently ignored and the default
    // `true` stands. Verified against pdf.js source, not assumed.
    linkService.externalLinkEnabled = false;

    // `abortSignal` and `enableScripting` are real, used options — verified
    // by reading the constructor in pdf.js source — but both are missing
    // from `pdfjs-dist`'s shipped (JSDoc-generated) `.d.ts`. Built through a
    // variable rather than an inline object literal so TypeScript checks
    // structural compatibility instead of excess-property literal checking,
    // which would otherwise reject options the runtime genuinely reads.
    const viewerOptions = {
      container,
      viewer: viewerEl,
      eventBus,
      linkService,
      abortSignal: abortController.signal,
      // Defaults to `ENABLE_FORMS`; left alone, a score gets interactive
      // form fields rather than merely rendering them.
      annotationMode: AnnotationMode.ENABLE,
      // Already the default. Set anyway: a default is not a guarantee, and
      // CSP does not govern top-level navigation a script could attempt.
      enableScripting: false,
    };
    const viewer = new PDFViewer(viewerOptions);
    pdfViewerRef.current = viewer;
    linkService.setViewer(viewer);

    // The score can move without the toolbar: a chord, a pedal, a search
    // hit, a click on an internal link. `pagechanging` is the one place all
    // of those converge, which is why the indicator follows it rather than
    // being set wherever a page turn is requested.
    function onPageChanging(event: { pageNumber: number }) {
      setPage(event.pageNumber);
    }
    eventBus.on("pagechanging", onPageChanging);

    function onPageRendered(event: PageRenderedEvent) {
      // The text layer is the accessible content (spec §10); the canvas is
      // a raster of the same page and would otherwise be presented as a
      // second, unlabelled region.
      event.source.canvas?.setAttribute("aria-hidden", "true");
    }
    eventBus.on("pagerendered", onPageRendered);

    // `pagesinit` fires from inside `setDocument` once the page views exist,
    // which is the earliest point a fit mode can be resolved — the fit-width
    // maths needs the first page's width. This is the same seam pdf.js's own
    // reference viewer uses, and without it the viewer stays at
    // `UNKNOWN_SCALE` and renders every page at 100%: see `geometry.ts`.
    function onPagesInit() {
      applyViewToViewer(viewer, open.view);
    }
    eventBus.on("pagesinit", onPagesInit);

    let loadingTask: ReturnType<typeof getDocument> | null = null;

    void (async () => {
      try {
        // Confirms a real module worker actually starts, once per session —
        // see `pdfjs.ts`. A worker that silently falls back to pdf.js's
        // main-thread "fake worker" is a frozen pane with no diagnostic,
        // which is the one outcome this must not allow through.
        await ensureWorker();
        const bytes = await ipc.scoreBytes();
        if (cancelled) return;
        loadingTask = getDocument({
          data: new Uint8Array(bytes),
          ...SCORE_DOCUMENT_OPTIONS,
        });
        const pdfDocument = await loadingTask.promise;
        // No `pdfDocument.destroy()` here: only `PDFDocumentLoadingTask` has
        // one. It tears down an already-resolved document's transport just
        // as well as an in-flight one, and the effect's own cleanup below
        // has already called it on `loadingTask` by the time this resolves.
        if (cancelled) return;
        viewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument, null);
        // From the document rather than the `pagesloaded` event, which does
        // not fire until every page has been fetched — a 300-page score
        // would show "of 0" until then.
        setPageCount(pdfDocument.numPages);
        setReady(true);

        const firstPage = await pdfDocument.getPage(1);
        if (cancelled) return;
        const content = await firstPage.getTextContent();
        if (!cancelled) setHasText(content.items.length > 0);
      } catch (error) {
        if (cancelled) return;
        onLoadErrorRef.current(await describeLoadError(error, t));
      }
    })();

    const resizeObserver = new ResizeObserver(() => {
      // pdf.js's own internal ResizeObserver only tracks the container's
      // height for scroll math; it never reapplies a fit-mode scale, on any
      // resize. Sidebar collapse, density, UI scale and popping the pane
      // out all change this container's width with no window resize at
      // all, so the fit mode has to be reapplied by hand. Re-assigning
      // through a local rather than `viewer.currentScaleValue =
      // viewer.currentScaleValue` — the setter has a real side effect
      // (`#setScale`, recomputed against the container's new width), which
      // a literal self-assignment would read as a no-op and strip.
      const scale = viewer.currentScaleValue;
      if (viewer.pdfDocument && scale) {
        viewer.currentScaleValue = scale;
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      eventBus.off("pagerendered", onPageRendered);
      eventBus.off("pagesinit", onPagesInit);
      eventBus.off("pagechanging", onPageChanging);
      pdfViewerRef.current = null;
      abortController.abort();
      void loadingTask?.destroy();
    };
    // `open.score` (name and size) is the only identity `Score` carries —
    // see `workspace::Score` in Rust — and is exactly what should retrigger
    // this effect: a new score, not a changed `t` or callback identity.
  }, [open.score.name, open.score.size]);

  function goToPage(next: number) {
    const viewer = pdfViewerRef.current;
    if (!viewer) return;
    viewer.currentPageNumber = clampPage(next, pageCount, page);
  }

  /**
   * Applies a view change to pdf.js and records it, in that order.
   *
   * No throttle: `score_view_patch` is deliberately un-throttled and only
   * the *disk* write is coalesced, in Rust. Page is not written here — it
   * moves far more often than these do, and writing it before Task 11's
   * restore exists would overwrite the very page a reopen is meant to
   * return to.
   */
  function changeView(patch: Partial<View>) {
    const next = { ...view, ...patch };
    setView(next);
    const viewer = pdfViewerRef.current;
    if (viewer) applyViewToViewer(viewer, next);
    fire(ipc.scoreViewPatch(next), "saving the view");
  }

  /**
   * Zoom steps from the scale pdf.js actually resolved, not from the stored
   * one — in a fit mode the stored value is a keyword, and "one step in from
   * fit width" only means anything against the number that fit width came
   * out as in this pane.
   */
  function zoom(direction: 1 | -1) {
    const viewer = pdfViewerRef.current;
    if (!viewer) return;
    changeView({ scale: steppedScale(viewer.currentScale, direction) });
  }

  return (
    <>
      {/* Beneath the pane header, which is left exactly as it is — twelve
          controls do not go beside `⧉` and `×`. */}
      {ready && (
        <ScoreToolbar
          page={page}
          pageCount={pageCount}
          view={view}
          onGoToPage={goToPage}
          onViewChange={changeView}
          onZoom={zoom}
        />
      )}
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className="riff-score-viewer absolute inset-0 overflow-auto"
          // Dim is a brightness reduction on the rendered page, applied by
          // `score.css` to `canvas` rather than `.page` so search highlights
          // stay at full strength while the page behind them darkens. It
          // costs no re-render: changing this while reading is a repaint,
          // where pdf.js's own `pageColors` would re-render every visible
          // page — and would invert to light-on-dark, which is a different
          // feature Riff does not have.
          data-dimmed={dim > 0}
          style={
            dim > 0 ? ({ "--score-dim-brightness": 1 - dim } as React.CSSProperties) : undefined
          }
        >
          <div ref={viewerRef} className="pdfViewer" />
        </div>
        {!ready && (
          <div className="absolute inset-0 grid place-items-center bg-card">
            <div className="flex flex-col items-center gap-2 text-[0.8125rem] text-muted-foreground">
              {/* No progress bar: with `data:` there is no streaming, the IPC
                transfer reports nothing, and parsing is not instrumented —
                an honest percentage does not exist here. */}
              <span
                aria-hidden
                className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              <span>{t("common:score.loading", { name: open.score.name })}</span>
            </div>
          </div>
        )}
        {ready && !hasText && (
          <p
            role="status"
            className="absolute inset-x-0 bottom-0 bg-card/90 px-3 py-1.5 text-center text-[0.75rem] text-muted-foreground"
          >
            {t("common:score.noText")}
          </p>
        )}
      </div>
      {/* The same pattern the route announcer uses in `__root.tsx`: a page
          turn is silent to a screen reader otherwise, and the indicator that
          shows it is a number nobody is looking at. */}
      <div aria-live="polite" className="sr-only">
        {ready && pageCount > 0
          ? t("common:score.pageAnnouncement", { page, total: pageCount })
          : ""}
      </div>
    </>
  );
}

/** Localises whatever stopped the score from opening, whoever raised it. */
async function describeLoadError(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): Promise<string> {
  if (error instanceof WorkerUnavailableError) {
    const webkitVersion = await ipc
      .appInfo()
      .then((info) => info.webkitVersion)
      .catch(() => "unknown");
    return t("common:score.workerUnavailable", { webkitVersion, minimum: MIN_WEBKITGTK });
  }
  // pdf.js's own exceptions, for the rare case Rust's lightweight heuristic
  // in `read_and_validate` lets an encrypted or malformed file through.
  if (error instanceof PasswordException) {
    return t("errors:code.score-encrypted");
  }
  if (error instanceof InvalidPDFException) {
    return t("errors:code.score-unreadable");
  }
  return scoreErrorMessage(error, t);
}

import "pdfjs-dist/web/pdf_viewer.css";
import "./score.css";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fire, ipc, type OpenScore, type View } from "@/lib/ipc";
import { useScoreDim } from "@/stores/settings";
import { onScoreCommand } from "./commands";
import {
  clampPage,
  clampSpeed,
  NO_SEARCH,
  nextFit,
  nextRotation,
  nextScrollMode,
  nextSpread,
  PDFJS_SCROLL_MODE,
  PDFJS_SPREAD_MODE,
  type SearchStatus,
  SPEED_STEP,
  scaleValue,
  searchStateFrom,
  steppedScale,
} from "./geometry";
import {
  AnnotationMode,
  EventBus,
  ensureWorker,
  getDocument,
  InvalidPDFException,
  PasswordException,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  SCORE_DOCUMENT_OPTIONS,
  WorkerUnavailableError,
} from "./pdfjs";
import { ScoreSearch } from "./ScoreSearch";
import { ScoreToolbar } from "./ScoreToolbar";
import { scoreErrorMessage } from "./scoreError";
import { useAutoScroll } from "./useAutoScroll";
import { MIN_WEBKITGTK } from "./webkitVersion";

interface PageRenderedEvent {
  pageNumber: number;
  source: { canvas?: HTMLCanvasElement };
  error?: unknown;
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
function applyViewToViewer(
  viewer: InstanceType<typeof PDFViewer>,
  view: View,
  { page = false }: { page?: boolean } = {},
) {
  viewer.pagesRotation = view.rotation;
  viewer.spreadMode = PDFJS_SPREAD_MODE[view.spread];
  viewer.scrollMode = PDFJS_SCROLL_MODE[view.scrollMode];
  // Stringified because that is what the setter stores anyway
  // (`newValue.toString()`) and what its `parseFloat` reads back — a number
  // reaches the same branch, but only the string is type-honest.
  viewer.currentScaleValue = String(scaleValue(view.scale));
  // Only on a restore. A change to spread or zoom must not yank the reader
  // back to a page they have since scrolled away from.
  if (page) {
    viewer.currentPageNumber = clampPage(view.page, viewer.pagesCount, view.page);
  }
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
  onFirstPagePaint,
}: {
  open: OpenScore;
  onLoadError: (message: string) => void;
  onFirstPagePaint?: () => void;
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
  const findControllerRef = useRef<InstanceType<typeof PDFFindController> | null>(null);
  const eventBusRef = useRef<InstanceType<typeof EventBus> | null>(null);
  const [ready, setReady] = useState(false);
  const [hasText, setHasText] = useState(true);
  const [page, setPage] = useState(open.view.page);
  const [pageCount, setPageCount] = useState(0);
  const [view, setView] = useState<View>(open.view);
  // Neither of these is in the view, and spec §6.4 is explicit about why:
  // a score that began scrolling the moment it reopened would be alarming
  // rather than helpful, and a pin is something you do to practise this
  // passage now, not a property of the score. Both start off, every time.
  const [scrolling, setScrolling] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState<SearchStatus>(NO_SEARCH);
  // The callback is fresh every render; the effect below must not be, or
  // every render would tear the viewer down and rebuild it.
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;
  const onFirstPagePaintRef = useRef(onFirstPagePaint);
  onFirstPagePaintRef.current = onFirstPagePaint;
  // The latest view, for the event handlers the effect creates once.
  const viewRef = useRef(view);
  viewRef.current = view;
  /**
   * Set while Riff is driving the viewer, so the events that driving
   * produces are not mistaken for the user doing something.
   *
   * Restoring a view is the case that needs it: setting `currentPageNumber`
   * makes `PDFViewer` dispatch `pagechanging` synchronously, and the handler
   * listening for it is the one that records the page — so a restore would
   * write straight back what it had just read. `settings/watcher.rs` solves
   * the same problem the same way, by filtering out its own last write.
   */
  const applying = useRef(false);
  const recordView = useRef<(next: View) => void>(() => {});

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
    eventBusRef.current = eventBus;
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
    // The text layer needs no configuration for matches to land in:
    // `textLayerMode` already defaults to `TextLayerMode.ENABLE`, so the
    // only way to break search is to turn it off.
    const findController = new PDFFindController({ linkService, eventBus });
    findControllerRef.current = findController;
    const viewer = new PDFViewer({ ...viewerOptions, findController });
    pdfViewerRef.current = viewer;
    linkService.setViewer(viewer);
    let restoredPage = open.view.page;
    let firstPagePainted = false;

    function onFindState(event: {
      state: number;
      matchesCount?: { current: number; total: number };
    }) {
      setSearch((current) => ({
        ...current,
        state: searchStateFrom(event.state),
        current: event.matchesCount?.current ?? 0,
        total: event.matchesCount?.total ?? 0,
      }));
    }
    eventBus.on("updatefindcontrolstate", onFindState);
    // Fired on its own as pages are scanned, so a long score's count climbs
    // rather than sitting at the first page's total until it finishes.
    function onFindMatchesCount(event: { matchesCount?: { current: number; total: number } }) {
      setSearch((current) => ({
        ...current,
        current: event.matchesCount?.current ?? current.current,
        total: event.matchesCount?.total ?? current.total,
      }));
    }
    eventBus.on("updatefindmatchescount", onFindMatchesCount);

    // The score can move without the toolbar: a chord, a pedal, a search
    // hit, a click on an internal link. `pagechanging` is the one place all
    // of those converge, which is why the indicator follows it rather than
    // being set wherever a page turn is requested.
    function onPageChanging(event: { pageNumber: number }) {
      setPage(event.pageNumber);
      // Riff's own restore echoing back, not a page the reader turned to.
      if (applying.current) return;
      recordView.current({ ...viewRef.current, page: event.pageNumber });
    }
    eventBus.on("pagechanging", onPageChanging);

    function onPageRendered(event: PageRenderedEvent) {
      // The text layer is the accessible content (spec §10); the canvas is
      // a raster of the same page and would otherwise be presented as a
      // second, unlabelled region.
      event.source.canvas?.setAttribute("aria-hidden", "true");
      // `setDocument` can schedule work for several pages at once. The
      // surface is ready only once the page the reader restored to is on
      // screen; a page rendered in the background must not hide its
      // slow-loading watchdog.
      if (!firstPagePainted && !event.error && event.pageNumber === restoredPage) {
        firstPagePainted = true;
        onFirstPagePaintRef.current?.();
      }
    }
    eventBus.on("pagerendered", onPageRendered);

    // `pagesinit` fires from inside `setDocument` once the page views exist,
    // which is the earliest point a fit mode can be resolved — the fit-width
    // maths needs the first page's width. This is the same seam pdf.js's own
    // reference viewer uses, and without it the viewer stays at
    // `UNKNOWN_SCALE` and renders every page at 100%: see `geometry.ts`.
    function onPagesInit() {
      // The whole view, page included: this is the arriving window of a
      // pop-out or a dock-back, and everything spec §6.4 lists has to come
      // back with it. Scroll position *within* the page deliberately does
      // not — it was never recorded, because a pixel offset means nothing
      // once the pane has changed width or the scale has changed.
      applying.current = true;
      try {
        applyViewToViewer(viewer, open.view, { page: true });
        restoredPage = viewer.currentPageNumber;
      } finally {
        applying.current = false;
      }
    }
    eventBus.on("pagesinit", onPagesInit);

    let loadingTask: ReturnType<typeof getDocument> | null = null;
    let worker: Awaited<ReturnType<typeof ensureWorker>> | null = null;

    void (async () => {
      try {
        // Confirms a real module worker actually starts, once per session —
        // see `pdfjs.ts`. A worker that silently falls back to pdf.js's
        // main-thread "fake worker" is a frozen pane with no diagnostic,
        // which is the one outcome this must not allow through.
        worker = await ensureWorker();
        if (cancelled) {
          worker.destroy();
          worker = null;
          return;
        }
        const bytes = await ipc.scoreBytes(open.generation);
        if (cancelled) return;
        loadingTask = getDocument({
          data: new Uint8Array(bytes),
          worker,
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
        findController.setDocument(pdfDocument);
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
      eventBus.off("updatefindcontrolstate", onFindState);
      eventBus.off("updatefindmatchescount", onFindMatchesCount);
      pdfViewerRef.current = null;
      findControllerRef.current = null;
      eventBusRef.current = null;
      abortController.abort();
      if (loadingTask) void Promise.resolve(loadingTask.destroy()).finally(() => worker?.destroy());
      else worker?.destroy();
    };
    // `open.score` (name and size) is the only identity `Score` carries —
    // see `workspace::Score` in Rust — and is exactly what should retrigger
    // this effect: a new score, not a changed `t` or callback identity.
  }, [open.score.name, open.score.size]);

  // Chords and palette commands arrive here rather than through the store,
  // so the view stays local to the component driving pdf.js. Only the
  // window hosting the Score pane has a viewer mounted, so a chord pressed
  // in the other window simply finds no listener.
  useEffect(() =>
    onScoreCommand((command) => {
      switch (command.kind) {
        case "page":
          return goToPage(page + command.delta);
        case "zoom":
          return zoom(command.direction);
        case "fit":
          return changeView({ scale: nextFit(viewRef.current.scale) });
        case "rotate":
          return changeView({ rotation: nextRotation(viewRef.current.rotation) });
        case "spread":
          return changeView({ spread: nextSpread(viewRef.current.spread) });
        case "scrollMode":
          return changeView({ scrollMode: nextScrollMode(viewRef.current.scrollMode) });
        case "search":
          return setSearching((was) => !was);
        case "autoScroll":
          return setScrolling((was) => !was);
        case "speed":
          return changeView({
            autoScrollSpeed: clampSpeed(
              viewRef.current.autoScrollSpeed + command.delta * SPEED_STEP,
            ),
          });
        case "pin":
          return setPinned((was) => !was);
      }
    }),
  );

  useAutoScroll({
    running: scrolling,
    speed: view.autoScrollSpeed,
    pinned,
    page,
    pageCount,
    spread: view.spread,
    scrollMode: view.scrollMode,
    container: containerRef,
    onAdvancePage: () => {
      const viewer = pdfViewerRef.current;
      if (viewer) viewer.currentPageNumber = viewer.currentPageNumber + 1;
    },
    onPause: () => setScrolling(false),
  });

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
  function recordViewNow(next: View) {
    viewRef.current = next;
    setView(next);
    fire(ipc.scoreViewPatch(open.generation, next), "saving the view");
  }
  recordView.current = recordViewNow;

  function changeView(patch: Partial<View>) {
    const next = { ...viewRef.current, ...patch };
    recordViewNow(next);
    const viewer = pdfViewerRef.current;
    if (!viewer) return;
    // Suppressed for the same reason a restore is: changing the spread can
    // move the current page, and that is Riff driving the viewer rather
    // than the reader turning a page.
    applying.current = true;
    try {
      applyViewToViewer(viewer, next);
    } finally {
      applying.current = false;
    }
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

  /**
   * Searching goes through the event bus rather than by calling the find
   * controller directly: that is the interface pdf.js gives it — its
   * constructor subscribes to `find` — and it is what keeps the highlight,
   * the match count and the scroll-to-match in step with each other.
   *
   * `type: ""` starts a fresh search; `"again"` walks the matches already
   * found. `findPrevious` is what makes Shift+Enter go backwards.
   */
  function find(query: string, type: "" | "again", findPrevious = false) {
    setSearch((current) => ({ ...current, query }));
    eventBusRef.current?.dispatch("find", {
      source: null,
      type,
      query,
      caseSensitive: false,
      entireWord: false,
      // Every match on the page, not only the current one — a musician
      // scanning for a repeat wants to see them all at once.
      highlightAll: true,
      findPrevious,
      matchDiacritics: false,
    });
  }

  function closeSearch() {
    setSearching(false);
    setSearch(NO_SEARCH);
    // Clears the highlights; without it they stay painted over the score
    // after the row that explained them has gone.
    eventBusRef.current?.dispatch("findbarclose", { source: null });
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
          searching={searching}
          scrolling={scrolling}
          pinned={pinned}
          onGoToPage={goToPage}
          onViewChange={changeView}
          onZoom={zoom}
          onToggleSearch={() => (searching ? closeSearch() : setSearching(true))}
          onToggleScrolling={() => setScrolling((was) => !was)}
          onTogglePinned={() => setPinned((was) => !was)}
        />
      )}
      {ready && searching && (
        <ScoreSearch
          query={search.query}
          status={search}
          hasText={hasText}
          onQueryChange={(query) => find(query, "")}
          onFindAgain={(direction) => find(search.query, "again", direction === -1)}
          onClose={closeSearch}
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
        {/* Not while the search row is open: it says the same sentence, in
            the place the question was just asked, and two `role="status"`
            elements carrying identical text is one announcement too many. */}
        {ready && !hasText && !searching && (
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
      {/* Start and stop, and nothing in between: announcing every frame of
          an auto-scroll would be intolerable (spec §10). Separate from the
          page announcer above so one does not overwrite the other. */}
      <div aria-live="polite" className="sr-only">
        {ready
          ? t(scrolling ? "common:score.autoScroll.started" : "common:score.autoScroll.stopped")
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

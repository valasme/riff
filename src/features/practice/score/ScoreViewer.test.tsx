import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";
import type { OpenScore } from "@/lib/ipc";

const scoreBytes = vi.fn();
const appInfo = vi.fn();
const scoreViewPatch = vi.fn().mockResolvedValue(undefined);
let dim = 0;
vi.mock("@/stores/settings", () => ({ useScoreDim: () => dim }));
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { scoreBytes, appInfo, scoreViewPatch },
}));

// `PDFViewer` cannot run in jsdom at all — no canvas, no layout — so it is
// mocked at the facade, `./pdfjs`, the way `@/lib/ipc` is mocked rather than
// `@tauri-apps/api`. Each fake keeps only the surface `ScoreViewer` touches.
let lastBus: FakeEventBus | undefined;

class FakeEventBus {
  #handlers = new Map<string, Set<(event: unknown) => void>>();
  on(name: string, handler: (event: unknown) => void) {
    if (!this.#handlers.has(name)) this.#handlers.set(name, new Set());
    this.#handlers.get(name)?.add(handler);
  }
  off(name: string, handler: (event: unknown) => void) {
    this.#handlers.get(name)?.delete(handler);
  }
  dispatch(name: string, event: unknown) {
    for (const handler of this.#handlers.get(name) ?? []) handler(event);
  }
}

class FakePDFLinkService {
  externalLinkEnabled = true;
  setViewer() {}
  setDocument() {}
}

let lastViewer: FakePDFViewer | undefined;

class FakePDFViewer {
  pdfDocument: unknown = null;
  // `null`, exactly as the real `_resetView()` leaves it — a viewer nothing
  // has chosen a scale for renders at 100%, which is the bug `pagesinit`
  // below exists to close.
  currentScaleValue: string | null = null;
  currentScale = 1;
  pagesRotation = 0;
  spreadMode = 0;
  scrollMode = 0;
  #currentPageNumber = 1;
  #eventBus: FakeEventBus;
  constructor(options: { eventBus: FakeEventBus }) {
    this.#eventBus = options.eventBus;
    lastBus = options.eventBus;
    lastViewer = this;
  }
  get currentPageNumber() {
    return this.#currentPageNumber;
  }
  // The real setter dispatches `pagechanging`, which is what the page
  // indicator follows — rather than being set wherever a turn is requested.
  set currentPageNumber(value: number) {
    this.#currentPageNumber = value;
    this.#eventBus.dispatch("pagechanging", { source: this, pageNumber: value });
  }
  setDocument(document: unknown) {
    this.pdfDocument = document;
    // The real `setDocument` dispatches this once the page views exist.
    this.#eventBus.dispatch("pagesinit", { source: this });
  }
}

/**
 * Enough of `PDFFindController` to drive the row: it subscribes to `find` on
 * the shared bus, exactly as the real one does in its constructor, and
 * answers with the same two events the viewer listens for.
 */
class FakePDFFindController {
  #eventBus: FakeEventBus;
  /** Set by a test to decide what the next search "finds". */
  static result: { state: number; current: number; total: number } = {
    state: 0,
    current: 1,
    total: 3,
  };
  constructor(options: { eventBus: FakeEventBus }) {
    this.#eventBus = options.eventBus;
    this.#eventBus.on("find", () => {
      const { state, current, total } = FakePDFFindController.result;
      this.#eventBus.dispatch("updatefindcontrolstate", {
        source: this,
        state,
        matchesCount: { current, total },
      });
    });
  }
  setDocument() {}
}

class WorkerUnavailableError extends Error {}
class PasswordException extends Error {}
class InvalidPDFException extends Error {}

const ensureWorker = vi.fn();
let getDocumentImpl: (options: unknown) => {
  promise: Promise<unknown>;
  destroy: () => Promise<void>;
};

vi.mock("./pdfjs", () => ({
  AnnotationMode: { ENABLE: 1 },
  EventBus: FakeEventBus,
  PDFFindController: FakePDFFindController,
  PDFLinkService: FakePDFLinkService,
  PDFViewer: FakePDFViewer,
  SCORE_DOCUMENT_OPTIONS: {},
  WorkerUnavailableError,
  PasswordException,
  InvalidPDFException,
  ensureWorker: () => ensureWorker(),
  getDocument: (options: unknown) => getDocumentImpl(options),
}));

const { ScoreViewer } = await import("./ScoreViewer");

const OPEN: OpenScore = {
  score: { name: "sonata.pdf", size: 10 },
  view: {
    page: 1,
    scale: { mode: "fit-width" },
    rotation: 0,
    spread: "none",
    scrollMode: "continuous",
    autoScrollSpeed: 1,
  },
};

function fakeDocument(textItems: unknown[] = [{}], numPages = 1) {
  return {
    numPages,
    getPage: vi.fn().mockResolvedValue({
      getTextContent: vi.fn().mockResolvedValue({ items: textItems }),
    }),
  };
}

function renderViewer(onLoadError: (message: string) => void = () => {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ScoreViewer open={OPEN} onLoadError={onLoadError} />
    </I18nextProvider>,
  );
}

describe("ScoreViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastViewer = undefined;
    lastBus = undefined;
    dim = 0;
    FakePDFFindController.result = { state: 0, current: 1, total: 3 };
    ensureWorker.mockResolvedValue(undefined);
    scoreBytes.mockResolvedValue(new ArrayBuffer(4));
    scoreViewPatch.mockResolvedValue(undefined);
    appInfo.mockResolvedValue({
      webkitVersion: "2.10.0",
      version: "0",
      tauriVersion: "0",
      buildDate: "",
      gitSha: "",
    });
  });

  it("names the score while it is loading, with no progress bar", async () => {
    getDocumentImpl = () => ({ promise: new Promise(() => {}), destroy: vi.fn() });
    renderViewer();
    expect(await screen.findByText("Opening sonata.pdf…")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("hides the loading state once the document resolves", async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(fakeDocument()), destroy: vi.fn() });
    renderViewer();
    await waitFor(() => expect(screen.queryByText("Opening sonata.pdf…")).not.toBeInTheDocument());
  });

  it("says a scan has no searchable text", async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(fakeDocument([])), destroy: vi.fn() });
    renderViewer();
    expect(await screen.findByText("This score has no searchable text.")).toBeInTheDocument();
  });

  it("does not show the no-text notice when the score has text", async () => {
    getDocumentImpl = () => ({
      promise: Promise.resolve(fakeDocument([{ str: "a" }])),
      destroy: vi.fn(),
    });
    renderViewer();
    await waitFor(() => expect(screen.queryByText("Opening sonata.pdf…")).not.toBeInTheDocument());
    expect(screen.queryByText("This score has no searchable text.")).not.toBeInTheDocument();
  });

  it("names the required and actual WebKitGTK version when the worker cannot start", async () => {
    ensureWorker.mockRejectedValue(new WorkerUnavailableError());
    const onLoadError = vi.fn();
    renderViewer(onLoadError);
    await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
    const [message] = onLoadError.mock.calls[0] as [string];
    expect(message).toContain("2.10.0");
    expect(message).toContain("2.36.0");
  });

  it("maps pdf.js's own password exception to the score-encrypted message", async () => {
    getDocumentImpl = () => ({
      promise: Promise.reject(new PasswordException("x")),
      destroy: vi.fn(),
    });
    const onLoadError = vi.fn();
    renderViewer(onLoadError);
    await waitFor(() =>
      expect(onLoadError).toHaveBeenCalledWith(
        "This score is password-protected. Riff cannot open a password-protected file.",
      ),
    );
  });

  it("maps pdf.js's own invalid-PDF exception to the score-unreadable message", async () => {
    getDocumentImpl = () => ({
      promise: Promise.reject(new InvalidPDFException("x")),
      destroy: vi.fn(),
    });
    const onLoadError = vi.fn();
    renderViewer(onLoadError);
    await waitFor(() =>
      expect(onLoadError).toHaveBeenCalledWith(
        "This score could not be read. It may not be a PDF, or the file may be damaged.",
      ),
    );
  });

  it("localises a plain RiffError from a failed score_bytes the same way as any other failure", async () => {
    scoreBytes.mockRejectedValue({ code: "score-missing", details: { name: "sonata.pdf" } });
    const onLoadError = vi.fn();
    renderViewer(onLoadError);
    await waitFor(() =>
      expect(onLoadError).toHaveBeenCalledWith(
        "This score could not be found. It may have been moved or deleted.",
      ),
    );
  });

  // Without this the viewer sits at pdf.js's UNKNOWN_SCALE, whose getter
  // answers 1.0 — so an 816px US Letter page renders at full size inside a
  // ~500px Score pane and the score arrives with a horizontal scrollbar.
  it("applies the view's fit mode as soon as the pages exist", async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(fakeDocument()), destroy: vi.fn() });
    renderViewer();
    await waitFor(() => expect(lastViewer?.currentScaleValue).toBe("page-width"));
  });

  it("applies free zoom as a number-valued scale rather than a fit keyword", async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(fakeDocument()), destroy: vi.fn() });
    render(
      <I18nextProvider i18n={i18n}>
        <ScoreViewer
          open={{ ...OPEN, view: { ...OPEN.view, scale: { mode: "custom", value: 1.25 } } }}
          onLoadError={() => {}}
        />
      </I18nextProvider>,
    );
    await waitFor(() => expect(lastViewer?.currentScaleValue).toBe("1.25"));
  });

  it("shows the toolbar with the document's page count once the score is ready", async () => {
    getDocumentImpl = () => ({
      promise: Promise.resolve(fakeDocument([{ str: "a" }], 12)),
      destroy: vi.fn(),
    });
    renderViewer();
    expect(await screen.findByText("of 12")).toBeInTheDocument();
    expect(screen.getByLabelText("Page number")).toHaveValue(1);
  });

  it("has no toolbar to mislead with while the score is still loading", () => {
    getDocumentImpl = () => ({ promise: new Promise(() => {}), destroy: vi.fn() });
    renderViewer();
    expect(screen.queryByLabelText("Score controls")).not.toBeInTheDocument();
  });

  it("turns the page through the viewer rather than tracking a number of its own", async () => {
    getDocumentImpl = () => ({
      promise: Promise.resolve(fakeDocument([{ str: "a" }], 12)),
      destroy: vi.fn(),
    });
    renderViewer();
    await userEvent.click(await screen.findByRole("button", { name: "Next page" }));
    expect(lastViewer?.currentPageNumber).toBe(2);
    expect(screen.getByLabelText("Page number")).toHaveValue(2);
  });

  // A pedal, a chord, a search hit and an internal link all move the score
  // without touching the toolbar; `pagechanging` is where they converge.
  it("follows a page change it did not initiate", async () => {
    getDocumentImpl = () => ({
      promise: Promise.resolve(fakeDocument([{ str: "a" }], 12)),
      destroy: vi.fn(),
    });
    renderViewer();
    await screen.findByText("of 12");
    act(() => {
      const viewer = lastViewer;
      if (viewer) viewer.currentPageNumber = 7;
    });
    expect(screen.getByLabelText("Page number")).toHaveValue(7);
  });

  it("announces the page politely, since the indicator is a number nobody is looking at", async () => {
    getDocumentImpl = () => ({
      promise: Promise.resolve(fakeDocument([{ str: "a" }], 12)),
      destroy: vi.fn(),
    });
    const { container } = renderViewer();
    await screen.findByText("of 12");
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent("Page 1 of 12");
  });

  async function renderReady(numPages = 12) {
    getDocumentImpl = () => ({
      promise: Promise.resolve(fakeDocument([{ str: "a" }], numPages)),
      destroy: vi.fn(),
    });
    const rendered = renderViewer();
    await screen.findByText(`of ${numPages}`);
    return rendered;
  }

  it("applies rotation, spread and scroll mode to the viewer and records all three", async () => {
    await renderReady();

    await userEvent.click(screen.getByRole("button", { name: "Rotate 90°" }));
    expect(lastViewer?.pagesRotation).toBe(90);

    await userEvent.click(screen.getByRole("button", { name: "Single pages" }));
    expect(lastViewer?.spreadMode).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Continuous pages" }));
    expect(lastViewer?.scrollMode).toBe(3);

    // The command takes a whole view, not a partial patch, so the last call
    // carries every value the round trip has to survive.
    expect(scoreViewPatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ rotation: 90, spread: "odd", scrollMode: "page" }),
    );
  });

  it("fits to the pane rather than the window, and says so as a keyword", async () => {
    await renderReady();
    await userEvent.click(screen.getByRole("button", { name: "Fit page" }));
    // "page-fit", not a number: the scale is resolved by pdf.js against the
    // container's own width, which is the pane — a window resize is not
    // what this follows.
    expect(lastViewer?.currentScaleValue).toBe("page-fit");
    expect(scoreViewPatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ scale: { mode: "fit-page" } }),
    );
  });

  it("steps zoom from the scale pdf.js resolved, leaving the fit mode", async () => {
    await renderReady();
    // What fit width came out as in this pane — not 100%.
    if (lastViewer) lastViewer.currentScale = 0.6;
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(scoreViewPatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ scale: { mode: "custom", value: 0.66 } }),
    );
    expect(lastViewer?.currentScaleValue).toBe("0.66");
  });

  // Page moves far more often than these do, and Task 11 owns writing it
  // alongside the restore that reads it back.
  it("does not write the page number yet, which would overwrite what a reopen restores", async () => {
    await renderReady();
    scoreViewPatch.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(scoreViewPatch).not.toHaveBeenCalled();
  });

  // A brightness reduction on the rendered page, not an inversion, and
  // applied to `canvas` rather than `.page` so search highlights — which sit
  // in the text layer above it — keep their full strength while the page
  // behind them darkens. `score.css` owns that selector; this is the value
  // it reads.
  it("applies no filter at all when dim is off, which is the default", async () => {
    const { container } = await renderReady();
    const surface = container.querySelector(".riff-score-viewer") as HTMLElement;
    // Not `brightness(1)`: a filter promotes every canvas to its own
    // compositing layer even when it changes nothing.
    expect(surface.dataset.dimmed).toBe("false");
    expect(surface.style.getPropertyValue("--score-dim-brightness")).toBe("");
  });

  it("darkens the page as dim rises", async () => {
    dim = 0.4;
    const { container } = await renderReady();
    const surface = container.querySelector(".riff-score-viewer") as HTMLElement;
    expect(surface.dataset.dimmed).toBe("true");
    expect(surface.style.getPropertyValue("--score-dim-brightness")).toBe("0.6");
  });

  async function openSearch(numPages = 12, textItems: unknown[] = [{ str: "a" }]) {
    getDocumentImpl = () => ({
      promise: Promise.resolve(fakeDocument(textItems, numPages)),
      destroy: vi.fn(),
    });
    const rendered = renderViewer();
    await screen.findByRole("button", { name: "Search this score" });
    await userEvent.click(screen.getByRole("button", { name: "Search this score" }));
    return rendered;
  }

  it("reveals the search row from a toggle rather than keeping a field on the toolbar", async () => {
    await openSearch();
    expect(screen.getByLabelText("Search the score")).toBeInTheDocument();
  });

  // The highlight is painted into a layer over the canvas, which is exactly
  // what a screen-reader user is not looking at.
  it("announces the match count rather than only highlighting it", async () => {
    await openSearch();
    await userEvent.type(screen.getByLabelText("Search the score"), "andante");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("1 of 3");
  });

  it("says a search wrapped, since a silent restart looks like the same match twice", async () => {
    await openSearch();
    FakePDFFindController.result = { state: 2, current: 1, total: 3 };
    await userEvent.type(screen.getByLabelText("Search the score"), "coda");
    expect(await screen.findByRole("status")).toHaveTextContent("(wrapped)");
  });

  it("says plainly when there is nothing to find", async () => {
    await openSearch();
    FakePDFFindController.result = { state: 1, current: 0, total: 0 };
    await userEvent.type(screen.getByLabelText("Search the score"), "zzz");
    expect(await screen.findByRole("status")).toHaveTextContent("No matches");
  });

  // Reporting zero matches on a scan reads as a search that is broken,
  // rather than one that was never possible. Reuses Task 5's sentence.
  it("tells a scan it has no searchable text instead of finding nothing", async () => {
    await openSearch(12, []);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "This score has no searchable text.",
    );
    expect(screen.getByLabelText("Search the score")).toBeDisabled();
  });

  it("clears the highlights when the row is dismissed", async () => {
    let closed = false;
    await openSearch();
    lastBus?.on("findbarclose", () => {
      closed = true;
    });
    await userEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(closed).toBe(true);
    expect(screen.queryByLabelText("Search the score")).not.toBeInTheDocument();
  });

  it("tears the loading task down on unmount, per the StrictMode fix", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocumentImpl = () => ({ promise: new Promise(() => {}), destroy });
    const { unmount } = renderViewer();
    await screen.findByText("Opening sonata.pdf…");
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";
import type { OpenScore } from "@/lib/ipc";

const scoreBytes = vi.fn();
const appInfo = vi.fn();
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { scoreBytes, appInfo },
}));

// `PDFViewer` cannot run in jsdom at all — no canvas, no layout — so it is
// mocked at the facade, `./pdfjs`, the way `@/lib/ipc` is mocked rather than
// `@tauri-apps/api`. Each fake keeps only the surface `ScoreViewer` touches.
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
  #currentPageNumber = 1;
  #eventBus: FakeEventBus;
  constructor(options: { eventBus: FakeEventBus }) {
    this.#eventBus = options.eventBus;
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
    ensureWorker.mockResolvedValue(undefined);
    scoreBytes.mockResolvedValue(new ArrayBuffer(4));
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

  it("tears the loading task down on unmount, per the StrictMode fix", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocumentImpl = () => ({ promise: new Promise(() => {}), destroy });
    const { unmount } = renderViewer();
    await screen.findByText("Opening sonata.pdf…");
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

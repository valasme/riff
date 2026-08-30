import { render, screen, waitFor } from "@testing-library/react";
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

class FakePDFViewer {
  pdfDocument: unknown = null;
  currentScaleValue: string | number = "page-width";
  setDocument(document: unknown) {
    this.pdfDocument = document;
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

function fakeDocument(textItems: unknown[] = [{}]) {
  return {
    numPages: 1,
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

  it("tears the loading task down on unmount, per the StrictMode fix", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocumentImpl = () => ({ promise: new Promise(() => {}), destroy });
    const { unmount } = renderViewer();
    await screen.findByText("Opening sonata.pdf…");
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

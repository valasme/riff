import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";
import type { OpenScore } from "@/lib/ipc";

const scoreState = vi.fn<() => Promise<OpenScore | null>>();
const scoreOpen = vi.fn();
const scoreClose = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { scoreState, scoreOpen, scoreClose },
}));

let emitScoreChanged: ((open: OpenScore | null) => void) | undefined;
let emitDropFailed: ((error: unknown) => void) | undefined;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    if (name === "score://changed") {
      emitScoreChanged = (open) => handler({ payload: open });
    } else if (name === "score://drop-failed") {
      emitDropFailed = (error) => handler({ payload: error });
    }
    return Promise.resolve(() => {});
  },
}));

// `PDFViewer` cannot run in jsdom at all (no canvas, no layout) — mocked at
// the facade component, the way `@/lib/ipc` is mocked rather than
// `@tauri-apps/api`. `ScoreViewer`'s own behaviour is `ScoreViewer.test.tsx`.
vi.mock("./score/ScoreViewer", () => ({
  ScoreViewer: ({ open }: { open: OpenScore }) => (
    <div data-testid="score-viewer">{open.score.name}</div>
  ),
}));

const { PracticePane } = await import("./PracticePane");

function renderPane(props: Partial<Parameters<typeof PracticePane>[0]> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <PracticePane pane="score" {...props} />
    </I18nextProvider>,
  );
}

const OPEN: OpenScore = {
  generation: "g1",
  score: { name: "sonata.pdf", size: 1024 },
  view: {
    page: 1,
    scale: { mode: "fit-width" },
    rotation: 0,
    spread: "none",
    scrollMode: "continuous",
    autoScrollSpeed: 1,
  },
};

describe("a practice pane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scoreState.mockResolvedValue(null);
    emitScoreChanged = undefined;
    emitDropFailed = undefined;
  });

  it("disables the travel control when nothing is listening to it", () => {
    renderPane();
    expect(screen.getByRole("button", { name: "Pop out" })).toBeDisabled();
  });

  // The failure this guards is silent: an arrow function wrapping an optional
  // handler is itself never undefined, so the button looks live, takes the
  // click, and does nothing at all.
  it("disables the dock-back control when nothing is listening to it", () => {
    renderPane({ popped: true });
    expect(screen.getByRole("button", { name: "Dock back" })).toBeDisabled();
  });

  it("enables it once a handler is supplied", () => {
    renderPane({ onPopOut: () => {} });
    expect(screen.getByRole("button", { name: "Pop out" })).toBeEnabled();
  });

  it("disables the pane-video and pane-audio close control, which pop-out keeps separate from pane management", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PracticePane pane="video" />
      </I18nextProvider>,
    );
    expect(screen.getByRole("button", { name: "Close pane" })).toBeDisabled();
  });

  it("disables the score close control with no score open", () => {
    renderPane();
    expect(screen.getByRole("button", { name: "Close pane" })).toBeDisabled();
  });

  it("offers an Open score affordance in the empty state", async () => {
    renderPane();
    expect(await screen.findByRole("button", { name: "Open score…" })).toBeInTheDocument();
  });

  it("opens the picker when Open score is pressed", async () => {
    scoreOpen.mockResolvedValue(OPEN);
    renderPane();
    await userEvent.click(await screen.findByRole("button", { name: "Open score…" }));
    expect(scoreOpen).toHaveBeenCalledTimes(1);
  });

  it("mounts the viewer and enables the close control once a score is open", async () => {
    scoreState.mockResolvedValue(OPEN);
    renderPane();
    expect(await screen.findByTestId("score-viewer")).toHaveTextContent("sonata.pdf");
    expect(screen.getByRole("button", { name: "Close score" })).toBeEnabled();
  });

  it("closes the score, not the pane, when × is pressed", async () => {
    scoreState.mockResolvedValue(OPEN);
    renderPane();
    await screen.findByTestId("score-viewer");
    await userEvent.click(screen.getByRole("button", { name: "Close score" }));
    expect(scoreClose).toHaveBeenCalledTimes(1);
  });

  it("shows the error in the pane rather than a dismissible toast when opening fails", async () => {
    scoreOpen.mockRejectedValue({ code: "score-encrypted" });
    renderPane();
    await userEvent.click(await screen.findByRole("button", { name: "Open score…" }));
    expect(
      await screen.findByText(
        "This score is password-protected. Riff cannot open a password-protected file.",
      ),
    ).toBeInTheDocument();
    // The affordance stays under the cursor rather than behind a dismissed dialog.
    expect(screen.getByRole("button", { name: "Open score…" })).toBeInTheDocument();
  });

  it("reports a failed drop the same way a failed pick is reported", async () => {
    renderPane();
    await waitFor(() => expect(emitDropFailed).toBeDefined());
    emitDropFailed?.({ code: "score-missing" });
    expect(
      await screen.findByText("This score could not be found. It may have been moved or deleted."),
    ).toBeInTheDocument();
  });

  it("follows score://changed to mount and unmount the viewer live", async () => {
    renderPane();
    await waitFor(() => expect(emitScoreChanged).toBeDefined());
    emitScoreChanged?.(OPEN);
    expect(await screen.findByTestId("score-viewer")).toBeInTheDocument();
    emitScoreChanged?.(null);
    await waitFor(() => expect(screen.queryByTestId("score-viewer")).not.toBeInTheDocument());
  });

  it("does not call any score command for the still-placeholder panes", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PracticePane pane="video" />
      </I18nextProvider>,
    );
    expect(scoreState).not.toHaveBeenCalled();
    expect(screen.getByText("In development")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const practiceDockBack = vi.fn().mockResolvedValue(undefined);
const scoreState = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { practiceDockBack, scoreState },
}));

// A pop-out can host the Score pane, which pulls in `useOpenScore` and
// hence a real `listen()` — unavailable outside a Tauri webview.
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

// `PDFViewer` cannot run in jsdom — see `PracticePane.test.tsx`.
vi.mock("./score/ScoreViewer", () => ({
  ScoreViewer: () => null,
}));

const { PopoutPane } = await import("./PopoutPane");

function renderPopout() {
  return render(
    <I18nextProvider i18n={i18n}>
      <PopoutPane pane="score" />
    </I18nextProvider>,
  );
}

describe("a pop-out window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    practiceDockBack.mockResolvedValue([]);
  });

  it("renders one pane and nothing else", () => {
    renderPopout();
    expect(screen.getByRole("region", { name: "Score" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Video" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Audio" })).toBeNull();
  });

  it("flips the pop-out control into a dock-back rather than growing a second one", () => {
    renderPopout();
    expect(screen.getByRole("button", { name: "Dock back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pop out" })).toBeNull();
  });

  it("docks the pane back through rust", async () => {
    renderPopout();
    await userEvent.click(screen.getByRole("button", { name: "Dock back" }));
    expect(practiceDockBack).toHaveBeenCalledWith("score");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderPopout();
    await expect(container).toHaveNoAxeViolations();
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";
import type { Pane } from "@/lib/ipc";

const practiceState = vi.fn<() => Promise<Pane[]>>();
const practicePopOut = vi.fn();
const practiceDockBack = vi.fn();
const practiceDockAll = vi.fn();
const practiceFocus = vi.fn();
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { practiceState, practicePopOut, practiceDockBack, practiceDockAll, practiceFocus },
}));

let emit: ((panes: Pane[]) => void) | undefined;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, handler: (event: { payload: Pane[] }) => void) => {
    emit = (panes) => handler({ payload: panes });
    return Promise.resolve(() => {});
  },
}));

const { PracticeGrid } = await import("./PracticeGrid");

function renderGrid() {
  return render(
    <I18nextProvider i18n={i18n}>
      <PracticeGrid />
    </I18nextProvider>,
  );
}

describe("the practice grid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    practiceState.mockResolvedValue([]);
    practicePopOut.mockResolvedValue([]);
    practiceDockBack.mockResolvedValue([]);
    practiceDockAll.mockResolvedValue([]);
  });

  it("shows the three panes from the mockup", async () => {
    renderGrid();
    await waitFor(() => expect(practiceState).toHaveBeenCalled());
    for (const name of ["Score", "Video", "Audio"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("says plainly that it is not finished", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getAllByText("In development")).toHaveLength(3));
  });

  it("leaves the close control inert rather than pretending it works", async () => {
    renderGrid();
    await waitFor(() => expect(practiceState).toHaveBeenCalled());
    for (const button of screen.getAllByRole("button", { name: "Close pane" })) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("asks rust to pop a pane out rather than deciding for itself", async () => {
    renderGrid();
    await waitFor(() => expect(practiceState).toHaveBeenCalled());
    const score = screen.getByRole("region", { name: "Score" });
    await userEvent.click(within(score).getByRole("button", { name: "Pop out" }));
    expect(practicePopOut).toHaveBeenCalledWith("score");
  });

  it("drops a pane from the grid when rust says it is out", async () => {
    renderGrid();
    await waitFor(() => expect(practiceState).toHaveBeenCalled());
    emit?.(["video"]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Video" })).toBeNull());
    expect(screen.getByRole("region", { name: "Score" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Audio" })).toBeInTheDocument();
  });

  it("has no strip at all while every pane is in the grid", async () => {
    renderGrid();
    await waitFor(() => expect(practiceState).toHaveBeenCalled());
    expect(screen.queryByLabelText("Panes in their own windows")).toBeNull();
  });

  it("offers a way back to a window that has drifted behind something else", async () => {
    renderGrid();
    await waitFor(() => expect(practiceState).toHaveBeenCalled());
    emit?.(["score"]);
    await waitFor(() => expect(screen.getByLabelText("Panes in their own windows")).toBeVisible());

    await userEvent.click(screen.getByRole("button", { name: "Show the Score window" }));
    expect(practiceFocus).toHaveBeenCalledWith("score");

    await userEvent.click(screen.getByRole("button", { name: "Dock Score back into Riff" }));
    expect(practiceDockBack).toHaveBeenCalledWith("score");
  });

  it("shows an empty state, not a grid of nothing, when all three are out", async () => {
    renderGrid();
    await waitFor(() => expect(practiceState).toHaveBeenCalled());
    emit?.(["score", "video", "audio"]);
    await waitFor(() =>
      expect(screen.getByText("All three panes are in their own windows")).toBeVisible(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Bring all back" }));
    expect(practiceDockAll).toHaveBeenCalled();
  });

  it("lets an event that arrives before the seed win", async () => {
    // The seed is a round trip and the event is not. Letting the seed land
    // last would resurrect the set as it was before whatever caused the event.
    let settle: (panes: Pane[]) => void = () => {};
    practiceState.mockReturnValue(new Promise<Pane[]>((resolve) => (settle = resolve)));
    renderGrid();
    emit?.(["audio"]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Audio" })).toBeNull());
    settle([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("region", { name: "Audio" })).toBeNull();
  });

  it("has no accessibility violations with a pane popped out", async () => {
    const { container } = renderGrid();
    await waitFor(() => expect(practiceState).toHaveBeenCalled());
    emit?.(["video"]);
    await waitFor(() => expect(screen.getByLabelText("Panes in their own windows")).toBeVisible());
    await expect(container).toHaveNoAxeViolations();
  });

  it("has no accessibility violations in the empty state", async () => {
    const { container } = renderGrid();
    await waitFor(() => expect(practiceState).toHaveBeenCalled());
    emit?.(["score", "video", "audio"]);
    await waitFor(() =>
      expect(screen.getByText("All three panes are in their own windows")).toBeVisible(),
    );
    await expect(container).toHaveNoAxeViolations();
  });
});

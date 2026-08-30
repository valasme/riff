import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const practiceDockBack = vi.fn().mockResolvedValue(undefined);
const windowQuitConfirmed = vi.fn().mockResolvedValue(undefined);
const windowClose = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { practiceDockBack, windowQuitConfirmed, windowClose },
}));

const { PopoutQuitDialog } = await import("./PopoutQuitDialog");

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <PopoutQuitDialog pane="score" open onOpenChange={onOpenChange} />
    </I18nextProvider>,
  );
  return onOpenChange;
}

describe("ctrl+q in a pop-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    practiceDockBack.mockResolvedValue([]);
    windowQuitConfirmed.mockResolvedValue(undefined);
  });

  it("asks rather than picking a side", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Dock back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quit Riff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("docks the pane back without touching the application", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Dock back" }));
    expect(practiceDockBack).toHaveBeenCalledWith("score");
    expect(windowQuitConfirmed).not.toHaveBeenCalled();
  });

  it("quits without asking a second time", async () => {
    // `windowQuitConfirmed` sets the approval flag, so `confirmOnQuit` does
    // not raise its own modal straight after this one for a single intent.
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Quit Riff" }));
    expect(windowQuitConfirmed).toHaveBeenCalled();
    expect(windowClose).not.toHaveBeenCalled();
  });

  it("cancels without doing either", async () => {
    const onOpenChange = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(practiceDockBack).not.toHaveBeenCalled();
    expect(windowQuitConfirmed).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    renderDialog();
    await expect(screen.getByRole("alertdialog")).toHaveNoAxeViolations();
  });
});

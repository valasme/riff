import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const windowMinimize = vi.fn();
const windowToggleMaximize = vi.fn();
const windowClose = vi.fn();
vi.mock("@/lib/ipc", () => ({
  ipc: { windowMinimize, windowToggleMaximize, windowClose },
  isRiffError: () => false,
}));

const { TitleBar } = await import("./TitleBar");

function renderBar() {
  return render(
    <I18nextProvider i18n={i18n}>
      <TitleBar />
    </I18nextProvider>,
  );
}

describe("TitleBar", () => {
  it("exposes every window control as a named button", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /minimi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maximi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("invokes the matching command", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: /minimi/i }));
    expect(windowMinimize).toHaveBeenCalledOnce();
  });

  it("marks the drag region so the window can be moved", () => {
    const { container } = renderBar();
    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderBar();
    await expect(container).toHaveNoAxeViolations();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const windowMinimize = vi.fn().mockResolvedValue(undefined);
const windowToggleMaximize = vi.fn().mockResolvedValue(undefined);
const windowClose = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { windowMinimize, windowToggleMaximize, windowClose },
  isRiffError: () => false,
}));

// The maximise control reads the real window state, so the test owns it.
// Outside a Tauri webview `getCurrentWindow()` throws and the hook falls back
// to `false`; mocking it is what lets the restored state be asserted at all.
let maximized = false;
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(maximized),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

const { TitleBar } = await import("./TitleBar");

function renderBar(props: Parameters<typeof TitleBar>[0] = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TitleBar {...props} />
    </I18nextProvider>,
  );
}

describe("TitleBar", () => {
  beforeEach(() => {
    maximized = false;
    windowMinimize.mockClear();
  });

  it("exposes every window control as a named button", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /minimi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maximi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close window/i })).toBeInTheDocument();
  });

  it("invokes the matching command", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: /minimi/i }));
    expect(windowMinimize).toHaveBeenCalledOnce();
  });

  it("offers Restore, not Maximize, once the window is already maximised", async () => {
    maximized = true;
    renderBar();
    expect(await screen.findByRole("button", { name: /restore/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Maximize" })).not.toBeInTheDocument();
  });

  it("says which way the sidebar toggle will go", () => {
    const { unmount } = renderBar({ sidebarCollapsed: false });
    expect(screen.getByRole("button", { name: /collapse sidebar/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    unmount();

    renderBar({ sidebarCollapsed: true });
    expect(screen.getByRole("button", { name: /expand sidebar/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens the palette from the search control", async () => {
    const user = userEvent.setup();
    const onOpenPalette = vi.fn();
    renderBar({ onOpenPalette });
    await user.click(screen.getByRole("button", { name: /search or jump to/i }));
    expect(onOpenPalette).toHaveBeenCalledOnce();
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

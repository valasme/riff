import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const openPath = vi.fn().mockResolvedValue(undefined);
const logWrite = vi.fn().mockResolvedValue(undefined);
const windowMinimize = vi.fn().mockResolvedValue(undefined);
const windowToggleMaximize = vi.fn().mockResolvedValue(undefined);
const windowClose = vi.fn().mockResolvedValue(undefined);
const windowStartDragging = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: {
    openPath,
    logWrite,
    windowMinimize,
    windowToggleMaximize,
    windowClose,
    windowStartDragging,
  },
}));

const writeText = vi.fn().mockResolvedValue(undefined);
const reload = vi.fn();

const { RouteError } = await import("./RouteError");

function renderCrash(error: unknown = new Error("boom")) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return render(
    <I18nextProvider i18n={i18n}>
      <RouteError error={error} />
    </I18nextProvider>,
  );
}

describe("RouteError", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    window.__RIFF_BOOTSTRAP__ = {
      settings: { appearance: {} },
      paths: { homeDir: "/home/dimitris", logDir: "/home/dimitris/.local/state/riff/logs" },
    } as unknown as Window["__RIFF_BOOTSTRAP__"];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload, hash: "#/settings/general", assign: vi.fn() },
    });
  });

  it("says what went wrong in Riff's own words, not the framework's", () => {
    renderCrash();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("leaves a window that can still be closed", () => {
    // `decorations: false` is baked into tauri.conf.json, and the boundary
    // replaces the whole layout — title bar included. Without its own
    // controls the crash screen is a window the user cannot move, minimise or
    // close from inside itself.
    renderCrash();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /minimi[sz]e/i })).toBeInTheDocument();
  });

  it("lets the crash window be moved", () => {
    const { container } = renderCrash();
    const chrome = container.querySelector("header");
    if (!chrome) throw new Error("crash chrome not found");
    fireEvent.mouseDown(chrome, { button: 0, detail: 1 });
    expect(windowStartDragging).toHaveBeenCalledOnce();
  });

  it("keeps the reload button reachable in a pop-out sized window", () => {
    // jsdom computes no layout, so this asserts the rule rather than the
    // pixels: the screen owns its own height and its own scroll container.
    // `h-full` is not inherited from a parent that never had it, and
    // `body { overflow: hidden }` means anything past the fold is gone —
    // which is where Reload sat at 360x320 and at 1.5x scale.
    const { container } = renderCrash();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("h-full");
    expect(container.querySelector(".overflow-auto")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("copies error details with no home directory and no username in them", async () => {
    renderCrash(new Error("failed at /home/dimitris/.config/riff/settings.json (dimitris)"));

    await userEvent.click(screen.getByRole("button", { name: /copy error details/i }));

    expect(writeText).toHaveBeenCalledOnce();
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).not.toContain("/home/dimitris");
    expect(copied).not.toContain("dimitris");
    expect(copied).toContain("$HOME");
  });

  it("still offers reload on the first crash under StrictMode", () => {
    // StrictMode double-invokes a `useState` initialiser, which counted the
    // first crash twice and offered the escape hatch straight away — removing
    // Reload, which is the right first answer.
    render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <RouteError error={new Error("boom")} />
        </I18nextProvider>
      </StrictMode>,
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /default settings/i })).not.toBeInTheDocument();
  });

  it("offers defaults rather than another reload on a second crash", async () => {
    renderCrash();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /default settings/i })).not.toBeInTheDocument();

    renderCrash();
    const escapeHatch = await screen.findByRole("button", { name: /default settings/i });
    await userEvent.click(escapeHatch);

    const { safeModeRequested } = await import("@/lib/crash-loop");
    expect(safeModeRequested()).toBe(true);
    expect(reload).toHaveBeenCalled();
  });

  it("names riff repair for the case where even defaults will not do", () => {
    renderCrash();
    renderCrash();
    expect(screen.getByText(/riff repair/)).toBeInTheDocument();
  });

  it("writes the crash to disk, because the boundary catching it is not a trace", () => {
    renderCrash();
    expect(logWrite).toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderCrash();
    await expect(container).toHaveNoAxeViolations();
  });
});

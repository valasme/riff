import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const patch = vi.fn().mockResolvedValue(undefined);
const appearance = {
  theme: "dark" as const,
  density: "comfortable" as const,
  uiScale: 1,
  reduceMotion: "system" as const,
  highContrast: false,
  sidebar: { collapsed: false, rememberCollapsed: true },
};
vi.mock("@/stores/settings", () => ({
  useAppearance: () => appearance,
  useSettings: (selector: (s: { patch: typeof patch }) => unknown) => selector({ patch }),
}));

const { AppearanceSection } = await import("./AppearanceSection");

function renderSection() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AppearanceSection />
    </I18nextProvider>,
  );
}

describe("AppearanceSection", () => {
  beforeEach(() => patch.mockClear());

  it("shows every control from the spec", () => {
    renderSection();
    expect(screen.getByRole("radiogroup", { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /interface scale/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /high contrast/i })).toBeInTheDocument();
  });

  it("persists a theme change immediately, with no save step", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(patch).toHaveBeenCalledWith({ appearance: { theme: "light" } });
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("persists the high contrast toggle", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("switch", { name: /high contrast/i }));
    expect(patch).toHaveBeenCalledWith({ appearance: { highContrast: true } });
  });

  it("applies a keyboard step to the interface scale immediately", () => {
    // Radix commits on every step key, so the keyboard path is unaffected by
    // the drag deferral below. Dragging cannot be exercised here: Radix maps
    // the pointer through `getBoundingClientRect`, which jsdom answers with
    // zeroes.
    renderSection();
    const slider = screen.getByRole("slider", { name: /interface scale/i });
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(patch).toHaveBeenCalledWith({ appearance: { uiScale: 1.05 } });
  });

  it("shows the dragged percentage while the drag is still in progress", () => {
    // The bug this pins: the thumb was drawn from the draft scale and the
    // readout from the committed one, so a drag moved the handle while the
    // number beside it sat at its old value until the mouse came up.
    // Radix maps the pointer through `getBoundingClientRect`, which jsdom
    // answers with zeroes, and calls `setPointerCapture`, which it does not
    // implement -- so both are supplied here. The measurement is still real:
    // Radix does its own arithmetic against the rect it is given.
    renderSection();
    const thumb = screen.getByRole("slider", { name: /interface scale/i });
    const root = thumb.closest("[data-slot='slider']");
    if (!root) throw new Error("slider root not found");
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 10, right: 200, bottom: 10, x: 0, y: 0 }) as DOMRect;
    for (const el of [root, thumb]) {
      Object.assign(el, {
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        hasPointerCapture: () => true,
      });
    }

    // 90% along a 0.8-1.5 track is 1.43, which snaps to the 0.05 step.
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 180, clientY: 5, button: 0, buttons: 1 });

    expect(thumb).toHaveAttribute("aria-valuenow", "1.45");
    // No pointer-up, so nothing has been committed: this is mid-gesture, and
    // the readout must already say so.
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByText("145%")).toBeInTheDocument();
  });

  it("offers every theme, so a new one cannot be added to the store alone", () => {
    renderSection();
    for (const name of ["Dark", "Darker", "Light"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSection();
    await expect(container).toHaveNoAxeViolations();
  });
});

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
  titleBar: "custom" as const,
  sidebar: { collapsed: false, rememberCollapsed: true },
};
vi.mock("@/stores/settings", () => ({
  useAppearance: () => appearance,
  useSettings: (selector: (s: { patch: typeof patch }) => unknown) => selector({ patch }),
}));
vi.mock("@/lib/ipc", () => ({ ipc: { windowSetDecorations: vi.fn().mockResolvedValue(false) } }));

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

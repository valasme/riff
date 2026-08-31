import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";
import { isTypingTarget } from "@/features/keybindings/chord";
import type { View } from "@/lib/ipc";
import { ScoreToolbar } from "./ScoreToolbar";

const VIEW: View = {
  page: 3,
  scale: { mode: "fit-width" },
  rotation: 0,
  spread: "none",
  scrollMode: "continuous",
  autoScrollSpeed: 1,
};

function renderToolbar(props: Partial<Parameters<typeof ScoreToolbar>[0]> = {}) {
  const onGoToPage = vi.fn();
  const onViewChange = vi.fn();
  const onZoom = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ScoreToolbar
        page={3}
        pageCount={12}
        view={VIEW}
        onGoToPage={onGoToPage}
        onViewChange={onViewChange}
        onZoom={onZoom}
        {...props}
      />
    </I18nextProvider>,
  );
  return { onGoToPage, onViewChange, onZoom };
}

describe("the score toolbar", () => {
  // The ARIA toolbar pattern moves focus with the arrow keys, which spec
  // §6.1 binds to turning pages. `role="toolbar"` looks like an obvious
  // improvement and would silently break the pedal.
  it("is a labelled group rather than an ARIA toolbar", () => {
    renderToolbar();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Score controls")).toBeInTheDocument();
  });

  it("turns to the next and previous page", async () => {
    const { onGoToPage } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onGoToPage).toHaveBeenCalledWith(4);
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onGoToPage).toHaveBeenCalledWith(2);
  });

  it("stops at both ends rather than offering a page that is not there", () => {
    renderToolbar({ page: 1 });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  });

  it("stops at the last page", () => {
    renderToolbar({ page: 12 });
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("shows the current page and the total", () => {
    renderToolbar();
    expect(screen.getByLabelText("Page number")).toHaveValue(3);
    expect(screen.getByText("of 12")).toBeInTheDocument();
  });

  it("goes to a typed page on Enter", async () => {
    const { onGoToPage } = renderToolbar();
    const field = screen.getByLabelText("Page number");
    await userEvent.clear(field);
    await userEvent.type(field, "9{Enter}");
    expect(onGoToPage).toHaveBeenLastCalledWith(9);
  });

  // Typing "1" on the way to "12" must not jump the score to page one.
  it("does not turn the page on every keystroke while a number is being typed", async () => {
    const { onGoToPage } = renderToolbar();
    const field = screen.getByLabelText("Page number");
    await userEvent.clear(field);
    await userEvent.type(field, "12");
    expect(onGoToPage).not.toHaveBeenCalled();
  });

  it("clamps a typed page past the end onto the last real page", async () => {
    const { onGoToPage } = renderToolbar();
    const field = screen.getByLabelText("Page number");
    await userEvent.clear(field);
    await userEvent.type(field, "99{Enter}");
    expect(onGoToPage).toHaveBeenLastCalledWith(12);
  });

  // `useKeybindings` skips every chord but `escape` when `isTypingTarget`
  // matches, and "number" is in its set — so the page-turn chords do not
  // steal the arrow keys from this field. Asserted here so nobody adds a
  // second guard for a problem that is already solved.
  it("leaves arrows in the page field to move the caret, not the score", () => {
    renderToolbar();
    expect(isTypingTarget(screen.getByLabelText("Page number"))).toBe(true);
  });

  it("toggles between fit width and fit page", async () => {
    const { onViewChange } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: "Fit page" }));
    expect(onViewChange).toHaveBeenCalledWith({ scale: { mode: "fit-page" } });
  });

  // The label and the action come from one `nextFit` call. Computed apart,
  // the button said "Fit page" while taking you to fit width.
  it("labels the fit control with what pressing it does", async () => {
    const { onViewChange } = renderToolbar({
      view: { ...VIEW, scale: { mode: "custom", value: 2 } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Fit width" }));
    expect(onViewChange).toHaveBeenCalledWith({ scale: { mode: "fit-width" } });
  });

  // Only the viewer knows what fit width resolved to in this pane, so the
  // toolbar asks for a direction rather than computing a scale.
  it("asks the viewer to zoom rather than computing a scale it cannot know", async () => {
    const { onZoom, onViewChange } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoom).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoom).toHaveBeenCalledWith(-1);
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("rotates the whole score in 90° steps", async () => {
    const { onViewChange } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: "Rotate 90°" }));
    expect(onViewChange).toHaveBeenCalledWith({ rotation: 90 });
  });

  it("cycles the spread", async () => {
    const { onViewChange } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: "Single pages" }));
    expect(onViewChange).toHaveBeenCalledWith({ spread: "odd" });
  });

  it("switches between continuous and one page at a time", async () => {
    const { onViewChange } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: "Continuous pages" }));
    expect(onViewChange).toHaveBeenCalledWith({ scrollMode: "page" });
  });

  // Colour alone would leave the state invisible to a screen reader.
  it("says which controls are currently on, not only shows it", () => {
    renderToolbar({ view: { ...VIEW, spread: "odd", scrollMode: "page" } });
    expect(screen.getByRole("button", { name: "Two pages, odd first" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "One page at a time" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps its targets at least 24px in both densities rather than shrinking them", () => {
    renderToolbar();
    // `size-6` is 1.5rem — 24px at the default scale, and it grows with UI
    // scale rather than being pinned in px. Density changes gaps, not this.
    for (const name of ["Previous page", "Next page"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("size-6");
    }
  });
});

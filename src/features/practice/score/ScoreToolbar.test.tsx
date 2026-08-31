import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";
import { isTypingTarget } from "@/features/keybindings/chord";
import { ScoreToolbar } from "./ScoreToolbar";

function renderToolbar(props: Partial<Parameters<typeof ScoreToolbar>[0]> = {}) {
  const onGoToPage = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ScoreToolbar page={3} pageCount={12} onGoToPage={onGoToPage} {...props} />
    </I18nextProvider>,
  );
  return { onGoToPage };
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

  it("keeps its targets at least 24px in both densities rather than shrinking them", () => {
    renderToolbar();
    // `size-6` is 1.5rem — 24px at the default scale, and it grows with UI
    // scale rather than being pinned in px. Density changes gaps, not this.
    for (const name of ["Previous page", "Next page"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("size-6");
    }
  });
});

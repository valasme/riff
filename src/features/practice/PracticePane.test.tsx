import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/app/i18n";
import { PracticePane } from "./PracticePane";

function renderPane(props: Partial<Parameters<typeof PracticePane>[0]> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <PracticePane pane="score" {...props} />
    </I18nextProvider>,
  );
}

describe("a practice pane", () => {
  it("disables the travel control when nothing is listening to it", () => {
    renderPane();
    expect(screen.getByRole("button", { name: "Pop out" })).toBeDisabled();
  });

  // The failure this guards is silent: an arrow function wrapping an optional
  // handler is itself never undefined, so the button looks live, takes the
  // click, and does nothing at all.
  it("disables the dock-back control when nothing is listening to it", () => {
    renderPane({ popped: true });
    expect(screen.getByRole("button", { name: "Dock back" })).toBeDisabled();
  });

  it("enables it once a handler is supplied", () => {
    renderPane({ onPopOut: () => {} });
    expect(screen.getByRole("button", { name: "Pop out" })).toBeEnabled();
  });

  // The × is inert by design, not by omission: bringing a *closed* pane back
  // is pane management, which §7 of the design keeps separate from pop-out.
  it("says the close control does not work yet by disabling it", () => {
    renderPane({ onPopOut: () => {} });
    expect(screen.getByRole("button", { name: "Close pane" })).toBeDisabled();
  });
});

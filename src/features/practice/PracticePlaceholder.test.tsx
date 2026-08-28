import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/app/i18n";
import { PracticePlaceholder } from "./PracticePlaceholder";

function renderPractice() {
  return render(
    <I18nextProvider i18n={i18n}>
      <PracticePlaceholder />
    </I18nextProvider>,
  );
}

describe("PracticePlaceholder", () => {
  it("shows the three panes from the mockup", () => {
    renderPractice();
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("Video")).toBeInTheDocument();
    expect(screen.getByText("Audio")).toBeInTheDocument();
  });

  it("says plainly that it is not finished", () => {
    renderPractice();
    expect(screen.getAllByText("In development").length).toBeGreaterThan(0);
  });

  it("disables every pane control rather than pretending it works", () => {
    renderPractice();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("has no accessibility violations", async () => {
    const { container } = renderPractice();
    await expect(container).toHaveNoAxeViolations();
  });
});

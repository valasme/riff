import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/app/i18n";
import { HistoryPlaceholder } from "./HistoryPlaceholder";

function renderHistory() {
  return render(
    <I18nextProvider i18n={i18n}>
      <HistoryPlaceholder />
    </I18nextProvider>,
  );
}

describe("HistoryPlaceholder", () => {
  it("shows the search field from the mockup, not editable", () => {
    renderHistory();
    expect(screen.getByRole("searchbox", { name: /search/i })).toHaveAttribute("readonly");
  });

  it("names the table", () => {
    renderHistory();
    expect(screen.getByRole("table", { name: /practice sessions/i })).toBeInTheDocument();
  });

  it("disables the filter control", () => {
    renderHistory();
    expect(screen.getByRole("button", { name: /filter/i })).toBeDisabled();
  });

  it("hides the decorative skeleton rows from assistive technology", () => {
    const { container } = renderHistory();
    const skeletons = container.querySelectorAll('[data-slot="skeleton"], .animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
    for (const node of skeletons) {
      expect(node.closest("[aria-hidden='true']")).not.toBeNull();
    }
  });

  it("names every column rather than leaving the header as bare icons", () => {
    renderHistory();
    for (const name of [/name/i, /last practised/i, /duration/i]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
  });

  it("says the rows are a preview rather than leaving them to be read as data", () => {
    renderHistory();
    expect(screen.getByText(/records nothing yet/i)).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderHistory();
    await expect(container).toHaveNoAxeViolations();
  });
});

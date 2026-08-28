import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

// `ReactNode` is imported explicitly: `React.*` in a module resolves to a UMD
// global and fails typecheck under `verbatimModuleSyntax`.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouterState: () => "/history",
}));

const { Sidebar } = await import("./Sidebar");

function renderSidebar(collapsed = false) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Sidebar collapsed={collapsed} />
    </I18nextProvider>,
  );
}

describe("Sidebar", () => {
  it("names its navigation landmark", () => {
    renderSidebar();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
  });

  it("marks the active route with aria-current", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Practice" })).not.toHaveAttribute("aria-current");
  });

  it("keeps every destination reachable when collapsed to the rail", () => {
    renderSidebar(true);
    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSidebar();
    await expect(container).toHaveNoAxeViolations();
  });
});

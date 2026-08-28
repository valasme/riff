import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

let pathname = "/settings/general";

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => null,
  useRouterState: () => pathname,
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { SettingsLayout } = await import("./SettingsLayout");

function renderLayout() {
  return render(
    <I18nextProvider i18n={i18n}>
      <SettingsLayout />
    </I18nextProvider>,
  );
}

describe("SettingsLayout", () => {
  it("marks the active section as the current page", () => {
    pathname = "/settings/appearance";
    renderLayout();
    expect(screen.getByRole("link", { name: /appearance/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /general/i })).not.toHaveAttribute("aria-current");
  });

  it("falls back to general when the path matches no known section", () => {
    pathname = "/settings";
    renderLayout();
    expect(screen.getByRole("heading", { name: /general/i })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    pathname = "/settings/general";
    const { container } = renderLayout();
    await expect(container).toHaveNoAxeViolations();
  });
});

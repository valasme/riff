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

  // jsdom has no layout engine, so these cannot measure a box — they assert
  // the class contract the measurements came from instead. Both regressions
  // were found against real WebKit, and both are one deleted utility away
  // from returning.
  it("stacks the panes at the same width the sub-navigation turns horizontal", () => {
    // A `w-full` nav inside a row flex leaves its sibling at `width: 0`, so
    // every setting on the screen stayed in the DOM and none of it was
    // visible. The two breakpoints have to be the same one.
    pathname = "/settings/general";
    const { container } = renderLayout();
    const nav = container.querySelector("nav");
    const outer = nav?.parentElement;
    const breakpoint = nav?.className.match(/(@max-\[[^\]]+\]\/settings):flex-row/)?.[1];

    expect(breakpoint).toBeDefined();
    expect(nav?.className).toContain(`${breakpoint}:w-full`);
    expect(outer?.className).toContain(`${breakpoint}:flex-col`);
  });

  it("aligns the content column with the sub-navigation rather than centring it", () => {
    // `mx-auto` put 348px of empty surface between the sub-navigation and the
    // settings it belongs to at 1920px wide, and 668px at 2560.
    pathname = "/settings/general";
    const { container } = renderLayout();
    const column = container.querySelector("header")?.parentElement;

    expect(column?.className).toContain("max-w-[46rem]");
    expect(column?.className).not.toContain("mx-auto");
  });

  it("has no accessibility violations", async () => {
    pathname = "/settings/general";
    const { container } = renderLayout();
    await expect(container).toHaveNoAxeViolations();
  });
});

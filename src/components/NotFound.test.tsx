import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const windowClose = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { windowClose, logWrite: vi.fn().mockResolvedValue(undefined) },
}));

let pathname = "/nonsense";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouterState: () => pathname,
}));

const { NotFound } = await import("./NotFound");

function renderNotFound() {
  return render(
    <I18nextProvider i18n={i18n}>
      <NotFound />
    </I18nextProvider>,
  );
}

describe("NotFound", () => {
  beforeEach(() => {
    pathname = "/nonsense";
    vi.clearAllMocks();
  });

  it("gives an unknown route Riff's own screen, not the router's", () => {
    // TanStack's fallback is a bare, untranslated `<p>Not Found</p>`.
    renderNotFound();
    expect(screen.getByRole("heading", { name: "There is nothing here" })).toBeInTheDocument();
  });

  it("offers a way back to the application", () => {
    renderNotFound();
    expect(screen.getByRole("link", { name: "Go to Practice" })).toHaveAttribute(
      "href",
      "/practice",
    );
  });

  it("offers to close the window instead when there is no navigation to leave by", async () => {
    // A pop-out has no sidebar. Sending it to /practice would turn one pane
    // into a second copy of the whole application in a 360x320 window.
    pathname = "/popout/score";
    renderNotFound();
    expect(screen.queryByRole("link", { name: "Go to Practice" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(windowClose).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderNotFound();
    await expect(container).toHaveNoAxeViolations();
  });
});

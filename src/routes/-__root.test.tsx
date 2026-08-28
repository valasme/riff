import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const patch = vi.fn().mockResolvedValue(undefined);
const settings = {
  general: {
    startupRoute: "practice",
    lastRoute: "/practice",
    restoreWindowState: true,
    confirmOnQuit: false,
    language: "en",
  },
  appearance: {
    theme: "dark",
    density: "comfortable",
    uiScale: 1,
    reduceMotion: "system",
    highContrast: false,
    titleBar: "custom",
    sidebar: { collapsed: false, rememberCollapsed: true },
  },
  onboarding: { completedAt: "2026-08-28T10:00:00Z", version: 1 },
};

vi.mock("@/stores/settings", () => ({
  useSettings: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ settings, patch }),
    { getState: () => ({ settings, patch }) },
  ),
  useAppearance: () => settings.appearance,
  useTitleBarStyle: () => settings.appearance.titleBar,
  subscribeToBackend: () => Promise.resolve(() => {}),
  reportRecovery: () => {},
}));

// __root.tsx renders outside a router in this test, so its router hooks and
// `Outlet` need a stand-in — the same pattern Sidebar.test.tsx already uses.
vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (options: unknown) => options,
  Outlet: () => null,
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
  useRouterState: () => "/practice",
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// QuitConfirmation listens for a Rust-emitted event; unmocked, `listen`
// reaches for Tauri internals that don't exist under jsdom.
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

const { RootLayout } = await import("./__root");

function renderShell() {
  return render(
    <I18nextProvider i18n={i18n}>
      <RootLayout />
    </I18nextProvider>,
  );
}

describe("the shell", () => {
  it("announces the destination on a route change", async () => {
    renderShell();
    await waitFor(() => expect(screen.getByText(/Navigated to/)).toBeInTheDocument());
  });

  it("opens the palette on alt+k", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.keyboard("{Alt>}k{/Alt}");
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });

  it("does not fire a shortcut while the palette input has focus", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.keyboard("{Alt>}k{/Alt}");
    const input = await screen.findByRole("combobox");
    input.focus();
    await user.keyboard("{Alt>}1{/Alt}");
    // Still open: alt+1 must not navigate out from under someone typing.
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("hides riffs own title bar when system decorations are chosen", async () => {
    settings.appearance.titleBar = "system";
    const { container } = renderShell();
    expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
    settings.appearance.titleBar = "custom";
  });

  it("has no accessibility violations, dialogs included", async () => {
    renderShell();
    await expect(document.body).toHaveNoAxeViolations();
  });
});

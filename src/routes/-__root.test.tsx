import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const reportRecovery = vi.fn();
let pathname = "/practice";
vi.mock("@/stores/settings", () => ({
  useSettings: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ settings, patch }),
    { getState: () => ({ settings, patch }) },
  ),
  useAppearance: () => settings.appearance,
  useTitleBarStyle: () => settings.appearance.titleBar,
  subscribeToBackend: () => Promise.resolve(() => {}),
  reportRecovery: () => reportRecovery(),
}));

// __root.tsx renders outside a router in this test, so its router hooks and
// `Outlet` need a stand-in — the same pattern Sidebar.test.tsx already uses.
vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (options: unknown) => options,
  Outlet: () => null,
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
  useRouterState: () => pathname,
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

const practicePendingReopen = vi.fn().mockResolvedValue([]);
const practiceReopen = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: {
    practicePendingReopen: () => practicePendingReopen(),
    practiceReopen: () => practiceReopen(),
    openPath: vi.fn(),
    windowClose: vi.fn(),
    practicePopOut: vi.fn(),
    practiceDockBack: vi.fn(),
    practiceDockAll: vi.fn(),
  },
}));

const toast = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign(toast, { error: vi.fn(), success: vi.fn() }) }));

const { RootLayout } = await import("./__root");

function renderShell() {
  return render(
    <I18nextProvider i18n={i18n}>
      <RootLayout />
    </I18nextProvider>,
  );
}

describe("the shell", () => {
  beforeEach(() => {
    pathname = "/practice";
    reportRecovery.mockClear();
    toast.mockClear();
    practicePendingReopen.mockClear();
    practiceReopen.mockClear();
  });

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

  it("reopens with the sidebar as it was left, when remembering is on", () => {
    settings.appearance.sidebar = { collapsed: true, rememberCollapsed: true };
    renderShell();
    // Collapsed to the rail: reachable by name, but showing no label.
    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    expect(screen.queryByText("Practice")).toBeNull();
    settings.appearance.sidebar = { collapsed: false, rememberCollapsed: true };
  });

  it("ignores the remembered state when remembering is off", () => {
    // The bug this pins: the session state was seeded from the persisted
    // value, so "don't remember" reopened however the sidebar was last left —
    // which is precisely the behaviour the setting exists to switch off.
    settings.appearance.sidebar = { collapsed: true, rememberCollapsed: false };
    renderShell();
    expect(screen.getByText("Practice")).toBeInTheDocument();
    settings.appearance.sidebar = { collapsed: false, rememberCollapsed: true };
  });

  it("does not move the sidebar when remembering is switched on", async () => {
    // Turning it on adopts what is on screen. Without that the persisted value
    // — stale since the last time remembering was on — snaps the sidebar shut
    // under a user who had just opened it.
    settings.appearance.sidebar = { collapsed: true, rememberCollapsed: false };
    const { rerender } = renderShell();
    patch.mockClear();

    settings.appearance.sidebar = { collapsed: true, rememberCollapsed: true };
    rerender(
      <I18nextProvider i18n={i18n}>
        <RootLayout />
      </I18nextProvider>,
    );

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith({ appearance: { sidebar: { collapsed: false } } }),
    );
    settings.appearance.sidebar = { collapsed: false, rememberCollapsed: true };
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

  it("offers to reopen the panes the last session left in their own windows", async () => {
    practicePendingReopen.mockResolvedValueOnce(["score", "video"]);
    renderShell();
    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    const [message, options] = toast.mock.calls[0] ?? [];
    // Named, and joined the way English joins them. "Score, Video were in
    // their own windows" is not a sentence.
    expect(message).toBe("Score and Video were in their own windows last time.");
    // "Reopen", not "Restore": that word already means the un-maximise glyph
    // and it already means window geometry.
    expect(options?.action?.label).toBe("Reopen");
    expect(options?.cancel?.label).toBe("Not now");
  });

  it("says it in the singular when one pane was out", async () => {
    practicePendingReopen.mockResolvedValueOnce(["audio"]);
    renderShell();
    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0]?.[0]).toBe("Audio was in its own window last time.");
  });

  it("reopens exactly what was offered", async () => {
    practicePendingReopen.mockResolvedValueOnce(["score"]);
    renderShell();
    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    toast.mock.calls[0]?.[1]?.action?.onClick?.({} as never);
    expect(practiceReopen).toHaveBeenCalled();
  });

  it("says nothing at all when every pane was already in the grid", async () => {
    practicePendingReopen.mockResolvedValueOnce([]);
    renderShell();
    await vi.waitFor(() => expect(practicePendingReopen).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });

  it("asks rust once per launch, not once per render", async () => {
    // The list is already gone from the file by the time this runs, so a
    // second ask could only ever return nothing — but an offer that redraws
    // itself on every re-render is a prompt nobody can dismiss.
    practicePendingReopen.mockResolvedValueOnce(["score"]);
    const { rerender } = renderShell();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    rerender(
      <I18nextProvider i18n={i18n}>
        <RootLayout />
      </I18nextProvider>,
    );
    expect(practicePendingReopen).toHaveBeenCalledTimes(1);
  });

  it("announces a recovery in the window that can act on it", () => {
    renderShell();
    expect(reportRecovery).toHaveBeenCalledOnce();
  });

  it("does not re-announce a recovery when a pane is popped out", () => {
    // `recovery` is baked into the init script for the whole process
    // lifetime, and every window mounts this component — so every pane popped
    // out during a recovered session announced all over again that the
    // settings file had been corrupt. The reopen prompt beside it already
    // gets this right; this matches it.
    pathname = "/popout/score";
    renderShell();
    expect(reportRecovery).not.toHaveBeenCalled();
  });
});

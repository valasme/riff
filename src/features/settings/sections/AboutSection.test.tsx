import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const openExternal = vi.fn().mockResolvedValue(undefined);
const writeText = vi.fn().mockResolvedValue(undefined);
const diagnosticsExport = vi.fn().mockResolvedValue(null);

vi.mock("@/stores/settings", () => ({
  useSettings: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      appInfo: {
        version: "0.1.0",
        tauriVersion: "2.11.5",
        webkitVersion: "2.52.6",
        buildDate: "2026-08-28",
        gitSha: "abc1234",
      },
      paths: {
        configDir: "/home/dimitris/.config/riff",
        dataDir: "/home/dimitris/.local/share/riff",
        cacheDir: "/home/dimitris/.cache/riff",
        logDir: "/home/dimitris/.local/state/riff/logs",
        stateDir: "/home/dimitris/.local/state/riff",
        homeDir: "/home/dimitris",
      },
    }),
}));
vi.mock("@/lib/ipc", () => ({ ipc: { openExternal, diagnosticsExport } }));

const { AboutSection } = await import("./AboutSection");

function renderSection() {
  // jsdom now ships its own getter-only `navigator.clipboard` stub, so a
  // plain `Object.assign` throws; the property must be redefined instead.
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return render(
    <I18nextProvider i18n={i18n}>
      <AboutSection />
    </I18nextProvider>,
  );
}

describe("AboutSection", () => {
  it("shows the build identity", () => {
    renderSection();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("2.52.6")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
  });

  it("opens links through the enum command, never a url", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /repository/i }));
    expect(openExternal).toHaveBeenCalledWith("repository");
  });

  it("exports diagnostics through the rust command, not the clipboard", async () => {
    const user = userEvent.setup();
    diagnosticsExport.mockResolvedValueOnce("/tmp/riff-diagnostics.txt");
    renderSection();
    await user.click(screen.getByRole("button", { name: /export/i }));
    expect(diagnosticsExport).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSection();
    await expect(container).toHaveNoAxeViolations();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const openExternal = vi.fn().mockResolvedValue(undefined);
const writeText = vi.fn().mockResolvedValue(undefined);
const diagnosticsExport = vi.fn().mockResolvedValue(null);
const licensesGet = vi.fn().mockResolvedValue([]);
const diagnosticsCheck = vi.fn().mockResolvedValue([]);

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
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: {
    openExternal,
    diagnosticsExport,
    licensesGet,
    diagnosticsCheck,
    logWrite: vi.fn().mockResolvedValue(undefined),
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

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
  beforeEach(() => {
    openExternal.mockClear();
    writeText.mockClear();
    diagnosticsExport.mockClear();
    licensesGet.mockClear();
    diagnosticsCheck.mockClear();
    diagnosticsCheck.mockResolvedValue([]);
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it("reports what riff doctor would report, for someone who never opens a terminal", async () => {
    // `health::run_checks` was a good pure function reachable only from a
    // terminal, so a GUI-first user whose config directory went read-only had
    // no in-app way to learn why saving had stopped working.
    diagnosticsCheck.mockResolvedValue([
      {
        id: "dirs",
        title: "Directories",
        severity: "ok",
        detail: "all present",
        repairable: false,
      },
      {
        id: "writable",
        title: "Permissions",
        severity: "error",
        detail: "not writable: /home/dimitris/.config/riff",
        repairable: false,
      },
    ]);
    renderSection();

    await userEvent.click(screen.getByRole("button", { name: /run checks/i }));
    expect(await screen.findByText(/not writable/)).toBeInTheDocument();
    expect(screen.getByText("Directories")).toBeInTheDocument();
  });

  it("says the checks failed rather than looking like a clean bill of health", async () => {
    diagnosticsCheck.mockRejectedValue(new Error("boom"));
    renderSection();

    await userEvent.click(screen.getByRole("button", { name: /run checks/i }));
    expect(await screen.findByText(/could not be run/i)).toBeInTheDocument();
  });

  it("shows the build identity", () => {
    renderSection();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("2.52.6")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
  });

  it("copies a value to the clipboard", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /copy version/i }));
    expect(writeText).toHaveBeenCalledWith("0.1.0");
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

  it("fetches third-party licences only once the list is expanded", async () => {
    const user = userEvent.setup();
    licensesGet.mockResolvedValueOnce([
      { name: "react", version: "19.1.0", license: "MIT", ecosystem: "npm" },
    ]);
    renderSection();
    expect(licensesGet).not.toHaveBeenCalled();

    await user.click(screen.getByText(/third-party licences/i));

    expect(licensesGet).toHaveBeenCalled();
    expect(await screen.findByText("react@19.1.0")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSection();
    await expect(container).toHaveNoAxeViolations();
  });

  it("distinguishes an empty licence list from one that failed to load", async () => {
    // A search box over a permanently empty list, with no loading state, no
    // error and no retry, is indistinguishable from "Riff has no
    // dependencies".
    licensesGet.mockRejectedValueOnce({ code: "io", details: { path: "p", message: "m" } });
    renderSection();

    await userEvent.click(screen.getByText("Third-party licences"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No package matches that.")).not.toBeInTheDocument();
  });

  it("says so when exporting diagnostics fails — the button pressed when something is already wrong", async () => {
    diagnosticsExport.mockRejectedValueOnce({ code: "io", details: { path: "p", message: "m" } });
    renderSection();

    await userEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(toastError).toHaveBeenCalledOnce();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("reports a repository link that cannot be opened", async () => {
    openExternal.mockRejectedValueOnce({ code: "denied", details: { what: "no browser" } });
    renderSection();

    await userEvent.click(screen.getByRole("button", { name: "Repository" }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledOnce());
  });
});

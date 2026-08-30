import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const patch = vi.fn().mockResolvedValue(undefined);
const reset = vi.fn().mockResolvedValue(undefined);
const openPath = vi.fn().mockResolvedValue(undefined);
const settingsImport = vi.fn().mockResolvedValue(null);
const settingsExport = vi.fn().mockResolvedValue(null);

vi.mock("@/stores/settings", () => ({
  useGeneral: () => ({
    startupRoute: "practice" as const,
    lastRoute: "/practice",
    restoreWindowState: true,
    confirmOnQuit: false,
    language: "en",
  }),
  useSettings: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      patch,
      reset,
      paths: {
        configDir: "/c",
        dataDir: "/d",
        cacheDir: "/k",
        logDir: "/l",
        stateDir: "/s",
        homeDir: "/h",
      },
    }),
}));
// `importOriginal`, not a bare object: `reportFailure` and `fire` live in this
// module too, and stubbing them out would stub out the very behaviour these
// tests exist to check.
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { openPath, settingsImport, settingsExport, logWrite: vi.fn().mockResolvedValue(undefined) },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

const { GeneralSection } = await import("./GeneralSection");

function renderSection() {
  return render(
    <I18nextProvider i18n={i18n}>
      <GeneralSection />
    </I18nextProvider>,
  );
}

describe("GeneralSection", () => {
  beforeEach(() => {
    toastError.mockReset();
    toastSuccess.mockReset();
    patch.mockClear();
    reset.mockClear();
    openPath.mockClear();
  });

  it("draws the startup route as its own listbox, never a native select", () => {
    // GTK paints `<select>` and its popup itself, so on the dark themes the
    // options came out unreadable and no stylesheet could reach them.
    renderSection();
    const trigger = screen.getByRole("combobox", { name: /on launch, open/i });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("select")).toBeNull();
  });

  it("has no language picker while english is the only locale", () => {
    renderSection();
    expect(screen.queryByRole("combobox", { name: /language/i })).not.toBeInTheDocument();
  });

  it("persists the confirm-on-quit switch", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("switch", { name: /confirm before quitting/i }));
    expect(patch).toHaveBeenCalledWith({ general: { confirmOnQuit: true } });
  });

  it("opens a data folder through the enum command, never a path", async () => {
    const user = userEvent.setup();
    renderSection();
    const [firstFolderButton] = screen.getAllByRole("button", { name: /open folder/i });
    if (!firstFolderButton) throw new Error("expected an open-folder button");
    await user.click(firstFolderButton);
    expect(openPath).toHaveBeenCalledWith("config");
  });

  it("guards reset behind a confirmation rather than colour", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(reset).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSection();
    await expect(container).toHaveNoAxeViolations();
  });

  it("tells the user when an import is rejected, and changes nothing", async () => {
    // Rust has a test asserting `settings_import` rejects a malformed file.
    // The frontend dropped that rejection on the floor: the dialog just closed.
    settingsImport.mockRejectedValueOnce({
      code: "parse",
      details: { path: "p", message: "m", line: 2 },
    });
    renderSection();

    await userEvent.click(screen.getByRole("button", { name: "Import settings" }));
    // The confirmation dialog's own Import button — Import is guarded because
    // it goes to arbitrary values from a file and there is no undo.
    const confirms = screen.getAllByRole("button", { name: "Import settings" });
    await userEvent.click(confirms[confirms.length - 1] as HTMLElement);

    expect(toastError).toHaveBeenCalledOnce();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("says a failed export failed rather than looking like success", async () => {
    settingsExport.mockRejectedValueOnce({ code: "io", details: { path: "p", message: "m" } });
    renderSection();

    await userEvent.click(screen.getByRole("button", { name: "Export settings" }));

    expect(toastError).toHaveBeenCalledOnce();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("reports a folder that cannot be opened, rather than leaving a dead button", async () => {
    // A machine with no `xdg-utils` and no file manager. The button did
    // nothing at all, forever, with no way to find out why.
    openPath.mockRejectedValueOnce({ code: "denied", details: { what: "no opener" } });
    renderSection();

    const [open] = screen.getAllByRole("button", { name: "Open folder" });
    await userEvent.click(open as HTMLElement);
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledOnce());
  });
});

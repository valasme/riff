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
vi.mock("@/lib/ipc", () => ({
  ipc: { openPath, settingsImport, settingsExport },
}));

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
    patch.mockClear();
    reset.mockClear();
    openPath.mockClear();
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
});

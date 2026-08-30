import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

let emit: (() => void) | undefined;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, handler: () => void) => {
    emit = handler;
    return Promise.resolve(() => {});
  },
}));
const windowQuitConfirmed = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { windowQuitConfirmed },
}));

const { QuitConfirmation } = await import("./QuitConfirmation");

function renderIt() {
  return render(
    <I18nextProvider i18n={i18n}>
      <QuitConfirmation />
    </I18nextProvider>,
  );
}

describe("QuitConfirmation", () => {
  beforeEach(() => windowQuitConfirmed.mockClear());

  it("stays hidden until rust asks", async () => {
    renderIt();
    await waitFor(() => expect(emit).toBeDefined());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("quits only after the user confirms", async () => {
    const user = userEvent.setup();
    renderIt();
    await waitFor(() => expect(emit).toBeDefined());
    emit?.();

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(windowQuitConfirmed).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Quit" }));
    expect(windowQuitConfirmed).toHaveBeenCalledOnce();
  });

  it("cancelling leaves the window open", async () => {
    const user = userEvent.setup();
    renderIt();
    await waitFor(() => expect(emit).toBeDefined());
    emit?.();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(windowQuitConfirmed).not.toHaveBeenCalled();
  });
});

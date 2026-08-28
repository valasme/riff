import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";
import type { Keybinding } from "@/features/keybindings/keymap";
import { CommandPalette } from "./CommandPalette";

const run = vi.fn();
const bindings: Keybinding[] = [
  {
    id: "nav.practice",
    chord: "alt+1",
    group: "navigation",
    descriptionKey: "palette:commands.nav.practice",
    run,
  },
  {
    id: "nav.history",
    chord: "alt+2",
    group: "navigation",
    descriptionKey: "palette:commands.nav.history",
    run,
  },
  {
    id: "app.quit",
    chord: "ctrl+q",
    group: "application",
    descriptionKey: "palette:commands.app.quit",
    run,
  },
];

function renderPalette(onOpenChange = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CommandPalette open bindings={bindings} onOpenChange={onOpenChange} />
    </I18nextProvider>,
  );
}

describe("CommandPalette", () => {
  it("lists every command with its shortcut", () => {
    renderPalette();
    expect(screen.getByText("Go to Practice")).toBeInTheDocument();
    expect(screen.getByText("Alt+1")).toBeInTheDocument();
  });

  it("filters as you type", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole("combobox"), "hist");
    expect(screen.getByText("Go to History")).toBeInTheDocument();
    expect(screen.queryByText("Quit Riff")).not.toBeInTheDocument();
  });

  it("runs a command and closes", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPalette(onOpenChange);
    await user.click(screen.getByText("Go to History"));
    expect(run).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("has no accessibility violations", async () => {
    renderPalette();
    await expect(document.body).toHaveNoAxeViolations();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

describe("ui primitives", () => {
  it("renders a button with no accessibility violations", async () => {
    const { container } = render(<Button>Open settings</Button>);
    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
    await expect(container).toHaveNoAxeViolations();
  });

  it("renders a labelled switch", async () => {
    const { container } = render(
      <>
        <label htmlFor="probe">Confirm before quitting</label>
        <Switch id="probe" />
      </>,
    );
    expect(screen.getByRole("switch", { name: "Confirm before quitting" })).toBeInTheDocument();
    await expect(container).toHaveNoAxeViolations();
  });

  it("uses riff tokens rather than shadcn defaults", () => {
    const { container } = render(<Button variant="secondary">Probe</Button>);
    const className = container.firstElementChild?.className ?? "";
    expect(className).not.toMatch(/bg-(background|primary|secondary|accent)\b/);
  });
});

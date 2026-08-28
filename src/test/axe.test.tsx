import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("axe matcher", () => {
  it("passes on accessible markup", async () => {
    const { container } = render(
      <main>
        <img src="/x.png" alt="a description" />
      </main>,
    );
    await expect(container).toHaveNoAxeViolations();
  });

  it("fails on an image with no alt text", async () => {
    const { container } = render(
      <main>
        {/* biome-ignore lint/a11y/useAltText: deliberately broken, proving the matcher works */}
        <img src="/x.png" />
      </main>,
    );
    await expect(expect(container).toHaveNoAxeViolations()).rejects.toThrow(/image-alt/);
  });
});

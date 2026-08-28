import axe, { type RunOptions } from "axe-core";
import { expect } from "vitest";

/**
 * Colour contrast is disabled because jsdom does not compute layout or
 * resolved colours, so axe cannot evaluate it and would report false
 * negatives. Contrast is audited by hand in the spec, §7.3.
 */
export async function runAxe(container: Element, options: RunOptions = {}) {
  return axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
    ...options,
  });
}

expect.extend({
  async toHaveNoAxeViolations(received: Element) {
    const { violations } = await runAxe(received);
    if (violations.length === 0) {
      return { pass: true, message: () => "expected accessibility violations, found none" };
    }
    const detail = violations
      .map((v) => `  [${v.id}] ${v.help}\n    ${v.nodes.map((n) => n.html).join("\n    ")}`)
      .join("\n");
    return {
      pass: false,
      message: () => `expected no accessibility violations, found ${violations.length}:\n${detail}`,
    };
  },
});

declare module "vitest" {
  // biome-ignore lint/suspicious/noExplicitAny: must match the installed Vitest's `Matchers<T = any>` signature exactly for declaration merging
  interface Matchers<T = any> {
    toHaveNoAxeViolations(): Promise<T>;
  }
}

// If `pnpm typecheck` reports that `toHaveNoAxeViolations` does not exist on
// the assertion, the installed Vitest names or parameterises this interface
// differently. Check `node_modules/vitest/dist/index.d.ts` for the interface
// `expect.extend` augments and match it — do not cast the expectation.

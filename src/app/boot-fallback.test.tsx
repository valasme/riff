import { act } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

/**
 * The markup that ships in `index.html`, read from the file rather than
 * retyped: the guarantee is about what a user's window actually contains.
 */
const INDEX = Object.values(
  import.meta.glob("/index.html", { query: "?raw", import: "default", eager: true }),
)[0] as string;

function rootMarkup(): string {
  const opened = INDEX.indexOf('<div id="root">');
  const closed = INDEX.indexOf("<script", opened);
  expect(opened).toBeGreaterThan(-1);
  return INDEX.slice(opened, closed);
}

describe("the static boot fallback", () => {
  it("says Riff failed to start and where the log is", () => {
    // An import-time throw leaves a blank #242424 rectangle: React never
    // mounts, so no error boundary exists to catch anything, and the reveal
    // watchdog shows an empty window three seconds later.
    const markup = rootMarkup();
    expect(markup).toContain("Riff could not start");
    expect(markup).toContain("logs/latest/riff.log");
    expect(markup).toContain("riff doctor");
  });

  it("carries no script, so the CSP stays strict", () => {
    // An inline <script> here would force `script-src 'unsafe-inline'`, which
    // is the exact directive the bootstrap plugin exists to avoid needing.
    expect(rootMarkup()).not.toContain("<script");
  });

  it("is replaced by the first React render, so a healthy launch never shows it", () => {
    const container = document.createElement("div");
    container.innerHTML = rootMarkup()
      .replace('<div id="root">', "")
      .replace(/<\/div>\s*$/, "");
    document.body.append(container);
    expect(container.textContent).toContain("Riff could not start");

    act(() => {
      createRoot(container).render(<p>the application</p>);
    });

    expect(container.textContent).not.toContain("Riff could not start");
    expect(container.textContent).toContain("the application");
    container.remove();
  });
});

import { describe, expect, it } from "vitest";

/**
 * Call site twenty-one.
 *
 * Biome cannot express this. Its `noFloatingPromises` is nursery, needs type
 * information, and — being a rule about *unhandled* promises — treats
 * `void x()` as the marker that says "I meant this", which is the exact
 * pattern the error-handling audit found at around twenty call sites. Reading
 * the source instead follows `src-tauri/tests/no_template_code.rs`, which
 * guards its own convention the same way.
 *
 * The convention: either give the rejection a voice with `fire()` or
 * `reportFailure()`, or swallow it in writing with `.catch(...)` and a comment
 * saying why there is nowhere to report it to. `appReady` and `logWrite` are
 * the two that genuinely have nowhere.
 *
 * `import.meta.glob`, not `node:fs`: the application's tsconfig deliberately
 * carries no Node types, and widening it so one test can call `readdirSync`
 * would let application code reference `process` in a webview that has none.
 */
const SOURCES = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The whole statement, not the line: the chain that offers to reopen last
 * session's panes puts its `.catch` nine lines and two nested statements after
 * the `void`, so depth has to be tracked rather than stopping at the first
 * semicolon.
 */
function statementAt(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === ";" && depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

function silentCalls(source: string): string[] {
  const offences: string[] = [];
  for (const match of source.matchAll(/\bvoid\s+ipc\b/g)) {
    const statement = statementAt(source, match.index);
    if (!statement.includes(".catch(")) offences.push(statement.split("\n")[0] ?? "");
  }
  return offences;
}

function isApplicationSource(path: string): boolean {
  if (path.includes(".test.") || path.endsWith("routeTree.gen.ts")) return false;
  // The module that defines `fire` and `reportFailure` necessarily writes out
  // the pattern they replace, in the comment explaining why they exist.
  return path !== "/src/lib/ipc/index.ts";
}

describe("no silent ipc call", () => {
  it("recognises a call that drops its rejection, and one that keeps it", () => {
    expect(silentCalls("void ipc.openPath('logs');")).toHaveLength(1);
    expect(silentCalls("void ipc.appReady().catch(() => {});")).toHaveLength(0);
    expect(
      silentCalls("void ipc\n  .practicePendingReopen()\n  .then(() => { a(); })\n  .catch(x);"),
    ).toHaveLength(0);
    expect(silentCalls("fire(ipc.openPath('logs'), 'opening a folder');")).toHaveLength(0);
  });

  it("finds no call in the application that drops its rejection on the floor", () => {
    const files = Object.keys(SOURCES).filter(isApplicationSource);
    expect(files.length).toBeGreaterThan(20);

    const offences = files.flatMap((path) =>
      silentCalls(SOURCES[path] ?? "").map((statement) => `${path}: ${statement}`),
    );
    expect(offences).toEqual([]);
  });
});

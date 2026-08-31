import { describe, expect, it } from "vitest";
import common from "@/locales/en/common.json";
// `?raw` rather than `node:fs`: typed by `vite/client`, which this tsconfig
// already pulls in, and no path arithmetic to get wrong.
import glossary from "../../../../CONTEXT.md?raw";

/**
 * `CONTEXT.md` is the glossary, and CLAUDE.md says to use its words and not
 * their synonyms. Each entry carries an `_Avoid_` list of the words that
 * were considered and rejected — usually because they already mean
 * something else in Riff.
 *
 * This exists because the rule was broken in exactly the way it is meant to
 * catch: the page-layout toggle shipped labelled "Scrolling continuously",
 * which is the "scrolling mode" the Auto-scroll entry forbids, and the first
 * person to use it reported auto-scroll as broken — a feature that had not
 * been built yet.
 *
 * Scoped to the score strings rather than every catalogue: several avoided
 * words (`session`, `restore`, `file`) are legitimate elsewhere in Riff, and
 * a check that cries wolf gets deleted.
 */

const AVOIDED = new Map<string, string>([
  ["autoplay", "Auto-scroll"],
  ["page turner", "Auto-scroll"],
  ["scrolling mode", "Auto-scroll"],
  ["night mode", "Dim"],
  ["dark mode", "Dim"],
  ["invert", "Dim"],
  ["two-up", "Spread"],
  ["facing pages", "Spread"],
  ["dual page", "Spread"],
  ["zoom to fit", "Fit width / Fit page"],
  ["auto zoom", "Fit width / Fit page"],
  ["fit screen", "Fit width / Fit page"],
  ["freeze", "Pin"],
]);

function scoreStrings(): [string, string][] {
  const found: [string, string][] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") return found.push([path, node]);
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
    }
  };
  walk(common.score, "score");
  return found;
}

describe("the score interface speaks the glossary's language", () => {
  it("uses no word CONTEXT.md rejects", () => {
    const offences = scoreStrings().flatMap(([path, text]) =>
      [...AVOIDED]
        .filter(([word]) => text.toLowerCase().includes(word))
        .map(([word, term]) => `${path} says "${word}", which CONTEXT.md's ${term} entry rejects`),
    );
    expect(offences).toEqual([]);
  });

  // The list above is a transcription, and a transcription rots. This
  // fails if an entry is edited out of CONTEXT.md so the guard cannot go on
  // quietly checking words nobody avoids any more.
  it("checks words CONTEXT.md still actually rejects", () => {
    const text = glossary.toLowerCase();
    for (const word of AVOIDED.keys()) {
      expect(text, `CONTEXT.md no longer rejects "${word}"`).toContain(word);
    }
  });
});

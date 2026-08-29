import { describe, expect, it } from "vitest";
import { dockedPanes, gridShape, PANES } from "./layout";

describe("the practice grid", () => {
  it("keeps the mockup's arrangement while all three panes are docked", () => {
    expect(gridShape(PANES)).toBe("feature");
  });

  it("reflows evenly when a pane pops out", () => {
    // Two full-height columns, not one column and a hole. A ghost in the
    // vacated slot would keep the cramping and remove the content, which is
    // the opposite of the point.
    expect(gridShape(["video", "audio"])).toBe("columns");
    expect(gridShape(["score", "audio"])).toBe("columns");
  });

  it("gives the last pane the whole area", () => {
    expect(gridShape(["score"])).toBe("full");
  });

  it("has an empty state rather than a grid of nothing", () => {
    expect(gridShape([])).toBe("empty");
  });

  it("lists the docked panes in the order the grid draws them", () => {
    // Not the order they were docked back in: the chips above the grid and
    // the panes inside it have to read the same way round.
    expect(dockedPanes(["video"])).toEqual(["score", "audio"]);
    expect(dockedPanes([])).toEqual(["score", "video", "audio"]);
    expect(dockedPanes(PANES)).toEqual([]);
  });
});

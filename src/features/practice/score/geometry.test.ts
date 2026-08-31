import { describe, expect, it } from "vitest";
import { scaleValue } from "./geometry";

describe("scaleValue", () => {
  it("maps fit width to the string pdf.js recognises", () => {
    expect(scaleValue({ mode: "fit-width" })).toBe("page-width");
  });

  it("maps fit page to the string pdf.js recognises", () => {
    expect(scaleValue({ mode: "fit-page" })).toBe("page-fit");
  });

  it("passes free zoom through as a number, which is how pdf.js tells the two apart", () => {
    expect(scaleValue({ mode: "custom", value: 1.25 })).toBe(1.25);
  });
});

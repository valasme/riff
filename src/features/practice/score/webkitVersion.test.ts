import { describe, expect, it } from "vitest";
import { MIN_WEBKITGTK, meetsMinimumWebkit } from "./webkitVersion";

describe("meetsMinimumWebkit", () => {
  it("accepts a runtime newer than the floor", () => {
    expect(meetsMinimumWebkit("2.52.6")).toBe(true);
  });

  it("accepts a runtime exactly at the floor", () => {
    expect(meetsMinimumWebkit(MIN_WEBKITGTK)).toBe(true);
  });

  it("rejects a runtime older than the floor", () => {
    expect(meetsMinimumWebkit("2.30.2")).toBe(false);
  });

  it("compares the minor version when the major version ties", () => {
    expect(meetsMinimumWebkit("2.35.9")).toBe(false);
    expect(meetsMinimumWebkit("2.36.0")).toBe(true);
  });

  it("compares the patch version when major and minor tie", () => {
    expect(meetsMinimumWebkit("2.36.0", "2.36.1")).toBe(false);
    expect(meetsMinimumWebkit("2.36.1", "2.36.1")).toBe(true);
  });

  it("treats an unparsable runtime string as the lowest possible version", () => {
    expect(meetsMinimumWebkit("unknown")).toBe(false);
  });
});

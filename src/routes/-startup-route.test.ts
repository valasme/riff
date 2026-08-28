import { describe, expect, it } from "vitest";
import { resolveStartupRoute } from "@/lib/startup-route";

const KNOWN = ["/practice", "/history", "/settings/general"];

describe("resolveStartupRoute", () => {
  it("uses the named route", () => {
    expect(resolveStartupRoute("history", "/practice", KNOWN)).toBe("/history");
  });

  it("uses the last route when asked to", () => {
    expect(resolveStartupRoute("last-used", "/settings/general", KNOWN)).toBe("/settings/general");
  });

  it("never restores onboarding, which would trap the user in a finished wizard", () => {
    expect(resolveStartupRoute("last-used", "/onboarding", KNOWN)).toBe("/practice");
  });

  it("falls back when the last route no longer exists after an update", () => {
    expect(resolveStartupRoute("last-used", "/removed-feature", KNOWN)).toBe("/practice");
  });

  it("falls back when the last route is empty", () => {
    expect(resolveStartupRoute("last-used", "", KNOWN)).toBe("/practice");
  });
});

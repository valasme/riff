import { describe, expect, it } from "vitest";
import i18n from "./i18n";

describe("i18n", () => {
  it("initialises with english as the only locale", () => {
    expect(i18n.language).toBe("en");
    expect(Object.keys(i18n.options.resources ?? {})).toEqual(["en"]);
  });

  it("resolves keys from every declared namespace", () => {
    expect(i18n.t("common:appName")).toBe("Riff");
    expect(i18n.t("nav:practice")).toBe("Practice");
    expect(i18n.t("errors:code.denied")).toBe("Your system refused that action.");
  });

  it("interpolates", () => {
    expect(i18n.t("nav:routeAnnouncement", { name: "History" })).toBe("Navigated to History");
  });

  it("returns the key rather than blank text when one is missing", () => {
    expect(i18n.t("common:doesNotExist")).toBe("doesNotExist");
  });
});

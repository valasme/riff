import { describe, expect, it } from "vitest";
import { redact, usernameFrom } from "./redact";

describe("redact", () => {
  it("rewrites the home directory and the username, like the rust bundle does", () => {
    const text = "error at /home/dimitris/.config/riff/settings.json for dimitris";
    const redacted = redact(text, "/home/dimitris");
    expect(redacted).toContain("$HOME/.config/riff/settings.json");
    expect(redacted).not.toContain("dimitris");
  });

  it("replaces every occurrence, not only the first", () => {
    const redacted = redact("/home/u/a and /home/u/b", "/home/u");
    expect(redacted).toBe("$HOME/a and $HOME/b");
  });

  it("is a no-op when the home directory is unknown", () => {
    expect(redact("plain text", "")).toBe("plain text");
  });

  it("does not treat a home directory as a regular expression", () => {
    // A path is not a pattern. `.` and `+` in one would otherwise match
    // characters the user never had in their name.
    expect(redact("/home/a.b+c/x", "/home/a.b+c")).toBe("$HOME/x");
    expect(redact("/home/axbXc/x", "/home/a.b+c")).toBe("/home/axbXc/x");
  });

  it("reads the username off the home directory", () => {
    expect(usernameFrom("/home/dimitris")).toBe("dimitris");
    expect(usernameFrom("/home/dimitris/")).toBe("dimitris");
    expect(usernameFrom("/root")).toBe("root");
    expect(usernameFrom("")).toBe("");
  });

  it("never redacts a username short enough to appear inside ordinary words", () => {
    // Rust reads $USER and replaces it outright. Here it is derived, so a
    // one- or two-letter home directory would turn "io" into "$USERr" all
    // through a stack trace and make the panel useless.
    expect(redact("the ratio of io errors", "/home/io")).toBe("the ratio of io errors");
  });
});

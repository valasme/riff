/**
 * Mirrors `diagnostics::bundle::redact`. The rule lives in two places because
 * the two places have different inputs, not because anyone wanted a copy: Rust
 * reads `$HOME` and `$USER` from the environment, and the webview has neither
 * — only `paths.homeDir`, which is carried in the bootstrap payload expressly
 * so this can happen.
 *
 * Without it, "Copy error details" put the account name on the clipboard of
 * the one affordance built to keep it off.
 */
const MIN_USERNAME = 3;

export function redact(text: string, home: string): string {
  if (!home) return text;
  let out = replaceAll(text, home, "$HOME");
  const user = usernameFrom(home);
  // Rust replaces `$USER` outright because it read the real value. Here it is
  // derived from a path, so a short one would rewrite the middle of ordinary
  // words — "the ratio of io errors" is not a leak, and turning it into
  // "the rat$USER of $USER errors" would make the technical panel unreadable
  // while protecting nothing.
  if (user.length >= MIN_USERNAME) out = replaceAll(out, user, "$USER");
  return out;
}

/** The last segment of the home directory. */
export function usernameFrom(home: string): string {
  const trimmed = home.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/**
 * `split`/`join` rather than a `RegExp`: a home directory is a path, not a
 * pattern, and a `.` or `+` in one would match characters the user never had.
 * `String.replaceAll` needs ES2021 and the build targets ES2020.
 */
function replaceAll(text: string, needle: string, replacement: string): string {
  return text.split(needle).join(replacement);
}

/** Modifier order is fixed so a chord string is comparable by equality. */
export function chordFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (event.metaKey) parts.push("meta");
  parts.push(event.key.toLowerCase());
  return parts.join("+");
}

const TYPING_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "password",
  "number",
  "tel",
  "",
]);

/**
 * A shortcut firing while someone types is the fastest way to make an
 * application feel broken. `Escape` is exempt, because closing an overlay is
 * exactly what a typing user reaches for.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TYPING_INPUT_TYPES.has(target.type);
  return false;
}

export function formatChord(chord: string): string {
  return chord
    .split("+")
    .map((part) => {
      if (part.length === 1) return part.toUpperCase();
      const [first, ...rest] = part;
      return first ? first.toUpperCase() + rest.join("") : part;
    })
    .join("+");
}

/**
 * Mirrors the Rust merge patch in `src-tauri/src/settings/patch.rs`:
 * `undefined` and `null` mean "not supplied" and are skipped, never "clear".
 * Used only to compute the optimistic value; the authoritative result is
 * whatever Rust returns.
 */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base;
  if (typeof patch !== "object" || Array.isArray(patch)) return patch as T;
  if (typeof base !== "object" || base === null) return patch as T;

  const result = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    result[key] = mergeDeep(result[key], value);
  }
  return result as T;
}

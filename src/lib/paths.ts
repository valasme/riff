import type { AppPaths, PathKind } from "@/lib/ipc";

/** `logs` maps to `logDir`, not `logsDir`. That single irregularity is the
 *  whole reason this lives in one place. */
const FIELD: Record<PathKind, keyof AppPaths> = {
  config: "configDir",
  data: "dataDir",
  cache: "cacheDir",
  logs: "logDir",
};

export const PATH_KINDS: PathKind[] = ["config", "data", "cache", "logs"];

export function pathFor(kind: PathKind, paths: AppPaths): string {
  return paths[FIELD[kind]];
}

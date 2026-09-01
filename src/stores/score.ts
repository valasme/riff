import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { create } from "zustand";
import i18n from "@/app/i18n";
import { scoreErrorMessage } from "@/features/practice/score/scoreError";
import {
  ipc,
  isRiffError,
  type OpenScore,
  type RiffError,
  reportFailure,
  type ScoreGeneration,
  type View,
} from "@/lib/ipc";

export const SCORE_CHANGED = "score://changed";
export const SCORE_OPEN_FAILED = "score://open-failed";

export type ScoreState = {
  initialised: boolean;
  open: OpenScore | null;
  operationError: RiffError | null;
  subscribe: () => Promise<() => void>;
  openFromPicker: () => Promise<void>;
  reopen: () => Promise<void>;
  close: (generation: ScoreGeneration) => Promise<void>;
  adoptView: (generation: ScoreGeneration, view: View) => void;
  clearOperationError: () => void;
};

let installation: Promise<() => void> | null = null;
let subscribers = 0;

function stale(error: unknown): boolean {
  return isRiffError(error) && error.code === "score-stale";
}

export function isScoreStale(error: unknown): boolean {
  return stale(error);
}

export function isScoreInfrastructure(error: unknown): boolean {
  return isRiffError(error) && error.code === "score-infrastructure";
}

async function install(): Promise<() => void> {
  let sequence = 0;
  const unlisteners: Array<() => void> = [];
  try {
    unlisteners.push(
      await listen<OpenScore | null>(SCORE_CHANGED, ({ payload }) => {
        sequence += 1;
        useScore.setState({ initialised: true, open: payload, operationError: null });
      }),
    );
    unlisteners.push(
      await listen<RiffError>(SCORE_OPEN_FAILED, ({ payload }) => {
        if (stale(payload)) return;
        if (useScore.getState().open) {
          toast.error(scoreErrorMessage(payload, (key, options) => i18n.t(key, options)));
        } else {
          useScore.setState({ initialised: true, operationError: payload });
        }
      }),
    );
  } catch (error) {
    for (const unlisten of unlisteners) unlisten();
    useScore.setState({
      initialised: true,
      operationError: {
        code: "score-infrastructure",
        details: { operation: "subscribing to score events" },
      },
    });
    reportFailure(error, "subscribing to score events");
  }
  const beforeSeed = sequence;
  try {
    const snapshot = await ipc.scoreState();
    if (sequence === beforeSeed)
      useScore.setState({ initialised: true, open: snapshot, operationError: null });
  } catch (error) {
    useScore.setState({
      initialised: true,
      operationError: {
        code: "score-infrastructure",
        details: { operation: "reading score state" },
      },
    });
    reportFailure(error, "reading score state");
  }
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

async function acquire(): Promise<() => void> {
  subscribers += 1;
  installation ??= install();
  try {
    const uninstall = await installation;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      subscribers -= 1;
      if (subscribers === 0) {
        uninstall();
        installation = null;
      }
    };
  } catch (error) {
    subscribers -= 1;
    if (subscribers === 0) installation = null;
    throw error;
  }
}

export const useScore = create<ScoreState>((set, get) => ({
  initialised: false,
  open: null,
  operationError: null,
  subscribe: acquire,
  openFromPicker: async () => {
    set({ operationError: null });
    try {
      const open = await ipc.scoreOpen();
      if (open) set({ open, operationError: null, initialised: true });
    } catch (error) {
      if (stale(error)) return;
      if (isScoreInfrastructure(error) || !isRiffError(error))
        reportFailure(error, "opening a score");
      else if (get().open)
        toast.error(scoreErrorMessage(error, (key, options) => i18n.t(key, options)));
      else set({ operationError: error });
    }
  },
  reopen: async () => {
    set({ operationError: null });
    try {
      const open = await ipc.scoreReopen();
      if (open) set({ open, operationError: null, initialised: true });
    } catch (error) {
      if (stale(error)) return;
      if (isScoreInfrastructure(error) || !isRiffError(error))
        reportFailure(error, "reopening a score");
      else if (get().open)
        toast.error(scoreErrorMessage(error, (key, options) => i18n.t(key, options)));
      else set({ operationError: error });
    }
  },
  close: async (generation) => {
    try {
      if (await ipc.scoreClose(generation)) set({ open: null, operationError: null });
    } catch (error) {
      if (!stale(error)) reportFailure(error, "closing the score");
    }
  },
  adoptView: (generation, view) => {
    const open = get().open;
    if (open?.generation === generation) set({ open: { ...open, view } });
  },
  clearOperationError: () => set({ operationError: null }),
}));

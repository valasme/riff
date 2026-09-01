import { act, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";
import type { OpenScore } from "@/lib/ipc";
import { useScore } from "@/stores/score";

let notifyFirstPagePaint: (() => void) | undefined;

vi.mock("./ScoreViewer", () => ({
  ScoreViewer: ({ onFirstPagePaint }: { onFirstPagePaint?: () => void }) => {
    notifyFirstPagePaint = onFirstPagePaint;
    return <div data-testid="score-viewer-stub" />;
  },
}));

const { ScoreSurface } = await import("./ScoreSurface");

const OPEN: OpenScore = {
  generation: "g1",
  score: { name: "engraved.pdf", size: 1024 },
  view: {
    page: 1,
    scale: { mode: "fit-width" },
    rotation: 0,
    spread: "none",
    scrollMode: "continuous",
    autoScrollSpeed: 1,
  },
};

describe("ScoreSurface", () => {
  afterEach(() => {
    vi.useRealTimers();
    notifyFirstPagePaint = undefined;
    useScore.setState({ open: null, operationError: null, initialised: false });
  });

  it("does not show the slow-loading notice after the restored page paints", () => {
    vi.useFakeTimers();
    render(
      <I18nextProvider i18n={i18n}>
        <ScoreSurface open={OPEN} />
      </I18nextProvider>,
    );

    act(() => notifyFirstPagePaint?.());
    act(() => vi.advanceTimersByTime(10_000));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the viewer in a flex column so its flex-growing canvas receives height", () => {
    render(
      <>
        <style>{`.flex { display: flex; } .flex-col { flex-direction: column; }`}</style>
        <I18nextProvider i18n={i18n}>
          <ScoreSurface open={OPEN} />
        </I18nextProvider>
      </>,
    );

    const surface = screen.getByTestId("score-viewer-stub").parentElement;
    expect(surface).not.toBeNull();
    expect(getComputedStyle(surface as HTMLElement).display).toBe("flex");
    expect(getComputedStyle(surface as HTMLElement).flexDirection).toBe("column");
  });
});

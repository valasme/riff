import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const patch = vi.fn().mockResolvedValue(undefined);
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
// `OnboardingFlow.finish()` reads `router.routesById` directly (not through a
// hook), so the real module — and the whole route tree it imports — must be
// mocked out too, or importing the component pulls in every route file and
// the unmocked `@tanstack/react-router` exports they need.
vi.mock("@/app/router", () => ({
  router: { routesById: { "/practice": {}, "/history": {}, "/settings/general": {} } },
}));
const state = {
  patch,
  paths: { configDir: "/c", dataDir: "/d", cacheDir: "/k", logDir: "/l", stateDir: "/s" },
  settings: { general: { startupRoute: "practice" as const, lastRoute: "/practice" } },
};
// `finish()` also calls `useSettings.getState()` directly, not through the
// hook, so the mock needs that static method alongside being callable.
function useSettingsMock(selector: (s: typeof state) => unknown) {
  return selector(state);
}
useSettingsMock.getState = () => state;
vi.mock("@/stores/settings", () => ({ useSettings: useSettingsMock }));
const openPath = vi.fn();
vi.mock("@/lib/ipc", () => ({ ipc: { openPath } }));

const { OnboardingFlow } = await import("./OnboardingFlow");

function renderFlow() {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true })); // desktop prefers light
  return render(
    <I18nextProvider i18n={i18n}>
      <OnboardingFlow />
    </I18nextProvider>,
  );
}

describe("OnboardingFlow", () => {
  beforeEach(() => {
    patch.mockClear();
    navigate.mockClear();
  });

  it("starts on welcome and reports progress", () => {
    renderFlow();
    expect(screen.getByText(/Practice everything in one place/)).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("applies the suggested theme on arrival at the theme step", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(patch).toHaveBeenCalledWith({ appearance: { theme: "light" } });
  });

  it("commits the suggestion when the user continues without choosing", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i })); // → theme
    patch.mockClear();
    await user.click(screen.getByRole("button", { name: /continue/i })); // → privacy
    await user.click(screen.getByRole("button", { name: /start practising/i }));

    const lastCall = patch.mock.calls[patch.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected patch to have been called");
    const completion = lastCall[0];
    expect(completion.onboarding.completedAt).toEqual(expect.any(String));
    expect(completion.onboarding.version).toBe(1);
  });

  it("applies the other theme instantly when chosen", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    patch.mockClear();
    // Exact, not /^Dark/: "Darker" now starts with the same four letters.
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(patch).toHaveBeenCalledWith({ appearance: { theme: "dark" } });
  });

  it("opens a data location from the privacy step", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i })); // → theme
    await user.click(screen.getByRole("button", { name: /continue/i })); // → privacy

    const [firstOpenFolder] = screen.getAllByRole("button", { name: /open folder/i });
    if (!firstOpenFolder) throw new Error("expected at least one data location row");
    await user.click(firstOpenFolder);
    expect(openPath).toHaveBeenCalled();
  });

  it("can go back", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("navigates away once finished", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /start practising/i }));
    expect(navigate).toHaveBeenCalledWith({ to: "/practice" });
  });

  it("has no accessibility violations", async () => {
    const { container } = renderFlow();
    await expect(container).toHaveNoAxeViolations();
  });
});

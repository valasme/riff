import {
  createRootRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RouteError } from "@/components/RouteError";
import { Sidebar } from "@/components/Sidebar";
import { createKeymap } from "@/features/keybindings/keymap";
import { useKeybindings } from "@/features/keybindings/useKeybindings";
import { ONBOARDING_VERSION, shouldShowOnboarding } from "@/features/onboarding/gate";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { QuitConfirmation } from "@/features/window/QuitConfirmation";
import { TitleBar } from "@/features/window/TitleBar";
import { ipc } from "@/lib/ipc";
import { reportRecovery, subscribeToBackend, useAppearance, useSettings } from "@/stores/settings";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  beforeLoad: ({ location }) => {
    const { onboarding } = useSettings.getState().settings;
    const needed = shouldShowOnboarding(onboarding, ONBOARDING_VERSION);
    if (needed && location.pathname !== "/onboarding") {
      throw redirect({ to: "/onboarding" });
    }
    if (!needed && location.pathname === "/onboarding") {
      throw redirect({ to: "/practice" });
    }
  },
});

export function RootLayout() {
  const { t, i18n } = useTranslation("nav");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [announcement, setAnnouncement] = useState("");
  const { collapsed, rememberCollapsed } = useAppearance().sidebar;
  const titleBar = useAppearance().titleBar;
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  // The sidebar's state for this session only, used when the user has asked
  // Riff *not* to remember. It starts expanded rather than seeded from
  // `collapsed`: seeding it from the persisted value is what made "don't
  // remember" remember, so every launch reopened however the sidebar happened
  // to be left, which is the behaviour the setting exists to switch off.
  const [sessionCollapsed, setSessionCollapsed] = useState(false);
  const effectiveCollapsed = rememberCollapsed ? collapsed : sessionCollapsed;
  const onboardingActive = pathname === "/onboarding";
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();

  const toggleSidebar = useCallback(() => {
    if (rememberCollapsed) {
      void patch({ appearance: { sidebar: { collapsed: !collapsed } } });
    } else {
      setSessionCollapsed((v) => !v);
    }
  }, [rememberCollapsed, collapsed, patch]);

  // Flipping "Remember sidebar state" must not move the sidebar. Whichever
  // value stops being the live one has to adopt what is currently on screen
  // first, or the switch resurrects a stale value from whenever that side was
  // last in charge — collapsing a sidebar the user had just opened, or the
  // reverse. Only the flip itself does this, which is why the previous value
  // is tracked in a ref: on mount the two agree and nothing is written.
  const rememberWas = useRef(rememberCollapsed);
  useEffect(() => {
    const was = rememberWas.current;
    rememberWas.current = rememberCollapsed;
    if (was === rememberCollapsed) return;
    if (rememberCollapsed) {
      if (collapsed !== sessionCollapsed) {
        void patch({ appearance: { sidebar: { collapsed: sessionCollapsed } } });
      }
    } else {
      setSessionCollapsed(collapsed);
    }
  }, [rememberCollapsed, collapsed, sessionCollapsed, patch]);

  const bindings = useMemo(
    () =>
      createKeymap({
        navigate,
        togglePalette: () => setPaletteOpen((v) => !v),
        toggleSidebar,
        patch: (p) => void patch(p),
        settings,
        openPath: (kind) => void ipc.openPath(kind),
        quit: () => void ipc.windowClose(),
        closeOverlay: () => setPaletteOpen(false),
      }),
    [navigate, toggleSidebar, patch, settings],
  );

  useKeybindings(bindings);

  useEffect(() => {
    reportRecovery();
    const unsubscribe = subscribeToBackend();
    return () => void unsubscribe.then((off) => off());
  }, []);

  // A client-side route change is silent to a screen reader. This is the
  // only thing that tells one the destination changed.
  // §10 requires both, and `dir` is what makes adding an RTL locale a
  // translation task rather than a rewrite.
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = i18n.dir();
  }, [i18n.language, i18n.dir]);

  useEffect(() => {
    const name = pathname.split("/").filter(Boolean)[0] ?? "practice";
    setAnnouncement(t("routeAnnouncement", { name: t(name, { defaultValue: name }) }));
    // Only tracked when the user asked for it, so a setting nobody uses costs
    // nothing in writes.
    if (useSettings.getState().settings.general.startupRoute === "last-used") {
      void useSettings.getState().patch({ general: { lastRoute: pathname } });
    }
  }, [pathname, t]);

  return (
    <div className="flex h-screen flex-col bg-surface text-foreground">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:z-50 focus-visible:m-2 focus-visible:rounded-[var(--radius-control)] focus-visible:border focus-visible:border-line focus-visible:bg-card focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium"
      >
        {t("skipToContent")}
      </a>
      {/* Choosing System decorations has to hide Riff's own bar live, or the
          window ends up with two title bars stacked. */}
      {titleBar === "custom" && (
        <TitleBar
          onToggleSidebar={toggleSidebar}
          // The toggle needs the state, not only the handler: without it the
          // button showed one icon for both directions and never said which
          // way it was about to go.
          sidebarCollapsed={effectiveCollapsed}
          onOpenPalette={() => setPaletteOpen(true)}
        />
      )}
      {/* The container the sidebar's rail breakpoint measures. The query is
          written in rem, so raising the UI scale grows the threshold while the
          window stays the same number of pixels — which is what makes the rail
          appear exactly when the chrome would otherwise crowd the content. A
          viewport media query could not respond to scale at all. */}
      <div className="@container/shell flex min-h-0 flex-1">
        {!onboardingActive && <Sidebar collapsed={effectiveCollapsed} />}
        <main id="main" className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <CommandPalette open={paletteOpen} bindings={bindings} onOpenChange={setPaletteOpen} />
      <QuitConfirmation />
    </div>
  );
}

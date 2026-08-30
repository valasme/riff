import {
  createRootRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RouteError } from "@/components/RouteError";
import { Sidebar } from "@/components/Sidebar";
import { createKeymap } from "@/features/keybindings/keymap";
import { useKeybindings } from "@/features/keybindings/useKeybindings";
import { ONBOARDING_VERSION, shouldShowOnboarding } from "@/features/onboarding/gate";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { popoutPaneFrom } from "@/features/practice/layout";
import { PANE_ICONS } from "@/features/practice/paneIcons";
import { PopoutQuitDialog } from "@/features/window/PopoutQuitDialog";
import { QuitConfirmation } from "@/features/window/QuitConfirmation";
import { TitleBar } from "@/features/window/TitleBar";
import { fire, ipc } from "@/lib/ipc";
import { reportRecovery, subscribeToBackend, useAppearance, useSettings } from "@/stores/settings";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  beforeLoad: ({ location }) => {
    // A pop-out is exempt. Re-running first-time setup does not close the
    // pop-out windows, and a score window that turned itself into the welcome
    // wizard would have no sidebar to escape by.
    if (isPopout(location.pathname)) return;
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

/**
 * `/popout/score` and friends. Every window shares this component, so most of
 * what follows asks this before drawing navigation chrome.
 *
 * Deliberately looser than `popoutPaneFrom`, which validates the segment: a
 * hand-typed `#/popout/bogus` is *not* a pane, so it keeps its sidebar and can
 * be navigated away from — but it is still not somewhere `lastRoute` should
 * remember, because `startupRoute: last-used` would then launch into a 404
 * every time. The two questions differ, so the two functions do.
 */
export function isPopout(pathname: string): boolean {
  return pathname.startsWith("/popout/");
}

export function RootLayout() {
  const { t, i18n } = useTranslation(["nav", "common"]);
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
  const popoutPane = popoutPaneFrom(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quitPromptOpen, setQuitPromptOpen] = useState(false);
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
        scope: popoutPane ? "popout" : "main",
        pane: popoutPane,
        navigate,
        togglePalette: () => setPaletteOpen((v) => !v),
        toggleSidebar,
        patch: (p) => void patch(p),
        settings,
        openPath: (kind) => fire(ipc.openPath(kind), "opening a folder"),
        popOut: (pane) => fire(ipc.practicePopOut(pane), "popping the pane out"),
        dockBack: (pane) => fire(ipc.practiceDockBack(pane), "docking the pane back"),
        dockAll: () => fire(ipc.practiceDockAll(), "docking every pane back"),
        // In a pop-out, Ctrl+Q is ambiguous. It is muscle memory for "close
        // the application", and a command labelled "Quit Riff" that silently
        // folds a pane back into a grid is a mislabelled action — so the
        // dialog asks rather than picking a side.
        quit: () => (popoutPane ? setQuitPromptOpen(true) : fire(ipc.windowClose(), "quitting")),
        closeOverlay: () => setPaletteOpen(false),
      }),
    [navigate, toggleSidebar, patch, settings, popoutPane],
  );

  useKeybindings(bindings);

  // The offer to reopen last session's pop-out windows, made exactly once.
  // Rust already took the list out of the file at launch, so declining or
  // ignoring this needs no bookkeeping — and a crash before answering cannot
  // leave a prompt that returns every launch until obeyed.
  //
  // It cannot delay the reveal: `app_ready()` is queued from main.tsx before
  // any of this, and the offer needs a round trip before it can even be drawn.
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || popoutPane || onboardingActive) return;
    offered.current = true;
    void ipc
      .practicePendingReopen()
      .then((panes) => {
        if (panes.length === 0) return;
        // `ES2021.Intl` is in tsconfig's lib for this alone. The target stays
        // ES2020 — this declares that WebKit has `ListFormat`, which it does,
        // rather than joining names with a comma and reading "Score, Video".
        const names = new Intl.ListFormat(i18n.language, {
          style: "long",
          type: "conjunction",
        }).format(panes.map((pane) => t(`common:panes.${pane}`)));
        // "Reopen", never "Restore": `nav.restore` is the un-maximise glyph and
        // `general.restoreWindowState` is window geometry. One word, one meaning.
        toast(t("common:panesOut.reopenPrompt", { count: panes.length, panes: names }), {
          action: {
            label: t("common:panesOut.reopen"),
            onClick: () => fire(ipc.practiceReopen(), "reopening last session's panes"),
          },
          cancel: { label: t("common:panesOut.notNow"), onClick: () => {} },
          // It waits. Sonner's four-second default is fine for "copied to
          // clipboard" and wrong for a question — and this one is asked
          // exactly once, so a prompt that times out is a prompt the user
          // never had the chance to answer.
          duration: Number.POSITIVE_INFINITY,
        });
      })
      // Nothing to offer is the same outcome as failing to ask, and neither
      // is worth a toast of its own on top of the one that did not appear.
      .catch(() => {});
  }, [popoutPane, onboardingActive, t, i18n.language]);

  useEffect(() => {
    // Once per launch, not once per window. `recovery` is baked into the
    // init script for the process lifetime and every window mounts this
    // component, so each pane popped out during a recovered session
    // announced all over again that the settings file had been corrupt —
    // in a window with no settings interface to do anything about it. Same
    // shape as the reopen prompt above.
    if (!popoutPane) reportRecovery();
    const unsubscribe = subscribeToBackend();
    return () => void unsubscribe.then((off) => off());
  }, [popoutPane]);

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
    // Never a pop-out's path. `startupRoute: last-used` would then launch the
    // MAIN window onto a single pane with no sidebar — a window that cannot
    // navigate anywhere, on every subsequent start.
    if (
      !isPopout(pathname) &&
      useSettings.getState().settings.general.startupRoute === "last-used"
    ) {
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
          badge={
            popoutPane
              ? { icon: PANE_ICONS[popoutPane], label: t(`common:panes.${popoutPane}`) }
              : undefined
          }
        />
      )}
      {/* The container the sidebar's rail breakpoint measures. The query is
          written in rem, so raising the UI scale grows the threshold while the
          window stays the same number of pixels — which is what makes the rail
          appear exactly when the chrome would otherwise crowd the content. A
          viewport media query could not respond to scale at all. */}
      <div className="@container/shell flex min-h-0 flex-1">
        {!onboardingActive && !popoutPane && <Sidebar collapsed={effectiveCollapsed} />}
        <main id="main" className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <CommandPalette open={paletteOpen} bindings={bindings} onOpenChange={setPaletteOpen} />
      {popoutPane ? (
        <PopoutQuitDialog
          pane={popoutPane}
          open={quitPromptOpen}
          onOpenChange={setQuitPromptOpen}
        />
      ) : (
        <QuitConfirmation />
      )}
    </div>
  );
}

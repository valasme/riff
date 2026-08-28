import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RouteError } from "@/components/RouteError";
import { Sidebar } from "@/components/Sidebar";
import { TitleBar } from "@/features/window/TitleBar";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
});

function RootLayout() {
  const { t, i18n } = useTranslation("nav");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [announcement, setAnnouncement] = useState("");
  // Plan 07 replaces this with the persisted setting.
  const [collapsed, setCollapsed] = useState(false);

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
  }, [pathname, t]);

  return (
    <div className="flex h-screen flex-col bg-surface text-foreground">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:z-50 focus-visible:m-2 focus-visible:rounded-md focus-visible:bg-raised focus-visible:px-3 focus-visible:py-2"
      >
        {t("skipToContent")}
      </a>
      {/* Plan 07 makes this conditional on `appearance.titleBar`, because
          "System decorations" has to hide Riff's own bar or the window ends
          up with two. */}
      <TitleBar onToggleSidebar={() => setCollapsed((v) => !v)} />
      {/* The container the sidebar's breakpoint measures. Chrome is rem-sized,
          so raising the UI scale shrinks this in px and the query fires —
          which a viewport media query could never do. */}
      <div className="@container/shell flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} />
        <main id="main" className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

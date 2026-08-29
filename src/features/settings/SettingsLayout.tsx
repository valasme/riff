import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Info, Palette, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";

// `sliders-horizontal` over `house` for General: a house means "home", and
// General is not the home of anything — it is the section full of switches.
const SECTIONS: { to: string; icon: LucideIcon; key: string }[] = [
  { to: "/settings/general", icon: SlidersHorizontal, key: "general" },
  { to: "/settings/appearance", icon: Palette, key: "appearance" },
  { to: "/settings/about", icon: Info, key: "about" },
];

export function SettingsLayout() {
  const { t } = useTranslation(["settings", "nav"]);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = SECTIONS.find((s) => s.to === pathname)?.key ?? "general";

  return (
    // A real container query, not `max-[700px]:`. A viewport media query
    // cannot respond to UI scale at all — scaling changes rem, not the
    // viewport — which is exactly the failure §7.4 designed around. The query
    // is in rem for the same reason: in px it would measure the same window
    // width at every scale and could only fire below the minimum window size.
    //
    // The container and the flex row are two elements on purpose. A container
    // query is answered by the nearest *ancestor* container, never by the
    // element that declares one, so `@max-[44rem]/settings:flex-col` written
    // on the `@container/settings` div itself silently matches nothing — it
    // goes looking for a `settings` container further up and finds none. The
    // wrapper is what gives the row an ancestor to ask.
    <div className="@container/settings h-full min-h-0">
      {/* `flex-col` below the breakpoint is not cosmetic — it is what makes
          the sub-navigation's own `w-full` survivable. Left as a row, a
          `shrink-0` nav asking for the full container width takes all of it
          and the content beside it computes to `width: 0`: at 1.5x scale in a
          minimum-size window every setting on the screen was still in the DOM
          and none of it was visible. The two flip together, which is what the
          test asserts. */}
      <div className="flex h-full min-h-0 @max-[44rem]/settings:flex-col">
        <nav
          aria-label={t("nav:settingsSections")}
          className={cn(
            "flex w-[var(--spacing-subnav)] shrink-0 flex-col gap-[var(--row-gap)] overflow-y-auto border-e border-line p-3",
            "@max-[44rem]/settings:w-full @max-[44rem]/settings:flex-row @max-[44rem]/settings:overflow-x-auto @max-[44rem]/settings:border-e-0 @max-[44rem]/settings:border-b",
          )}
        >
          {SECTIONS.map(({ to, icon: Icon, key }) => (
            <Link
              key={to}
              to={to}
              aria-current={pathname === to ? "page" : undefined}
              className={cn(
                "flex h-[var(--row-height)] shrink-0 items-center gap-2.5 rounded-[var(--radius-nav)] px-2.5 text-[0.9375rem]",
                "text-muted-foreground transition-colors duration-[var(--motion-fast)] ease-(--ease-standard)",
                "hover:bg-hover hover:text-foreground",
                pathname === to ? "bg-active-fill font-semibold text-foreground" : "font-medium",
              )}
            >
              <Icon size={17} aria-hidden className="shrink-0" />
              {t(`settings:sections.${key}`)}
            </Link>
          ))}
        </nav>

        {/* `min-h-0` for the stacked case: a `flex-1` child that scrolls its own
          overflow needs it in a column, or it grows to its content instead and
          pushes the scrollbar onto the window. */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {/* Not `mx-auto`. Centring a fixed-width column in an unbounded pane
            put 348px of empty surface between the sub-navigation and the
            settings it belongs to at 1920px wide, and 668px at 2560 — the
            column read as an unrelated card floating in the middle of the
            window rather than as the content of the section next to it. Left
            aligned, the gap is one `--content-padding` at every window size.
            No auto margin means it follows the writing direction on its own,
            so this stays correct under `dir="rtl"`. */}
          <div className="w-full max-w-[46rem] p-[var(--content-padding)]">
            <PageHeader
              title={t(`settings:sections.${current}`)}
              description={t(`settings:sectionDescriptions.${current}`)}
            />
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}

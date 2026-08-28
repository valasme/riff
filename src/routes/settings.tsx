import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { House, Info, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/settings")({ component: SettingsLayout });

const SECTIONS: { to: string; icon: LucideIcon; key: string }[] = [
  { to: "/settings/general", icon: House, key: "general" },
  { to: "/settings/appearance", icon: Palette, key: "appearance" },
  { to: "/settings/about", icon: Info, key: "about" },
];

function SettingsLayout() {
  const { t } = useTranslation(["settings", "nav"]);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = SECTIONS.find((s) => s.to === pathname)?.key ?? "general";

  return (
    // A real container query, not `max-[700px]:`. A viewport media query
    // cannot respond to UI scale at all — scaling changes rem, not the
    // viewport — which is exactly the failure §7.4 designed around. Because
    // the chrome is rem-sized, raising the scale shrinks this container in
    // px, and the query fires.
    <div className="@container/settings flex h-full min-h-0">
      <nav
        aria-label={t("nav:settingsSections")}
        className="flex w-[var(--spacing-subnav)] shrink-0 flex-col gap-[var(--row-gap)] border-e border-border-subtle p-3 @max-[700px]/settings:w-full @max-[700px]/settings:flex-row @max-[700px]/settings:border-e-0 @max-[700px]/settings:border-b"
      >
        {SECTIONS.map(({ to, icon: Icon, key }) => (
          <Link
            key={to}
            to={to}
            aria-current={pathname === to ? "page" : undefined}
            className={cn(
              "flex h-[var(--row-height)] items-center gap-2 rounded-[var(--radius-nav)] px-3 text-[0.9375rem] font-medium transition-colors hover:bg-raised",
              pathname === to && "bg-raised",
            )}
          >
            <Icon size={16} aria-hidden />
            {t(`settings:sections.${key}`)}
          </Link>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto p-[var(--content-padding)]">
        <div className="rounded-[var(--radius-card)] bg-card">
          {/* The mockup draws a header band with a rule under it. Without it
              the section name only ever appears in the sub-nav pill and the
              card opens straight into its first row. */}
          <PageHeader title={t(`settings:sections.${current}`)} />
          <div className="px-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}

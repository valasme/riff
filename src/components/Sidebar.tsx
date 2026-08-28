import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { AudioWaveform, FolderClock, Settings as SettingsIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

type Destination = { to: string; icon: LucideIcon; labelKey: string };

const PRIMARY: Destination[] = [
  { to: "/practice", icon: AudioWaveform, labelKey: "practice" },
  { to: "/history", icon: FolderClock, labelKey: "history" },
];

const FOOTER: Destination[] = [{ to: "/settings", icon: SettingsIcon, labelKey: "settings" }];

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation("nav");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label={t("primary")}
      className={cn(
        "flex shrink-0 flex-col justify-between border-e border-separator bg-surface py-3 transition-[width]",
        // Below 900px of available width the sidebar drops to its rail
        // regardless of the setting (§7.4), because at 1.5x scale in a
        // minimum-size window the chrome would otherwise leave the content
        // column unusable. The user's own collapse choice still wins above it.
        "@max-[900px]/shell:w-[var(--spacing-sidebar-rail)] @max-[900px]/shell:px-2",
        collapsed ? "w-[var(--spacing-sidebar-rail)] px-2" : "w-[var(--spacing-sidebar)] px-3",
      )}
    >
      <ul className="flex flex-col gap-[var(--row-gap)]">
        {PRIMARY.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} pathname={pathname} />
        ))}
      </ul>
      <ul className="flex flex-col gap-[var(--row-gap)]">
        {FOOTER.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}

function NavItem({
  item,
  collapsed,
  pathname,
}: {
  item: Destination;
  collapsed: boolean;
  pathname: string;
}) {
  const { t } = useTranslation("nav");
  const label = t(item.labelKey);
  const active = pathname.startsWith(item.to);
  const Icon = item.icon;

  return (
    <li>
      <Link
        to={item.to}
        aria-current={active ? "page" : undefined}
        title={label}
        // The accessible name is on the attribute unconditionally: below the
        // rail breakpoint the visible text is display:none, and a hidden
        // <span> contributes nothing to the accessible name.
        aria-label={label}
        className={cn(
          "flex h-[var(--row-height)] items-center gap-3 rounded-[var(--radius-nav)] px-3 text-[0.9375rem] font-medium",
          "transition-colors hover:bg-raised",
          active && "bg-raised",
          collapsed && "justify-center px-0",
          "@max-[900px]/shell:justify-center @max-[900px]/shell:px-0",
        )}
      >
        <Icon size={18} aria-hidden className="shrink-0" />
        {!collapsed && <span className="truncate @max-[900px]/shell:hidden">{label}</span>}
      </Link>
    </li>
  );
}

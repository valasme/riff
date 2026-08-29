import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { History, Music4, Settings as SettingsIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

type Destination = { to: string; icon: LucideIcon; labelKey: string; chord?: string };

// `music-4` over `audio-waveform`, `history` over `folder-clock`: the old pair
// described the file formats Practice will eventually open and the folder
// History will eventually list, rather than what either screen is for. A clock
// with a turn-back arrow is the universal glyph for history; a folder with a
// clock on it is a folder.
const PRIMARY: Destination[] = [
  { to: "/practice", icon: Music4, labelKey: "practice", chord: "Alt+1" },
  { to: "/history", icon: History, labelKey: "history", chord: "Alt+2" },
];

const FOOTER: Destination[] = [
  { to: "/settings", icon: SettingsIcon, labelKey: "settings", chord: "Alt+3" },
];

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation("nav");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    // See TitleBar for why the provider is here rather than only at the root.
    <TooltipProvider delayDuration={500}>
      <nav
        aria-label={t("primary")}
        className={cn(
          "flex shrink-0 flex-col justify-between border-e border-line bg-surface py-2",
          // Nothing about the sidebar's geometry animates, and that is the
          // point. Transitioning its width drags the entire content column
          // along for 170ms on every toggle — the panes reflow frame by frame
          // and the text you were reading slides sideways. A width change is
          // not a thing worth watching; it is a thing worth having already
          // happened. Only the items inside it transition, and only their
          // colours.
          // Below 56rem of available width the sidebar drops to its rail
          // regardless of the setting (§7.4), because at 1.5x scale in a
          // minimum-size window the chrome would otherwise leave the content
          // column unusable. rem, not px: a container query in px measures the
          // same window width at every UI scale, so the px form could only
          // ever fire below the 960px minimum window — that is, never.
          "@max-[56rem]/shell:w-[var(--spacing-sidebar-rail)] @max-[56rem]/shell:px-2",
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
    </TooltipProvider>
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

  const link = (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      // The accessible name is on the attribute unconditionally: below the
      // rail breakpoint the visible text is display:none, and a hidden
      // <span> contributes nothing to the accessible name.
      aria-label={label}
      className={cn(
        "flex h-[var(--row-height)] items-center gap-3 rounded-[var(--radius-nav)] px-2.5 text-[0.9375rem]",
        "text-muted-foreground transition-colors duration-[var(--motion-fast)] ease-(--ease-standard)",
        "hover:bg-hover hover:text-foreground",
        // Fill plus weight, not fill alone. On the collapsed rail the pill is
        // a square behind an icon and the weight change is what still reads
        // at a glance.
        active ? "bg-active-fill font-semibold text-foreground" : "font-medium",
        collapsed && "justify-center px-0",
        "@max-[56rem]/shell:justify-center @max-[56rem]/shell:px-0",
      )}
    >
      <Icon size={18} aria-hidden className="shrink-0" />
      {!collapsed && <span className="truncate @max-[56rem]/shell:hidden">{label}</span>}
    </Link>
  );

  return (
    <li>
      {/* §7.4: the rail keeps navigation available rather than hiding it, and
          tooltips supply the labels it can no longer show. Expanded, the label
          is right there — a tooltip repeating it is noise, so there isn't one.
          `title` is deliberately absent in both cases: two tooltips, one of
          them the operating system's, is worse than either. */}
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {label}
            {item.chord && <Kbd chord={item.chord} />}
          </TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

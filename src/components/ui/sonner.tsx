"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Riff has no theme store to pull from — `document.documentElement.dataset.theme`
 * IS the source of truth, written by `applyAppearance` (and, before React mounts,
 * by the Rust bootstrap script). Reading it directly avoids pulling next-themes,
 * a Next.js dependency, into a Vite application to answer a question Riff already
 * owns the answer to.
 */
function readDomTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function useDomTheme(): "light" | "dark" {
  const [theme, setTheme] = React.useState<"light" | "dark">(readDomTheme);

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readDomTheme()));
    observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useDomTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--fg)",
          "--normal-border": "var(--border-subtle)",
          "--border-radius": "var(--radius-card)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

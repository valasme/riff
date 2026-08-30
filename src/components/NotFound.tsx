import { Link, useRouterState } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { fire, ipc } from "@/lib/ipc";

/**
 * Riff's own 404. TanStack's default is a bare, untranslated `<p>Not Found</p>`
 * on the page's own background, with nothing to press.
 *
 * Reachable by a hand-typed hash, or by a `lastRoute` written by a version of
 * Riff that had a route this one does not.
 */
export function NotFound() {
  const { t } = useTranslation("nav");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // A pop-out has no sidebar and no navigation. Sending it to /practice would
  // turn one pane into a second copy of the whole application in a window
  // whose minimum size is 360x320; closing it docks the pane back instead.
  const popout = pathname.startsWith("/popout/");

  return (
    <div className="grid h-full min-h-0 place-items-center overflow-auto p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <span className="grid size-11 place-items-center rounded-full border border-line bg-card text-muted-foreground">
          <Compass size={20} aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{t("notFound.title")}</h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">{t("notFound.body")}</p>
        </div>
        {popout ? (
          <Button onClick={() => fire(ipc.windowClose(), "closing the window")}>
            {t("closeWindow")}
          </Button>
        ) : (
          <Button asChild>
            <Link to="/practice">{t("notFound.goToPractice")}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

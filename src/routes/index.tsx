import { createFileRoute, redirect } from "@tanstack/react-router";
import { router } from "@/app/router";
import { resolveStartupRoute } from "@/lib/startup-route";
import { useSettings } from "@/stores/settings";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const { startupRoute, lastRoute } = useSettings.getState().settings.general;
    const known = Object.keys(router.routesById);
    throw redirect({ to: resolveStartupRoute(startupRoute, lastRoute, known) });
  },
});

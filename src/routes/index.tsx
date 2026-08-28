import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // Plan 07 replaces this constant with the persisted startup route.
  beforeLoad: () => {
    throw redirect({ to: "/practice" });
  },
});

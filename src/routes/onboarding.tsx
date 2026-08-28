import { createFileRoute } from "@tanstack/react-router";

// Plan 08 replaces this with the real onboarding wizard.
export const Route = createFileRoute("/onboarding")({
  component: () => <div />,
});

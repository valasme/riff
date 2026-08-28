import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: () => <div className="p-[var(--content-padding)]" />,
});

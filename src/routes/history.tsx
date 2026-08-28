import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/history")({
  component: () => <div className="p-[var(--content-padding)]" />,
});

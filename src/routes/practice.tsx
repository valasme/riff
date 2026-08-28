import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/practice")({
  component: () => <div className="p-[var(--content-padding)]" />,
});

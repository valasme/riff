import { createFileRoute } from "@tanstack/react-router";
import { HistoryPlaceholder } from "@/features/history/HistoryPlaceholder";

export const Route = createFileRoute("/history")({ component: HistoryPlaceholder });

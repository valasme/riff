import { createFileRoute } from "@tanstack/react-router";
import { PracticePlaceholder } from "@/features/practice/PracticePlaceholder";

export const Route = createFileRoute("/practice")({ component: PracticePlaceholder });

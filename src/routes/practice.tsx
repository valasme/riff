import { createFileRoute } from "@tanstack/react-router";
import { PracticeGrid } from "@/features/practice/PracticeGrid";

export const Route = createFileRoute("/practice")({ component: PracticeGrid });

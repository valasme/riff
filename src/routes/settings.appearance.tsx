import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSection } from "@/features/settings/sections/AppearanceSection";

export const Route = createFileRoute("/settings/appearance")({ component: AppearanceSection });

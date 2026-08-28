import { createFileRoute } from "@tanstack/react-router";
import { GeneralSection } from "@/features/settings/sections/GeneralSection";

export const Route = createFileRoute("/settings/general")({ component: GeneralSection });

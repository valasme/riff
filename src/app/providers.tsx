import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { I18nextProvider } from "react-i18next";
import i18n from "@/app/i18n";
import { RouteError } from "@/components/RouteError";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={400}>
        <ErrorBoundary FallbackComponent={RouteError}>{children}</ErrorBoundary>
        {/* Riff's own Toaster, not sonner's. The bare `sonner` export was
            imported here with `theme="dark"` hard-coded, so every toast stayed
            a dark card after switching to the light theme — and the wrapper in
            components/ui that exists precisely to follow `data-theme` was never
            mounted.
            position is "bottom-right", not the logical "bottom-end": sonner's
            own Position type has no logical-direction values to opt into. */}
        <Toaster position="bottom-right" closeButton />
      </TooltipProvider>
    </I18nextProvider>
  );
}

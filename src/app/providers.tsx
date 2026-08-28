import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import i18n from "@/app/i18n";
import { RouteError } from "@/components/RouteError";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={400}>
        <ErrorBoundary FallbackComponent={RouteError}>{children}</ErrorBoundary>
        {/* sonner defaults to theme="light". Without this every toast is a
            white card on a #242424 application. Plan 07 replaces the literal
            with the persisted theme once the store exists.
            position is "bottom-right", not the logical "bottom-end": sonner's
            own Position type has no logical-direction values to opt into. */}
        <Toaster theme="dark" position="bottom-right" closeButton />
      </TooltipProvider>
    </I18nextProvider>
  );
}

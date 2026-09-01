import type { PdfRuntime } from "./pdfRuntime";
import { MIN_WEBKITGTK, meetsMinimumWebkit } from "./webkitVersion";

export class UnsupportedWebKitError extends Error {
  installed: string;
  required: string;
  cause?: unknown;

  constructor(installed: string, required: string, options?: { cause?: unknown }) {
    super("Unsupported WebKitGTK");
    this.name = "UnsupportedWebKitError";
    this.installed = installed;
    this.required = required;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

let runtimePromise: Promise<PdfRuntime> | null = null;

export function loadPdfRuntime(
  installed: string | undefined,
  importer: () => Promise<PdfRuntime> = () => import("./pdfRuntime"),
): Promise<PdfRuntime> {
  const known = /^\d+\.\d+\.\d+$/.test(installed ?? "");
  if (known && !meetsMinimumWebkit(installed as string)) {
    return Promise.reject(new UnsupportedWebKitError(installed as string, MIN_WEBKITGTK));
  }
  runtimePromise ??= importer().catch((cause: unknown) => {
    runtimePromise = null;
    if (!known) {
      throw new UnsupportedWebKitError("unknown", MIN_WEBKITGTK, { cause });
    }
    throw cause;
  });
  return runtimePromise;
}

/** Test-only cache reset; production code never needs to clear a successful runtime. */
export function resetPdfRuntimeForTests(): void {
  if (import.meta.env.MODE === "test") runtimePromise = null;
}

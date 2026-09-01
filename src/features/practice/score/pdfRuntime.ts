/** The PDF.js runtime boundary. Kept separate so the score surface can load it lazily. */
export * from "./pdfjs";

export type PdfRuntime = typeof import("./pdfjs");

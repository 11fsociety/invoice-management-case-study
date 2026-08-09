// Server-only utility. Not marked "use server" because it is imported directly
// by other server-side files rather than invoked as a Server Action.

/**
 * PDF text extraction using pdfjs-dist legacy build.
 * pdfjs-dist relies on DOMMatrix in some rendering paths, so text extraction
 * must be safe (no rendering) and the worker must be disabled in Node.
 */
export async function extractText(buffer: Buffer): Promise<{
  text: string;
  chars: number;
  pages: number;
  charsPerPage: number;
}> {
  // Dynamic import so pdfjs is never touched at RSC build time.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const uint8 = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  } as Parameters<typeof pdfjs.getDocument>[0]);

  const doc = await loadingTask.promise;
  const pages = doc.numPages;
  const pageTexts: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string }>;
    const pageText = items.map((it) => (typeof it.str === "string" ? it.str : "")).join(" ");
    pageTexts.push(pageText);
  }
  await doc.cleanup();
  await loadingTask.destroy();

  const text = pageTexts.join("\n\n---\n\n");
  const chars = text.replace(/\s/g, "").length;
  const charsPerPage = pages > 0 ? chars / pages : 0;
  return { text, chars, pages, charsPerPage };
}

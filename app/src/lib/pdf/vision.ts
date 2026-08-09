// Server-only utility. Not marked "use server" because it is imported directly
// by other server-side files rather than invoked as a Server Action.

/**
 * Render every page of a PDF into a 2x-scaled PNG buffer for LLM vision input.
 * Dynamic import keeps the native worker + pdfjs off the RSC compile path.
 */
export async function renderToPngs(buffer: Buffer): Promise<Buffer[]> {
  const { pdfToPng } = await import("pdf-to-png-converter");
  const pages = await pdfToPng(buffer, {
    viewportScale: 2.0,
    disableFontFace: true,
  });
  const out: Buffer[] = [];
  for (const p of pages) {
    if (p.kind === "content" && p.content) {
      out.push(p.content);
    }
  }
  return out;
}

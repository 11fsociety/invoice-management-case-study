import { eq, inArray } from "drizzle-orm";
import { db, invoiceRuns, invoiceExtractions } from "../src/lib/db";

async function main() {
  const targets = process.argv.slice(2);
  const rows = await db
    .select({
      filename: invoiceRuns.filename,
      extraction: invoiceExtractions.extractedJson,
    })
    .from(invoiceRuns)
    .leftJoin(invoiceExtractions, eq(invoiceExtractions.runId, invoiceRuns.id))
    .where(inArray(invoiceRuns.filename, targets));
  for (const r of rows) {
    const e = (r.extraction ?? {}) as Record<string, unknown>;
    console.log(
      `${r.filename} vendor_id=${e.vendor_id} gst_number=${e.gst_number} po=${e.po_number} invoice_no=${e.invoice_number} total=${e.invoice_total} doctype=${e.document_type} refs=${e.references_invoice_number}`
    );
    const li = e.line_items as unknown[];
    if (Array.isArray(li)) {
      console.log("  line_items[0..2]=", JSON.stringify(li.slice(0, 3)));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { decisions, invoiceExtractions, invoiceRuns, poRows, profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bucketColors: Record<string, string> = {
  APPROVED: "FF10B981",
  FLAGGED_FOR_REVIEW: "FFF59E0B",
  REJECTED: "FFEF4444",
  DUPLICATE: "FF6366F1",
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const profileRows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, user.id));
  const role = profileRows[0]?.role ?? null;

  // Full join across runs, extractions, decisions, po.
  const baseQuery = db
    .select({
      runId: invoiceRuns.id,
      filename: invoiceRuns.filename,
      uploadedAt: invoiceRuns.uploadedAt,
      finalDecision: decisions.finalDecision,
      pass1Decision: decisions.pass1Decision,
      reason: decisions.reason,
      matchedPoId: decisions.matchedPoId,
      amountDeltaPct: decisions.amountDeltaPct,
      amountDelta: decisions.amountDelta,
      vendorMatchScore: decisions.vendorMatchScore,
      currencyOk: decisions.currencyOk,
      duplicateConfidence: decisions.duplicateConfidence,
      extractedJson: invoiceExtractions.extractedJson,
    })
    .from(invoiceRuns)
    .leftJoin(decisions, eq(decisions.runId, invoiceRuns.id))
    .leftJoin(invoiceExtractions, eq(invoiceExtractions.runId, invoiceRuns.id));

  const rows =
    role === "admin"
      ? await baseQuery
      : await baseQuery.where(eq(invoiceRuns.uploadedBy, user.id));

  // Prefetch PO map.
  const allPos = await db.select().from(poRows);
  const poById = new Map(allPos.map((p) => [p.id, p]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Invoice Ops";
  wb.created = new Date();

  const buckets: Array<keyof typeof bucketColors> = [
    "APPROVED",
    "FLAGGED_FOR_REVIEW",
    "REJECTED",
    "DUPLICATE",
  ];

  const headers = [
    "Run ID",
    "Filename",
    "Uploaded",
    "Decision",
    "Reason",
    "PO Number",
    "Vendor Name",
    "Invoice Total",
    "Currency",
    "Amount Delta %",
    "Vendor Match Score",
    "Duplicate Confidence",
  ];

  for (const bucket of buckets) {
    const sheet = wb.addWorksheet(bucket);
    sheet.columns = headers.map((h) => ({ header: h, width: 22 }));
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: bucketColors[bucket] },
    };

    for (const r of rows) {
      if ((r.finalDecision ?? "") !== bucket) continue;
      const json = (r.extractedJson ?? {}) as Record<string, unknown>;
      const po = r.matchedPoId ? poById.get(r.matchedPoId) : null;
      sheet.addRow([
        r.runId,
        r.filename,
        r.uploadedAt ? r.uploadedAt.toISOString() : "",
        r.finalDecision ?? "",
        r.reason ?? "",
        typeof json.po_number === "string" ? json.po_number : po?.poNumber ?? "",
        typeof json.vendor_name === "string" ? json.vendor_name : po?.vendorName ?? "",
        typeof json.invoice_total === "number" ? json.invoice_total : "",
        typeof json.currency === "string" ? json.currency : "",
        r.amountDeltaPct ?? "",
        r.vendorMatchScore ?? "",
        r.duplicateConfidence ?? "",
      ]);
    }
  }

  const arrayBuffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const filename = `invoice-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(arrayBuffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

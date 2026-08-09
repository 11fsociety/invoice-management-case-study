import { NextResponse } from "next/server";
import { z } from "zod";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { invoiceRuns, poRows } from "@/lib/db/schema";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { triggerPipeline } from "@/lib/pipeline/orchestrator";
import { runPass2Global } from "@/lib/pipeline/dedupe";

export const runtime = "nodejs";

const bodySchema = z.object({
  kind: z.enum(["invoice", "po"]),
  id: z.string().min(1),
  filename: z.string().min(1),
  path: z.string().min(1),
  size: z.number().nonnegative(),
});

function normalizeDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date.
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const yyyy = String(d.y).padStart(4, "0");
    const mm = String(d.m).padStart(2, "0");
    const dd = String(d.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return trimmed;
  }
  return null;
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toAmount(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(2);
  if (typeof v === "string") {
    const cleaned = v.replace(/[,\s]/g, "").replace(/[^0-9.\-]/g, "");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n.toFixed(2);
  }
  return "0.00";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw: unknown = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const body = parsed.data;

  // Verify the client-supplied path matches the deterministic pattern for the
  // kind - clients can't smuggle in arbitrary paths.
  const expectedPath =
    body.kind === "invoice" ? `runs/${body.id}.pdf` : `sheets/${body.id}.xlsx`;
  if (body.path !== expectedPath) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (body.kind === "invoice") {
    await db.insert(invoiceRuns).values({
      id: body.id,
      filename: body.filename,
      storagePath: body.path,
      fileSizeBytes: body.size,
      uploadedBy: user.id,
      status: "received",
    });

    // Fire the pipeline; do NOT await.
    void triggerPipeline(body.id).catch((err) => {
      console.error(`[pipeline] run ${body.id} failed`, err);
    });

    return NextResponse.json({ run_id: body.id });
  }

  // kind === 'po'
  const service = createServiceClient();
  const { data: blob, error: dlErr } = await service.storage
    .from("po-sheets")
    .download(body.path);
  if (dlErr || !blob) {
    return NextResponse.json(
      { error: "download_failed", detail: dlErr?.message },
      { status: 500 }
    );
  }

  const buf = Buffer.from(await blob.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const first = wb.SheetNames[0];
  if (!first) {
    return NextResponse.json({ error: "empty_workbook" }, { status: 400 });
  }
  const sheet = wb.Sheets[first];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
  });

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  const values = rows
    .map((r) => {
      const poNumber = toStringOrNull(r.po_number ?? r["PO Number"] ?? r.poNumber);
      const poDate = normalizeDate(r.po_date ?? r["PO Date"] ?? r.poDate);
      const vendorName = toStringOrNull(
        r.vendor_name ?? r["Vendor Name"] ?? r.vendorName
      );
      if (!poNumber || !poDate || !vendorName) return null;
      const vendorId = toStringOrNull(
        r.vendor_id ?? r["Vendor ID"] ?? r.vendorId
      );
      const poAmount = toAmount(
        r.po_amount ?? r["PO Amount"] ?? r.poAmount ?? 0
      );
      const currency =
        toStringOrNull(r.currency ?? r["Currency"])?.toUpperCase() ?? "INR";
      const lineItemSummary = toStringOrNull(
        r.line_item_summary ?? r["Line Item Summary"] ?? r.lineItemSummary
      );
      return {
        poNumber,
        poDate,
        vendorName,
        vendorId,
        poAmount,
        currency,
        lineItemSummary,
        uploadedBy: user.id,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  if (values.length > 0) {
    await db.insert(poRows).values(values);
  }

  // Non-blocking pass 2 across all APPROVED invoices.
  void runPass2Global().catch((err) => {
    console.error(`[pipeline] pass2 after PO upload failed`, err);
  });

  return NextResponse.json({ inserted: values.length });
}

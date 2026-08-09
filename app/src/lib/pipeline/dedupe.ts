import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  decisions,
  invoiceExtractions,
  invoiceRuns,
} from "@/lib/db/schema";
import { emit } from "./sse";
import { normalizeVendorId, normalizeVendorName } from "./vendor-normalizer";
import { levenshtein } from "./matcher";

type ApprovedInvoice = {
  runId: string;
  uploadedAt: Date | null;
  invoiceNumber: string | null;
  vendorName: string | null;
  vendorId: string | null;
  amount: number | null;
  poNumber: string | null;
  invoiceDate: string | null;
  currency: string | null;
};

function pick(json: Record<string, unknown>, key: string): unknown {
  return json[key];
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[,\s]/g, "").replace(/[^0-9.\-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function vendorNameSim(a: string | null, b: string | null): number {
  const A = normalizeVendorName(a);
  const B = normalizeVendorName(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const max = Math.max(A.length, B.length);
  if (max === 0) return 1;
  return 1 - levenshtein(A, B) / max;
}

/**
 * Backwards-compatible helper: weighted confidence used elsewhere (e.g. tests
 * or component displays). Kept for API stability.
 */
export function duplicateConfidence(
  a: ApprovedInvoice,
  b: ApprovedInvoice
): number {
  let score = 0;
  if (
    a.invoiceNumber &&
    b.invoiceNumber &&
    a.invoiceNumber.trim().toLowerCase() === b.invoiceNumber.trim().toLowerCase()
  ) {
    score += 0.4;
  }
  const vendorIdMatch =
    !!a.vendorId &&
    !!b.vendorId &&
    a.vendorId.trim() === b.vendorId.trim();
  const vendorNameMatch = vendorNameSim(a.vendorName, b.vendorName) >= 0.9;
  if (vendorIdMatch || vendorNameMatch) score += 0.2;
  if (
    a.amount !== null &&
    b.amount !== null &&
    a.amount !== 0 &&
    b.amount !== 0
  ) {
    const denom = Math.max(Math.abs(a.amount), Math.abs(b.amount));
    if (denom > 0 && Math.abs(a.amount - b.amount) / denom <= 0.005) {
      score += 0.2;
    }
  }
  if (
    a.poNumber &&
    b.poNumber &&
    a.poNumber.trim().toLowerCase() === b.poNumber.trim().toLowerCase()
  ) {
    score += 0.1;
  }
  if (
    a.invoiceDate &&
    b.invoiceDate &&
    a.invoiceDate.trim() === b.invoiceDate.trim()
  ) {
    score += 0.05;
  }
  if (
    a.currency &&
    b.currency &&
    a.currency.trim().toUpperCase() === b.currency.trim().toUpperCase()
  ) {
    score += 0.05;
  }
  return Number(score.toFixed(3));
}

export async function runPass2Global(): Promise<{
  retagCount: number;
  retagged: number;
}> {
  // Consider decisions where pass1='APPROVED'. Their final may currently be
  // APPROVED or DUPLICATE.
  const rows = await db
    .select({
      runId: decisions.runId,
      pass1: decisions.pass1Decision,
      finalDecision: decisions.finalDecision,
      uploadedAt: invoiceRuns.uploadedAt,
      extractedJson: invoiceExtractions.extractedJson,
    })
    .from(decisions)
    .leftJoin(invoiceRuns, eq(invoiceRuns.id, decisions.runId))
    .leftJoin(
      invoiceExtractions,
      eq(invoiceExtractions.runId, decisions.runId)
    )
    .where(eq(decisions.pass1Decision, "APPROVED"));

  const invoices: ApprovedInvoice[] = rows.map((r) => {
    const json = (r.extractedJson ?? {}) as Record<string, unknown>;
    return {
      runId: r.runId,
      uploadedAt: r.uploadedAt ?? null,
      invoiceNumber: toStringOrNull(pick(json, "invoice_number")),
      vendorName: toStringOrNull(pick(json, "vendor_name")),
      vendorId:
        toStringOrNull(pick(json, "gst_number")) ??
        toStringOrNull(pick(json, "vendor_id")),
      amount: toNumberOrNull(pick(json, "invoice_total")),
      poNumber: toStringOrNull(pick(json, "po_number")),
      invoiceDate: toStringOrNull(pick(json, "invoice_date")),
      currency: toStringOrNull(pick(json, "currency")),
    };
  });

  // Sort by uploadedAt (earliest first). Nulls last.
  invoices.sort((a, b) => {
    const ta = a.uploadedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = b.uploadedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });

  const retagPlan: Array<{
    runId: string;
    duplicateOf: string;
    confidence: number;
  }> = [];
  const markedDup = new Set<string>();

  for (let i = 0; i < invoices.length; i++) {
    const A = invoices[i];
    if (markedDup.has(A.runId)) continue;
    for (let j = i + 1; j < invoices.length; j++) {
      const B = invoices[j];
      if (markedDup.has(B.runId)) continue;

      // Vendor signal - id equal OR name similarity >= 0.90.
      const invIdA = normalizeVendorId(A.vendorId);
      const invIdB = normalizeVendorId(B.vendorId);
      const vendorIdOk = !!invIdA && !!invIdB && invIdA === invIdB;
      const vendorNameOk =
        vendorNameSim(A.vendorName, B.vendorName) >= 0.9;
      const vendorMatch = vendorIdOk || vendorNameOk;

      // Invoice number equal (trim/lower).
      const invA = A.invoiceNumber?.trim().toLowerCase() ?? null;
      const invB = B.invoiceNumber?.trim().toLowerCase() ?? null;
      const invoiceNumberMatch = !!invA && !!invB && invA === invB;

      // PO number equal.
      const poA = A.poNumber?.trim().toLowerCase() ?? null;
      const poB = B.poNumber?.trim().toLowerCase() ?? null;
      const poMatch = !!poA && !!poB && poA === poB;

      // Amount within 0.1%.
      let amountMatchStrict = false;
      let amountMatchLoose = false;
      if (
        A.amount !== null &&
        B.amount !== null &&
        A.amount !== 0 &&
        B.amount !== 0
      ) {
        const denom = Math.max(Math.abs(A.amount), Math.abs(B.amount));
        const rel = Math.abs(A.amount - B.amount) / denom;
        amountMatchStrict = rel <= 0.001;
        amountMatchLoose = rel <= 0.005;
      }

      // Primary rule - ALL four signals must match, all four inputs non-null.
      if (
        vendorMatch &&
        invoiceNumberMatch &&
        poMatch &&
        amountMatchStrict
      ) {
        retagPlan.push({
          runId: B.runId,
          duplicateOf: A.runId,
          confidence: 1.0,
        });
        markedDup.add(B.runId);
        continue;
      }

      // Secondary fingerprint - if invoice_number missing on either side,
      // use vendor + po + date equal + amount within 0.5%.
      if (!invA || !invB) {
        const dateMatch =
          !!A.invoiceDate &&
          !!B.invoiceDate &&
          A.invoiceDate.trim() === B.invoiceDate.trim();
        if (vendorMatch && poMatch && dateMatch && amountMatchLoose) {
          retagPlan.push({
            runId: B.runId,
            duplicateOf: A.runId,
            confidence: 0.85,
          });
          markedDup.add(B.runId);
        }
      }
    }
  }

  await db.transaction(async (tx) => {
    for (const p of retagPlan) {
      await tx
        .update(decisions)
        .set({
          finalDecision: "DUPLICATE",
          duplicateOf: p.duplicateOf,
          duplicateConfidence: p.confidence.toFixed(3),
          decidedAt: sql`now()`,
        })
        .where(eq(decisions.runId, p.runId));
    }

    // Revert previously-DUPLICATE rows whose partner is no longer matched.
    const retaggedIds = new Set(retagPlan.map((p) => p.runId));
    const previouslyDup = await tx
      .select({ runId: decisions.runId })
      .from(decisions)
      .where(
        and(
          eq(decisions.finalDecision, "DUPLICATE"),
          eq(decisions.pass1Decision, "APPROVED")
        )
      );
    const toRevert = previouslyDup
      .map((r) => r.runId)
      .filter((id) => !retaggedIds.has(id));
    if (toRevert.length > 0) {
      await tx
        .update(decisions)
        .set({
          finalDecision: "APPROVED",
          duplicateOf: null,
          duplicateConfidence: null,
          decidedAt: sql`now()`,
        })
        .where(inArray(decisions.runId, toRevert));
    }
  });

  emit("_global", "pass2_complete", { retag_count: retagPlan.length });
  for (const p of retagPlan) {
    emit(p.runId, "pass2_complete", {
      retagged: true,
      duplicateOf: p.duplicateOf,
      confidence: p.confidence,
    });
  }

  return { retagCount: retagPlan.length, retagged: retagPlan.length };
}

import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  decisions,
  invoiceExtractions,
  invoiceRuns,
  settings,
} from "@/lib/db/schema";
import { emit } from "./sse";
import { nameSimilarity } from "./matcher";

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

async function loadThreshold(): Promise<number> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "duplicate_confidence_threshold"));
  if (rows.length === 0) return 0.75;
  const v = rows[0].value;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0.75;
  return 0.75;
}

/**
 * Weighted duplicate confidence per PRD 5.4.
 */
export function duplicateConfidence(
  a: ApprovedInvoice,
  b: ApprovedInvoice
): number {
  let score = 0;

  // Invoice number - 0.40 if trim-lower-equal (both non-null)
  if (
    a.invoiceNumber &&
    b.invoiceNumber &&
    a.invoiceNumber.trim().toLowerCase() === b.invoiceNumber.trim().toLowerCase()
  ) {
    score += 0.4;
  }

  // Vendor - 0.20 if exact vendor_id OR fuzzy name >= 0.90
  const vendorIdMatch =
    !!a.vendorId &&
    !!b.vendorId &&
    a.vendorId.trim() === b.vendorId.trim();
  const vendorNameMatch = nameSimilarity(a.vendorName, b.vendorName) >= 0.9;
  if (vendorIdMatch || vendorNameMatch) score += 0.2;

  // Amount - 0.20 if within 0.5%
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

  // PO number - 0.10
  if (
    a.poNumber &&
    b.poNumber &&
    a.poNumber.trim().toLowerCase() === b.poNumber.trim().toLowerCase()
  ) {
    score += 0.1;
  }

  // Date - 0.05
  if (a.invoiceDate && b.invoiceDate && a.invoiceDate.trim() === b.invoiceDate.trim()) {
    score += 0.05;
  }

  // Currency - 0.05
  if (
    a.currency &&
    b.currency &&
    a.currency.trim().toUpperCase() === b.currency.trim().toUpperCase()
  ) {
    score += 0.05;
  }

  return Number(score.toFixed(3));
}

export async function runPass2Global(): Promise<{ retagCount: number }> {
  const threshold = await loadThreshold();

  // Join decisions + extractions + runs for APPROVED rows only.
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
      vendorId: toStringOrNull(pick(json, "vendor_id")),
      amount: toNumberOrNull(pick(json, "invoice_total")),
      poNumber: toStringOrNull(pick(json, "po_number")),
      invoiceDate: toStringOrNull(pick(json, "invoice_date")),
      currency: toStringOrNull(pick(json, "currency")),
    };
  });

  // Union-find on duplicate-linked invoices.
  const idxOf = new Map<string, number>();
  invoices.forEach((inv, i) => idxOf.set(inv.runId, i));
  const parent = invoices.map((_, i) => i);
  const rank = invoices.map(() => 0);
  const bestConf = new Map<string, number>(); // runId -> best confidence

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else {
      parent[rb] = ra;
      rank[ra] += 1;
    }
  };

  for (let i = 0; i < invoices.length; i++) {
    for (let j = i + 1; j < invoices.length; j++) {
      const conf = duplicateConfidence(invoices[i], invoices[j]);
      if (conf >= threshold) {
        union(i, j);
        const ki = invoices[i].runId;
        const kj = invoices[j].runId;
        if ((bestConf.get(ki) ?? 0) < conf) bestConf.set(ki, conf);
        if ((bestConf.get(kj) ?? 0) < conf) bestConf.set(kj, conf);
      }
    }
  }

  // Group members and find the earliest-uploaded in each group.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < invoices.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }

  const retagPlan: Array<{
    runId: string;
    duplicateOf: string | null;
    confidence: number;
  }> = [];

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // Earliest by uploadedAt.
    let earliest = members[0];
    for (const m of members) {
      const cur = invoices[m].uploadedAt?.getTime() ?? Infinity;
      const best = invoices[earliest].uploadedAt?.getTime() ?? Infinity;
      if (cur < best) earliest = m;
    }
    const earliestRunId = invoices[earliest].runId;
    for (const m of members) {
      const inv = invoices[m];
      const conf = bestConf.get(inv.runId) ?? 0;
      // Every member is retagged DUPLICATE. Earliest row has duplicate_of=null;
      // later rows point back to the earliest.
      retagPlan.push({
        runId: inv.runId,
        duplicateOf: m === earliest ? null : earliestRunId,
        confidence: conf,
      });
    }
  }

  // Apply retag + revert atomically so concurrent Pass 2 runs never observe
  // intermediate state.
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

    // Also revert previously DUPLICATE rows that no longer match to APPROVED.
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

  return { retagCount: retagPlan.length };
}

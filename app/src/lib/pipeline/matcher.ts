import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  invoiceExtractions,
  invoiceRuns,
  poRows,
  decisions,
  settings,
} from "@/lib/db/schema";
import { emit } from "./sse";

type Extraction = Record<string, unknown>;

type PoRow = {
  id: string;
  poNumber: string;
  poDate: string;
  vendorName: string;
  vendorId: string | null;
  poAmount: string;
  currency: string | null;
  lineItemSummary: string | null;
};

export type DecisionOutcome =
  | "APPROVED"
  | "FLAGGED_FOR_REVIEW"
  | "REJECTED"
  | "DUPLICATE";

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

function parseDate(v: unknown): Date | null {
  const s = toStringOrNull(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// Minimal Levenshtein for short strings.
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

export function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const A = a.trim().toLowerCase();
  const B = b.trim().toLowerCase();
  if (A === B) return 1;
  const max = Math.max(A.length, B.length);
  if (max === 0) return 1;
  return 1 - levenshtein(A, B) / max;
}

async function loadSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  if (rows.length === 0) return fallback;
  const v = rows[0].value;
  if (v === null || v === undefined) return fallback;
  return v as T;
}

export async function runPass1(runId: string): Promise<void> {
  emit(runId, "matching_started", {});

  const extRows = await db
    .select()
    .from(invoiceExtractions)
    .where(eq(invoiceExtractions.runId, runId));
  const extRow = extRows[0];
  if (!extRow) {
    // Terminal - no extraction found. Insert REJECTED with reason.
    await upsertDecision(runId, {
      pass1Decision: "REJECTED",
      finalDecision: "REJECTED",
      reason: "unparseable extraction",
    });
    await db
      .update(invoiceRuns)
      .set({ status: "matched" })
      .where(eq(invoiceRuns.id, runId));
    emit(runId, "decision", { decision: "REJECTED" });
    return;
  }

  const extraction = extRow.extractedJson as Extraction;

  const [tolerancePct, vendorThreshold] = await Promise.all([
    loadSetting<number>("tolerance_pct", 2.0),
    loadSetting<number>("vendor_match_threshold", 0.85),
  ]);

  const poRowsAll = (await db.select().from(poRows)) as PoRow[];

  const poNumber = toStringOrNull(extraction.po_number);
  const vendorName = toStringOrNull(extraction.vendor_name);
  const vendorId = toStringOrNull(extraction.vendor_id);
  const currency = toStringOrNull(extraction.currency);
  const invoiceTotal = toNumberOrNull(extraction.invoice_total);
  const invoiceDate = parseDate(extraction.invoice_date);

  // Diagnostics we build up.
  const diagnostics: {
    matchedPoId: string | null;
    amountDelta: number | null;
    amountDeltaPct: number | null;
    dateDeltaDays: number | null;
    vendorMatchScore: number | null;
    currencyOk: boolean | null;
  } = {
    matchedPoId: null,
    amountDelta: null,
    amountDeltaPct: null,
    dateDeltaDays: null,
    vendorMatchScore: null,
    currencyOk: null,
  };

  // Check 1: PO number present.
  if (!poNumber) {
    await finish({
      decision: "REJECTED",
      reason: "no PO reference on invoice",
    });
    return;
  }

  // Check 2: PO exists in table.
  const po = poRowsAll.find(
    (r) => r.poNumber.trim().toLowerCase() === poNumber.trim().toLowerCase()
  );
  if (!po) {
    await finish({
      decision: "REJECTED",
      reason: "no matching PO",
    });
    return;
  }
  diagnostics.matchedPoId = po.id;

  const poAmount = Number(po.poAmount);
  const poDate = parseDate(po.poDate);
  if (invoiceDate && poDate) {
    diagnostics.dateDeltaDays = daysBetween(invoiceDate, poDate);
  }

  // Compute all diagnostics upfront so they're saved even on early exit.
  if (invoiceTotal !== null && Number.isFinite(poAmount) && poAmount !== 0) {
    diagnostics.amountDelta = Number((invoiceTotal - poAmount).toFixed(2));
    diagnostics.amountDeltaPct = Number(
      (((invoiceTotal - poAmount) / poAmount) * 100).toFixed(3)
    );
  }
  diagnostics.currencyOk =
    currency !== null && (po.currency ?? "").trim().toUpperCase() === currency.trim().toUpperCase();

  // Vendor score.
  let vendorScore: number | null = null;
  if (vendorId && po.vendorId && vendorId.trim() === po.vendorId.trim()) {
    vendorScore = 1;
  } else {
    vendorScore = Number(nameSimilarity(vendorName, po.vendorName).toFixed(3));
  }
  diagnostics.vendorMatchScore = vendorScore;

  // Check 3: date order.
  if (invoiceDate && poDate && invoiceDate < poDate) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: "invoice predates PO",
    });
    return;
  }

  // Check 4: vendor identity.
  const vendorMatch =
    (vendorId && po.vendorId && vendorId.trim() === po.vendorId.trim()) ||
    (vendorScore !== null && vendorScore >= vendorThreshold);
  if (!vendorMatch) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: `vendor mismatch: ${vendorName ?? "?"} vs ${po.vendorName}`,
    });
    return;
  }

  // Check 5: currency.
  if (!diagnostics.currencyOk) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: `currency mismatch: invoice ${currency ?? "?"} vs PO ${po.currency ?? "?"}`,
    });
    return;
  }

  // Check 6: amount tolerance.
  if (
    invoiceTotal === null ||
    !Number.isFinite(poAmount) ||
    poAmount === 0 ||
    diagnostics.amountDeltaPct === null
  ) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: "invoice_total missing or PO amount invalid",
    });
    return;
  }
  const absPct = Math.abs(diagnostics.amountDeltaPct);
  if (absPct > tolerancePct) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: `amount outside tolerance: ${invoiceTotal} vs ${poAmount} (${absPct.toFixed(2)}% delta)`,
    });
    return;
  }

  await finish({
    decision: "APPROVED",
    reason: null,
  });

  async function finish(res: {
    decision: Exclude<DecisionOutcome, "DUPLICATE">;
    reason: string | null;
  }): Promise<void> {
    await upsertDecision(runId, {
      pass1Decision: res.decision,
      finalDecision: res.decision,
      reason: res.reason,
      matchedPoId: diagnostics.matchedPoId,
      amountDelta:
        diagnostics.amountDelta === null ? null : diagnostics.amountDelta.toFixed(2),
      amountDeltaPct:
        diagnostics.amountDeltaPct === null
          ? null
          : diagnostics.amountDeltaPct.toFixed(3),
      dateDeltaDays: diagnostics.dateDeltaDays,
      vendorMatchScore:
        diagnostics.vendorMatchScore === null
          ? null
          : diagnostics.vendorMatchScore.toFixed(3),
      currencyOk: diagnostics.currencyOk,
    });
    await db
      .update(invoiceRuns)
      .set({ status: "matched" })
      .where(eq(invoiceRuns.id, runId));
    emit(runId, "decision", { decision: res.decision, reason: res.reason });
  }
}

type DecisionUpdate = {
  pass1Decision: "APPROVED" | "FLAGGED_FOR_REVIEW" | "REJECTED";
  finalDecision: "APPROVED" | "FLAGGED_FOR_REVIEW" | "REJECTED" | "DUPLICATE";
  reason: string | null;
  matchedPoId?: string | null;
  amountDelta?: string | null;
  amountDeltaPct?: string | null;
  dateDeltaDays?: number | null;
  vendorMatchScore?: string | null;
  currencyOk?: boolean | null;
  duplicateOf?: string | null;
  duplicateConfidence?: string | null;
};

async function upsertDecision(
  runId: string,
  values: DecisionUpdate
): Promise<void> {
  const insertValues = {
    runId,
    pass1Decision: values.pass1Decision,
    finalDecision: values.finalDecision,
    reason: values.reason ?? null,
    matchedPoId: values.matchedPoId ?? null,
    amountDelta: values.amountDelta ?? null,
    amountDeltaPct: values.amountDeltaPct ?? null,
    dateDeltaDays: values.dateDeltaDays ?? null,
    vendorMatchScore: values.vendorMatchScore ?? null,
    currencyOk: values.currencyOk ?? null,
    duplicateOf: values.duplicateOf ?? null,
    duplicateConfidence: values.duplicateConfidence ?? null,
    decidedAt: sql`now()`,
  } as const;

  await db
    .insert(decisions)
    .values(insertValues)
    .onConflictDoUpdate({
      target: decisions.runId,
      set: {
        pass1Decision: values.pass1Decision,
        finalDecision: values.finalDecision,
        reason: values.reason ?? null,
        matchedPoId: values.matchedPoId ?? null,
        amountDelta: values.amountDelta ?? null,
        amountDeltaPct: values.amountDeltaPct ?? null,
        dateDeltaDays: values.dateDeltaDays ?? null,
        vendorMatchScore: values.vendorMatchScore ?? null,
        currencyOk: values.currencyOk ?? null,
        duplicateOf: values.duplicateOf ?? null,
        duplicateConfidence: values.duplicateConfidence ?? null,
        decidedAt: sql`now()`,
      },
    });
}

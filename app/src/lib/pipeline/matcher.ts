import { eq, sql, and, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  invoiceExtractions,
  invoiceRuns,
  poRows,
  decisions,
  settings,
} from "@/lib/db/schema";
import { emit } from "./sse";
import { matchLineItems } from "./item-normalizer";
import { normalizeVendorId, normalizeVendorName } from "./vendor-normalizer";

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

function normalizedNameSimilarity(a: string | null, b: string | null): number {
  const A = normalizeVendorName(a);
  const B = normalizeVendorName(b);
  if (!A || !B) return 0;
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

  // Fail-fast: if the invoice run itself is 'failed' (extraction crashed), REJECT.
  const runRow = await db
    .select()
    .from(invoiceRuns)
    .where(eq(invoiceRuns.id, runId));
  if (runRow.length > 0 && runRow[0].status === "failed") {
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

  const extRows = await db
    .select()
    .from(invoiceExtractions)
    .where(eq(invoiceExtractions.runId, runId));
  const extRow = extRows[0];
  if (!extRow) {
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
  const gstNumber = toStringOrNull(extraction.gst_number);
  const currency = toStringOrNull(extraction.currency);
  const invoiceTotal = toNumberOrNull(extraction.invoice_total);
  const invoiceDate = parseDate(extraction.invoice_date);
  const documentTypeRaw = toStringOrNull(extraction.document_type);
  const referencesInvoiceNumber = toStringOrNull(
    extraction.references_invoice_number
  );

  const diagnostics: {
    matchedPoId: string | null;
    amountDelta: number | null;
    amountDeltaPct: number | null;
    dateDeltaDays: number | null;
    vendorMatchScore: number | null;
    currencyOk: boolean | null;
    itemMatchScore: number | null;
    cumulativeApprovedAmount: number | null;
    remainingPoBalance: number | null;
    documentType: string | null;
    creditNoteLinkedRunId: string | null;
  } = {
    matchedPoId: null,
    amountDelta: null,
    amountDeltaPct: null,
    dateDeltaDays: null,
    vendorMatchScore: null,
    currencyOk: null,
    itemMatchScore: null,
    cumulativeApprovedAmount: null,
    remainingPoBalance: null,
    documentType: null,
    creditNoteLinkedRunId: null,
  };

  // --- EDGE 5: Credit-note branch. ---
  const isCreditNote =
    documentTypeRaw?.toUpperCase() === "CREDIT_NOTE" ||
    (invoiceTotal !== null && invoiceTotal < 0);
  if (isCreditNote) {
    diagnostics.documentType = "CREDIT_NOTE";

    let linkedRunId: string | null = null;
    let linkedInvoiceTotal: number | null = null;
    if (referencesInvoiceNumber) {
      // Try to find an existing invoice by extracted invoice_number OR by filename.
      const refTrim = referencesInvoiceNumber.trim();
      const linkedRows = await db
        .select({
          runId: invoiceRuns.id,
          filename: invoiceRuns.filename,
          extractedJson: invoiceExtractions.extractedJson,
        })
        .from(invoiceRuns)
        .leftJoin(
          invoiceExtractions,
          eq(invoiceExtractions.runId, invoiceRuns.id)
        )
        .where(
          sql`${invoiceRuns.id} <> ${runId} AND (
                ${invoiceRuns.filename} ILIKE ${"%" + refTrim + "%"} OR
                ${invoiceExtractions.extractedJson}->>'invoice_number' = ${refTrim}
              )`
        );
      if (linkedRows.length > 0) {
        linkedRunId = linkedRows[0].runId;
        const j = (linkedRows[0].extractedJson ?? {}) as Record<string, unknown>;
        linkedInvoiceTotal = toNumberOrNull(j.invoice_total);
      }
    }
    diagnostics.creditNoteLinkedRunId = linkedRunId;

    const adjustment = invoiceTotal !== null ? Math.abs(invoiceTotal) : 0;
    let reason: string;
    if (linkedRunId) {
      const adjustedPayable =
        linkedInvoiceTotal !== null && invoiceTotal !== null
          ? linkedInvoiceTotal + invoiceTotal
          : null;
      reason = `Credit note (adjustment: ${adjustment}) linked to invoice ${referencesInvoiceNumber}. Adjusted payable: ${adjustedPayable ?? "n/a"}. Auditor review required.`;
    } else {
      reason = `Credit note could not be linked to an existing invoice or PO.`;
    }

    await upsertDecision(runId, {
      pass1Decision: "FLAGGED_FOR_REVIEW",
      finalDecision: "FLAGGED_FOR_REVIEW",
      reason,
      documentType: "CREDIT_NOTE",
      creditNoteLinkedRunId: linkedRunId,
    });
    await db
      .update(invoiceRuns)
      .set({ status: "matched" })
      .where(eq(invoiceRuns.id, runId));
    emit(runId, "decision", { decision: "FLAGGED_FOR_REVIEW", reason });
    return;
  }

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

  if (invoiceTotal !== null && Number.isFinite(poAmount) && poAmount !== 0) {
    diagnostics.amountDelta = Number((invoiceTotal - poAmount).toFixed(2));
    diagnostics.amountDeltaPct = Number(
      (((invoiceTotal - poAmount) / poAmount) * 100).toFixed(3)
    );
  }
  diagnostics.currencyOk =
    currency !== null &&
    (po.currency ?? "").trim().toUpperCase() === currency.trim().toUpperCase();

  // --- EDGE 2: Vendor identity check (authoritative id first). ---
  const invAuthId = normalizeVendorId(gstNumber ?? vendorId);
  const poAuthId = normalizeVendorId(po.vendorId);
  let vendorScore: number | null = null;
  if (invAuthId && poAuthId && invAuthId !== poAuthId) {
    // Authoritative id mismatch - FLAG.
    diagnostics.vendorMatchScore = 0;
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: `Vendor identity mismatch: invoice vendor "${vendorName ?? "?"}" (id: ${invAuthId}) does not match PO vendor "${po.vendorName}" (id: ${poAuthId}).`,
    });
    return;
  } else if (invAuthId && poAuthId && invAuthId === poAuthId) {
    vendorScore = 1;
  } else {
    vendorScore = Number(
      normalizedNameSimilarity(vendorName, po.vendorName).toFixed(3)
    );
  }
  diagnostics.vendorMatchScore = vendorScore;

  if (vendorScore < vendorThreshold) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: `vendor mismatch: ${vendorName ?? "?"} vs ${po.vendorName} (similarity: ${vendorScore.toFixed(2)}, threshold: ${vendorThreshold})`,
    });
    return;
  }

  // Check: currency.
  if (currency && po.currency && !diagnostics.currencyOk) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: `currency mismatch: invoice ${currency} vs PO ${po.currency ?? "?"}`,
    });
    return;
  }

  // Check: date.
  if (invoiceDate && poDate && invoiceDate < poDate) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: "invoice predates PO",
    });
    return;
  }

  // --- EDGE 3: Line-item match. ---
  const lineItemsForMatch = (Array.isArray(extraction.line_items)
    ? (extraction.line_items as Array<{ description?: string | null }>)
    : null);
  const itemResult = matchLineItems(lineItemsForMatch, po.lineItemSummary);
  diagnostics.itemMatchScore = Number(itemResult.score.toFixed(3));

  if (itemResult.pairs.length > 0) {
    if (itemResult.score < 0.4) {
      await finish({
        decision: "FLAGGED_FOR_REVIEW",
        reason: `Invoice line items do not match PO items (similarity: ${itemResult.score.toFixed(2)}).`,
      });
      return;
    }
    if (itemResult.score < 0.7) {
      await finish({
        decision: "FLAGGED_FOR_REVIEW",
        reason: `Line-item descriptions could not be confidently matched (similarity: ${itemResult.score.toFixed(2)}).`,
      });
      return;
    }
  }

  // Check: amount tolerance.
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
  // Only flag OVER-tolerance here. Under-billing (partial invoicing) is
  // handled by the cumulative PO-balance check below.
  if (diagnostics.amountDeltaPct > tolerancePct) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: `amount outside tolerance: ${invoiceTotal} vs ${poAmount} (${diagnostics.amountDeltaPct.toFixed(2)}% delta)`,
    });
    return;
  }

  // --- EDGE 1: Cumulative PO balance. ---
  // Skip if this invoice looks like a duplicate of an existing APPROVED one on
  // the same PO (same amount within 0.1%). Duplicates are Pass 2's job.
  const priorSameRuns = await db
    .select({
      runId: decisions.runId,
      total: sql<string>`(${invoiceExtractions.extractedJson}->>'invoice_total')`,
    })
    .from(decisions)
    .leftJoin(
      invoiceExtractions,
      eq(invoiceExtractions.runId, decisions.runId)
    )
    .where(
      and(
        eq(decisions.matchedPoId, po.id),
        eq(decisions.finalDecision, "APPROVED"),
        ne(decisions.runId, runId)
      )
    );

  let prior = 0;
  let looksLikeDuplicate = false;
  for (const r of priorSameRuns) {
    const t = r.total !== null ? Number(r.total) : 0;
    prior += t;
    if (t !== 0 && invoiceTotal !== 0) {
      const denom = Math.max(Math.abs(t), Math.abs(invoiceTotal));
      if (denom > 0 && Math.abs(t - invoiceTotal) / denom <= 0.001) {
        looksLikeDuplicate = true;
      }
    }
  }
  const combined = prior + invoiceTotal;
  diagnostics.cumulativeApprovedAmount = Number(prior.toFixed(2));
  diagnostics.remainingPoBalance = Number(
    (poAmount - prior - invoiceTotal).toFixed(2)
  );

  if (
    !looksLikeDuplicate &&
    combined > poAmount * (1 + tolerancePct / 100)
  ) {
    await finish({
      decision: "FLAGGED_FOR_REVIEW",
      reason: `Cumulative invoice amount (${combined.toFixed(2)}) exceeds PO balance (${poAmount}) with tolerance ${tolerancePct}%.`,
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
      itemMatchScore:
        diagnostics.itemMatchScore === null
          ? null
          : diagnostics.itemMatchScore.toFixed(3),
      cumulativeApprovedAmount:
        diagnostics.cumulativeApprovedAmount === null
          ? null
          : diagnostics.cumulativeApprovedAmount.toFixed(2),
      remainingPoBalance:
        diagnostics.remainingPoBalance === null
          ? null
          : diagnostics.remainingPoBalance.toFixed(2),
      documentType: diagnostics.documentType,
      creditNoteLinkedRunId: diagnostics.creditNoteLinkedRunId,
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
  itemMatchScore?: string | null;
  cumulativeApprovedAmount?: string | null;
  remainingPoBalance?: string | null;
  documentType?: string | null;
  creditNoteLinkedRunId?: string | null;
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
    itemMatchScore: values.itemMatchScore ?? null,
    cumulativeApprovedAmount: values.cumulativeApprovedAmount ?? null,
    remainingPoBalance: values.remainingPoBalance ?? null,
    documentType: values.documentType ?? null,
    creditNoteLinkedRunId: values.creditNoteLinkedRunId ?? null,
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
        itemMatchScore: values.itemMatchScore ?? null,
        cumulativeApprovedAmount: values.cumulativeApprovedAmount ?? null,
        remainingPoBalance: values.remainingPoBalance ?? null,
        documentType: values.documentType ?? null,
        creditNoteLinkedRunId: values.creditNoteLinkedRunId ?? null,
        decidedAt: sql`now()`,
      },
    });
}

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  decisions,
  invoiceExtractions,
  invoiceRuns,
  poRows,
  profiles,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Decision = "APPROVED" | "FLAGGED_FOR_REVIEW" | "REJECTED" | "DUPLICATE";
const DECISIONS: Decision[] = [
  "APPROVED",
  "FLAGGED_FOR_REVIEW",
  "REJECTED",
  "DUPLICATE",
];

type Row = {
  runId: string;
  uploadedAt: Date | string | null;
  uploadedBy: string | null;
  extractionMode: string | null;
  finalDecision: string | null;
  amountDeltaPct: string | null;
  vendorMatchScore: string | null;
  latencyMs: number | null;
  extractedJson: unknown;
  matchedPoId: string | null;
  poVendorName: string | null;
  poCurrency: string | null;
};

type ExtractedJson = {
  vendor_name?: unknown;
  currency?: unknown;
  invoice_total?: unknown;
};

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function dayKey(d: Date | string | null): string | null {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return null;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toleranceBucket(pct: number): string {
  if (pct < -2) return "<-2";
  if (pct < -1) return "-2..-1";
  if (pct < 0) return "-1..0";
  if (pct < 1) return "0..1";
  if (pct < 2) return "1..2";
  return ">2";
}

const TOLERANCE_BUCKETS = [
  "<-2",
  "-2..-1",
  "-1..0",
  "0..1",
  "1..2",
  ">2",
] as const;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  if (next === undefined) return sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

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
  const role = profileRows[0]?.role === "admin" ? "admin" : "auditor";

  const baseQuery = db
    .select({
      runId: invoiceRuns.id,
      uploadedAt: invoiceRuns.uploadedAt,
      uploadedBy: invoiceRuns.uploadedBy,
      extractionMode: invoiceRuns.extractionMode,
      finalDecision: decisions.finalDecision,
      amountDeltaPct: decisions.amountDeltaPct,
      vendorMatchScore: decisions.vendorMatchScore,
      latencyMs: invoiceExtractions.latencyMs,
      extractedJson: invoiceExtractions.extractedJson,
      matchedPoId: decisions.matchedPoId,
      poVendorName: poRows.vendorName,
      poCurrency: poRows.currency,
    })
    .from(invoiceRuns)
    .leftJoin(decisions, eq(decisions.runId, invoiceRuns.id))
    .leftJoin(invoiceExtractions, eq(invoiceExtractions.runId, invoiceRuns.id))
    .leftJoin(poRows, eq(poRows.id, decisions.matchedPoId));

  const rows: Row[] =
    role === "admin"
      ? await baseQuery
      : await baseQuery.where(eq(invoiceRuns.uploadedBy, user.id));

  const totalRuns = rows.length;

  // Chart 1 - decision breakdown.
  const bucketCounts = new Map<Decision, number>(
    DECISIONS.map((d) => [d, 0])
  );
  for (const r of rows) {
    if (r.finalDecision && DECISIONS.includes(r.finalDecision as Decision)) {
      const key = r.finalDecision as Decision;
      bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
    }
  }
  const decisionsByBucket = DECISIONS.map((bucket) => ({
    bucket,
    count: bucketCounts.get(bucket) ?? 0,
  }));

  // Chart 2 - timeline by day.
  const timelineMap = new Map<string, Record<Decision, number>>();
  for (const r of rows) {
    const day = dayKey(r.uploadedAt);
    if (!day) continue;
    const dec =
      r.finalDecision && DECISIONS.includes(r.finalDecision as Decision)
        ? (r.finalDecision as Decision)
        : null;
    if (!dec) continue;
    let entry = timelineMap.get(day);
    if (!entry) {
      entry = { APPROVED: 0, FLAGGED_FOR_REVIEW: 0, REJECTED: 0, DUPLICATE: 0 };
      timelineMap.set(day, entry);
    }
    entry[dec] += 1;
  }
  const timeline = Array.from(timelineMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, counts]) => ({
      day,
      APPROVED: counts.APPROVED,
      FLAGGED_FOR_REVIEW: counts.FLAGGED_FOR_REVIEW,
      REJECTED: counts.REJECTED,
      DUPLICATE: counts.DUPLICATE,
    }));

  // Chart 3 - amount by vendor (top 8).
  const vendorTotals = new Map<string, number>();
  for (const r of rows) {
    const json = (r.extractedJson ?? {}) as ExtractedJson;
    const vendor =
      pickString(json.vendor_name) ?? r.poVendorName ?? null;
    const total = pickNumber(json.invoice_total);
    if (!vendor || total === null) continue;
    vendorTotals.set(vendor, (vendorTotals.get(vendor) ?? 0) + total);
  }
  const amountByVendor = Array.from(vendorTotals.entries())
    .map(([vendor_name, total]) => ({ vendor_name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // Chart 4 - currency breakdown.
  const currencyAgg = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    const json = (r.extractedJson ?? {}) as ExtractedJson;
    const currency =
      pickString(json.currency) ?? r.poCurrency ?? null;
    if (!currency) continue;
    const total = pickNumber(json.invoice_total) ?? 0;
    const cur = currencyAgg.get(currency) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += total;
    currencyAgg.set(currency, cur);
  }
  const currencyBreakdown = Array.from(currencyAgg.entries())
    .map(([currency, v]) => ({ currency, count: v.count, total: v.total }))
    .sort((a, b) => b.count - a.count);

  // Chart 5 - PDF extraction latency (single mode now that we send the whole
  // PDF straight to Bedrock).
  const pdfLatencies: number[] = [];
  for (const r of rows) {
    if (r.latencyMs === null || r.latencyMs === undefined) continue;
    pdfLatencies.push(r.latencyMs);
  }
  const latency: Array<{
    mode: "pdf";
    avg_ms: number;
    p95_ms: number;
    count: number;
  }> = (() => {
    if (pdfLatencies.length === 0) {
      return [{ mode: "pdf", avg_ms: 0, p95_ms: 0, count: 0 }];
    }
    const sum = pdfLatencies.reduce((a, b) => a + b, 0);
    const sorted = [...pdfLatencies].sort((a, b) => a - b);
    return [
      {
        mode: "pdf",
        avg_ms: Math.round(sum / pdfLatencies.length),
        p95_ms: Math.round(quantile(sorted, 0.95)),
        count: pdfLatencies.length,
      },
    ];
  })();

  // Chart 6 - tolerance histogram on amount_delta_pct.
  const toleranceCounts = new Map<string, number>(
    TOLERANCE_BUCKETS.map((b) => [b, 0])
  );
  for (const r of rows) {
    const pct = pickNumber(r.amountDeltaPct);
    if (pct === null) continue;
    const bucket = toleranceBucket(pct);
    toleranceCounts.set(bucket, (toleranceCounts.get(bucket) ?? 0) + 1);
  }
  const toleranceHist = TOLERANCE_BUCKETS.map((bucket) => ({
    bucket,
    count: toleranceCounts.get(bucket) ?? 0,
  }));

  return NextResponse.json({
    role,
    totalRuns,
    decisionsByBucket,
    timeline,
    amountByVendor,
    currencyBreakdown,
    latency,
    toleranceHist,
  });
}

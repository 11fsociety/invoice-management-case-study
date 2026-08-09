import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  invoiceRuns,
  invoiceExtractions,
  decisions,
  profiles,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function getRole(userId: string): Promise<string | null> {
  const rows = await db.select().from(profiles).where(eq(profiles.id, userId));
  return rows[0]?.role ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = await getRole(user.id);

  const baseQuery = db
    .select({
      runId: invoiceRuns.id,
      filename: invoiceRuns.filename,
      uploadedAt: invoiceRuns.uploadedAt,
      uploadedBy: invoiceRuns.uploadedBy,
      status: invoiceRuns.status,
      extractionMode: invoiceRuns.extractionMode,
      finalDecision: decisions.finalDecision,
      pass1Decision: decisions.pass1Decision,
      reason: decisions.reason,
      amountDelta: decisions.amountDelta,
      amountDeltaPct: decisions.amountDeltaPct,
      vendorMatchScore: decisions.vendorMatchScore,
      currencyOk: decisions.currencyOk,
      duplicateOf: decisions.duplicateOf,
      duplicateConfidence: decisions.duplicateConfidence,
      matchedPoId: decisions.matchedPoId,
      extractedJson: invoiceExtractions.extractedJson,
    })
    .from(invoiceRuns)
    .leftJoin(decisions, eq(decisions.runId, invoiceRuns.id))
    .leftJoin(invoiceExtractions, eq(invoiceExtractions.runId, invoiceRuns.id));

  // Auditors only see their own runs. Push filter into SQL.
  const rows =
    role === "admin"
      ? await baseQuery.orderBy(desc(invoiceRuns.uploadedAt))
      : await baseQuery
          .where(eq(invoiceRuns.uploadedBy, user.id))
          .orderBy(desc(invoiceRuns.uploadedAt));

  return NextResponse.json({ runs: rows });
}

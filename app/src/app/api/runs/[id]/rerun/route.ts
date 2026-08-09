import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoiceRuns, invoiceExtractions, decisions } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { triggerPipeline } from "@/lib/pipeline/orchestrator";
import { checkRunOwnership } from "@/lib/auth/ownership";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ownership = await checkRunOwnership(id, user.id);
  if (ownership === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (ownership === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db
    .delete(decisions)
    .where(eq(decisions.runId, id));
  await db
    .delete(invoiceExtractions)
    .where(eq(invoiceExtractions.runId, id));
  await db
    .update(invoiceRuns)
    .set({ status: "received", extractionMode: null })
    .where(eq(invoiceRuns.id, id));

  void triggerPipeline(id).catch((err) => {
    console.error(`[pipeline] rerun ${id} failed`, err);
  });

  return NextResponse.json({ ok: true });
}

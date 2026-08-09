import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  invoiceRuns,
  invoiceExtractions,
  decisions,
  auditLog,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { checkRunOwnership } from "@/lib/auth/ownership";

export const runtime = "nodejs";

export async function GET(
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

  const [run] = await db.select().from(invoiceRuns).where(eq(invoiceRuns.id, id));
  if (!run) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const [extraction] = await db
    .select()
    .from(invoiceExtractions)
    .where(eq(invoiceExtractions.runId, id));
  const [decision] = await db
    .select()
    .from(decisions)
    .where(eq(decisions.runId, id));
  const audit = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.runId, id));

  return NextResponse.json({
    run,
    extraction: extraction ?? null,
    decision: decision ?? null,
    audit,
  });
}

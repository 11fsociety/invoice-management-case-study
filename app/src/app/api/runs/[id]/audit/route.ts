import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, profiles } from "@/lib/db/schema";
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

  const rows = await db
    .select({
      id: auditLog.id,
      runId: auditLog.runId,
      actor: auditLog.actor,
      fromDecision: auditLog.fromDecision,
      toDecision: auditLog.toDecision,
      reason: auditLog.reason,
      at: auditLog.at,
      actorEmail: profiles.email,
    })
    .from(auditLog)
    .leftJoin(profiles, eq(profiles.id, auditLog.actor))
    .where(eq(auditLog.runId, id))
    .orderBy(desc(auditLog.at));

  return NextResponse.json({ audit: rows });
}

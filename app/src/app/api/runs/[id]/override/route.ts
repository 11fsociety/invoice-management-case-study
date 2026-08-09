import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { decisions, auditLog } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { checkRunOwnership } from "@/lib/auth/ownership";

export const runtime = "nodejs";

const bodySchema = z.object({
  to_decision: z.enum(["APPROVED", "FLAGGED_FOR_REVIEW", "REJECTED", "DUPLICATE"]),
  reason: z.string().min(1),
});

export async function POST(
  req: Request,
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

  const raw: unknown = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { to_decision, reason } = parsed.data;

  const existing = await db
    .select()
    .from(decisions)
    .where(eq(decisions.runId, id));
  if (existing.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const fromDecision = existing[0].finalDecision;

  await db
    .update(decisions)
    .set({ finalDecision: to_decision })
    .where(eq(decisions.runId, id));

  await db.insert(auditLog).values({
    runId: id,
    actor: user.id,
    fromDecision,
    toDecision: to_decision,
    reason,
  });

  const [updated] = await db
    .select()
    .from(decisions)
    .where(eq(decisions.runId, id));

  return NextResponse.json({ decision: updated });
}

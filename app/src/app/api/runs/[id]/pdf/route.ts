import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoiceRuns } from "@/lib/db/schema";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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

  const rows = await db.select().from(invoiceRuns).where(eq(invoiceRuns.id, id));
  const run = rows[0];
  if (!run) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const service = createServiceClient();
  const { data, error } = await service.storage
    .from("invoices")
    .createSignedUrl(run.storagePath, 60);
  if (error || !data) {
    return NextResponse.json(
      { error: "sign_failed", detail: error?.message },
      { status: 500 }
    );
  }

  return NextResponse.redirect(data.signedUrl, 302);
}

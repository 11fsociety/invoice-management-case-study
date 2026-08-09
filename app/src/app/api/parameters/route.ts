import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { parameters, profiles } from "@/lib/db/schema";
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

  const rows = await db.select().from(parameters).orderBy(parameters.id);
  return NextResponse.json({ parameters: rows });
}

const putSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

export async function PUT(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = await getRole(user.id);
  if (role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const raw: unknown = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  await db
    .update(parameters)
    .set({ active: parsed.data.active })
    .where(eq(parameters.id, parsed.data.id));

  const [updated] = await db
    .select()
    .from(parameters)
    .where(eq(parameters.id, parsed.data.id));

  return NextResponse.json({ parameter: updated });
}

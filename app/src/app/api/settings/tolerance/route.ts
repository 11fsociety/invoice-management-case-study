import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { settings, profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  tolerance_pct: z.number().nonnegative().max(100),
});

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
  if (role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "tolerance_pct"));
  const raw = rows[0]?.value ?? null;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && !isNaN(Number(raw))
        ? Number(raw)
        : 2.0;
  return NextResponse.json({ tolerance_pct: value });
}

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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  await db
    .insert(settings)
    .values({ key: "tolerance_pct", value: parsed.data.tolerance_pct })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: parsed.data.tolerance_pct },
    });

  return NextResponse.json({ tolerance_pct: parsed.data.tolerance_pct });
}

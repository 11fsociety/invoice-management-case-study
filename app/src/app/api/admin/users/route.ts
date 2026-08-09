import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createClient, createServiceClient } from "@/lib/supabase/server";

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
  if (role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await db.select().from(profiles);
  return NextResponse.json({ users: rows });
}

const postSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: Request) {
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
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (error || !data.user) {
    return NextResponse.json(
      { error: "create_failed", detail: error?.message },
      { status: 500 }
    );
  }

  await db.insert(profiles).values({
    id: data.user.id,
    email: parsed.data.email,
    role: "auditor",
    createdBy: user.id,
  });

  return NextResponse.json({ id: data.user.id, email: parsed.data.email });
}

export async function DELETE(req: Request) {
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

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const target = await db.select().from(profiles).where(eq(profiles.id, id));
  if (target.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (target[0].role !== "auditor") {
    return NextResponse.json({ error: "cannot_delete_non_auditor" }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json(
      { error: "delete_failed", detail: error.message },
      { status: 500 }
    );
  }

  await db.delete(profiles).where(eq(profiles.id, id));
  return NextResponse.json({ ok: true });
}

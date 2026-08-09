import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { generateText } from "ai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { db } from "@/lib/db";
import { providers, profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function getRole(userId: string): Promise<string | null> {
  const rows = await db.select().from(profiles).where(eq(profiles.id, userId));
  return rows[0]?.role ?? null;
}

export async function POST() {
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

  const [activeProvider] = await db
    .select()
    .from(providers)
    .where(eq(providers.isActive, true));
  if (!activeProvider) {
    return NextResponse.json({ error: "no_active_provider" }, { status: 404 });
  }

  const region = activeProvider.region ?? process.env.AWS_REGION ?? "ap-south-1";
  const modelId =
    activeProvider.modelId ??
    process.env.BEDROCK_MODEL_ID ??
    "global.anthropic.claude-opus-4-7";

  const bedrock = createAmazonBedrock({
    region,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  });

  let ok = false;
  let detail: string | null = null;
  try {
    const res = await generateText({
      model: bedrock(modelId),
      prompt: "Reply with the single word PONG.",
    });
    detail = res.text?.slice(0, 200) ?? null;
    ok = true;
  } catch (err) {
    ok = false;
    detail = (err as Error).message?.slice(0, 500) ?? "unknown_error";
  }

  await db
    .update(providers)
    .set({ connectionOk: ok, lastChecked: sql`now()` })
    .where(eq(providers.id, activeProvider.id));

  const [updated] = await db
    .select()
    .from(providers)
    .where(eq(providers.id, activeProvider.id));

  return NextResponse.json({ ok, detail, provider: updated });
}

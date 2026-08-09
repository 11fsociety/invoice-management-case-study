import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateObject } from "ai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { db } from "@/lib/db";
import { parameters, profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  raw_name: z.string().min(1),
  raw_description: z.string().min(1),
});

const refinedSchema = z.object({
  id: z.string(),
  name: z.string(),
  display_name: z.string(),
  type: z.enum(["string", "number", "date", "currency", "regex_match", "boolean"]),
  format_hint: z.string(),
  required: z.boolean(),
  example: z.string().nullable().optional(),
});

async function getRole(userId: string): Promise<string | null> {
  const rows = await db.select().from(profiles).where(eq(profiles.id, userId));
  return rows[0]?.role ?? null;
}

function randomThreeDigitId(): string {
  return String(100 + Math.floor(Math.random() * 900));
}

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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Pick a free 3-digit id. Loop up to 200 times to cover a saturated space.
  let id = randomThreeDigitId();
  for (let i = 0; i < 200; i++) {
    const collision = await db.select().from(parameters).where(eq(parameters.id, id));
    if (collision.length === 0) break;
    id = randomThreeDigitId();
  }

  const bedrock = createAmazonBedrock({
    region: process.env.AWS_REGION ?? "ap-south-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  });
  const modelId = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-opus-4-7";

  const system =
    "You are a schema designer. Given a raw parameter definition, return JSON " +
    "with these fields: id (echo), name (snake_case), display_name (Title Case), " +
    "type (one of: string, number, date, currency, regex_match, boolean), " +
    "format_hint (short instruction appended to the extraction prompt), " +
    "required (true/false, infer from wording), example (string or null).";

  const userMsg =
    `id: ${id}\nraw_name: ${parsed.data.raw_name}\nraw_description: ${parsed.data.raw_description}`;

  let refined: z.infer<typeof refinedSchema> | null = null;
  try {
    const result = await generateObject({
      model: bedrock(modelId),
      schema: refinedSchema,
      system,
      messages: [{ role: "user", content: userMsg }],
      mode: "json",
    } as Parameters<typeof generateObject>[0]);
    refined = result.object as z.infer<typeof refinedSchema>;
  } catch (err) {
    // One retry with the error appended.
    try {
      const result = await generateObject({
        model: bedrock(modelId),
        schema: refinedSchema,
        system,
        messages: [
          { role: "user", content: userMsg },
          {
            role: "user",
            content: `Your last output failed schema validation with: ${(err as Error).message}. Return ONLY valid JSON matching the schema.`,
          },
        ],
        mode: "json",
      } as Parameters<typeof generateObject>[0]);
      refined = result.object as z.infer<typeof refinedSchema>;
    } catch (err2) {
      return NextResponse.json(
        { error: "refine_failed", detail: (err2 as Error).message },
        { status: 502 }
      );
    }
  }

  if (!refined) {
    return NextResponse.json({ error: "refine_failed" }, { status: 502 });
  }

  await db.insert(parameters).values({
    id,
    name: refined.name,
    displayName: refined.display_name,
    type: refined.type,
    formatHint: refined.format_hint,
    required: refined.required,
    active: true,
    isPredefined: false,
  });

  const [row] = await db.select().from(parameters).where(eq(parameters.id, id));
  return NextResponse.json({ parameter: row });
}

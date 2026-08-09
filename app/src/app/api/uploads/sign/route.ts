import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  kind: z.enum(["invoice", "po"]),
  filename: z.string().min(1),
  size: z.number().nonnegative(),
  contentType: z.string().min(1),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw: unknown = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const id = randomUUID();
  const bucket = parsed.data.kind === "invoice" ? "invoices" : "po-sheets";
  const path =
    parsed.data.kind === "invoice"
      ? `runs/${id}.pdf`
      : `sheets/${id}.xlsx`;

  const service = createServiceClient();
  // NOTE: Supabase's createSignedUploadUrl does not accept a TTL argument;
  // upload tokens are fixed at Supabase's 2h default. Accepted deviation from
  // the shorter TTL originally desired - client must upload within 2h.
  const { data, error } = await service.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json(
      { error: "sign_failed", detail: error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    id,
    bucket,
    path,
    uploadUrl: data.signedUrl,
    token: data.token,
  });
}

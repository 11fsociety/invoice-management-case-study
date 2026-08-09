import { eq } from "drizzle-orm";
import { generateObject, type ModelMessage } from "ai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { db } from "@/lib/db";
import { invoiceRuns, invoiceExtractions } from "@/lib/db/schema";
import { createServiceClient } from "@/lib/supabase/server";
import { buildPrompt } from "./prompt";
import { emit } from "./sse";

const BEDROCK_MODEL =
  process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-opus-4-7";
const AWS_REGION = process.env.AWS_REGION ?? "ap-south-1";

const MAX_LLM_RETRIES = 3;

function backoff(attempt: number): Promise<void> {
  const ms = Math.min(30_000, 1000 * 2 ** attempt);
  return new Promise((r) => setTimeout(r, ms));
}

function isThrottling(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string; statusCode?: number };
  const name = e.name ?? "";
  const msg = e.message ?? "";
  const status = e.statusCode ?? 0;
  return (
    /Throttling|ThrottlingException|TooManyRequests|429|503|ServiceUnavailable/.test(
      name + " " + msg
    ) ||
    status === 429 ||
    status === 503
  );
}

/**
 * Send the WHOLE PDF directly to Bedrock Opus 4.7 as a single document content
 * block. No text extraction, no page rendering, no vision fallback. The AI SDK
 * Bedrock adapter maps a `file` content part with `mediaType: 'application/pdf'`
 * to a Converse-API `document` block with base64 bytes.
 */
export async function runExtraction(runId: string): Promise<void> {
  const runs = await db.select().from(invoiceRuns).where(eq(invoiceRuns.id, runId));
  const run = runs[0];
  if (!run) throw new Error(`run not found: ${runId}`);

  emit(runId, "extraction_started", { runId });

  // 1. Download the PDF via the service-role Supabase client.
  const supabase = createServiceClient();
  const { data: fileBlob, error: dlErr } = await supabase.storage
    .from("invoices")
    .download(run.storagePath);
  if (dlErr || !fileBlob) {
    await db
      .update(invoiceRuns)
      .set({ status: "failed" })
      .where(eq(invoiceRuns.id, runId));
    emit(runId, "extraction_failed", { reason: "download_failed" });
    throw new Error(`failed to download invoice: ${dlErr?.message ?? "unknown"}`);
  }
  const pdfBuf = Buffer.from(await fileBlob.arrayBuffer());
  const pdfBase64 = pdfBuf.toString("base64");

  emit(runId, "pdf_downloaded", { bytes: pdfBuf.byteLength });

  await db
    .update(invoiceRuns)
    .set({ status: "extracting", extractionMode: "pdf" })
    .where(eq(invoiceRuns.id, runId));

  // 2. Build the prompt + schema.
  const { system, zodSchema } = await buildPrompt();

  const bedrock = createAmazonBedrock({
    region: AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  });

  // 3. Assemble the single user message: PDF file part + inline instruction.
  const baseMessages: ModelMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "file",
          data: pdfBase64,
          mediaType: "application/pdf",
          filename: run.filename,
        },
        {
          type: "text",
          text: "Extract the specified fields from the attached invoice PDF, returning ONLY valid JSON matching the given schema.",
        },
      ],
    },
  ];

  const t0 = Date.now();

  emit(runId, "llm_called", { mode: "pdf" });

  let object: Record<string, unknown> | null = null;
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  let rawResponse = "";
  let lastError: unknown = null;

  let attempt = 0;
  let messages = baseMessages;

  while (attempt < MAX_LLM_RETRIES) {
    try {
      const result = await generateObject({
        model: bedrock(BEDROCK_MODEL),
        schema: zodSchema,
        system,
        messages,
        mode: "json",
      } as Parameters<typeof generateObject>[0]);

      object = result.object as Record<string, unknown>;
      usage = {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      };
      try {
        rawResponse = JSON.stringify(result.object);
      } catch {
        rawResponse = "";
      }
      break;
    } catch (err) {
      lastError = err;
      const msg = (err as Error).message ?? "";
      const looksLikeSchema =
        /schema|zod|parse|validation|NoObjectGenerated/i.test(msg);

      if (looksLikeSchema && attempt === 0) {
        // Retry once with the error appended.
        messages = [
          ...baseMessages,
          {
            role: "user",
            content: `Your last output failed schema validation with: ${msg}. Return ONLY valid JSON matching the schema.`,
          },
        ];
        attempt += 1;
        continue;
      }

      if (isThrottling(err) && attempt < MAX_LLM_RETRIES - 1) {
        await backoff(attempt);
        attempt += 1;
        continue;
      }

      break;
    }
  }

  if (!object) {
    await db
      .update(invoiceRuns)
      .set({ status: "failed" })
      .where(eq(invoiceRuns.id, runId));
    emit(runId, "extraction_failed", {
      reason: "llm_failed",
      message: (lastError as Error | null)?.message,
    });
    throw new Error(
      `LLM extraction failed: ${(lastError as Error | null)?.message ?? "unknown"}`
    );
  }

  const latencyMs = Date.now() - t0;
  emit(runId, "llm_returned", { latencyMs });

  // 4. Persist extraction.
  const lineItemsRaw =
    typeof object.line_items_raw === "string"
      ? (object.line_items_raw as string)
      : null;
  const lineItems = Array.isArray(object.line_items) ? object.line_items : null;
  const documentType =
    typeof object.document_type === "string" ? (object.document_type as string) : null;
  const referencesInvoiceNumber =
    typeof object.references_invoice_number === "string"
      ? (object.references_invoice_number as string)
      : null;

  await db
    .insert(invoiceExtractions)
    .values({
      runId,
      extractedJson: object,
      lineItemsRaw,
      lineItems,
      documentType,
      referencesInvoiceNumber,
      providerUsed: "bedrock",
      modelUsed: BEDROCK_MODEL,
      tokensIn: usage.inputTokens ?? null,
      tokensOut: usage.outputTokens ?? null,
      latencyMs,
      rawResponse,
    })
    .onConflictDoUpdate({
      target: invoiceExtractions.runId,
      set: {
        extractedJson: object,
        lineItemsRaw,
        lineItems,
        documentType,
        referencesInvoiceNumber,
        providerUsed: "bedrock",
        modelUsed: BEDROCK_MODEL,
        tokensIn: usage.inputTokens ?? null,
        tokensOut: usage.outputTokens ?? null,
        latencyMs,
        rawResponse,
      },
    });

  emit(runId, "persisted", {});
}

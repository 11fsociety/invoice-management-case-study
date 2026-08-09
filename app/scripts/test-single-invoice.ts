/**
 * scripts/test-single-invoice.ts
 *
 * One-off harness for INV-0001 to verify the new whole-PDF-to-Bedrock path
 * works end-to-end. Uploads the PDF, inserts an invoice_runs row, invokes
 * triggerPipeline(), and prints the resulting final_decision.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";

const AUDITOR_ID = "85e15b4c-29ea-472e-9328-182de0347f36";

const SAMPLES_DIR =
  process.env.SAMPLES_DIR ??
  "D:\\codezzz\\Claude\\zamp-asa\\sample-invoices";

const INVOICE_NAME = process.env.INVOICE_NAME ?? "INV-0001.pdf";

async function main() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - check .env.local"
    );
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS creds missing - check .env.local");
  }

  const region = process.env.AWS_REGION ?? "ap-south-1";
  const model =
    process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-opus-4-7";
  console.log(`[env] region=${region} model=${model}`);

  const supabase = createClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const fpath = join(SAMPLES_DIR, INVOICE_NAME);
  if (!existsSync(fpath)) {
    throw new Error(`sample not found: ${fpath}`);
  }
  const bytes = readFileSync(fpath);
  console.log(`[inv] ${basename(fpath)} loaded (${bytes.byteLength} bytes)`);

  const { db, invoiceRuns, invoiceExtractions, decisions } = await import(
    "../src/lib/db"
  );

  // Clean up any prior run for this filename so we get a fresh pipeline.
  const priors = await db
    .select({ id: invoiceRuns.id })
    .from(invoiceRuns)
    .where(eq(invoiceRuns.filename, INVOICE_NAME));
  for (const p of priors) {
    await db.delete(decisions).where(eq(decisions.runId, p.id));
    await db.delete(invoiceExtractions).where(eq(invoiceExtractions.runId, p.id));
    await db.delete(invoiceRuns).where(eq(invoiceRuns.id, p.id));
    console.log(`[cleanup] deleted prior run ${p.id}`);
  }

  const runId = randomUUID();
  const storagePath = `runs/${runId}.pdf`;

  const { error: upErr } = await supabase.storage
    .from("invoices")
    .upload(storagePath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);
  console.log(`[storage] uploaded to invoices/${storagePath}`);

  await db.insert(invoiceRuns).values({
    id: runId,
    filename: INVOICE_NAME,
    storagePath,
    fileSizeBytes: bytes.byteLength,
    uploadedBy: AUDITOR_ID,
    status: "received",
  });
  console.log(`[db] inserted invoice_runs row ${runId}`);

  const { triggerPipeline } = await import("../src/lib/pipeline/orchestrator");
  const t0 = Date.now();
  await triggerPipeline(runId);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[pipeline] completed in ${dt}s`);

  const run = await db
    .select({
      status: invoiceRuns.status,
      extractionMode: invoiceRuns.extractionMode,
    })
    .from(invoiceRuns)
    .where(eq(invoiceRuns.id, runId));

  const ext = await db
    .select({
      extractedJson: invoiceExtractions.extractedJson,
      modelUsed: invoiceExtractions.modelUsed,
      tokensIn: invoiceExtractions.tokensIn,
      tokensOut: invoiceExtractions.tokensOut,
      latencyMs: invoiceExtractions.latencyMs,
    })
    .from(invoiceExtractions)
    .where(eq(invoiceExtractions.runId, runId));

  const dec = await db
    .select({
      finalDecision: decisions.finalDecision,
      pass1Decision: decisions.pass1Decision,
      reason: decisions.reason,
    })
    .from(decisions)
    .where(eq(decisions.runId, runId));

  console.log("\n============================================================");
  console.log("RESULT");
  console.log("============================================================");
  console.log(`runId:              ${runId}`);
  console.log(`filename:           ${INVOICE_NAME}`);
  console.log(`run.status:         ${run[0]?.status}`);
  console.log(`run.extractionMode: ${run[0]?.extractionMode}`);
  if (ext[0]) {
    console.log(`model:              ${ext[0].modelUsed}`);
    console.log(`tokens in/out:      ${ext[0].tokensIn}/${ext[0].tokensOut}`);
    console.log(`latency:            ${ext[0].latencyMs} ms`);
    console.log(`extracted JSON:`);
    console.log(JSON.stringify(ext[0].extractedJson, null, 2));
  }
  if (dec[0]) {
    console.log(`pass1_decision:     ${dec[0].pass1Decision}`);
    console.log(`final_decision:     ${dec[0].finalDecision}`);
    console.log(`reason:             ${dec[0].reason ?? "-"}`);
  } else {
    console.log(`NO DECISION ROW`);
  }
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });

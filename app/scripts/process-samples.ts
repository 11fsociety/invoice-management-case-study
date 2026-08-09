/**
 * scripts/process-samples.ts
 *
 * Seed-time driver that pushes all 20 sample invoices through the real Bedrock
 * pipeline so the admin dashboard has populated rows on first login.
 *
 * Flow per invoice:
 *   read PDF -> upload to `invoices` bucket -> insert invoice_runs row ->
 *   call triggerPipeline() from src/lib/pipeline/orchestrator (extract + pass1
 *   + pass2 global).
 *
 * If the `global.anthropic.claude-opus-4-7` inference profile returns
 * AccessDeniedException we fall back once to `us.anthropic.claude-opus-4-7`
 * (regional profile). The DB row for the active provider is NOT changed.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { eq, sql } from "drizzle-orm";

// Fixed IDs handed in from the seed.
const AUDITOR_ID = "85e15b4c-29ea-472e-9328-182de0347f36";

const SAMPLES_DIR =
  process.env.SAMPLES_DIR ??
  "D:\\codezzz\\Claude\\zamp-asa\\sample-invoices";

const PO_XLSX = join(SAMPLES_DIR, "po_master.xlsx");
const INVOICE_COUNT = Number(process.env.INVOICE_COUNT ?? 29);
const SLEEP_MS = 400;

const REGIONAL_MODEL = "us.anthropic.claude-opus-4-7";

type FinalDecision = "APPROVED" | "FLAGGED_FOR_REVIEW" | "REJECTED" | "DUPLICATE";

type PerInvoiceResult = {
  filename: string;
  runId: string | null;
  finalDecision: FinalDecision | "UNKNOWN" | "ERROR";
  reason: string | null;
  usedFallbackModel: boolean;
  error?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAccessDeniedOnInferenceProfile(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  const name = e.name ?? "";
  const msg = e.message ?? "";
  return (
    /AccessDeniedException/i.test(name + " " + msg) ||
    /inference profile/i.test(msg) ||
    /You don.?t have access to the model/i.test(msg)
  );
}

function isThrottling(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string; statusCode?: number };
  const s = (e.name ?? "") + " " + (e.message ?? "");
  return (
    /Throttling|ThrottlingException|TooManyRequests|429|503|ServiceUnavailable/.test(
      s
    ) ||
    e.statusCode === 429 ||
    e.statusCode === 503
  );
}

/**
 * Wipe cached pipeline modules so the next `await import()` re-reads
 * process.env.BEDROCK_MODEL_ID (which is captured at module load).
 * We iterate require.cache because path aliases (@/) don't work with
 * require.resolve outside webpack.
 */
function invalidatePipelineCache(): void {
  const req = require as unknown as { cache: Record<string, unknown> };
  const cache = req.cache;
  if (!cache) return;
  for (const key of Object.keys(cache)) {
    // Any TS file under src/lib/pipeline should be nuked.
    if (key.replace(/\\/g, "/").includes("/src/lib/pipeline/")) {
      delete cache[key];
    }
  }
}

async function loadPipeline() {
  const mod = await import("../src/lib/pipeline/orchestrator");
  return mod.triggerPipeline;
}

async function loadPass2() {
  const mod = await import("../src/lib/pipeline/dedupe");
  return mod.runPass2Global;
}

async function loadDb() {
  const mod = await import("../src/lib/db");
  return {
    db: mod.db,
    schema: {
      poRows: mod.poRows,
      invoiceRuns: mod.invoiceRuns,
      decisions: mod.decisions,
    },
  };
}

// ---- PO seeding ----

async function seedPoSheetIfNeeded(
  supabase: ReturnType<typeof createClient>,
  drizzleBits: Awaited<ReturnType<typeof loadDb>>
): Promise<void> {
  const { db, schema } = drizzleBits;

  if (!existsSync(PO_XLSX)) {
    throw new Error(`PO master xlsx not found at ${PO_XLSX}`);
  }

  const xlsxBytes = readFileSync(PO_XLSX);

  // Upload the current xlsx snapshot only if po_rows table is empty.
  const existing = await db.select({ id: schema.poRows.id }).from(schema.poRows).limit(1);
  if (existing.length === 0) {
    const storagePath = `sheets/${randomUUID()}.xlsx`;
    const { error: upErr } = await supabase.storage
      .from("po-sheets")
      .upload(storagePath, xlsxBytes, {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });
    if (upErr) {
      throw new Error(`po-sheets upload failed: ${upErr.message}`);
    }
    console.log(`[po] uploaded ${basename(PO_XLSX)} -> po-sheets/${storagePath}`);
  } else {
    console.log("[po] po_rows already has data; will add any missing rows from xlsx");
  }

  const wb = XLSX.read(xlsxBytes, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
    raw: true,
    defval: null,
  });
  console.log(`[po] parsed ${rows.length} rows from ${sheetName}`);

  // Dedupe by po_number.
  const existingPoNumbers = new Set<string>();
  const already = await db.select({ poNumber: schema.poRows.poNumber }).from(schema.poRows);
  for (const r of already) existingPoNumbers.add(r.poNumber.trim().toLowerCase());

  const inserts: Array<typeof schema.poRows.$inferInsert> = [];
  for (const r of rows) {
    const poNumber = String(r.po_number ?? "").trim();
    if (!poNumber) continue;
    if (existingPoNumbers.has(poNumber.toLowerCase())) continue;

    let poDate: string;
    const dv = r.po_date;
    if (dv instanceof Date) {
      poDate = dv.toISOString().slice(0, 10);
    } else if (typeof dv === "number") {
      // Excel serial date
      const parsed = XLSX.SSF.parse_date_code(dv);
      poDate = `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(
        2,
        "0"
      )}-${String(parsed.d).padStart(2, "0")}`;
    } else {
      const s = String(dv ?? "").trim();
      const d = new Date(s);
      if (isNaN(d.getTime())) {
        console.warn(`[po] skipping row with unparseable po_date: ${poNumber} ${s}`);
        continue;
      }
      poDate = d.toISOString().slice(0, 10);
    }

    inserts.push({
      poNumber,
      poDate,
      vendorName: String(r.vendor_name ?? "").trim(),
      vendorId: r.vendor_id != null ? String(r.vendor_id).trim() : null,
      poAmount: String(r.po_amount ?? "0"),
      currency: r.currency != null ? String(r.currency).trim() : "INR",
      lineItemSummary:
        r.line_item_summary != null ? String(r.line_item_summary) : null,
      uploadedBy: AUDITOR_ID,
    });
  }

  if (inserts.length === 0) {
    console.log("[po] nothing to insert after dedupe");
    return;
  }
  await db.insert(schema.poRows).values(inserts);
  console.log(`[po] inserted ${inserts.length} po_rows`);
}

// ---- Invoice run ----

async function processOneInvoice(
  supabase: ReturnType<typeof createClient>,
  drizzleBits: Awaited<ReturnType<typeof loadDb>>,
  filename: string,
  filepath: string,
  attemptState: { fellBackToRegional: boolean }
): Promise<PerInvoiceResult> {
  const { db, schema } = drizzleBits;

  // Skip if run row with this filename already exists.
  const existing = await db
    .select({ id: schema.invoiceRuns.id })
    .from(schema.invoiceRuns)
    .where(eq(schema.invoiceRuns.filename, filename));
  if (existing.length > 0) {
    console.log(`[inv] ${filename}: already processed (runId=${existing[0].id}), skipping`);
    return {
      filename,
      runId: existing[0].id,
      finalDecision: "UNKNOWN",
      reason: "already exists",
      usedFallbackModel: false,
    };
  }

  const bytes = readFileSync(filepath);
  const runId = randomUUID();
  const storagePath = `runs/${runId}.pdf`;

  const { error: upErr } = await supabase.storage
    .from("invoices")
    .upload(storagePath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (upErr) {
    return {
      filename,
      runId: null,
      finalDecision: "ERROR",
      reason: `upload failed: ${upErr.message}`,
      usedFallbackModel: false,
      error: upErr.message,
    };
  }

  await db.insert(schema.invoiceRuns).values({
    id: runId,
    filename,
    storagePath,
    fileSizeBytes: bytes.byteLength,
    uploadedBy: AUDITOR_ID,
    status: "received",
  });

  let usedFallbackModel = attemptState.fellBackToRegional;
  let lastError: unknown = null;

  // First attempt.
  try {
    const triggerPipeline = await loadPipeline();
    await triggerPipeline(runId);
  } catch (err) {
    lastError = err;
    const msg = (err as Error).message ?? String(err);

    // Access denied on inference profile -> switch to regional, once.
    if (isAccessDeniedOnInferenceProfile(err) && !attemptState.fellBackToRegional) {
      console.warn(
        `[inv] ${filename}: AccessDeniedException on inference profile - falling back to ${REGIONAL_MODEL}`
      );
      process.env.BEDROCK_MODEL_ID = REGIONAL_MODEL;
      attemptState.fellBackToRegional = true;
      usedFallbackModel = true;
      invalidatePipelineCache();
      try {
        const triggerPipeline = await loadPipeline();
        await triggerPipeline(runId);
        lastError = null;
      } catch (err2) {
        lastError = err2;
      }
    } else if (
      /timed out|timeout|ETIMEDOUT|ECONNRESET/i.test(msg) ||
      isThrottling(err)
    ) {
      // Cold-start / throttle - single retry after 5s.
      console.warn(
        `[inv] ${filename}: transient error (${msg.slice(0, 120)}) - retrying once after 5s`
      );
      await sleep(5000);
      try {
        const triggerPipeline = await loadPipeline();
        await triggerPipeline(runId);
        lastError = null;
      } catch (err2) {
        lastError = err2;
      }
    }
  }

  if (lastError) {
    const msg = (lastError as Error).message ?? String(lastError);
    console.error(`[inv] ${filename}: pipeline failed: ${msg}`);
    return {
      filename,
      runId,
      finalDecision: "ERROR",
      reason: msg.slice(0, 300),
      usedFallbackModel,
      error: msg,
    };
  }

  // Load decision row.
  const dec = await db
    .select({
      finalDecision: schema.decisions.finalDecision,
      reason: schema.decisions.reason,
    })
    .from(schema.decisions)
    .where(eq(schema.decisions.runId, runId));

  if (dec.length === 0) {
    return {
      filename,
      runId,
      finalDecision: "UNKNOWN",
      reason: "no decision row after pipeline",
      usedFallbackModel,
    };
  }

  return {
    filename,
    runId,
    finalDecision: dec[0].finalDecision as FinalDecision,
    reason: dec[0].reason ?? null,
    usedFallbackModel,
  };
}

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

  const initialModel =
    process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-opus-4-7";
  const region = process.env.AWS_REGION ?? "ap-south-1";
  console.log(`[env] region=${region} model=${initialModel}`);

  const supabase = createClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const drizzleBits = await loadDb();

  // 1. PO master.
  await seedPoSheetIfNeeded(supabase, drizzleBits);

  // 2. 20 invoices.
  const attemptState = { fellBackToRegional: false };
  const results: PerInvoiceResult[] = [];

  for (let i = 1; i <= INVOICE_COUNT; i++) {
    const fname = `INV-${String(i).padStart(4, "0")}.pdf`;
    const fpath = join(SAMPLES_DIR, fname);
    if (!existsSync(fpath)) {
      console.warn(`[inv] ${fname}: file missing at ${fpath}, skipping`);
      results.push({
        filename: fname,
        runId: null,
        finalDecision: "ERROR",
        reason: "file missing",
        usedFallbackModel: false,
      });
      continue;
    }

    console.log(`\n[inv] === ${fname} (${i}/${INVOICE_COUNT}) ===`);
    const t0 = Date.now();
    const r = await processOneInvoice(
      supabase,
      drizzleBits,
      fname,
      fpath,
      attemptState
    );
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[inv] ${fname}: ${r.finalDecision}${
        r.reason ? ` (${r.reason})` : ""
      } [${dt}s]${r.usedFallbackModel ? " [fallback-model]" : ""}`
    );
    results.push(r);

    if (i < INVOICE_COUNT) await sleep(SLEEP_MS);
  }

  // 3. Final pass2 sweep.
  console.log("\n[pass2] running final global sweep...");
  try {
    const runPass2Global = await loadPass2();
    const { retagCount } = await runPass2Global();
    console.log(`[pass2] retagged ${retagCount} rows`);
  } catch (err) {
    console.error(`[pass2] failed: ${(err as Error).message}`);
  }

  // 4. Refresh decisions from DB (in case pass2 retagged).
  const { db, schema } = drizzleBits;
  const finalRows = await db
    .select({
      filename: schema.invoiceRuns.filename,
      runId: schema.invoiceRuns.id,
      finalDecision: schema.decisions.finalDecision,
      reason: schema.decisions.reason,
    })
    .from(schema.invoiceRuns)
    .leftJoin(schema.decisions, eq(schema.decisions.runId, schema.invoiceRuns.id));

  // Summary counts.
  const counts: Record<string, number> = {
    APPROVED: 0,
    FLAGGED_FOR_REVIEW: 0,
    REJECTED: 0,
    DUPLICATE: 0,
    NO_DECISION: 0,
  };
  for (const r of finalRows) {
    const k = r.finalDecision ?? "NO_DECISION";
    counts[k] = (counts[k] ?? 0) + 1;
  }

  console.log("\n============================================================");
  console.log("SUMMARY");
  console.log("============================================================");
  console.log(`Region:          ${region}`);
  console.log(`Initial model:   ${initialModel}`);
  console.log(
    `Fallback used:   ${attemptState.fellBackToRegional ? `yes (${REGIONAL_MODEL})` : "no"}`
  );
  console.log("");
  console.log(`APPROVED             ${counts.APPROVED}`);
  console.log(`FLAGGED_FOR_REVIEW   ${counts.FLAGGED_FOR_REVIEW}`);
  console.log(`REJECTED             ${counts.REJECTED}`);
  console.log(`DUPLICATE            ${counts.DUPLICATE}`);
  if (counts.NO_DECISION > 0) {
    console.log(`NO_DECISION          ${counts.NO_DECISION}`);
  }
  console.log("");

  const nonApproved = finalRows.filter(
    (r) => (r.finalDecision ?? "NO_DECISION") !== "APPROVED"
  );
  if (nonApproved.length > 0) {
    console.log("NON-APPROVED:");
    for (const r of nonApproved) {
      console.log(
        `  - ${r.filename}: ${r.finalDecision ?? "NO_DECISION"}${
          r.reason ? ` - ${r.reason}` : ""
        }`
      );
    }
    console.log("");
  }

  // 5. Raw SQL verify.
  const raw = await db.execute(
    sql`SELECT final_decision, count(*)::int AS n FROM decisions GROUP BY final_decision ORDER BY final_decision`
  );
  console.log("RAW SQL (decisions grouped):");
  for (const row of raw as unknown as Array<{ final_decision: string; n: number }>) {
    console.log(`  ${row.final_decision.padEnd(20)} ${row.n}`);
  }
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });

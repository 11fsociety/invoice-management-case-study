/**
 * Re-run Pass 1 (and pass2 global) for a hardcoded list of filenames -
 * used to re-evaluate decisions after a matcher change without re-calling the
 * LLM.
 */

import { eq, inArray } from "drizzle-orm";

async function loadDb() {
  const mod = await import("../src/lib/db");
  return {
    db: mod.db,
    schema: {
      invoiceRuns: mod.invoiceRuns,
      decisions: mod.decisions,
    },
  };
}

async function loadPass1() {
  const mod = await import("../src/lib/pipeline/matcher");
  return mod.runPass1;
}

async function loadPass2() {
  const mod = await import("../src/lib/pipeline/dedupe");
  return mod.runPass2Global;
}

async function main() {
  const target = process.argv.slice(2);
  if (target.length === 0) {
    console.error("usage: rerun-pass1 INV-0021.pdf INV-0022.pdf ...");
    process.exit(1);
  }
  const { db, schema } = await loadDb();
  const rows = await db
    .select({ id: schema.invoiceRuns.id, filename: schema.invoiceRuns.filename })
    .from(schema.invoiceRuns)
    .where(inArray(schema.invoiceRuns.filename, target));

  const runPass1 = await loadPass1();
  for (const r of rows) {
    console.log(`[rerun] ${r.filename} (${r.id})`);
    try {
      await runPass1(r.id);
    } catch (err) {
      console.error(`  FAIL: ${(err as Error).message}`);
    }
  }
  const runPass2 = await loadPass2();
  const { retagCount } = await runPass2();
  console.log(`[pass2] retagged ${retagCount}`);

  // Print current decisions for the target rows.
  const dec = await db
    .select({
      filename: schema.invoiceRuns.filename,
      finalDecision: schema.decisions.finalDecision,
      reason: schema.decisions.reason,
    })
    .from(schema.invoiceRuns)
    .leftJoin(schema.decisions, eq(schema.decisions.runId, schema.invoiceRuns.id))
    .where(inArray(schema.invoiceRuns.filename, target));
  for (const d of dec) {
    console.log(`  ${d.filename}: ${d.finalDecision} ${d.reason ?? ""}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/**
 * scripts/delete-samples.ts
 *
 * Wipe invoice_runs (and cascaded extractions/decisions) for INV-0001..INV-0020,
 * plus their storage objects in the `invoices` bucket. Used before re-seeding
 * to force reprocessing after the switch to native PDF input.
 */

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dbUrl) throw new Error("DATABASE_URL not set");
  if (!supaUrl || !serviceKey) {
    throw new Error("Supabase URL / service role key not set");
  }

  const sql = postgres(dbUrl, {
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const supabase = createClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Find candidate rows.
  const rows = await sql<Array<{ id: string; filename: string; storage_path: string }>>`
    SELECT id, filename, storage_path
    FROM invoice_runs
    WHERE filename ~ '^INV-00[012][0-9]\.pdf$'
    ORDER BY filename
  `;
  console.log(`[del] matched ${rows.length} invoice_runs rows`);
  for (const r of rows) {
    console.log(`  - ${r.filename} (id=${r.id}, storage=${r.storage_path})`);
  }

  // 2. Delete storage objects first (so we still have the path list).
  const paths = rows.map((r) => r.storage_path).filter((p) => !!p);
  let deletedStorage = 0;
  if (paths.length > 0) {
    const { data, error } = await supabase.storage.from("invoices").remove(paths);
    if (error) {
      console.error(`[del] storage remove error: ${error.message}`);
    } else {
      deletedStorage = data?.length ?? 0;
      console.log(`[del] removed ${deletedStorage} storage objects from bucket 'invoices'`);
    }
  }

  // 3. Delete DB rows (cascade -> extractions + decisions).
  const del = await sql`
    DELETE FROM invoice_runs
    WHERE filename ~ '^INV-00[012][0-9]\.pdf$'
    RETURNING id
  `;
  const deletedRuns = del.length;
  console.log(`[del] deleted ${deletedRuns} invoice_runs rows (cascaded extractions/decisions)`);

  // 4. Sanity check.
  const remain = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM invoice_runs WHERE filename ~ '^INV-00[012][0-9]\.pdf$'
  `;
  console.log(`[del] remaining matching rows: ${remain[0].n}`);

  console.log(JSON.stringify({ deletedRuns, deletedStorage, paths }, null, 2));

  await sql.end({ timeout: 5 });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const buckets = [
    { name: "invoices", public: false },
    { name: "po-sheets", public: false },
  ];

  const { data: existing } = await supabase.storage.listBuckets();
  const existingNames = new Set((existing ?? []).map((b) => b.name));

  for (const b of buckets) {
    if (existingNames.has(b.name)) {
      console.log(`[bucket] exists: ${b.name}`);
      continue;
    }
    const { error } = await supabase.storage.createBucket(b.name, { public: b.public });
    if (error) {
      console.error(`[bucket] FAIL ${b.name}: ${error.message}`);
      throw error;
    }
    console.log(`[bucket] created: ${b.name}`);
  }
  console.log("[bucket] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

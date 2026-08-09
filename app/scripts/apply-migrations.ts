import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL missing");

  const dir = "drizzle";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const sql = postgres(url, { max: 1, prepare: false });

  for (const file of files) {
    const path = join(dir, file);
    const content = readFileSync(path, "utf8");
    const statements = content.split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(`[migrate] ${file} - ${statements.length} statements`);
    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already exists/i.test(msg)) {
          console.log(`  skip (exists): ${stmt.slice(0, 60)}...`);
        } else {
          console.error(`  FAIL: ${stmt.slice(0, 200)}`);
          throw err;
        }
      }
    }
  }
  await sql.end();
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

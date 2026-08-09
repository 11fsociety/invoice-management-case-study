import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

async function main() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const dbUrl = process.env.DIRECT_URL!;
  if (!supaUrl || !serviceKey || !dbUrl) throw new Error("Env missing");

  const supabase = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  const sql = postgres(dbUrl, { max: 1, prepare: false });

  // --- 1. providers ---
  await sql`DELETE FROM providers`;
  await sql`
    INSERT INTO providers (provider, model_id, region, is_active, connection_ok)
    VALUES ('bedrock', 'global.anthropic.claude-opus-4-7', 'ap-south-1', true, null)
  `;
  console.log("[seed] providers");

  // --- 2. settings ---
  await sql`DELETE FROM settings`;
  await sql`
    INSERT INTO settings (key, value) VALUES
      ('tolerance_pct', ${sql.json(2.0)}),
      ('vendor_match_threshold', ${sql.json(0.85)}),
      ('duplicate_confidence_threshold', ${sql.json(0.75)})
  `;
  console.log("[seed] settings");

  // --- 3. parameters ---
  await sql`DELETE FROM parameters`;
  const params = [
    ["vendor_name", "vendor_name", "Vendor Name", "string", "Exact legal name of the vendor as printed on the invoice", true, true, true],
    ["invoice_date", "invoice_date", "Invoice Date", "date", "ISO date the invoice was issued", true, true, true],
    ["invoice_total", "invoice_total", "Amount", "currency", "Grand total payable on the invoice (post-tax)", true, true, true],
    ["line_items", "line_items", "Items", "string", "Purchased items or services with quantity and rate; also return line_items_raw verbatim", false, true, true],
    ["gst_number", "gst_number", "GST Number", "regex_match", "15-char alphanumeric Indian GST if present; null otherwise", false, true, true],
    ["po_number", "po_number", "PO Number", "string", "Purchase order reference cited on the invoice", true, true, true],
    // internal - not in admin UI, but always injected into prompt for matching
    ["currency", "currency", "Currency", "string", "ISO 4217 code (INR/USD/EUR)", false, false, true],
  ];
  for (const [id, name, displayName, type, hint, required, active, isPredef] of params) {
    await sql`
      INSERT INTO parameters (id, name, display_name, type, format_hint, required, active, is_predefined)
      VALUES (${id as string}, ${name as string}, ${displayName as string}, ${type as string},
              ${hint as string}, ${required as boolean}, ${active as boolean}, ${isPredef as boolean})
    `;
  }
  console.log(`[seed] parameters (${params.length})`);

  // --- 4. admin + auditor auth users ---
  async function ensureUser(email: string, password: string, role: "admin" | "auditor", createdBy?: string): Promise<string> {
    // check if exists in auth
    const list = await supabase.auth.admin.listUsers();
    if (list.error) throw list.error;
    const found = list.data.users.find((u) => u.email === email);
    let userId: string;
    if (found) {
      userId = found.id;
      console.log(`[seed] auth user exists: ${email}`);
    } else {
      const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      userId = created.data.user!.id;
      console.log(`[seed] auth user created: ${email}`);
    }
    // upsert profile
    await sql`
      INSERT INTO profiles (id, email, role, created_by)
      VALUES (${userId}, ${email}, ${role}, ${createdBy ?? null})
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role
    `;
    console.log(`[seed] profile: ${email} (${role})`);
    return userId;
  }

  const adminId = await ensureUser("admin123@gmail.com", "admin123", "admin");
  const auditorId = await ensureUser("auditor123@gmail.com", "auditor123", "auditor", adminId);

  await sql.end();
  console.log(JSON.stringify({ adminId, auditorId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

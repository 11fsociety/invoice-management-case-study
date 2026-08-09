import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { AdminTabs } from "./admin-tabs";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const rows = await db.select().from(profiles).where(eq(profiles.id, user.id));
  if (rows[0]?.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Manage users, model configuration, and extraction parameters.
        </p>
      </div>
      <AdminTabs />
    </section>
  );
}

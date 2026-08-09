import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const rows = await db.select().from(profiles).where(eq(profiles.id, user.id));
  const profile = rows[0];
  if (!profile) {
    redirect("/login");
  }

  const role = profile.role === "admin" ? "admin" : "auditor";

  return (
    <AppShell email={profile.email} role={role}>
      {children}
    </AppShell>
  );
}

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, invoiceRuns } from "@/lib/db/schema";

/**
 * Fetch the profile role for the given user id, or null if no profile row.
 */
export async function getRole(userId: string): Promise<string | null> {
  const rows = await db.select().from(profiles).where(eq(profiles.id, userId));
  return rows[0]?.role ?? null;
}

/**
 * Verify the given user is allowed to act on a run.
 * Returns "ok" if role is admin, or if the run's uploaded_by matches user.
 * Returns "not_found" if the run does not exist.
 * Returns "forbidden" if uploaded_by does not match and role is not admin.
 */
export async function checkRunOwnership(
  runId: string,
  userId: string
): Promise<"ok" | "not_found" | "forbidden"> {
  const rows = await db
    .select({ uploadedBy: invoiceRuns.uploadedBy })
    .from(invoiceRuns)
    .where(eq(invoiceRuns.id, runId));
  if (rows.length === 0) return "not_found";

  const role = await getRole(userId);
  if (role === "admin") return "ok";

  if (rows[0].uploadedBy && rows[0].uploadedBy === userId) return "ok";
  return "forbidden";
}

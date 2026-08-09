import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

// pgbouncer transaction pooler => disable prepared statements.
// Serverless note: each Vercel function instance opens its own pool. Keeping
// max low (10) prevents blowing through Supabase pooler connection quota when
// dozens of warm lambdas exist. idle_timeout closes idle sockets so cold pools
// don't linger, and connect_timeout bounds the initial handshake.
const client = postgres(url, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client);
export * from "./schema";

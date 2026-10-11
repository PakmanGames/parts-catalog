import { connection } from "next/server";
import { pool } from "@/db";

/** `GET /api/health` (PRD 7.4): `200 { ok: true }` once the app can query the database. */
export async function GET() {
  // With Cache Components, a GET handler can be prerendered at build time. Opting out keeps the
  // build away from the database and makes every call a live check, which Railway's healthcheck
  // relies on.
  await connection();
  try {
    // Plain `pg` rather than Drizzle, which would wrap the failure as "Failed query: select 1".
    await pool.query("select 1");
  } catch (error) {
    // A refused connection arrives as an AggregateError with an empty message and only a code
    // such as ECONNREFUSED, so fall back to the code.
    const { message, code } = error as Error & { code?: string };
    return Response.json({ error: `Database unreachable: ${message || code}` }, { status: 503 });
  }
  return Response.json({ ok: true });
}

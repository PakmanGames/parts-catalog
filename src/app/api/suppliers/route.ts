import type { SuppliersResponse } from "@/contracts/suppliers";
import { db } from "@/db";
import { listSuppliers } from "@/server/parts/list-suppliers";

/** `GET /api/suppliers` (PRD 7.4): one display spelling per supplier, sorted by name. */
export async function GET() {
  return Response.json((await listSuppliers(db)) satisfies SuppliersResponse);
}

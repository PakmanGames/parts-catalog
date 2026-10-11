import { sql } from "drizzle-orm";
import type { SuppliersResponse } from "@/contracts/suppliers";
import type { Db } from "@/db";

/**
 * The supplier list behind `GET /api/suppliers` (PRD 7.3, 7.4): one display spelling per
 * `supplier_key`, sorted by name.
 *
 * A plain `DISTINCT` would read all 1.2M rows to find 40 names. Instead a recursive query jumps
 * from each key to the next one in the `(supplier_key, ...)` index (a loose index scan), so it
 * reads about one index entry per supplier.
 *
 * The import gives every available part of a supplier the same spelling, its most common one
 * (A13), so any available part has it. An unavailable part can keep an older spelling, so only a
 * supplier with no available parts falls back to the spelling on its newest row.
 */
export async function listSuppliers(db: Db): Promise<SuppliersResponse> {
  return db.transaction(async (tx) => {
    // The planner prices the rarely used fallback below as a sort for every supplier, which pushes
    // the estimate past `jit_above_cost`. JIT compilation then takes about 80 ms of a query that
    // runs in under 1 ms at 1.2M rows, so it is off for this statement only.
    await tx.execute(sql`set local jit = off`);
    const { rows } = await tx.execute<{ supplier: string }>(sql`
      with recursive supplier_keys (supplier_key) as (
        (select supplier_key from parts order by supplier_key limit 1)
        union all
        select (
          select p.supplier_key from parts p
          where p.supplier_key > k.supplier_key
          order by p.supplier_key
          limit 1
        )
        from supplier_keys k
        where k.supplier_key is not null
      )
      select coalesce(
        (
          select p.supplier from parts p
          where p.supplier_key = k.supplier_key and p.unavailable_since is null
          -- Pins the plan to the (supplier_key, part_number_key) index; without an order the
          -- planner may scan the table, which is slow when one supplier's rows sit together.
          order by p.part_number_key
          limit 1
        ),
        (
          select p.supplier from parts p
          where p.supplier_key = k.supplier_key
          order by p.last_updated desc, p.id desc
          limit 1
        )
      ) as supplier
      from supplier_keys k
      where k.supplier_key is not null
      order by supplier
    `);
    return { items: rows.map((row) => row.supplier) };
  });
}

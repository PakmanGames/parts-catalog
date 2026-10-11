/**
 * Drizzle table definitions for PRD 7.1, the source drizzle-kit generates migrations from.
 *
 * `normalize_key` and the `pg_trgm` extension live in the hand-written migration
 * `drizzle/0000_extensions_and_normalize_key.sql`, because drizzle-kit can't express them.
 * Indexes beyond the keys are WS-B's to revise from its benchmark (PRD 7.3, section 10).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Ids are `bigint` in Postgres and plain numbers in TypeScript, which is exact up to 2^53 - 1.
const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

/** `numeric(12, 2)`: scale 2 is confirmed by the data profile (P20), and matches `MONEY_SCALE`. */
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/**
 * The catalog: one row per (normalized supplier, normalized part number).
 * Rows are never deleted, so an id always refers to the same part (D2, D14).
 */
export const parts = pgTable(
  "parts",
  {
    id: id(),
    /** The supplier's most common spelling in the latest file that had it (A13). */
    supplier: text("supplier").notNull(),
    supplierKey: text("supplier_key").notNull().generatedAlwaysAs(sql`normalize_key(supplier)`),
    /** Trimmed and upper-cased from the winning row (A13). */
    partNumber: text("part_number").notNull(),
    partNumberKey: text("part_number_key")
      .notNull()
      .generatedAlwaysAs(sql`normalize_key(part_number)`),
    /** NULL when the file left it blank or wrote `N/A` (A19). */
    quantity: integer("quantity"),
    /** US dollars (Q8). NULL when the file left it blank or wrote `CALL` (A19). */
    price: money("price"),
    /** Whole calendar days (Q8). NULL when the file left it blank or wrote `TBD`. */
    leadTimeDays: integer("lead_time_days"),
    lastUpdated: timestamp("last_updated", { withTimezone: true, mode: "date" }).notNull(),
    /** NULL while the part is in the latest file (C11, D14, A17). */
    unavailableSince: timestamp("unavailable_since", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    // The natural key: the import's MERGE target and the "no duplicates" guarantee (R1.3, D2).
    unique("parts_supplier_key_part_number_key_key").on(t.supplierKey, t.partNumberKey),
    // Each sort with no supplier filter, both directions by backward scan (PRD 7.3).
    index("parts_quantity_id_idx").on(t.quantity, t.id),
    index("parts_price_id_idx").on(t.price, t.id),
    index("parts_lead_time_days_id_idx").on(t.leadTimeDays, t.id),
    index("parts_part_number_key_id_idx").on(t.partNumberKey, t.id),
    // One supplier plus each sort (PRD 7.3).
    index("parts_supplier_key_quantity_id_idx").on(t.supplierKey, t.quantity, t.id),
    index("parts_supplier_key_price_id_idx").on(t.supplierKey, t.price, t.id),
    index("parts_supplier_key_lead_time_days_id_idx").on(t.supplierKey, t.leadTimeDays, t.id),
    // Substring search on the normalized part number (R2.3).
    index("parts_part_number_key_trgm_idx").using("gin", t.partNumberKey.op("gin_trgm_ops")),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    customerName: text("customer_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [check("quotes_customer_name_check", sql`btrim(${t.customerName}) <> ''`)],
);

/** Each line keeps its own copy of the agreed unit price, so later imports can't change it (D9). */
export const quoteLines = pgTable(
  "quote_lines",
  {
    quoteId: bigint("quote_id", { mode: "number" })
      .notNull()
      .references(() => quotes.id),
    partId: bigint("part_id", { mode: "number" })
      .notNull()
      .references(() => parts.id),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteId, t.partId] }),
    check("quote_lines_quantity_check", sql`${t.quantity} > 0`),
    check("quote_lines_unit_price_check", sql`${t.unitPrice} >= 0`),
  ],
);

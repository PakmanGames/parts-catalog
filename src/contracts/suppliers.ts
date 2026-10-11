import { z } from "zod";

/** `GET /api/suppliers`: one display spelling per supplier, sorted by name (PRD 7.4, A13). */
export const SuppliersResponse = z.object({ items: z.array(z.string()) });
export type SuppliersResponse = z.infer<typeof SuppliersResponse>;

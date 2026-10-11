import { z } from "zod";

/** `GET /api/health` `200` body. When the database is unreachable it is a `503` `ErrorResponse`. */
export const HealthResponse = z.object({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;

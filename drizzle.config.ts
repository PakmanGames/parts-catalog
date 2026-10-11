import { defineConfig } from "drizzle-kit";

// Only `pnpm db:generate` reads this file, and generating migrations needs no database connection.
// `pnpm db:migrate` applies them with src/db/migrate.ts instead.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});

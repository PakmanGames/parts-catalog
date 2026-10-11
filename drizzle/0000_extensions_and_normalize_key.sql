-- Hand-written, because drizzle-kit can express neither an extension nor a SQL function (PRD 7.1).
-- It must stay the first migration: the generated key columns in 0001 call normalize_key (K1).

-- Trigram indexes make substring search on part numbers fast (PRD 7.3).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- The single definition of "the same" for part numbers and supplier names (C10, C12, A13, D13).
-- Used by the key columns, by import deduplication, and by search and filtering, so they can never disagree.
-- IMMUTABLE is required to use it in a generated column and an index.
CREATE FUNCTION normalize_key(raw text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN regexp_replace(upper(raw), '[^A-Z0-9]', '', 'g');

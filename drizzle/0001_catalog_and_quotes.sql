CREATE TABLE "parts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier" text NOT NULL,
	"supplier_key" text GENERATED ALWAYS AS (normalize_key(supplier)) STORED NOT NULL,
	"part_number" text NOT NULL,
	"part_number_key" text GENERATED ALWAYS AS (normalize_key(part_number)) STORED NOT NULL,
	"quantity" integer,
	"price" numeric(12, 2),
	"lead_time_days" integer,
	"last_updated" timestamp with time zone NOT NULL,
	"unavailable_since" timestamp with time zone,
	CONSTRAINT "parts_supplier_key_part_number_key_key" UNIQUE("supplier_key","part_number_key")
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"quote_id" bigint NOT NULL,
	"part_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	CONSTRAINT "quote_lines_quote_id_part_id_pk" PRIMARY KEY("quote_id","part_id"),
	CONSTRAINT "quote_lines_quantity_check" CHECK ("quote_lines"."quantity" > 0),
	CONSTRAINT "quote_lines_unit_price_check" CHECK ("quote_lines"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quotes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_customer_name_check" CHECK (btrim("quotes"."customer_name") <> '')
);
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parts_quantity_id_idx" ON "parts" USING btree ("quantity","id");--> statement-breakpoint
CREATE INDEX "parts_price_id_idx" ON "parts" USING btree ("price","id");--> statement-breakpoint
CREATE INDEX "parts_lead_time_days_id_idx" ON "parts" USING btree ("lead_time_days","id");--> statement-breakpoint
CREATE INDEX "parts_part_number_key_id_idx" ON "parts" USING btree ("part_number_key","id");--> statement-breakpoint
CREATE INDEX "parts_supplier_key_quantity_id_idx" ON "parts" USING btree ("supplier_key","quantity","id");--> statement-breakpoint
CREATE INDEX "parts_supplier_key_price_id_idx" ON "parts" USING btree ("supplier_key","price","id");--> statement-breakpoint
CREATE INDEX "parts_supplier_key_lead_time_days_id_idx" ON "parts" USING btree ("supplier_key","lead_time_days","id");--> statement-breakpoint
CREATE INDEX "parts_part_number_key_trgm_idx" ON "parts" USING gin ("part_number_key" gin_trgm_ops);
CREATE TABLE IF NOT EXISTS "agility_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_ref" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"custom_status" text,
	"premise_id" bigint,
	"customer_name" text,
	"supplier" text,
	"product" text,
	"channel_partner" text,
	"agent_name_raw" text,
	"agent_name_key" text,
	"order_created_date" timestamp with time zone,
	"payment_received_date" timestamp with time zone,
	"completed_date" timestamp with time zone,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agility_orders_order_ref_unique" UNIQUE("order_ref")
);

CREATE TABLE IF NOT EXISTS "agility_agent_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name_key" text NOT NULL,
	"agent_name_raw" text NOT NULL,
	"profile_id" uuid,
	"display_name" text,
	"match_type" text DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agility_agent_map_agent_name_key_unique" UNIQUE("agent_name_key")
);

DO $$ BEGIN
	ALTER TABLE "agility_orders" ADD CONSTRAINT "agility_orders_import_batch_id_agility_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."agility_import_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "agility_agent_map" ADD CONSTRAINT "agility_agent_map_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "agility_orders_agent_name_key_idx" ON "agility_orders" ("agent_name_key");
CREATE INDEX IF NOT EXISTS "agility_orders_status_idx" ON "agility_orders" ("status");
CREATE INDEX IF NOT EXISTS "agility_orders_order_created_date_idx" ON "agility_orders" ("order_created_date");
CREATE INDEX IF NOT EXISTS "agility_orders_premise_id_idx" ON "agility_orders" ("premise_id");

CREATE TABLE IF NOT EXISTS "agility_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_entity_id" bigint NOT NULL,
	"lead_number" text NOT NULL,
	"lead_description" text,
	"order_ref" text,
	"account_number" text,
	"account_name" text,
	"contact_name" text,
	"contact_email" text,
	"contact_number_raw" text,
	"contact_number" text,
	"alt_number_raw" text,
	"id_number" text,
	"address" text,
	"region" text,
	"latitude" double precision,
	"longitude" double precision,
	"status" text NOT NULL,
	"custom_status" text,
	"source" text,
	"product_name" text,
	"product_code" text,
	"supplier" text,
	"recurring_excl" double precision,
	"recurring_incl" double precision,
	"debit_order_day" integer,
	"kyc_status" text,
	"kyc_required" boolean,
	"channel_partner_code" text,
	"agent_name_raw" text,
	"agent_name_key" text,
	"sales_agent" text,
	"premise_id" bigint,
	"audit_created_date" timestamp with time zone,
	"original_order_date" timestamp with time zone,
	"submitted_date" timestamp with time zone,
	"assigned_date" timestamp with time zone,
	"audit_updated_date" timestamp with time zone,
	"expired_date" timestamp with time zone,
	"next_payment_date" timestamp with time zone,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agility_leads_lead_entity_id_unique" UNIQUE("lead_entity_id"),
	CONSTRAINT "agility_leads_lead_number_unique" UNIQUE("lead_number")
);

DO $$ BEGIN
	ALTER TABLE "agility_leads" ADD CONSTRAINT "agility_leads_import_batch_id_agility_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."agility_import_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "agility_leads_order_ref_idx" ON "agility_leads" ("order_ref");
CREATE INDEX IF NOT EXISTS "agility_leads_agent_name_key_idx" ON "agility_leads" ("agent_name_key");
CREATE INDEX IF NOT EXISTS "agility_leads_contact_number_idx" ON "agility_leads" ("contact_number");
CREATE INDEX IF NOT EXISTS "agility_leads_status_idx" ON "agility_leads" ("status");

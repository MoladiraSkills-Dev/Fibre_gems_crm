CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_code" text NOT NULL,
	"name" text NOT NULL,
	"campaign_cid" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"dial_method" text DEFAULT 'RATIO' NOT NULL,
	"auto_dial_level" double precision DEFAULT 1.5 NOT NULL,
	"ringing_timeout" integer DEFAULT 25 NOT NULL,
	"hopper_level" integer DEFAULT 200 NOT NULL,
	"force_recording" boolean DEFAULT true NOT NULL,
	"amd_enabled" boolean DEFAULT true NOT NULL,
	"auto_alternate_cell" boolean DEFAULT true NOT NULL,
	"blended_inbound" boolean DEFAULT false NOT NULL,
	"retry_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_campaign_code_unique" UNIQUE("campaign_code")
);

CREATE TABLE IF NOT EXISTS "lead_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_code" text NOT NULL,
	"name" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"vicidial_list_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_lists_list_code_unique" UNIQUE("list_code"),
	CONSTRAINT "lead_lists_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action
);

CREATE TABLE IF NOT EXISTS "lead_list_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"surname" text DEFAULT '' NOT NULL,
	"cell_number" text NOT NULL,
	"normalized_cell" text NOT NULL,
	"alternate_cell" text,
	"email" text,
	"address" text,
	"suburb" text,
	"product_package" text,
	"easypay_number" text,
	"vicidial_lead_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_list_leads_list_id_lead_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE cascade ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "lead_lists_campaign_idx" ON "lead_lists" ("campaign_id");
CREATE INDEX IF NOT EXISTS "lead_list_leads_list_idx" ON "lead_list_leads" ("list_id");
CREATE INDEX IF NOT EXISTS "lead_list_leads_normalized_idx" ON "lead_list_leads" ("normalized_cell");
CREATE INDEX IF NOT EXISTS "lead_list_leads_vicidial_idx" ON "lead_list_leads" ("vicidial_lead_id");

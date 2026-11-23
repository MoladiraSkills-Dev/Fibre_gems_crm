ALTER TABLE "agility_leads" ADD COLUMN IF NOT EXISTS "vicidial_lead_id" text;
ALTER TABLE "agility_leads" ADD COLUMN IF NOT EXISTS "pushed_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "agility_leads_vicidial_lead_id_idx" ON "agility_leads" ("vicidial_lead_id");

ALTER TABLE "agility_agent_map" ADD COLUMN IF NOT EXISTS "agent_status" text DEFAULT 'active' NOT NULL;
ALTER TABLE "agility_agent_map" ADD COLUMN IF NOT EXISTS "notes" text;

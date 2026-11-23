import { eq, sql } from "drizzle-orm";
import { agilityAgentMap, profiles } from "./db/schema";
import { normalizeNameKey } from "./agility-utils";

export type AgentNameRef = { key: string; raw: string };

/**
 * Ensures every distinct Agility agent name has an agility_agent_map row.
 * - Auto-matches normalized names against profiles.fullName.
 * - Never touches manual mappings.
 * - Upgrades still-unmatched rows when a matching profile appears later
 *   (covers agents added to the CRM after the first import).
 */
export async function ensureAgentMappings(
  db: any,
  names: AgentNameRef[]
): Promise<void> {
  if (!names.length) return;
  const now = new Date();

  const mapRows = await db
    .select({
      id: agilityAgentMap.id,
      key: agilityAgentMap.agentNameKey,
      profileId: agilityAgentMap.profileId,
      matchType: agilityAgentMap.matchType,
    })
    .from(agilityAgentMap);
  const mapByKey = new Map<string, any>(
    mapRows.map((r: any) => [
      r.key,
      { id: r.id, key: r.key, profileId: r.profileId, matchType: r.matchType },
    ])
  );

  const profRows = await db
    .select({ id: profiles.id, fullName: profiles.fullName })
    .from(profiles);
  const profByName = new Map<string, string>(
    profRows.map((p: any) => [normalizeNameKey(p.fullName), p.id] as const)
  );

  const seen = new Map<string, string>();
  for (const n of names) {
    if (n.key && !seen.has(n.key)) seen.set(n.key, n.raw);
  }

  for (const [key, raw] of seen) {
    const existing = mapByKey.get(key);
    if (existing) {
      if (!existing.profileId && existing.matchType !== "manual") {
        const pid = profByName.get(key);
        if (pid) {
          await db
            .update(agilityAgentMap)
            .set({ profileId: pid, matchType: "auto", updatedAt: now })
            .where(eq(agilityAgentMap.id, existing.id));
          existing.profileId = pid;
          existing.matchType = "auto";
        }
      }
      continue;
    }
    const pid = profByName.get(key) ?? null;
    await db
      .insert(agilityAgentMap)
      .values({
        agentNameKey: key,
        agentNameRaw: raw,
        profileId: pid,
        matchType: pid ? "auto" : "unmatched",
        updatedAt: now,
      })
      .onConflictDoNothing();
    mapByKey.set(key, { id: "", key, profileId: pid, matchType: pid ? "auto" : "unmatched" });
  }
}

/** Order+lead counts per agent key, for the mapping review UI. */
export async function agentOrderCounts(db: any): Promise<Map<string, number>> {
  const res = (await db.execute(sql`
    SELECT agent_name_key, SUM(c)::int AS c FROM (
      SELECT agent_name_key, COUNT(*) AS c FROM agility_orders WHERE agent_name_key IS NOT NULL GROUP BY agent_name_key
      UNION ALL
      SELECT agent_name_key, COUNT(*) AS c FROM agility_leads WHERE agent_name_key IS NOT NULL GROUP BY agent_name_key
    ) x GROUP BY agent_name_key
  `)) as any[];
  return new Map(res.map((r: any) => [r.agent_name_key, r.c]));
}

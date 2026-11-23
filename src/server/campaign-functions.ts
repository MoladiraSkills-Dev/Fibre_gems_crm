import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "./auth";
import { getDb, isMockMode, mockStore } from "./db";
import { campaigns, leadLists } from "./db/schema";
import { eq, asc, inArray, sql } from "drizzle-orm";
import { fetchVicidialCampaigns } from "./vicidial.server";

// ----------------------------------------------------
// TYPES
// ----------------------------------------------------

export type DialMethod = "MANUAL" | "RATIO" | "ADAPT_AVERAGE";

export type RetryRule = {
  status: string;
  retryAfterMinutes: number;
  maxAttempts: number;
};

export type AssignedLeadList = {
  id: string;
  name: string;
  leadCount: number;
  active: boolean;
};

export type Campaign = {
  id: string;
  campaignId: string; // numeric badge e.g. "1001"
  name: string;
  campaignCid: string;
  description: string;
  active: boolean;
  dialMethod: DialMethod;
  autoDialLevel: number; // 1.0 - 3.5
  ringingTimeout: number; // 18 - 45 seconds
  hopperLevel: number; // target lead count in hopper
  hopperCurrent: number; // current leads in hopper
  forceRecording: boolean;
  amdEnabled: boolean;
  autoAlternateCell: boolean;
  blendedInbound: boolean;
  leadLists: AssignedLeadList[];
  retryRules: RetryRule[];
  callsToday: number;
  conversionsToday: number;
  createdAt: string;
  updatedAt: string;
  /** "crm" = managed in Postgres; "vicidial" = read-only mirror of a dialer campaign */
  source: "crm" | "vicidial";
  /** VICIdial campaigns can't be edited/toggled from the CRM */
  readOnly: boolean;
  /** For CRM campaigns: whether a matching campaign exists and is active in VICIdial */
  vicidialActive?: boolean | null;
};

export type CampaignInput = {
  name: string;
  campaignCid: string;
  description?: string;
  dialMethod: DialMethod;
  autoDialLevel: number;
  ringingTimeout: number;
  hopperLevel: number;
  active: boolean;
  forceRecording: boolean;
  amdEnabled: boolean;
  autoAlternateCell: boolean;
  blendedInbound: boolean;
  retryRules: RetryRule[];
};

export type CampaignUpdate = Partial<{
  name: string;
  campaignCid: string;
  description: string;
  dialMethod: DialMethod;
  autoDialLevel: number;
  ringingTimeout: number;
  hopperLevel: number;
  active: boolean;
  forceRecording: boolean;
  amdEnabled: boolean;
  autoAlternateCell: boolean;
  blendedInbound: boolean;
  retryRules: RetryRule[];
}>;

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------

function requireAdmin(user: { id: string; role: string } | null) {
  if (!user) throw new Error("Unauthorized");
  if (user.role !== "admin") throw new Error("Admin access required");
  return user;
}

type CampaignRow = typeof campaigns.$inferSelect;
type LeadListRow = typeof leadLists.$inferSelect;

/** Loads campaigns with real lead-list assignments, hopper pool and today's call stats. */
async function loadCampaignDtos(db: any, campRows?: CampaignRow[]): Promise<Campaign[]> {
  const rows: CampaignRow[] =
    campRows ?? (await db.select().from(campaigns).orderBy(asc(campaigns.campaignCode)));
  if (rows.length === 0) return [];

  const campIds = rows.map((c) => c.id);
  const listRows: LeadListRow[] = await db
    .select()
    .from(leadLists)
    .where(inArray(leadLists.campaignId, campIds));
  const listIds = listRows.map((l) => l.id);
  const listIdParams = sql.join(
    listIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  // Per-list total + dialed lead counts (dialed = has a call_events row via VICIdial lead id)
  const listStats: Array<{ list_id: string; total: number; dialed: number }> = listIds.length
    ? ((await db.execute(sql`
        select l.list_id,
               count(*)::int as total,
               count(*) filter (where exists (
                 select 1 from call_events ce
                 where ce.vicidial_lead_id = l.vicidial_lead_id
               ))::int as dialed
        from lead_list_leads l
        where l.list_id in (${listIdParams})
        group by l.list_id
      `)) as any[])
    : [];
  const listStatMap = new Map(listStats.map((s) => [s.list_id, s]));

  // Per-campaign today call/conversion stats + undialed hopper pool
  const campIdParams = sql.join(
    campIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const campStats: Array<{
    campaign_id: string;
    calls_today: number;
    conversions_today: number;
    undialed: number;
  }> = ((await db.execute(sql`
    select c.id as campaign_id,
      count(ce.id) filter (where ce.started_at::date = current_date) as calls_today,
      count(ce.id) filter (
        where ce.started_at::date = current_date
          and upper(coalesce(ce.disposition, '')) in ('SALE', 'ACTIVATED', 'PAYMENT_PENDING')
      ) as conversions_today,
      (select count(*)::int
         from lead_lists ll2
         join lead_list_leads l2 on l2.list_id = ll2.id
        where ll2.campaign_id = c.id
          and ll2.active
          and not exists (
            select 1 from call_events ce2
            where ce2.vicidial_lead_id = l2.vicidial_lead_id
          )) as undialed
    from campaigns c
    left join lead_lists ll on ll.campaign_id = c.id
    left join lead_list_leads l on l.list_id = ll.id
    left join call_events ce on ce.vicidial_lead_id = l.vicidial_lead_id
    where c.id in (${campIdParams})
    group by c.id
  `)) as any[]);
  const campStatMap = new Map(campStats.map((s) => [s.campaign_id, s]));

  return rows.map((c) => {
    const stats = campStatMap.get(c.id);
    const assigned = listRows
      .filter((l) => l.campaignId === c.id)
      .map((l) => ({
        id: l.id,
        name: l.name,
        leadCount: listStatMap.get(l.id)?.total ?? 0,
        active: l.active,
      }));
    const retryRules = Array.isArray(c.retryRules) ? (c.retryRules as RetryRule[]) : [];
    return {
      id: c.id,
      campaignId: c.campaignCode,
      name: c.name,
      campaignCid: c.campaignCid,
      description: c.description,
      active: c.active,
      dialMethod: c.dialMethod as DialMethod,
      autoDialLevel: Number(c.autoDialLevel),
      ringingTimeout: c.ringingTimeout,
      hopperLevel: c.hopperLevel,
      hopperCurrent: Math.min(stats?.undialed ?? 0, c.hopperLevel),
      forceRecording: c.forceRecording,
      amdEnabled: c.amdEnabled,
      autoAlternateCell: c.autoAlternateCell,
      blendedInbound: c.blendedInbound,
      leadLists: assigned,
      retryRules,
      callsToday: stats?.calls_today ?? 0,
      conversionsToday: stats?.conversions_today ?? 0,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      source: "crm",
      readOnly: false,
      vicidialActive: null,
    };
  });
}

/** Maps VICIdial dial_method strings onto the CRM DialMethod union. */
function mapVicidialDialMethod(raw: string): DialMethod {
  const v = raw.toUpperCase();
  if (v.includes("ADAPT")) return "ADAPT_AVERAGE";
  if (v.includes("RATIO") || v.includes("ADAPT_HARD") || v.includes("ADAPT_AVG")) return "RATIO";
  return "MANUAL";
}

/**
 * Merges VICIdial-native campaigns into the CRM campaign list.
 * - A VICIdial campaign whose ID matches a CRM campaign_code is treated as the
 *   same campaign: the CRM row keeps ownership and just records vicidialActive.
 * - VICIdial campaigns with no CRM counterpart are appended as read-only
 *   entries so admins see the full dialer picture without duplicating rows.
 */
async function mergeVicidialCampaigns(dtos: Campaign[]): Promise<Campaign[]> {
  const res = await fetchVicidialCampaigns();
  if (!res.ok || !res.data.available) return dtos;

  const remote = res.data.campaigns ?? [];
  const byCode = new Map(dtos.map((d) => [d.campaignId, d]));

  for (const v of remote) {
    const id = (v.campaign_id || "").trim();
    if (!id) continue;
    const existing = byCode.get(id);
    if (existing) {
      existing.vicidialActive = v.active;
    } else {
      const now = new Date().toISOString();
      dtos.push({
        id: `vici-${id}`,
        campaignId: id,
        name: v.campaign_name || `VICIdial Campaign ${id}`,
        campaignCid: "",
        description: `Managed inside VICIdial (user group: ${v.user_group || "—"})`,
        active: v.active,
        dialMethod: mapVicidialDialMethod(v.dial_method),
        autoDialLevel: Number(v.dial_level) || 0,
        ringingTimeout: Number(v.dial_timeout) || 0,
        hopperLevel: 0,
        hopperCurrent: 0,
        forceRecording: false,
        amdEnabled: false,
        autoAlternateCell: false,
        blendedInbound: false,
        leadLists: [],
        retryRules: [],
        callsToday: 0,
        conversionsToday: 0,
        createdAt: now,
        updatedAt: now,
        source: "vicidial",
        readOnly: true,
        vicidialActive: v.active,
      });
      byCode.set(id, dtos[dtos.length - 1]!);
    }
  }
  return dtos;
}

async function nextCampaignCode(db: any): Promise<string> {
  const rows = (await db.execute(sql`
    select coalesce(max(campaign_code::int), 1000) + 1 as next_code
    from campaigns
    where campaign_code ~ '^[0-9]+$'
  `)) as any[];
  return String(rows[0]?.next_code ?? 1001);
}

// ----------------------------------------------------
// SERVER FUNCTIONS
// ----------------------------------------------------

export const getCampaignsFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());

  if (isMockMode()) {
    const map = (mockStore as any).campaigns as Map<string, Campaign> | undefined;
    const list = Array.from(map?.values() ?? []).sort((a, b) =>
      a.campaignId.localeCompare(b.campaignId),
    );
    return { campaigns: list };
  }

  const db = getDb();
  const dtos = await loadCampaignDtos(db);
  return { campaigns: await mergeVicidialCampaigns(dtos) };
});

export const createCampaignFn = createServerFn({ method: "POST" })
  .validator((data: CampaignInput) => {
    if (!data.name?.trim()) throw new Error("Campaign name is required");
    if (!data.campaignCid?.trim()) throw new Error("Outbound Caller ID is required");
    if (data.autoDialLevel < 1.0 || data.autoDialLevel > 3.5)
      throw new Error("Auto-dial multiplier must be between 1.0 and 3.5");
    if (data.ringingTimeout < 18 || data.ringingTimeout > 45)
      throw new Error("Ringing timeout must be between 18 and 45 seconds");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      const map = (mockStore as any).campaigns as Map<string, Campaign>;
      const existing = Array.from(map.values());
      const nums = existing.map((c) => parseInt(c.campaignId, 10)).filter((n) => !isNaN(n));
      const nextNum = nums.length ? Math.max(...nums) + 1 : 1001;
      const id = `camp-${nextNum}`;
      const campaignId = String(nextNum);
      const ts = new Date().toISOString();
      const campaign: Campaign = {
        id,
        campaignId,
        name: data.name.trim(),
        campaignCid: data.campaignCid.trim(),
        description: data.description?.trim() ?? "",
        active: data.active,
        dialMethod: data.dialMethod,
        autoDialLevel: data.autoDialLevel,
        ringingTimeout: data.ringingTimeout,
        hopperLevel: data.hopperLevel,
        hopperCurrent: 0,
        forceRecording: data.forceRecording,
        amdEnabled: data.amdEnabled,
        autoAlternateCell: data.autoAlternateCell,
        blendedInbound: data.blendedInbound,
        leadLists: [],
        retryRules: data.retryRules,
        callsToday: 0,
        conversionsToday: 0,
        createdAt: ts,
        updatedAt: ts,
        source: "crm",
        readOnly: false,
        vicidialActive: null,
      };
      map.set(id, campaign);
      return { success: true, campaign };
    }

    const db = getDb();
    const campaignCode = await nextCampaignCode(db);
    const [row] = await db
      .insert(campaigns)
      .values({
        campaignCode,
        name: data.name.trim(),
        campaignCid: data.campaignCid.trim(),
        description: data.description?.trim() ?? "",
        active: data.active,
        dialMethod: data.dialMethod,
        autoDialLevel: data.autoDialLevel,
        ringingTimeout: data.ringingTimeout,
        hopperLevel: data.hopperLevel,
        forceRecording: data.forceRecording,
        amdEnabled: data.amdEnabled,
        autoAlternateCell: data.autoAlternateCell,
        blendedInbound: data.blendedInbound,
        retryRules: data.retryRules,
      })
      .returning();
    if (!row) throw new Error("Failed to create campaign");

    const [campaign] = await loadCampaignDtos(db, [row]);
    if (!campaign) throw new Error("Failed to load created campaign");
    return { success: true, campaign };
  });

export const updateCampaignFn = createServerFn({ method: "POST" })
  .validator((data: { id: string } & CampaignUpdate) => {
    if (!data.id) throw new Error("Campaign ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    const patch: Partial<typeof campaigns.$inferInsert> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.campaignCid !== undefined) patch.campaignCid = data.campaignCid.trim();
    if (data.description !== undefined) patch.description = data.description.trim();
    if (data.dialMethod !== undefined) patch.dialMethod = data.dialMethod;
    if (data.autoDialLevel !== undefined) patch.autoDialLevel = data.autoDialLevel;
    if (data.ringingTimeout !== undefined) patch.ringingTimeout = data.ringingTimeout;
    if (data.hopperLevel !== undefined) patch.hopperLevel = data.hopperLevel;
    if (data.active !== undefined) patch.active = data.active;
    if (data.forceRecording !== undefined) patch.forceRecording = data.forceRecording;
    if (data.amdEnabled !== undefined) patch.amdEnabled = data.amdEnabled;
    if (data.autoAlternateCell !== undefined) patch.autoAlternateCell = data.autoAlternateCell;
    if (data.blendedInbound !== undefined) patch.blendedInbound = data.blendedInbound;
    if (data.retryRules !== undefined) patch.retryRules = data.retryRules;

    if (isMockMode()) {
      const map = (mockStore as any).campaigns as Map<string, Campaign>;
      const existing = map.get(data.id);
      if (!existing) throw new Error("Campaign not found");
      const updated: Campaign = {
        ...existing,
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.campaignCid !== undefined ? { campaignCid: data.campaignCid.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() } : {}),
        ...(data.dialMethod !== undefined ? { dialMethod: data.dialMethod } : {}),
        ...(data.autoDialLevel !== undefined ? { autoDialLevel: data.autoDialLevel } : {}),
        ...(data.ringingTimeout !== undefined ? { ringingTimeout: data.ringingTimeout } : {}),
        ...(data.hopperLevel !== undefined ? { hopperLevel: data.hopperLevel } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.forceRecording !== undefined ? { forceRecording: data.forceRecording } : {}),
        ...(data.amdEnabled !== undefined ? { amdEnabled: data.amdEnabled } : {}),
        ...(data.autoAlternateCell !== undefined ? { autoAlternateCell: data.autoAlternateCell } : {}),
        ...(data.blendedInbound !== undefined ? { blendedInbound: data.blendedInbound } : {}),
        ...(data.retryRules !== undefined ? { retryRules: data.retryRules } : {}),
        updatedAt: new Date().toISOString(),
        source: existing.source ?? "crm",
        readOnly: existing.readOnly ?? false,
        vicidialActive: existing.vicidialActive ?? null,
      };
      map.set(data.id, updated);
      return { success: true, campaign: updated };
    }

    const db = getDb();
    if (data.id.startsWith("vici-")) throw new Error("VICIdial-managed campaigns are read-only");
    const [row] = await db
      .update(campaigns)
      .set(patch)
      .where(eq(campaigns.id, data.id))
      .returning();
    if (!row) throw new Error("Campaign not found");

    const [campaign] = await loadCampaignDtos(db, [row]);
    if (!campaign) throw new Error("Failed to load updated campaign");
    return { success: true, campaign };
  });

export const reloadHopperFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("Campaign ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      const map = (mockStore as any).campaigns as Map<string, Campaign>;
      const existing = map.get(data.id);
      if (!existing) throw new Error("Campaign not found");
      const availableLeads = existing.leadLists
        .filter((l) => l.active)
        .reduce((sum, l) => sum + l.leadCount, 0);
      const target = Math.min(existing.hopperLevel, availableLeads);
      existing.hopperCurrent = target;
      existing.updatedAt = new Date().toISOString();
      map.set(data.id, existing);
      return { success: true, hopperCurrent: target };
    }

    const db = getDb();
    if (data.id.startsWith("vici-")) throw new Error("VICIdial-managed campaigns are read-only");
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, data.id)).limit(1);
    if (!camp) throw new Error("Campaign not found");

    // Real hopper pool: undialed leads across this campaign's active lists
    const rows = (await db.execute(sql`
      select count(*)::int as undialed
      from lead_lists ll
      join lead_list_leads l on l.list_id = ll.id
      where ll.campaign_id = ${data.id}::uuid
        and ll.active
        and not exists (
          select 1 from call_events ce
          where ce.vicidial_lead_id = l.vicidial_lead_id
        )
    `)) as any[];
    const undialed = rows[0]?.undialed ?? 0;
    return { success: true, hopperCurrent: Math.min(undialed, camp.hopperLevel) };
  });

/**
 * Adopts a VICIdial-native campaign into the CRM: creates a Postgres
 * `campaigns` row keyed by the VICIdial campaign_id so it can then be
 * fully managed (edit, toggle, hopper, lead lists) from the CRM.
 * Idempotent — returns the existing row if already adopted.
 */
export const adoptVicidialCampaignFn = createServerFn({ method: "POST" })
  .validator((data: { campaignId: string }) => {
    const id = (data?.campaignId || "").trim();
    if (!id) throw new Error("VICIdial campaign ID is required");
    return { campaignId: id };
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    if (isMockMode()) throw new Error("VICIdial campaigns are only available in production mode");

    const vicidialId = data.campaignId.replace(/^vici-/, "");
    const res = await fetchVicidialCampaigns();
    if (!res.ok || !res.data.available) {
      throw new Error("Could not reach VICIdial to verify this campaign");
    }
    const remote = (res.data.campaigns ?? []).find(
      (c) => (c.campaign_id || "").trim() === vicidialId,
    );
    if (!remote) throw new Error("Campaign not found in VICIdial");

    const db = getDb();
    const [existing] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.campaignCode, vicidialId))
      .limit(1);
    if (existing) {
      const [dto] = await loadCampaignDtos(db, [existing]);
      return { success: true, campaign: dto, alreadyExisted: true };
    }

    const [row] = await db
      .insert(campaigns)
      .values({
        campaignCode: vicidialId,
        name: remote.campaign_name || `VICIdial Campaign ${vicidialId}`,
        campaignCid: remote.dial_prefix || "",
        description: `Adopted from VICIdial (user group: ${remote.user_group || "—"})`,
        active: remote.active,
        dialMethod: mapVicidialDialMethod(remote.dial_method),
        autoDialLevel: Number(remote.dial_level) || 1.5,
        ringingTimeout: Number(remote.dial_timeout) || 25,
        hopperLevel: 200,
      })
      .returning();
    if (!row) throw new Error("Failed to adopt campaign");

    const [dto] = await loadCampaignDtos(db, [row]);
    return { success: true, campaign: dto, alreadyExisted: false };
  });

/**
 * Deletes a CRM-managed campaign. Lead lists and their leads cascade-delete
 * (VICIdial-side data is untouched). Blocked while the campaign still has
 * imported leads — delete/flush its lists first.
 */
export const deleteCampaignFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data?.id) throw new Error("Campaign ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    if (data.id.startsWith("vici-")) {
      throw new Error("VICIdial-managed campaigns must be removed inside VICIdial");
    }

    if (isMockMode()) {
      const map = (mockStore as any).campaigns as Map<string, Campaign>;
      if (!map.delete(data.id)) throw new Error("Campaign not found");
      return { success: true };
    }

    const db = getDb();
    const leadCountRows = (await db.execute(sql`
      select count(*)::int as n
      from lead_lists ll
      join lead_list_leads l on l.list_id = ll.id
      where ll.campaign_id = ${data.id}::uuid
    `)) as any[];
    const leadCount = leadCountRows[0]?.n ?? 0;
    if (leadCount > 0) {
      throw new Error(
        `Campaign still has ${leadCount} imported lead${leadCount === 1 ? "" : "s"} — delete its lead lists first`,
      );
    }

    const deleted = await db
      .delete(campaigns)
      .where(eq(campaigns.id, data.id))
      .returning({ id: campaigns.id });
    if (deleted.length === 0) throw new Error("Campaign not found");
    return { success: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "./auth";
import { getDb, isMockMode, mockStore } from "./db";
import { campaigns, leadLists, leadListLeads } from "./db/schema";
import { eq, asc, inArray, sql } from "drizzle-orm";

// ----------------------------------------------------
// TYPES
// ----------------------------------------------------

export type LeadList = {
  id: string;
  listId: string; // numeric badge e.g. "L-501"
  name: string;
  campaignId: string; // internal campaign id
  campaignName: string;
  totalLeads: number;
  dialedLeads: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ImportedLead = {
  id: string;
  listId: string;
  firstName: string;
  surname: string;
  cellNumber: string;
  normalizedCell: string;
  alternateCell: string | null;
  email: string | null;
  address: string | null;
  suburb: string | null;
  productPackage: string | null;
  easypayNumber: string | null;
  dialed: boolean;
  createdAt: string;
};

export type ImportResult = {
  totalRows: number;
  added: number;
  duplicates: number;
  invalidPhones: number;
  listId: string;
  syncedToVicidial?: number;
  vicidialFailed?: number;
  vicidialSyncError?: string | undefined;
};

export type MappedLeadRow = {
  firstName: string;
  surname: string;
  cellNumber: string;
  alternateCell?: string;
  email?: string;
  address?: string;
  suburb?: string;
  productPackage?: string;
  easypayNumber?: string;
};

export type ImportBatchInput = {
  campaignId: string;
  listId: string | null; // null = create new
  newListId?: string;
  newListName?: string;
  leads: MappedLeadRow[];
  skipDuplicates: boolean;
  normalizeNumbers: boolean;
};

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------

const now = () => new Date().toISOString();

function requireAdmin(user: { id: string; role: string } | null) {
  if (!user) throw new Error("Unauthorized");
  if (user.role !== "admin") throw new Error("Admin access required");
  return user;
}

function normalizeSaCell(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("27")) return digits;
  if (digits.startsWith("0")) return `27${digits.slice(1)}`;
  return digits;
}

function isValidSaCell(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return false;
  const normalized = digits.startsWith("27")
    ? digits
    : digits.startsWith("0")
      ? `27${digits.slice(1)}`
      : digits;
  // South African mobile numbers: 27 + 10 digits starting with 6,7,8
  return normalized.length === 12 && /^27[678]/.test(normalized);
}

/** Calls the FastAPI backend to push leads into the VICIdial dialer list. */
async function syncLeadsToVicidial(
  leads: Array<{ normalizedCell: string; firstName: string; surname: string }>,
): Promise<{ synced: Map<string, string>; failed: number; error: string | undefined }> {
  const synced = new Map<string, string>();
  if (leads.length === 0) return { synced, failed: 0, error: undefined };

  const base = (
    process.env["REMI_API_URL"] ||
    process.env["VICIDIAL_API_URL"] ||
    "http://127.0.0.1:8000"
  ).replace(/\/+$/, "");
  const token = process.env["REMI_API_TOKEN"] || process.env["VICIDIAL_API_TOKEN"];

  const CHUNK = 100;
  let failed = 0;
  let lastError: string | undefined;

  for (let i = 0; i < leads.length; i += CHUNK) {
    const chunk = leads.slice(i, i + CHUNK);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      const res = await fetch(`${base}/api/v1/admin/leads/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          leads: chunk.map((l) => ({
            phone_number: l.normalizedCell,
            first_name: l.firstName,
            last_name: l.surname,
          })),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        failed += chunk.length;
        lastError = `VICIdial sync HTTP ${res.status}`;
        continue;
      }
      const data = (await res.json()) as {
        results?: Array<{ phone_number: string; lead_id: string | null; success: boolean }>;
      };
      for (const r of data.results ?? []) {
        if (r.success && r.lead_id) synced.set(r.phone_number, r.lead_id);
        else failed++;
      }
    } catch (err) {
      failed += chunk.length;
      lastError = err instanceof Error ? err.message : "VICIdial sync failed";
    }
  }

  return { synced, failed, error: lastError };
}

type LeadListRow = typeof leadLists.$inferSelect;

async function loadLeadListDtos(db: any, listRows?: LeadListRow[]): Promise<LeadList[]> {
  const rows: LeadListRow[] =
    listRows ?? (await db.select().from(leadLists).orderBy(asc(leadLists.listCode)));
  if (rows.length === 0) return [];

  const listIds = rows.map((l) => l.id);
  const campIds = [...new Set(rows.map((l) => l.campaignId))];

  const campRows: Array<{ id: string; name: string }> = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(inArray(campaigns.id, campIds));
  const campNameMap = new Map(campRows.map((c) => [c.id, c.name]));

  const listIdParams = sql.join(
    listIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const stats: Array<{ list_id: string; total: number; dialed: number }> = ((await db.execute(sql`
    select l.list_id,
           count(*)::int as total,
           count(*) filter (where exists (
             select 1 from call_events ce
             where ce.vicidial_lead_id = l.vicidial_lead_id
           ))::int as dialed
    from lead_list_leads l
    where l.list_id in (${listIdParams})
    group by l.list_id
  `)) as any[]);
  const statMap = new Map(stats.map((s) => [s.list_id, s]));

  return rows.map((l) => ({
    id: l.id,
    listId: l.listCode,
    name: l.name,
    campaignId: l.campaignId,
    campaignName: campNameMap.get(l.campaignId) ?? "Unassigned",
    totalLeads: statMap.get(l.id)?.total ?? 0,
    dialedLeads: statMap.get(l.id)?.dialed ?? 0,
    active: l.active,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  }));
}

async function nextListCode(db: any): Promise<string> {
  const rows = (await db.execute(sql`
    select coalesce(max(substring(list_code from 3)::int), 500) + 1 as next_num
    from lead_lists
    where list_code ~ '^L-[0-9]+$'
  `)) as any[];
  return `L-${rows[0]?.next_num ?? 501}`;
}

// ----------------------------------------------------
// MOCK STORE (offline fallback only)
// ----------------------------------------------------

export interface MockLeadList extends LeadList {}
export interface MockLead extends ImportedLead {}

const leadListsMap: Map<string, MockLeadList> = new Map();
const leadsMap: Map<string, MockLead> = new Map();

(mockStore as any).leadLists = leadListsMap;
(mockStore as any).leads = leadsMap;

function getListsMap(): Map<string, MockLeadList> {
  return (mockStore as any).leadLists as Map<string, MockLeadList>;
}

function getLeadsMap(): Map<string, MockLead> {
  return (mockStore as any).leads as Map<string, MockLead>;
}

// ----------------------------------------------------
// SERVER FUNCTIONS
// ----------------------------------------------------

export const getLeadListsFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());

  if (isMockMode()) {
    const lists = Array.from(getListsMap().values()).sort((a, b) =>
      a.listId.localeCompare(b.listId),
    );
    return { lists };
  }

  const db = getDb();
  return { lists: await loadLeadListDtos(db) };
});

export const createLeadListFn = createServerFn({ method: "POST" })
  .validator(
    (data: { campaignId: string; listName: string; listId?: string }) => {
      if (!data.campaignId) throw new Error("Campaign is required");
      if (!data.listName?.trim()) throw new Error("List name is required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      const map = getListsMap();
      const existing = Array.from(map.values());
      const ts = now();
      const nums = existing.map((l) => parseInt(l.listId.replace(/\D/g, ""), 10)).filter((n) => !isNaN(n));
      const listId = data.listId?.trim() || `L-${nums.length ? Math.max(...nums) + 1 : 501}`;
      const campaignsMap = (mockStore as any).campaigns as Map<string, any> | undefined;
      const campaign = campaignsMap?.get(data.campaignId);
      const id = `ll-${crypto.randomUUID().slice(0, 8)}`;
      const newList: LeadList = {
        id,
        listId,
        name: data.listName.trim(),
        campaignId: data.campaignId,
        campaignName: campaign?.name ?? "Unassigned",
        totalLeads: 0,
        dialedLeads: 0,
        active: true,
        createdAt: ts,
        updatedAt: ts,
      };
      map.set(id, newList);
      return { success: true, list: newList };
    }

    const db = getDb();
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, data.campaignId)).limit(1);
    if (!camp) throw new Error("Campaign not found");

    const listCode = data.listId?.trim() || (await nextListCode(db));
    const [row] = await db
      .insert(leadLists)
      .values({
        listCode,
        name: data.listName.trim(),
        campaignId: data.campaignId,
        active: true,
      })
      .returning();
    if (!row) throw new Error("Failed to create lead list");

    const [list] = await loadLeadListDtos(db, [row]);
    if (!list) throw new Error("Failed to load created lead list");
    return { success: true, list };
  });

export const importLeadsBatchFn = createServerFn({ method: "POST" })
  .validator((data: ImportBatchInput) => {
    if (!data.campaignId) throw new Error("Campaign is required");
    if (!data.leads?.length) throw new Error("No leads to import");
    if (!data.listId && !data.newListName?.trim())
      throw new Error("Either an existing list or a new list name is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    // ---------------- MOCK PATH ----------------
    if (isMockMode()) {
      const listsMap = getListsMap();
      const leadsMap = getLeadsMap();

      let list: LeadList | undefined;
      if (data.listId) {
        list = listsMap.get(data.listId);
        if (!list) throw new Error("Target list not found");
      } else {
        const existing = Array.from(listsMap.values());
        const ts = now();
        const nums = existing.map((l) => parseInt(l.listId.replace(/\D/g, ""), 10)).filter((n) => !isNaN(n));
        const listId = data.newListId?.trim() || `L-${nums.length ? Math.max(...nums) + 1 : 501}`;
        const campaignsMap = (mockStore as any).campaigns as Map<string, any> | undefined;
        const campaign = campaignsMap?.get(data.campaignId);
        const id = `ll-${crypto.randomUUID().slice(0, 8)}`;
        list = {
          id,
          listId,
          name: data.newListName!.trim(),
          campaignId: data.campaignId,
          campaignName: campaign?.name ?? "Unassigned",
          totalLeads: 0,
          dialedLeads: 0,
          active: true,
          createdAt: ts,
          updatedAt: ts,
        };
        listsMap.set(id, list);
      }

      const campaignListIds = new Set(
        Array.from(listsMap.values())
          .filter((l) => l.campaignId === data.campaignId)
          .map((l) => l.id),
      );
      const existingPhones = new Set<string>();
      for (const lead of leadsMap.values()) {
        if (campaignListIds.has(lead.listId)) existingPhones.add(lead.normalizedCell);
      }

      let added = 0;
      let duplicates = 0;
      let invalidPhones = 0;
      const ts = now();

      for (const row of data.leads) {
        const rawPhone = (row.cellNumber || "").trim();
        if (!rawPhone) {
          invalidPhones++;
          continue;
        }
        const normalized = data.normalizeNumbers
          ? normalizeSaCell(rawPhone)
          : rawPhone.replace(/\D/g, "");
        if (!isValidSaCell(normalized)) {
          invalidPhones++;
          continue;
        }
        if (data.skipDuplicates && existingPhones.has(normalized)) {
          duplicates++;
          continue;
        }
        const id = `lead-${crypto.randomUUID().slice(0, 12)}`;
        leadsMap.set(id, {
          id,
          listId: list.id,
          firstName: row.firstName?.trim() || "",
          surname: row.surname?.trim() || "",
          cellNumber: rawPhone,
          normalizedCell: normalized,
          alternateCell: row.alternateCell?.trim() || null,
          email: row.email?.trim() || null,
          address: row.address?.trim() || null,
          suburb: row.suburb?.trim() || null,
          productPackage: row.productPackage?.trim() || null,
          easypayNumber: row.easypayNumber?.trim() || null,
          dialed: false,
          createdAt: ts,
        });
        existingPhones.add(normalized);
        added++;
      }

      list.totalLeads += added;
      list.updatedAt = ts;
      listsMap.set(list.id, list);

      return {
        success: true,
        result: {
          totalRows: data.leads.length,
          added,
          duplicates,
          invalidPhones,
          listId: list.id,
        } satisfies ImportResult,
      };
    }

    // ---------------- REAL POSTGRES PATH ----------------
    const db = getDb();

    // Resolve or create the target list
    let listRow: LeadListRow | undefined;
    if (data.listId) {
      [listRow] = await db.select().from(leadLists).where(eq(leadLists.id, data.listId)).limit(1);
      if (!listRow) throw new Error("Target list not found");
      if (listRow.campaignId !== data.campaignId)
        throw new Error("Target list does not belong to the selected campaign");
    } else {
      const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, data.campaignId)).limit(1);
      if (!camp) throw new Error("Campaign not found");
      const listCode = data.newListId?.trim() || (await nextListCode(db));
      [listRow] = await db
        .insert(leadLists)
        .values({
          listCode,
          name: data.newListName!.trim(),
          campaignId: data.campaignId,
          active: true,
        })
        .returning();
    }
    if (!listRow) throw new Error("Failed to resolve target list");
    const listId = listRow.id;

    // Existing normalized numbers: all leads in this campaign's lists + CRM customers
    const campaignListRows: Array<{ id: string }> = await db
      .select({ id: leadLists.id })
      .from(leadLists)
      .where(eq(leadLists.campaignId, data.campaignId));
    const campaignListIds = campaignListRows.map((l) => l.id);

    const existingPhones = new Set<string>();
    if (campaignListIds.length) {
      const campaignListParams = sql.join(
        campaignListIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const existing = (await db.execute(sql`
        select distinct normalized_cell
        from lead_list_leads
        where list_id in (${campaignListParams})
      `)) as any[];
      for (const r of existing) existingPhones.add(r.normalized_cell);
    }

    // Validate + dedupe rows first so we can check customers table in bulk
    const candidates: Array<MappedLeadRow & { normalizedCell: string; rawPhone: string }> = [];
    let invalidPhones = 0;
    for (const row of data.leads) {
      const rawPhone = (row.cellNumber || "").trim();
      if (!rawPhone) {
        invalidPhones++;
        continue;
      }
      const normalized = data.normalizeNumbers
        ? normalizeSaCell(rawPhone)
        : rawPhone.replace(/\D/g, "");
      if (!isValidSaCell(normalized)) {
        invalidPhones++;
        continue;
      }
      candidates.push({ ...row, normalizedCell: normalized, rawPhone });
    }

    // Also skip numbers already in the CRM customers table
    const candidateCells = [...new Set(candidates.map((c) => c.normalizedCell))];
    if (candidateCells.length && data.skipDuplicates) {
      const cellParams = sql.join(
        candidateCells.map((c) => sql`${c}::text`),
        sql`, `,
      );
      const custRows = (await db.execute(sql`
        select normalized_cell from customers
        where normalized_cell in (${cellParams})
      `)) as any[];
      for (const r of custRows) existingPhones.add(r.normalized_cell);
    }

    let duplicates = 0;
    const toInsert: Array<typeof leadListLeads.$inferInsert> = [];
    const insertedPhones: Array<{ normalizedCell: string; firstName: string; surname: string }> = [];

    for (const c of candidates) {
      if (data.skipDuplicates && existingPhones.has(c.normalizedCell)) {
        duplicates++;
        continue;
      }
      toInsert.push({
        listId,
        firstName: c.firstName?.trim() || "",
        surname: c.surname?.trim() || "",
        cellNumber: c.rawPhone,
        normalizedCell: c.normalizedCell,
        alternateCell: c.alternateCell?.trim() || null,
        email: c.email?.trim() || null,
        address: c.address?.trim() || null,
        suburb: c.suburb?.trim() || null,
        productPackage: c.productPackage?.trim() || null,
        easypayNumber: c.easypayNumber?.trim() || null,
      });
      existingPhones.add(c.normalizedCell);
      insertedPhones.push({
        normalizedCell: c.normalizedCell,
        firstName: c.firstName?.trim() || "",
        surname: c.surname?.trim() || "",
      });
    }

    // Batch insert
    const INSERT_CHUNK = 500;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      await db.insert(leadListLeads).values(toInsert.slice(i, i + INSERT_CHUNK));
    }
    await db
      .update(leadLists)
      .set({ updatedAt: new Date() })
      .where(eq(leadLists.id, listId));

    // Push new leads into VICIdial and store returned lead ids
    let syncedToVicidial = 0;
    let vicidialFailed = 0;
    let vicidialSyncError: string | undefined;
    if (insertedPhones.length) {
      const sync = await syncLeadsToVicidial(insertedPhones);
      syncedToVicidial = sync.synced.size;
      vicidialFailed = sync.failed;
      vicidialSyncError = sync.error;

      const pairs = [...sync.synced.entries()];
      for (let i = 0; i < pairs.length; i += 200) {
        const chunk = pairs.slice(i, i + 200);
        const values = sql.join(
          chunk.map(([nc, vid]) => sql`(${nc}, ${vid})`),
          sql`, `,
        );
        await db.execute(sql`
          update lead_list_leads as l
          set vicidial_lead_id = v.vid::text
          from (values ${values}) as v(nc, vid)
          where l.list_id = ${listId}::uuid
            and l.normalized_cell = v.nc::text
        `);
      }
    }

    const result: ImportResult = {
      totalRows: data.leads.length,
      added: toInsert.length,
      duplicates,
      invalidPhones,
      listId,
      syncedToVicidial,
      vicidialFailed,
      vicidialSyncError,
    };
    return { success: true, result };
  });

export const toggleListActiveFn = createServerFn({ method: "POST" })
  .validator((data: { id: string; active: boolean }) => {
    if (!data.id) throw new Error("List ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      const map = getListsMap();
      const list = map.get(data.id);
      if (!list) throw new Error("Lead list not found");
      list.active = data.active;
      list.updatedAt = now();
      map.set(data.id, list);
      return { success: true, active: list.active };
    }

    const db = getDb();
    const [row] = await db
      .update(leadLists)
      .set({ active: data.active, updatedAt: new Date() })
      .where(eq(leadLists.id, data.id))
      .returning({ active: leadLists.active });
    if (!row) throw new Error("Lead list not found");
    return { success: true, active: row.active };
  });

export const flushLeadListFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("List ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      const map = getListsMap();
      const leadsMap = getLeadsMap();
      const list = map.get(data.id);
      if (!list) throw new Error("Lead list not found");
      let removed = 0;
      for (const [leadId, lead] of leadsMap) {
        if (lead.listId === data.id && !lead.dialed) {
          leadsMap.delete(leadId);
          removed++;
        }
      }
      list.totalLeads = list.dialedLeads;
      list.updatedAt = now();
      map.set(data.id, list);
      return { success: true, removed };
    }

    const db = getDb();
    const [list] = await db.select().from(leadLists).where(eq(leadLists.id, data.id)).limit(1);
    if (!list) throw new Error("Lead list not found");

    // Remove leads that have no recorded call event (undialed)
    const deleted = (await db.execute(sql`
      delete from lead_list_leads l
      where l.list_id = ${data.id}::uuid
        and not exists (
          select 1 from call_events ce
          where ce.vicidial_lead_id = l.vicidial_lead_id
        )
      returning l.id
    `)) as any[];

    await db
      .update(leadLists)
      .set({ updatedAt: new Date() })
      .where(eq(leadLists.id, data.id));

    return { success: true, removed: deleted.length };
  });

export const deleteLeadListFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("List ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      const map = getListsMap();
      const leadsMap = getLeadsMap();
      const list = map.get(data.id);
      if (!list) throw new Error("Lead list not found");
      for (const [leadId, lead] of leadsMap) {
        if (lead.listId === data.id) leadsMap.delete(leadId);
      }
      map.delete(data.id);
      return { success: true };
    }

    const db = getDb();
    const [row] = await db.delete(leadLists).where(eq(leadLists.id, data.id)).returning({ id: leadLists.id });
    if (!row) throw new Error("Lead list not found");
    return { success: true };
  });

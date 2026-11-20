import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "./auth";
import { isMockMode, mockStore } from "./db";

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
// MOCK STORE
// ----------------------------------------------------

export interface MockLeadList extends LeadList {}
export interface MockLead extends ImportedLead {}

const now = () => new Date().toISOString();

const seedLeadLists: LeadList[] = [
  {
    id: "ll-001",
    listId: "L-501",
    name: "Soweto Door-to-Door",
    campaignId: "camp-1001",
    campaignName: "Outbound Sales",
    totalLeads: 842,
    dialedLeads: 520,
    active: true,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "ll-002",
    listId: "L-502",
    name: "Referral Warm Leads",
    campaignId: "camp-1001",
    campaignName: "Outbound Sales",
    totalLeads: 156,
    dialedLeads: 89,
    active: true,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "ll-003",
    listId: "L-503",
    name: "Customer Referrals Q4",
    campaignId: "camp-1002",
    campaignName: "Referral Follow-Up",
    totalLeads: 312,
    dialedLeads: 201,
    active: true,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "ll-004",
    listId: "L-504",
    name: "Lapsed Q2-Q3",
    campaignId: "camp-1003",
    campaignName: "Reactivation Win-Back",
    totalLeads: 204,
    dialedLeads: 0,
    active: false,
    createdAt: now(),
    updatedAt: now(),
  },
];

const leadListsMap: Map<string, MockLeadList> = new Map(
  seedLeadLists.map((l) => [l.id, { ...l }]),
);

const leadsMap: Map<string, MockLead> = new Map();

(mockStore as any).leadLists = leadListsMap;
(mockStore as any).leads = leadsMap;

function getListsMap(): Map<string, MockLeadList> {
  return (mockStore as any).leadLists as Map<string, MockLeadList>;
}

function getLeadsMap(): Map<string, MockLead> {
  return (mockStore as any).leads as Map<string, MockLead>;
}

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

function nextListIdNumber(existing: LeadList[]): number {
  const nums = existing
    .map((l) => parseInt(l.listId.replace(/\D/g, ""), 10))
    .filter((n) => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 501;
}

// ----------------------------------------------------
// SERVER FUNCTIONS
// ----------------------------------------------------

export const getLeadListsFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());

  const lists = Array.from(getListsMap().values()).sort((a, b) =>
    a.listId.localeCompare(b.listId),
  );
  return { lists };
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

    const map = getListsMap();
    const existing = Array.from(map.values());
    const ts = now();

    const listId = data.listId?.trim() || `L-${nextListIdNumber(existing)}`;

    // Look up campaign name from the campaigns mock store
    const campaignsMap = (mockStore as any).campaigns as Map<string, any> | undefined;
    const campaign = campaignsMap?.get(data.campaignId);
    const campaignName = campaign?.name ?? "Unassigned";

    const id = `ll-${crypto.randomUUID().slice(0, 8)}`;
    const newList: LeadList = {
      id,
      listId,
      name: data.listName.trim(),
      campaignId: data.campaignId,
      campaignName,
      totalLeads: 0,
      dialedLeads: 0,
      active: true,
      createdAt: ts,
      updatedAt: ts,
    };
    map.set(id, newList);
    return { success: true, list: newList };
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

    const listsMap = getListsMap();
    const leadsMap = getLeadsMap();

    // Resolve or create the target list
    let list: LeadList | undefined;
    if (data.listId) {
      list = listsMap.get(data.listId);
      if (!list) throw new Error("Target list not found");
    } else {
      const existing = Array.from(listsMap.values());
      const ts = now();
      const listId = data.newListId?.trim() || `L-${nextListIdNumber(existing)}`;
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

    // Gather existing normalized numbers in this campaign's lists for duplicate check
    const campaignListIds = new Set(
      Array.from(listsMap.values())
        .filter((l) => l.campaignId === data.campaignId)
        .map((l) => l.id),
    );
    const existingPhones = new Set<string>();
    for (const lead of leadsMap.values()) {
      if (campaignListIds.has(lead.listId)) {
        existingPhones.add(lead.normalizedCell);
      }
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
      const altCell = row.alternateCell?.trim() || null;
      const lead: MockLead = {
        id,
        listId: list.id,
        firstName: row.firstName?.trim() || "",
        surname: row.surname?.trim() || "",
        cellNumber: rawPhone,
        normalizedCell: normalized,
        alternateCell: altCell,
        email: row.email?.trim() || null,
        address: row.address?.trim() || null,
        suburb: row.suburb?.trim() || null,
        productPackage: row.productPackage?.trim() || null,
        easypayNumber: row.easypayNumber?.trim() || null,
        dialed: false,
        createdAt: ts,
      };
      leadsMap.set(id, lead);
      existingPhones.add(normalized);
      added++;
    }

    // Update list counts
    list.totalLeads += added;
    list.updatedAt = ts;
    listsMap.set(list.id, list);

    const result: ImportResult = {
      totalRows: data.leads.length,
      added,
      duplicates,
      invalidPhones,
      listId: list.id,
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

    const map = getListsMap();
    const list = map.get(data.id);
    if (!list) throw new Error("Lead list not found");

    list.active = data.active;
    list.updatedAt = now();
    map.set(data.id, list);
    return { success: true, active: list.active };
  });

export const flushLeadListFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("List ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    const map = getListsMap();
    const leadsMap = getLeadsMap();
    const list = map.get(data.id);
    if (!list) throw new Error("Lead list not found");

    // Remove undialed leads
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
  });

export const deleteLeadListFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("List ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    const map = getListsMap();
    const leadsMap = getLeadsMap();
    const list = map.get(data.id);
    if (!list) throw new Error("Lead list not found");

    // Remove all leads in this list
    for (const [leadId, lead] of leadsMap) {
      if (lead.listId === data.id) {
        leadsMap.delete(leadId);
      }
    }

    map.delete(data.id);
    return { success: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "./auth";
import { isMockMode, mockStore } from "./db";

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
// MOCK STORE
// ----------------------------------------------------

export interface MockCampaign extends Campaign {}

const now = () => new Date().toISOString();

const seedCampaigns: Campaign[] = [
  {
    id: "camp-1001",
    campaignId: "1001",
    name: "Outbound Sales",
    campaignCid: "0842840069",
    description: "Primary fibre outbound sales campaign targeting Soweto and greater Johannesburg.",
    active: true,
    dialMethod: "RATIO",
    autoDialLevel: 1.5,
    ringingTimeout: 25,
    hopperLevel: 200,
    hopperCurrent: 142,
    forceRecording: true,
    amdEnabled: true,
    autoAlternateCell: true,
    blendedInbound: false,
    leadLists: [
      { id: "list-a", name: "Soweto Door-to-Door", leadCount: 842, active: true },
      { id: "list-b", name: "Referral Warm Leads", leadCount: 156, active: true },
    ],
    retryRules: [
      { status: "NO_ANSWER", retryAfterMinutes: 30, maxAttempts: 3 },
      { status: "BUSY", retryAfterMinutes: 15, maxAttempts: 5 },
      { status: "AMD", retryAfterMinutes: 60, maxAttempts: 2 },
    ],
    callsToday: 347,
    conversionsToday: 23,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "camp-1002",
    campaignId: "1002",
    name: "Referral Follow-Up",
    campaignCid: "0842840070",
    description: "Follow-up calls to referred leads from existing FibreGems customers.",
    active: true,
    dialMethod: "ADAPT_AVERAGE",
    autoDialLevel: 1.2,
    ringingTimeout: 30,
    hopperLevel: 100,
    hopperCurrent: 78,
    forceRecording: true,
    amdEnabled: false,
    autoAlternateCell: true,
    blendedInbound: true,
    leadLists: [
      { id: "list-c", name: "Customer Referrals Q4", leadCount: 312, active: true },
    ],
    retryRules: [
      { status: "NO_ANSWER", retryAfterMinutes: 45, maxAttempts: 4 },
      { status: "BUSY", retryAfterMinutes: 20, maxAttempts: 3 },
    ],
    callsToday: 128,
    conversionsToday: 19,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "camp-1003",
    campaignId: "1003",
    name: "Reactivation Win-Back",
    campaignCid: "0842840071",
    description: "Win-back campaign targeting lapsed customers from the last 6 months.",
    active: false,
    dialMethod: "MANUAL",
    autoDialLevel: 1.0,
    ringingTimeout: 35,
    hopperLevel: 50,
    hopperCurrent: 0,
    forceRecording: false,
    amdEnabled: true,
    autoAlternateCell: false,
    blendedInbound: false,
    leadLists: [
      { id: "list-d", name: "Lapsed Q2-Q3", leadCount: 204, active: false },
    ],
    retryRules: [
      { status: "NO_ANSWER", retryAfterMinutes: 60, maxAttempts: 2 },
    ],
    callsToday: 0,
    conversionsToday: 0,
    createdAt: now(),
    updatedAt: now(),
  },
];

// Attach campaigns to the shared mock store so state persists across reloads of the module
const campaignsMap: Map<string, MockCampaign> = new Map(
  seedCampaigns.map((c) => [c.id, { ...c }]),
);

// Augment mockStore at runtime so it is visible alongside other mock collections
(mockStore as any).campaigns = campaignsMap;

function getCampaignsMap(): Map<string, MockCampaign> {
  return (mockStore as any).campaigns as Map<string, MockCampaign>;
}

function requireAdmin(user: { id: string; role: string } | null) {
  if (!user) throw new Error("Unauthorized");
  if (user.role !== "admin") throw new Error("Admin access required");
  return user;
}

function nextCampaignIdNumber(existing: Campaign[]): number {
  const nums = existing.map((c) => parseInt(c.campaignId, 10)).filter((n) => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1001;
}

// ----------------------------------------------------
// SERVER FUNCTIONS
// ----------------------------------------------------

export const getCampaignsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser();
  requireAdmin(user);

  if (isMockMode()) {
    const list = Array.from(getCampaignsMap().values()).sort((a, b) =>
      a.campaignId.localeCompare(b.campaignId),
    );
    return { campaigns: list };
  }

  // When a real campaigns table is introduced, query it here.
  // For now the backend falls back to the seeded mock data shape.
  const list = Array.from(getCampaignsMap().values()).sort((a, b) =>
    a.campaignId.localeCompare(b.campaignId),
  );
  return { campaigns: list };
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
      const map = getCampaignsMap();
      const existing = Array.from(map.values());
      const id = `camp-${nextCampaignIdNumber(existing)}`;
      const campaignId = String(nextCampaignIdNumber(existing));
      const ts = now();
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
      };
      map.set(id, campaign);
      return { success: true, campaign };
    }

    // Placeholder for real DB persistence
    const map = getCampaignsMap();
    const existing = Array.from(map.values());
    const id = `camp-${nextCampaignIdNumber(existing)}`;
    const campaignId = String(nextCampaignIdNumber(existing));
    const ts = now();
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
    };
    map.set(id, campaign);
    return { success: true, campaign };
  });

export const updateCampaignFn = createServerFn({ method: "POST" })
  .validator((data: { id: string } & CampaignUpdate) => {
    if (!data.id) throw new Error("Campaign ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    const map = getCampaignsMap();
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
      updatedAt: now(),
    };
    map.set(data.id, updated);
    return { success: true, campaign: updated };
  });

export const reloadHopperFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("Campaign ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    const map = getCampaignsMap();
    const existing = map.get(data.id);
    if (!existing) throw new Error("Campaign not found");

    // Simulate hopper reload: fill up to hopperLevel from available lead lists
    const availableLeads = existing.leadLists
      .filter((l) => l.active)
      .reduce((sum, l) => sum + l.leadCount, 0);
    const target = Math.min(existing.hopperLevel, availableLeads);
    existing.hopperCurrent = target;
    existing.updatedAt = now();
    map.set(data.id, existing);

    return { success: true, hopperCurrent: target };
  });

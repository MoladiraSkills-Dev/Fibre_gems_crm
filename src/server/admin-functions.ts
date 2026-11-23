import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "./auth";
import { getDb, isMockMode, mockStore, type MockProfile } from "./db";
import { profiles, userRoles } from "./db/schema";
import { eq, asc } from "drizzle-orm";
import { hashPassword } from "./auth";

export type AdminAgentRow = {
  id: string;
  full_name: string;
  email: string;
  agent_code: string | null;
  phone_login: string | null;
  phone_pass: string | null;
  status: string;
  role: "admin" | "team_leader" | "agent";
  team_id: string | null;
  created_at: string;
};

function requireAdmin(user: { id: string; role: string } | null): { id: string; role: string } {
  if (!user) throw new Error("Unauthorized");
  if (user.role !== "admin") throw new Error("Admin access required");
  return user;
}

function rowFromMock(p: MockProfile): AdminAgentRow {
  const role = (mockStore.userRoles.get(p.id) ?? "agent") as AdminAgentRow["role"];
  return {
    id: p.id,
    full_name: p.fullName,
    email: p.email,
    agent_code: p.agentCode,
    phone_login: (p as any).phoneLogin ?? null,
    phone_pass: (p as any).phonePass ?? null,
    status: p.status,
    role,
    team_id: p.teamId,
    created_at: p.createdAt.toISOString(),
  };
}

export const listAgentsFn = createServerFn({ method: "GET" })
  .validator((params?: { search?: string; role?: string; status?: string }) => params ?? {})
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      let rows = Array.from(mockStore.profiles.values()).map(rowFromMock);
      if (data.search) {
        const q = data.search.toLowerCase();
        rows = rows.filter((r) =>
          `${r.full_name} ${r.email} ${r.agent_code ?? ""}`.toLowerCase().includes(q),
        );
      }
      if (data.role) rows = rows.filter((r) => r.role === data.role);
      if (data.status) rows = rows.filter((r) => r.status === data.status);
      rows.sort((a, b) => a.full_name.localeCompare(b.full_name));
      return { agents: rows, total: rows.length };
    }

    const db = getDb();
    const rows = await db
      .select({
        id: profiles.id,
        full_name: profiles.fullName,
        email: profiles.email,
        agent_code: profiles.agentCode,
        phone_login: profiles.phoneLogin,
        phone_pass: profiles.phonePass,
        status: profiles.status,
        team_id: profiles.teamId,
        created_at: profiles.createdAt,
        role: userRoles.role,
      })
      .from(profiles)
      .innerJoin(userRoles, eq(profiles.id, userRoles.userId))
      .orderBy(asc(profiles.fullName));

    let filtered = rows;
    if (data.search) {
      const q = data.search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.full_name.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          (r.agent_code ?? "").toLowerCase().includes(q),
      );
    }
    if (data.role) filtered = filtered.filter((r) => r.role === data.role);
    if (data.status) filtered = filtered.filter((r) => r.status === data.status);

    const agents: AdminAgentRow[] = filtered.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      email: r.email,
      agent_code: r.agent_code,
      phone_login: r.phone_login,
      phone_pass: r.phone_pass,
      status: r.status,
      role: r.role,
      team_id: r.team_id,
      created_at: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    }));

    return { agents, total: agents.length };
  });

export type CreateAgentInput = {
  full_name: string;
  email: string;
  password: string;
  role: "agent" | "team_leader" | "admin";
  agent_code?: string;
  phone_login?: string;
  phone_pass?: string;
  status?: string;
};

export function getDefaultAgentCode(role: "agent" | "team_leader" | "admin", ext?: string | null): string {
  const prefix = role === "team_leader" ? "TML" : role === "admin" ? "ADM" : "AGT";
  if (ext) {
    const clean = ext.replace(/\D/g, "");
    if (clean) return `${prefix}${clean}`;
  }
  return `${prefix}${Math.floor(100 + Math.random() * 900)}`;
}

export const createAgentFn = createServerFn({ method: "POST" })
  .validator(
    (data: CreateAgentInput) => {
      if (!data.full_name?.trim()) throw new Error("Full name is required");
      if (!data.email?.trim()) throw new Error("Email is required");
      if (!data.password?.trim() || data.password.length < 6)
        throw new Error("Password must be at least 6 characters");
      return data;
    },
  )
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    const email = data.email.trim().toLowerCase();
    const fullName = data.full_name.trim();
    const phoneLogin = data.phone_login?.trim() || null;
    const phonePass = data.phone_pass?.trim() || null;
    const agentCode = data.agent_code?.trim() || getDefaultAgentCode(data.role, phoneLogin);
    const status = data.status || "active";
    const hashedPassword = hashPassword(data.password);

    if (isMockMode()) {
      const existing = Array.from(mockStore.profiles.values()).find(
        (p) => p.email.toLowerCase() === email,
      );
      if (existing) throw new Error("An agent with this email already exists");

      const newId = crypto.randomUUID();
      const newProfile: MockProfile = {
        id: newId,
        agentCode,
        fullName,
        email,
        passwordHash: hashedPassword,
        status,
        teamId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(phoneLogin ? { phoneLogin } : {}),
        ...(phonePass ? { phonePass } : {}),
      } as MockProfile;
      mockStore.profiles.set(newId, newProfile);
      mockStore.userRoles.set(newId, data.role);

      // Trigger PBX / VICIdial background provisioning if backend is available
      void backendFetch("/api/v1/admin/agents/provision", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName,
          email,
          password: data.password,
          role: data.role,
          agent_code: agentCode,
          phone_login: phoneLogin,
          phone_pass: phonePass,
        }),
      }).catch(() => null);

      return {
        success: true,
        agent: rowFromMock(newProfile),
      };
    }

    // Production: delegate to the FastAPI backend which provisions the agent in
    // VICIdial (add_phone + add_user via non_agent_api POST) AND upserts the CRM
    // profile + role in Postgres. Fails loudly if VICIdial rejects the writes.
    type ProvisionResponse = {
      id: string;
      full_name: string;
      email: string | null;
      agent_code: string | null;
      phone_login: string | null;
      phone_pass: string | null;
      role: string;
      is_active: boolean;
      created_at: string | null;
    };
    const provisioned = await backendFetch<ProvisionResponse>(
      "/api/v1/admin/agents/provision",
      {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName,
          email,
          password: data.password,
          role: data.role,
          // Only forward an explicitly chosen agent_code — otherwise the backend
          // derives it from the real assigned SIP extension.
          agent_code: data.agent_code?.trim() || null,
          phone_login: phoneLogin,
          phone_pass: phonePass,
        }),
      },
    );
    if (!provisioned) {
      throw new Error(
        "Agent provisioning failed — the telephony backend rejected the request or is unreachable. No agent was created.",
      );
    }

    return {
      success: true,
      agent: {
        id: provisioned.id,
        full_name: provisioned.full_name,
        email: provisioned.email ?? email,
        agent_code: provisioned.agent_code,
        phone_login: provisioned.phone_login,
        phone_pass: provisioned.phone_pass,
        status: provisioned.is_active ? "active" : "suspended",
        role: (provisioned.role as AdminAgentRow["role"]) ?? data.role,
        team_id: null,
        created_at: provisioned.created_at ?? new Date().toISOString(),
      } as AdminAgentRow,
    };
  });

export type UpdateAgentInput = {
  id: string;
  full_name?: string;
  email?: string;
  agent_code?: string | null;
  phone_login?: string | null;
  phone_pass?: string | null;
  status?: string;
  role?: "agent" | "team_leader" | "admin";
  password?: string;
};

export const updateAgentFn = createServerFn({ method: "POST" })
  .validator((data: UpdateAgentInput) => {
    if (!data.id) throw new Error("Agent ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      const p = mockStore.profiles.get(data.id);
      if (!p) throw new Error("Agent not found");

      if (data.full_name) p.fullName = data.full_name.trim();
      if (data.email) p.email = data.email.trim().toLowerCase();
      if (data.agent_code !== undefined) p.agentCode = data.agent_code;
      if (data.phone_login !== undefined) (p as any).phoneLogin = data.phone_login;
      if (data.phone_pass !== undefined) (p as any).phonePass = data.phone_pass;
      if (data.status) p.status = data.status;
      if (data.password) p.passwordHash = hashPassword(data.password);
      p.updatedAt = new Date();
      if (data.role) mockStore.userRoles.set(data.id, data.role);

      return { success: true, agent: rowFromMock(p) };
    }

    const db = getDb();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.full_name) updates.fullName = data.full_name.trim();
    if (data.email) updates.email = data.email.trim().toLowerCase();
    if (data.agent_code !== undefined) updates.agentCode = data.agent_code;
    if (data.phone_login !== undefined) updates.phoneLogin = data.phone_login;
    if (data.phone_pass !== undefined) updates.phonePass = data.phone_pass;
    if (data.status) updates.status = data.status;
    if (data.password) updates.passwordHash = hashPassword(data.password);

    const [updated] = await db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, data.id))
      .returning();

    if (!updated) throw new Error("Agent not found");

    if (data.role) {
      await db
        .update(userRoles)
        .set({ role: data.role })
        .where(eq(userRoles.userId, data.id));
    }

    return {
      success: true,
      agent: {
        id: updated.id,
        full_name: updated.fullName,
        email: updated.email,
        agent_code: updated.agentCode,
        phone_login: updated.phoneLogin,
        phone_pass: updated.phonePass,
        status: updated.status,
        role: data.role ?? "agent",
        team_id: updated.teamId,
        created_at: updated.createdAt.toISOString(),
      } as AdminAgentRow,
    };
  });

export type ToggleAgentInput = {
  id: string;
  active: boolean;
};

export const toggleAgentStatusFn = createServerFn({ method: "POST" })
  .validator((data: ToggleAgentInput) => data)
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const status = data.active ? "active" : "suspended";

    if (isMockMode()) {
      const p = mockStore.profiles.get(data.id);
      if (!p) throw new Error("Agent not found");
      p.status = status;
      p.updatedAt = new Date();
      return { success: true, status };
    }

    const db = getDb();
    await db
      .update(profiles)
      .set({ status, updatedAt: new Date() })
      .where(eq(profiles.id, data.id));

    // Best-effort sync of the active flag into VICIdial (update_user).
    // The CRM status above remains authoritative for the UI even if the
    // dialer is temporarily unreachable.
    void backendFetch(`/api/v1/admin/agents/${encodeURIComponent(data.id)}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ active: data.active }),
    }).catch(() => null);

    return { success: true, status };
  });

export const deleteAgentFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("Agent ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const me = requireAdmin(await getCurrentUser());
    if (data.id === me.id) throw new Error("You cannot delete your own account");

    if (isMockMode()) {
      if (!mockStore.profiles.has(data.id)) throw new Error("Agent not found");
      mockStore.profiles.delete(data.id);
      mockStore.userRoles.delete(data.id);
      return { success: true };
    }

    const db = getDb();
    try {
      await db.delete(profiles).where(eq(profiles.id, data.id));
    } catch (err) {
      if ((err as { code?: string })?.code === "23503") {
        throw new Error(
          "Cannot delete this agent — they still own customers, calls or activity records. Reassign their data or suspend the agent instead to preserve history.",
        );
      }
      throw err;
    }

    // Best-effort: deactivate the VICIdial agent user so they can't log into the dialer.
    void backendFetch(`/api/v1/admin/agents/${encodeURIComponent(data.id)}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    }).catch(() => null);

    return { success: true };
  });

export async function backendFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  try {
    const backendBase = (
      process.env["REMI_API_URL"] ||
      process.env["VICIDIAL_API_URL"] ||
      "http://127.0.0.1:8000"
    ).replace(/\/+$/, "");
    const token = process.env["REMI_API_TOKEN"] || process.env["VICIDIAL_API_TOKEN"];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${backendBase}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type ExecutiveDashboardData = {
  floor: {
    loggedIn: number;
    inCall: number;
    ready: number;
    paused: number;
  };
  kpis: {
    totalDialsToday: number;
    answersToday: number;
    contactRatePct: number;
    salesToday: number;
    conversionRatePct: number;
    ahtSeconds: number;
    totalTalkSeconds: number;
    dropRatePct: number;
  };
  hourlyFlow: Array<{
    hour: string;
    dials: number;
    connected: number;
  }>;
  dispositionBreakdown: Array<{
    name: string;
    count: number;
    fill: string;
  }>;
  timeAllocation: {
    talkPct: number;
    waitPct: number;
    pausePct: number;
  };
  recentCalls: Array<{
    id: string;
    agentName: string;
    agentCode: string;
    customerName: string;
    customerPhone: string;
    disposition: string;
    durationSeconds: number;
    startedAt: string;
    recordingUrl?: string | null;
  }>;
  liveAgents: Array<{
    agent_id: string;
    agent_code: string;
    full_name: string;
    extension: string;
    status: string;
    seconds_in_state: number;
    pause_code?: string | null;
  }>;
  salesLeads: Array<{
    id: string;
    customerName: string;
    phone: string;
    package: string;
    agentName: string;
    durationSeconds: number;
    time: string;
  }>;
};

export const getExecutiveDashboardStatsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExecutiveDashboardData> => {
    requireAdmin(await getCurrentUser());

    // 1. Fetch live telemetry from FastAPI backend
    const adminStats = await backendFetch<{
      floor: { loggedIn: number; inCall: number; ready: number; paused: number };
      kpis: {
        totalDialsToday: number;
        answersToday: number;
        contactRatePct: number;
        salesToday: number;
        conversionRatePct: number;
        ahtSeconds: number;
        totalTalkSeconds: number;
        dropRatePct: number;
      };
      hourly_flow: Array<{ hour: string; dials: number; connected: number }>;
      disposition_breakdown: Array<{ name: string; count: number; fill: string }>;
      recent_calls: Array<any>;
      live_agents: Array<any>;
      sales_leads: Array<any>;
    }>("/api/v1/admin/stats");

    if (adminStats && adminStats.kpis) {
      const talkSec = adminStats.kpis.totalTalkSeconds || 0;
      const waitSec = Math.max(0, adminStats.kpis.answersToday * 30);
      const totalFloorSec = talkSec + waitSec + 1;

      return {
        floor: adminStats.floor ?? { loggedIn: 0, inCall: 0, ready: 0, paused: 0 },
        kpis: adminStats.kpis,
        hourlyFlow: adminStats.hourly_flow ?? [],
        dispositionBreakdown: adminStats.disposition_breakdown ?? [],
        timeAllocation: {
          talkPct: totalFloorSec > 0 ? Math.min(100, Math.round((talkSec / totalFloorSec) * 100)) : 0,
          waitPct: totalFloorSec > 0 ? Math.min(100, Math.round((waitSec / totalFloorSec) * 100)) : 0,
          pausePct: 0,
        },
        recentCalls: adminStats.recent_calls ?? [],
        liveAgents: adminStats.live_agents ?? [],
        salesLeads: adminStats.sales_leads ?? [],
      };
    }

    // 2. Direct PostgreSQL fallback if backend API is not yet called
    if (!isMockMode()) {
      try {
        const db = getDb();
        // Return clean zero-based real structure
        return {
          floor: { loggedIn: 0, inCall: 0, ready: 0, paused: 0 },
          kpis: {
            totalDialsToday: 0,
            answersToday: 0,
            contactRatePct: 0,
            salesToday: 0,
            conversionRatePct: 0,
            ahtSeconds: 0,
            totalTalkSeconds: 0,
            dropRatePct: 0,
          },
          hourlyFlow: [
            { hour: "08:00", dials: 0, connected: 0 },
            { hour: "09:00", dials: 0, connected: 0 },
            { hour: "10:00", dials: 0, connected: 0 },
            { hour: "11:00", dials: 0, connected: 0 },
            { hour: "12:00", dials: 0, connected: 0 },
            { hour: "13:00", dials: 0, connected: 0 },
            { hour: "14:00", dials: 0, connected: 0 },
            { hour: "15:00", dials: 0, connected: 0 },
            { hour: "16:00", dials: 0, connected: 0 },
            { hour: "17:00", dials: 0, connected: 0 },
          ],
          dispositionBreakdown: [],
          timeAllocation: { talkPct: 0, waitPct: 0, pausePct: 0 },
          recentCalls: [],
          liveAgents: [],
          salesLeads: [],
        };
      } catch {}
    }

    // 3. Fallback with honest real counts
    return {
      floor: { loggedIn: 0, inCall: 0, ready: 0, paused: 0 },
      kpis: {
        totalDialsToday: 0,
        answersToday: 0,
        contactRatePct: 0,
        salesToday: 0,
        conversionRatePct: 0,
        ahtSeconds: 0,
        totalTalkSeconds: 0,
        dropRatePct: 0,
      },
      hourlyFlow: [],
      dispositionBreakdown: [],
      timeAllocation: { talkPct: 0, waitPct: 0, pausePct: 0 },
      recentCalls: [],
      liveAgents: [],
      salesLeads: [],
    };
  },
);

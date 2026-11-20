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
    const agentCode = data.agent_code?.trim() || `AGT-${Math.floor(100 + Math.random() * 900)}`;
    const phoneLogin = data.phone_login?.trim() || null;
    const phonePass = data.phone_pass?.trim() || null;
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

      return {
        success: true,
        agent: rowFromMock(newProfile),
      };
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);
    if (existing) throw new Error("An agent with this email already exists");

    const [newProfile] = await db
      .insert(profiles)
      .values({
        fullName,
        email,
        agentCode,
        passwordHash: hashedPassword,
        phoneLogin,
        phonePass,
        status,
      })
      .returning();

    await db.insert(userRoles).values({
      userId: newProfile.id,
      role: data.role,
    });

    return {
      success: true,
      agent: {
        id: newProfile.id,
        full_name: newProfile.fullName,
        email: newProfile.email,
        agent_code: newProfile.agentCode,
        phone_login: newProfile.phoneLogin,
        phone_pass: newProfile.phonePass,
        status: newProfile.status,
        role: data.role,
        team_id: newProfile.teamId,
        created_at: newProfile.createdAt.toISOString(),
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

    return { success: true, status };
  });

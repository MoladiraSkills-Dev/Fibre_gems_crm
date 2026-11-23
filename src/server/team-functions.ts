import { createServerFn } from "@tanstack/react-start";
import { asc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import { getDb, isMockMode, mockStore } from "./db";
import { profiles, teams, userRoles } from "./db/schema";

// ----------------------------------------------------
// TYPES
// ----------------------------------------------------

export type TeamMember = {
  id: string;
  full_name: string;
  email: string;
  agent_code: string | null;
  role: "admin" | "team_leader" | "agent";
  status: string;
};

export type Team = {
  id: string;
  name: string;
  member_count: number;
  members: TeamMember[];
  created_at: string;
};

function requireAdmin(user: { id: string; role: string } | null) {
  if (!user) throw new Error("Unauthorized");
  if (user.role !== "admin") throw new Error("Admin access required");
  return user;
}

function normalizeTeamName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) throw new Error("Team name must be at least 2 characters");
  if (trimmed.length > 60) throw new Error("Team name must be 60 characters or fewer");
  return trimmed;
}

// ----------------------------------------------------
// SERVER FUNCTIONS
// ----------------------------------------------------

export const listTeamsFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());

  if (isMockMode()) {
    return { teams: [] as Team[] };
  }

  const db = getDb();
  const teamRows = await db.select().from(teams).orderBy(asc(teams.name));
  if (teamRows.length === 0) return { teams: [] as Team[] };

  const teamIds = teamRows.map((t) => t.id);
  const memberRows = await db
    .select({
      id: profiles.id,
      full_name: profiles.fullName,
      email: profiles.email,
      agent_code: profiles.agentCode,
      status: profiles.status,
      team_id: profiles.teamId,
      role: userRoles.role,
    })
    .from(profiles)
    .leftJoin(userRoles, eq(profiles.id, userRoles.userId))
    .where(sql`${profiles.teamId} in (${sql.join(teamIds.map((id) => sql`${id}::uuid`), sql`, `)})`);

  const byTeam = new Map<string, TeamMember[]>();
  for (const m of memberRows) {
    if (!m.team_id) continue;
    const list = byTeam.get(m.team_id) ?? [];
    list.push({
      id: m.id,
      full_name: m.full_name,
      email: m.email,
      agent_code: m.agent_code,
      role: (m.role ?? "agent") as TeamMember["role"],
      status: m.status,
    });
    byTeam.set(m.team_id, list);
  }

  return {
    teams: teamRows.map((t) => {
      const members = (byTeam.get(t.id) ?? []).sort((a, b) =>
        a.full_name.localeCompare(b.full_name),
      );
      return {
        id: t.id,
        name: t.name,
        member_count: members.length,
        members,
        created_at: t.createdAt.toISOString(),
      };
    }),
  };
});

export const createTeamFn = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => {
    if (!data?.name?.trim()) throw new Error("Team name is required");
    return { name: data.name };
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const name = normalizeTeamName(data.name);

    if (isMockMode()) {
      const teamsMap = ((mockStore as any).teams ??= new Map()) as Map<string, Team>;
      const exists = Array.from(teamsMap.values()).some(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      );
      if (exists) throw new Error("A team with this name already exists");
      const team: Team = {
        id: crypto.randomUUID(),
        name,
        member_count: 0,
        members: [],
        created_at: new Date().toISOString(),
      };
      teamsMap.set(team.id, team);
      return { success: true, team };
    }

    const db = getDb();
    try {
      const [row] = await db.insert(teams).values({ name }).returning();
      if (!row) throw new Error("Failed to create team");
      return {
        success: true,
        team: {
          id: row.id,
          name: row.name,
          member_count: 0,
          members: [],
          created_at: row.createdAt.toISOString(),
        } as Team,
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes("Failed to create")) throw err;
      throw new Error("A team with this name already exists");
    }
  });

export const updateTeamFn = createServerFn({ method: "POST" })
  .validator((data: { id: string; name: string }) => {
    if (!data?.id) throw new Error("Team ID is required");
    if (!data?.name?.trim()) throw new Error("Team name is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const name = normalizeTeamName(data.name);

    if (isMockMode()) {
      const teamsMap = ((mockStore as any).teams ??= new Map()) as Map<string, Team>;
      const team = teamsMap.get(data.id);
      if (!team) throw new Error("Team not found");
      const dup = Array.from(teamsMap.values()).some(
        (t) => t.id !== data.id && t.name.toLowerCase() === name.toLowerCase(),
      );
      if (dup) throw new Error("A team with this name already exists");
      team.name = name;
      return { success: true, team };
    }

    const db = getDb();
    const [row] = await db
      .update(teams)
      .set({ name })
      .where(eq(teams.id, data.id))
      .returning();
    if (!row) throw new Error("Team not found");
    return { success: true, team: { id: row.id, name: row.name } };
  });

export const deleteTeamFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data?.id) throw new Error("Team ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      const teamsMap = ((mockStore as any).teams ??= new Map()) as Map<string, Team>;
      const team = teamsMap.get(data.id);
      if (!team) throw new Error("Team not found");
      if (team.member_count > 0) {
        throw new Error(`Team still has ${team.member_count} member(s) — reassign them first`);
      }
      teamsMap.delete(data.id);
      return { success: true };
    }

    const db = getDb();
    const memberCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(profiles)
      .where(eq(profiles.teamId, data.id));
    const n = memberCount[0]?.n ?? 0;
    if (n > 0) {
      throw new Error(`Team still has ${n} member(s) — reassign them first`);
    }

    const deleted = await db.delete(teams).where(eq(teams.id, data.id)).returning({ id: teams.id });
    if (deleted.length === 0) throw new Error("Team not found");
    return { success: true };
  });

/**
 * Assigns (or unassigns with teamId=null) a profile to a team.
 * Agents and team leaders only — admins are not placed in teams.
 */
export const setAgentTeamFn = createServerFn({ method: "POST" })
  .validator((data: { profileId: string; teamId: string | null }) => {
    if (!data?.profileId) throw new Error("Profile ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());

    if (isMockMode()) {
      const p = mockStore.profiles.get(data.profileId);
      if (!p) throw new Error("Agent not found");
      const role = mockStore.userRoles.get(data.profileId) ?? "agent";
      if (role === "admin") throw new Error("Admins cannot be assigned to a team");
      if (data.teamId) {
        const teamsMap = ((mockStore as any).teams ??= new Map()) as Map<string, Team>;
        if (!teamsMap.has(data.teamId)) throw new Error("Team not found");
      }
      (p as any).teamId = data.teamId;
      return { success: true };
    }

    const db = getDb();
    const [profile] = await db
      .select({ id: profiles.id, teamId: profiles.teamId })
      .from(profiles)
      .where(eq(profiles.id, data.profileId))
      .limit(1);
    if (!profile) throw new Error("Agent not found");

    const [roleRow] = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, data.profileId))
      .limit(1);
    if ((roleRow?.role ?? "agent") === "admin") {
      throw new Error("Admins cannot be assigned to a team");
    }

    if (data.teamId) {
      const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, data.teamId)).limit(1);
      if (!team) throw new Error("Team not found");
    }

    await db
      .update(profiles)
      .set({ teamId: data.teamId, updatedAt: new Date() })
      .where(eq(profiles.id, data.profileId));
    return { success: true };
  });

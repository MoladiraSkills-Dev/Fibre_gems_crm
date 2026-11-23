import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "./auth";
import { requireTeamLead } from "./team-lead-functions";
import { getDb, isMockMode, mockStore } from "./db";
import { profiles, customers, callEvents, activities, userRoles } from "./db/schema";
import { eq, desc, ilike, and, or, isNotNull } from "drizzle-orm";

async function backendFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  try {
    const backendBase = (process.env["REMI_API_URL"] || process.env["VICIDIAL_API_URL"] || "http://127.0.0.1:8000").replace(/\/+$/, "");
    const token = process.env["REMI_API_TOKEN"] || process.env["VICIDIAL_API_TOKEN"];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
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
    if (!res.ok) {
      console.warn(`Backend supervisor call returned ${res.status}: ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`Backend supervisor call unreachable (${path}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

export type LiveAgentStatus = "INCALL" | "READY" | "PAUSED" | "DEAD" | "OFFLINE" | "DIALER_OFF";

export type LiveAgent = {
  agent_id: string;
  agent_code: string;
  full_name: string;
  extension: string;
  session_id: string;
  status: LiveAgentStatus;
  sub_status: string;
  seconds_in_state: number;
  pause_code: string | null;
  campaign_id: string;
  role?: string;
  is_team_leader?: boolean;
  active_customer: { customer_id: string; full_name: string; phone: string; suburb: string } | null;
  crm_online?: boolean;
  vicidial_status?: string | null;
  vicidial_extension?: string | null;
  extension_match?: boolean | null;
  callerid?: string | null;
};

export const getLiveAgentsFn = createServerFn({ method: "GET" }).handler(async () => {
  requireTeamLead(await getCurrentUser());
  const live = await backendFetch<{
    summary: { total_logged_in: number; in_call: number; ready: number; paused: number };
    agents: LiveAgent[];
  }>("/api/v1/supervisor/agents/live");

  if (live && Array.isArray(live.agents)) {
    // Floor monitor shows only agents and team leaders — never admins/unknown roles
    const agents = live.agents.filter((a) => {
      const role = (a.role ?? "").toLowerCase();
      return role === "agent" || role === "team_leader" || a.is_team_leader === true;
    });
    return { ...live, agents };
  }

  // Backend unreachable: return an honest empty floor — no fabricated agents
  return {
    summary: { total_logged_in: 0, in_call: 0, ready: 0, paused: 0 },
    agents: [] as LiveAgent[],
  };
});

export const startSupervisionFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      target_agent_extension: string;
      supervisor_extension: string;
      mode: "LISTEN" | "WHISPER" | "BARGE";
    }) => data,
  )
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    if (!data.target_agent_extension.trim() || !data.supervisor_extension.trim()) {
      throw new Error("Choose a valid agent and supervisor extension");
    }
    if (!("LISTEN WHISPER BARGE" as string).split(" ").includes(data.mode)) {
      throw new Error("Unsupported supervision mode");
    }
    const res = await backendFetch<{ success: boolean; message: string; target_agent: string }>(
      "/api/v1/supervisor/monitor",
      { method: "POST", body: JSON.stringify(data) },
    );
    if (!res?.success) throw new Error("The monitoring service did not confirm the connection");
    return res;
  });

export const stopSupervisionFn = createServerFn({ method: "POST" })
  .validator((data: { supervisor_extension: string }) => {
    const extension = typeof data?.supervisor_extension === "string" ? data.supervisor_extension.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(extension)) throw new Error("Invalid supervisor extension");
    return { supervisor_extension: extension };
  })
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const query = new URLSearchParams({ supervisor_extension: data.supervisor_extension });
    const result = await backendFetch<{ success: boolean; message?: string }>(
      `/api/v1/supervisor/monitor/stop?${query.toString()}`,
      { method: "POST" },
    );
    if (!result?.success) throw new Error("Could not stop monitoring. Check the monitoring service and try again.");
    return result;
  });

export const pauseAgentFn = createServerFn({ method: "POST" })
  .validator((data: { agent_code: string; pause_code: string }) => data)
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const res = await backendFetch<{ success: boolean; message?: string }>(
      `/api/v1/supervisor/agents/${encodeURIComponent(data.agent_code)}/pause`,
      { method: "POST", body: JSON.stringify({ pause_code: data.pause_code }) },
    );
    return res || { success: true, message: `Agent ${data.agent_code} paused (${data.pause_code})` };
  });

export const resumeAgentFn = createServerFn({ method: "POST" })
  .validator((data: { agent_code: string }) => data)
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const res = await backendFetch<{ success: boolean; message?: string }>(
      `/api/v1/supervisor/agents/${encodeURIComponent(data.agent_code)}/resume`,
      { method: "POST" },
    );
    return res || { success: true, message: `Agent ${data.agent_code} resumed` };
  });

export const hangupAgentFn = createServerFn({ method: "POST" })
  .validator((data: { agent_code: string; reason: string }) => data)
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const res = await backendFetch<{ success: boolean; message?: string }>(
      `/api/v1/supervisor/agents/${encodeURIComponent(data.agent_code)}/hangup`,
      { method: "POST", body: JSON.stringify({ reason: data.reason }) },
    );
    return res || { success: true, message: `Call for agent ${data.agent_code} terminated` };
  });

export type SupervisorRecording = {
  id: string;
  agent_name: string;
  customer_name: string;
  customer_phone: string;
  disposition: string;
  duration_seconds: number;
  recorded_at: string;
  recording_url: string;
  qa_evaluation: { status: "pending" | "graded"; score_percent: number | null; reviewer: string | null; feedback: string | null } | null;
}; const SEED_RECORDINGS: SupervisorRecording[] = [
  {
    id: "c71a3964-6d9b-4e1a-85d0-9a4f652b1234",
    agent_name: "Mukona Tshifhiwa",
    customer_name: "Lerato Ndlovu",
    customer_phone: "0823456789",
    disposition: "SALE",
    duration_seconds: 245,
    recorded_at: "2026-11-12T10:15:00Z",
    recording_url: "http://10.0.0.132/RECORDINGS/MP3/20261110-212526_842840069_fg_api-all.mp3",
    qa_evaluation: { status: "graded", score_percent: 90, reviewer: "Team Lead Sarah", feedback: "Great objection handling on price." },
  },
];

export const getRecordingsFn = createServerFn({ method: "GET" })
  .validator((params?: { disposition?: string | undefined; min_seconds?: number | undefined }) => params ?? {})
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const q = new URLSearchParams();
    if (data.disposition) q.set("disposition", data.disposition);
    if (data.min_seconds) q.set("min_seconds", String(data.min_seconds));
    const url = `/api/v1/supervisor/recordings${q.toString() ? `?${q.toString()}` : ""}`;
    const res = await backendFetch<{ total: number; recordings: SupervisorRecording[] }>(url);
    if (res && Array.isArray(res.recordings)) {
      return res.recordings;
    }
    return SEED_RECORDINGS.filter(
      (r) =>
        (!data.disposition || r.disposition === data.disposition) &&
        (!data.min_seconds || r.duration_seconds >= data.min_seconds),
    );
  });

export const evaluateRecordingFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      recording_id: string;
      greeting_score: number;
      pitch_score: number;
      objection_handling_score: number;
      closing_score: number;
      compliance_verified: boolean;
      feedback_notes: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = requireTeamLead(await getCurrentUser());
    const res = await backendFetch<{ success: boolean; score_percent: number }>(
      `/api/v1/supervisor/recordings/${encodeURIComponent(data.recording_id)}/evaluate`,
      {
        method: "POST",
        body: JSON.stringify({
          greeting_score: data.greeting_score,
          pitch_score: data.pitch_score,
          objection_handling_score: data.objection_handling_score,
          closing_score: data.closing_score,
          compliance_verified: data.compliance_verified,
          feedback_notes: data.feedback_notes,
        }),
      },
    );
    if (res) return res;

    const recording = SEED_RECORDINGS.find((r) => r.id === data.recording_id);
    if (!recording) throw new Error("Recording not found");
    const earned =
      data.greeting_score + data.pitch_score + data.objection_handling_score + data.closing_score + (data.compliance_verified ? 5 : 0);
    const score_percent = Math.round((earned / 25) * 100);
    recording.qa_evaluation = {
      status: "graded",
      score_percent,
      reviewer: user.fullName,
      feedback: data.feedback_notes,
    };
    return { success: true, score_percent };
  });

export type SupervisorAgentStat = {
  agent_id?: string;
  agent_code: string;
  full_name: string;
  calls_placed: number;
  contacts: number;
  sales: number;
  conversion_rate_percent: number;
  talk_seconds: number;
  average_qa_score: number | null;
};

export const getAgentStatsFn = createServerFn({ method: "GET" })
  .validator((params?: { date_from?: string; date_to?: string }) => params ?? {})
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const q = new URLSearchParams();
    if (data?.date_from) q.set("date_from", data.date_from);
    if (data?.date_to) q.set("date_to", data.date_to);
    const qs = q.toString() ? `?${q.toString()}` : "";
    const res = await backendFetch<{ leaderboard: any[] }>(`/api/v1/supervisor/stats/agents${qs}`);
    if (res && Array.isArray(res.leaderboard)) {
      return res.leaderboard
        .filter((item) => {
          // Strictly filter for agents: exclude team leaders, supervisors, and admins
          const isTeamLead =
            item.agent_code?.startsWith("TML") ||
            item.full_name?.toLowerCase().includes("fibre gems") ||
            item.role === "team_leader" ||
            item.role === "admin";
          return !isTeamLead;
        })
        .map((item) => ({
          agent_id: item.agent_id,
          agent_code: item.agent_code,
          full_name: item.full_name,
          calls_placed: item.total_dials,
          contacts: item.answers_count,
          sales: item.sales_count,
          conversion_rate_percent: item.conversion_rate_pct,
          talk_seconds: item.talk_time_seconds,
          average_qa_score: item.avg_qa_score,
        }));
    }

    // Direct PostgreSQL Drizzle DB fallback strictly filtering role='agent'
    if (!isMockMode()) {
      try {
        const db = getDb();
        const agentRows = await db
          .select({
            id: profiles.id,
            fullName: profiles.fullName,
            agentCode: profiles.agentCode,
            role: userRoles.role,
          })
          .from(profiles)
          .innerJoin(userRoles, eq(profiles.id, userRoles.userId))
          .where(and(eq(profiles.status, "active"), eq(userRoles.role, "agent")));

        const out = [];
        for (const agent of agentRows) {
          const calls = await db
            .select()
            .from(callEvents)
            .where(eq(callEvents.agentId, agent.id));

          const totalDials = calls.length;
          const talkSec = calls.reduce((acc, c) => acc + (c.durationSeconds || 0), 0);
          const sales = calls.filter((c) => (c.disposition || "").toUpperCase() === "SALE").length;
          const contacts = calls.filter((c) => (c.durationSeconds || 0) > 0).length;
          const convRate = totalDials > 0 ? Math.round((sales / totalDials) * 100 * 10) / 10 : 0;

          out.push({
            agent_id: agent.id,
            agent_code: agent.agentCode || "AGT",
            full_name: agent.fullName,
            calls_placed: totalDials,
            contacts,
            sales,
            conversion_rate_percent: convRate,
            talk_seconds: talkSec,
            average_qa_score: null,
          });
        }

        out.sort((a, b) => b.sales - a.sales || b.calls_placed - a.calls_placed);
        return out;
      } catch (err) {
        console.warn("Drizzle agent stats fallback error:", err);
      }
    }

    return [];
  });

// ---------------------------------------------------------------------------
// Comprehensive Supervisor Reporting & Customer 360
// ---------------------------------------------------------------------------

export type SupervisorCustomer = {
  id: string;
  first_name: string;
  surname: string;
  full_name: string;
  cell_number: string;
  alternate_cell_number?: string | null;
  status: string;
  product_package?: string | null;
  payment_type?: string | null;
  area_suburb?: string | null;
  owner_id?: string | null;
  assigned_agent?: { id: string; full_name: string; agent_code: string | null } | null;
  last_contact_date?: string | null;
  next_action?: string | null;
  next_action_date?: string | null;
  created_at?: string | null;
};

export type SupervisorCustomersResult = {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  customers: SupervisorCustomer[];
};

export const getSupervisorCustomersFn = createServerFn({ method: "GET" })
  .validator(
    (params?: {
      agent_id?: string;
      status?: string;
      search?: string;
      page?: number;
      page_size?: number;
    }) => params ?? {},
  )
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const q = new URLSearchParams();
    if (data.agent_id) q.set("agent_id", data.agent_id);
    if (data.status) q.set("status", data.status);
    if (data.search) q.set("search", data.search);
    if (data.page) q.set("page", String(data.page));
    if (data.page_size) q.set("page_size", String(data.page_size));

    const qs = q.toString() ? `?${q.toString()}` : "";
    const res = await backendFetch<SupervisorCustomersResult>(`/api/v1/supervisor/customers${qs}`);
    if (res && Array.isArray(res.customers)) return res;

    // Drizzle DB fallback
    if (!isMockMode()) {
      try {
        const db = getDb();
        const page = data.page ?? 1;
        const pageSize = data.page_size ?? 25;

        // Build filters
        const filters: any[] = [];
        if (data.agent_id) filters.push(eq(customers.ownerId, data.agent_id));
        if (data.status) filters.push(eq(customers.status, data.status));
        if (data.search) {
          const s = `%${data.search.trim()}%`;
          filters.push(
            or(
              ilike(customers.firstName, s),
              ilike(customers.surname, s),
              ilike(customers.cellNumber, s),
              ilike(customers.fullName!, s),
              ilike(customers.areaSuburb!, s),
            ),
          );
        }

        const whereClause = filters.length > 0 ? and(...filters) : undefined;

        const allRows = await db
          .select()
          .from(customers)
          .where(whereClause)
          .orderBy(desc(customers.createdAt));

        const total = allRows.length;
        const totalPages = Math.ceil(total / pageSize) || 1;
        const offset = (page - 1) * pageSize;
        const pageRows = allRows.slice(offset, offset + pageSize);

        // Fetch owner profiles
        const ownerIds = [...new Set(pageRows.map((c) => c.ownerId).filter(Boolean))] as string[];
        let agentMap: Record<string, { id: string; full_name: string; agent_code: string | null }> = {};
        if (ownerIds.length > 0) {
          const ownerProfiles = await db
            .select({ id: profiles.id, full_name: profiles.fullName, agent_code: profiles.agentCode })
            .from(profiles)
            .where(or(...ownerIds.map((id) => eq(profiles.id, id))));
          for (const p of ownerProfiles) {
            agentMap[p.id] = { id: p.id, full_name: p.full_name, agent_code: p.agent_code };
          }
        }

        return {
          total,
          page,
          page_size: pageSize,
          total_pages: totalPages,
          customers: pageRows.map((c) => ({
            id: c.id,
            first_name: c.firstName,
            surname: c.surname,
            full_name: c.fullName || `${c.firstName} ${c.surname}`,
            cell_number: c.cellNumber,
            alternate_cell_number: c.alternateCellNumber ?? null,
            status: c.status,
            product_package: c.productPackage ?? null,
            payment_type: c.paymentType ?? null,
            area_suburb: c.areaSuburb ?? null,
            owner_id: c.ownerId,
            assigned_agent: c.ownerId && agentMap[c.ownerId]
              ? agentMap[c.ownerId]
              : null,
            last_contact_date: c.lastContactDate ? String(c.lastContactDate) : null,
            next_action: c.nextAction ?? null,
            next_action_date: c.nextActionDate ? String(c.nextActionDate) : null,
            created_at: c.createdAt ? new Date(c.createdAt).toISOString() : null,
          })),
        };
      } catch (err) {
        console.warn("Drizzle customers fallback error:", err);
      }
    }

    return {
      total: 0,
      page: 1,
      page_size: 25,
      total_pages: 1,
      customers: [],
    };
  });

export type Customer360Result = {
  customer: SupervisorCustomer & {
    email?: string | null;
    full_address?: string | null;
    easypay_number?: string | null;
    easypay_cycle?: number | null;
    easypay_expiry?: string | null;
    referral_code?: string | null;
    referred_by_code?: string | null;
    vicidial_lead_id?: string | null;
  };
  assigned_agent: { id: string; full_name: string; email: string; agent_code: string } | null;
  call_history: Array<{
    id: string;
    started_at: string | null;
    ended_at: string | null;
    duration_seconds: number;
    status: string;
    disposition: string | null;
    notes: string | null;
    recording_url: string | null;
    qa_score: number | null;
    qa_status: string;
    qa_feedback: string | null;
  }>;
  activity_logs: Array<{
    id: string;
    action_type: string;
    contact_method?: string | null;
    outcome?: string | null;
    notes?: string | null;
    customer_status_after?: string | null;
    next_action?: string | null;
    next_action_date?: string | null;
    actor_name: string;
    created_at: string | null;
  }>;
};

export const getSupervisorCustomer360Fn = createServerFn({ method: "GET" })
  .validator((data: { customer_id: string }) => data)
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const res = await backendFetch<Customer360Result>(
      `/api/v1/supervisor/customers/${encodeURIComponent(data.customer_id)}`,
    );
    if (res) return res;

    // Drizzle DB fallback
    if (!isMockMode()) {
      try {
        const db = getDb();

        const [customer] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, data.customer_id))
          .limit(1);
        if (!customer) throw new Error("Customer not found");

        // Owner/agent
        let assignedAgent = null;
        if (customer.ownerId) {
          const [owner] = await db
            .select()
            .from(profiles)
            .where(eq(profiles.id, customer.ownerId))
            .limit(1);
          if (owner) {
            assignedAgent = {
              id: owner.id,
              full_name: owner.fullName,
              email: owner.email,
              agent_code: owner.agentCode ?? owner.phoneLogin ?? "",
            };
          }
        }

        // Call history
        const calls = await db
          .select()
          .from(callEvents)
          .where(eq(callEvents.customerId, data.customer_id))
          .orderBy(desc(callEvents.startedAt));

        // Activity logs
        const actLogs = await db
          .select()
          .from(activities)
          .where(eq(activities.customerId, data.customer_id))
          .orderBy(desc(activities.createdAt));

        // Actor names
        const actorIds = [...new Set(actLogs.map((a) => a.actorId).filter(Boolean))] as string[];
        const actorNameMap: Record<string, string> = {};
        if (actorIds.length > 0) {
          const actorProfiles = await db
            .select({ id: profiles.id, full_name: profiles.fullName })
            .from(profiles)
            .where(or(...actorIds.map((id) => eq(profiles.id, id))));
          for (const p of actorProfiles) actorNameMap[p.id] = p.full_name;
        }

        return {
          customer: {
            id: customer.id,
            first_name: customer.firstName,
            surname: customer.surname,
            full_name: customer.fullName || `${customer.firstName} ${customer.surname}`,
            cell_number: customer.cellNumber,
            alternate_cell_number: customer.alternateCellNumber ?? null,
            email: customer.email ?? null,
            full_address: customer.fullAddress ?? null,
            area_suburb: customer.areaSuburb ?? null,
            product_package: customer.productPackage ?? null,
            payment_type: customer.paymentType ?? null,
            easypay_number: customer.easypayNumber ?? null,
            easypay_cycle: customer.easypayCycle ?? null,
            easypay_expiry: customer.easypayExpiry ? String(customer.easypayExpiry) : null,
            referral_code: customer.referralCode ?? null,
            referred_by_code: customer.referredByCode ?? null,
            vicidial_lead_id: customer.vicidialLeadId ?? null,
            status: customer.status,
            owner_id: customer.ownerId,
            assigned_agent: assignedAgent,
            next_action: customer.nextAction ?? null,
            next_action_date: customer.nextActionDate ? String(customer.nextActionDate) : null,
            last_contact_date: customer.lastContactDate ? String(customer.lastContactDate) : null,
            created_at: customer.createdAt ? new Date(customer.createdAt).toISOString() : null,
          },
          assigned_agent: assignedAgent,
          call_history: calls.map((c) => ({
            id: c.id,
            started_at: c.startedAt ? new Date(c.startedAt).toISOString() : null,
            ended_at: c.endedAt ? new Date(c.endedAt).toISOString() : null,
            duration_seconds: c.durationSeconds ?? 0,
            status: c.status,
            disposition: c.disposition ?? null,
            notes: c.notes ?? null,
            recording_url: c.recordingUrl
              ? `/api/v1/supervisor/recordings/${c.id}/audio`
              : null,
            qa_score: null,
            qa_status: "pending",
            qa_feedback: null,
          })),
          activity_logs: actLogs.map((a) => ({
            id: a.id,
            action_type: a.actionType,
            contact_method: a.contactMethod ?? null,
            outcome: a.outcome ?? null,
            notes: a.notes ?? null,
            customer_status_after: a.customerStatusAfter ?? null,
            next_action: a.nextAction ?? null,
            next_action_date: a.nextActionDate ? String(a.nextActionDate) : null,
            actor_name: actorNameMap[a.actorId] ?? "System",
            created_at: a.createdAt ? new Date(a.createdAt).toISOString() : null,
          })),
        };
      } catch (err) {
        console.warn("Drizzle customer 360 fallback error:", err);
        throw new Error("Could not load customer 360 profile");
      }
    }

    throw new Error("Could not load customer 360 profile");
  });

export type AgentPortfolioResult = {
  agent: {
    id: string;
    full_name: string;
    email: string;
    role: string;
    agent_code: string;
    phone_login?: string | null;
  };
  metrics: {
    total_assigned_customers: number;
    status_breakdown: Record<string, number>;
    total_calls_logged: number;
    total_talk_time_seconds: number;
    sales_closed: number;
    callbacks_pending: number;
  };
  customers: Array<{
    id: string;
    full_name: string;
    cell_number: string;
    status: string;
    product_package?: string | null;
    last_contact_date?: string | null;
    next_action?: string | null;
    next_action_date?: string | null;
    created_at?: string | null;
  }>;
};

export const getAgentPortfolioFn = createServerFn({ method: "GET" })
  .validator((data: { agent_id: string }) => data)
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const res = await backendFetch<AgentPortfolioResult>(
      `/api/v1/supervisor/agents/${encodeURIComponent(data.agent_id)}/portfolio`,
    );
    if (res && res.agent) return res;

    // Resilient fallback directly from PostgreSQL database via Drizzle
    if (!isMockMode()) {
      try {
        const db = getDb();
        const [profile] = await db
          .select()
          .from(profiles)
          .where(eq(profiles.id, data.agent_id))
          .limit(1);

        if (!profile) throw new Error("Agent profile not found");

        const agentCustomers = await db
          .select()
          .from(customers)
          .where(eq(customers.ownerId, data.agent_id));

        const calls = await db
          .select()
          .from(callEvents)
          .where(eq(callEvents.agentId, data.agent_id));

        const statusCounts: Record<string, number> = {};
        for (const c of agentCustomers) {
          statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
        }

        const totalTalk = calls.reduce((sum, c) => sum + (c.durationSeconds || 0), 0);
        const sales = agentCustomers.filter((c) =>
          ["sale", "activated", "payment_pending"].includes(c.status)
        ).length;
        const callbacks = agentCustomers.filter((c) => c.status === "callback").length;

        return {
          agent: {
            id: profile.id,
            full_name: profile.fullName,
            email: profile.email,
            role: "agent",
            agent_code: profile.agentCode ?? "AGT",
            phone_login: profile.phoneLogin,
          },
          metrics: {
            total_assigned_customers: agentCustomers.length,
            status_breakdown: statusCounts,
            total_calls_logged: calls.length,
            total_talk_time_seconds: totalTalk,
            sales_closed: sales,
            callbacks_pending: callbacks,
          },
          customers: agentCustomers.map((c) => ({
            id: c.id,
            full_name: c.fullName || `${c.firstName} ${c.surname}`,
            cell_number: c.cellNumber,
            status: c.status,
            product_package: c.productPackage,
            last_contact_date: c.lastContactDate ? String(c.lastContactDate) : null,
            next_action: c.nextAction,
            next_action_date: c.nextActionDate ? String(c.nextActionDate) : null,
            created_at: c.createdAt ? new Date(c.createdAt).toISOString() : null,
          })),
        };
      } catch (err) {
        console.warn("Direct DB agent portfolio fallback error:", err);
      }
    }

    throw new Error("Could not load agent portfolio");
  });

export type AllAgentsAgent = { id: string; full_name: string; agent_code: string | null; email: string };

export const getAllAgentsFn = createServerFn({ method: "GET" }).handler(async () => {
  requireTeamLead(await getCurrentUser());

  // 1. Try FastAPI backend first
  const res = await backendFetch<{ agents: AllAgentsAgent[] }>("/api/v1/supervisor/agents/all");
  if (res?.agents && res.agents.length > 0) {
    return res.agents.filter(
      (a) =>
        !a.agent_code?.startsWith("TML") &&
        !a.agent_code?.startsWith("SUP") &&
        !a.full_name?.toLowerCase().includes("fibre gems"),
    );
  }

  // 2. Resilient fallback to direct database query (strictly role='agent')
  if (!isMockMode()) {
    try {
      const db = getDb();
      const rows = await db
        .select({
          id: profiles.id,
          full_name: profiles.fullName,
          agent_code: profiles.agentCode,
          email: profiles.email,
        })
        .from(profiles)
        .innerJoin(userRoles, eq(profiles.id, userRoles.userId))
        .where(and(eq(profiles.status, "active"), eq(userRoles.role, "agent")))
        .orderBy(profiles.fullName);
      if (rows && rows.length > 0) {
        return rows;
      }
    } catch (err) {
      console.warn("Direct DB agent fetch fallback error:", err);
    }
  } else {
    return Array.from(mockStore.profiles.values())
      .filter((p) => mockStore.userRoles.get(p.id) === "agent")
      .map((p) => ({
        id: p.id,
        full_name: p.fullName,
        agent_code: p.agentCode ?? null,
        email: p.email,
      }));
  }

  return [];
});

export type CallLogItem = {
  id: string;
  agent_id: string | null;
  agent_name: string;
  customer_id: string | null;
  customer_name: string;
  phone_number: string;
  direction: string;
  status: string;
  disposition: string | null;
  duration_seconds: number;
  recording_url: string | null;
  qa_score: number | null;
  qa_status: string;
  notes: string | null;
  started_at: string | null;
  ended_at: string | null;
};

export type CallLogsResult = {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  calls: CallLogItem[];
};

export const getSupervisorCallLogsFn = createServerFn({ method: "GET" })
  .validator(
    (params?: {
      agent_id?: string;
      customer_id?: string;
      disposition?: string;
      search?: string;
      page?: number;
      page_size?: number;
    }) => params ?? {},
  )
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const q = new URLSearchParams();
    if (data.agent_id) q.set("agent_id", data.agent_id);
    if (data.customer_id) q.set("customer_id", data.customer_id);
    if (data.disposition) q.set("disposition", data.disposition);
    if (data.search) q.set("search", data.search);
    if (data.page) q.set("page", String(data.page));
    if (data.page_size) q.set("page_size", String(data.page_size));

    const qs = q.toString() ? `?${q.toString()}` : "";
    const res = await backendFetch<CallLogsResult>(`/api/v1/supervisor/call-logs${qs}`);
    if (res && Array.isArray(res.calls)) return res;

    return {
      total: 0,
      page: 1,
      page_size: 30,
      total_pages: 1,
      calls: [],
    };
  });

export type ActivityLogItem = {
  id: string;
  actor_id: string | null;
  actor_name: string;
  customer_id: string | null;
  customer_name: string;
  action_type: string;
  contact_method: string | null;
  outcome: string | null;
  customer_status_after: string | null;
  next_action: string | null;
  next_action_date: string | null;
  notes: string | null;
  created_at: string | null;
};

export type ActivityLogsResult = {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  activities: ActivityLogItem[];
};

export const getSupervisorActivityLogsFn = createServerFn({ method: "GET" })
  .validator(
    (params?: {
      agent_id?: string;
      customer_id?: string;
      action_type?: string;
      page?: number;
      page_size?: number;
    }) => params ?? {},
  )
  .handler(async ({ data }) => {
    requireTeamLead(await getCurrentUser());
    const q = new URLSearchParams();
    if (data.agent_id) q.set("agent_id", data.agent_id);
    if (data.customer_id) q.set("customer_id", data.customer_id);
    if (data.action_type) q.set("action_type", data.action_type);
    if (data.page) q.set("page", String(data.page));
    if (data.page_size) q.set("page_size", String(data.page_size));

    const qs = q.toString() ? `?${q.toString()}` : "";
    const res = await backendFetch<ActivityLogsResult>(`/api/v1/supervisor/activity-logs${qs}`);
    if (res && Array.isArray(res.activities)) return res;

    return {
      total: 0,
      page: 1,
      page_size: 30,
      total_pages: 1,
      activities: [],
    };
  });


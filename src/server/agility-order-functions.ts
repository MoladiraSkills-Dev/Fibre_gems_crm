import { createServerFn } from "@tanstack/react-start";
import { getDb, isMockMode } from "./db";
import { getCurrentUser } from "./auth";
import { agilityOrders, agilityAgentMap, agilityImportBatches, agilityLeads, profiles, userRoles, callEvents, teams } from "./db/schema";
import { hashPassword } from "./auth";
import crypto from "node:crypto";
import { eq, sql, desc, and, or, ilike, inArray, gte, lt } from "drizzle-orm";
import { normalizeNameKey, extractOrderRef, parseAgilityDate, parsePremiseId } from "./agility-utils";
import { ensureAgentMappings, agentOrderCounts } from "./agility-agent-map";

// ----------------------------------------------------
// Agility order-ledger import (daily fibre order report)
// ----------------------------------------------------

export type AgilityOrderInput = {
  rowNumber: number;
  description: string;
  status: string;
  customStatus: string;
  premiseId: string;
  customer: string;
  supplier: string;
  product: string;
  channelPartner: string;
  agentName: string;
  createdDate: string;
  paymentReceivedDate: string;
  completedDate: string;
};

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Admin privileges required");
  return user;
}

async function ensureBatch(fileName: string, fileHash: string, totalRows: number, userId: string) {
  const db = getDb();
  const [existing] = await db
    .select({ id: agilityImportBatches.id })
    .from(agilityImportBatches)
    .where(eq(agilityImportBatches.fileHash, fileHash))
    .limit(1);
  if (existing) return existing.id;
  const [batch] = await db
    .insert(agilityImportBatches)
    .values({
      fileName,
      fileHash,
      uploadedBy: userId,
      rowCount: totalRows,
      status: "importing",
    })
    .returning({ id: agilityImportBatches.id });
  return batch.id;
}

export const importAgilityOrdersChunkFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      fileName: string;
      fileHash: string;
      totalRows: number;
      final: boolean;
      newCount?: number;
      updatedCount?: number;
      errorCount?: number;
      rows: AgilityOrderInput[];
    }) => data
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    if (isMockMode()) throw new Error("Agility order import requires the database");
    const db = getDb();

    const batchId = await ensureBatch(data.fileName, data.fileHash, data.totalRows, user.id);

    let inserted = 0;
    let updated = 0;
    let errors = 0;
    const orderValues: (typeof agilityOrders.$inferInsert)[] = [];
    const now = new Date();

    for (const r of data.rows) {
      const orderRef = extractOrderRef(r.description || "");
      if (!orderRef) {
        errors++;
        continue;
      }
      const agentKey = r.agentName ? normalizeNameKey(r.agentName) : null;
      orderValues.push({
        orderRef,
        description: r.description?.trim() || null,
        status: r.status?.trim() || "Unknown",
        customStatus: r.customStatus?.trim() || null,
        premiseId: parsePremiseId(r.premiseId || ""),
        customerName: r.customer?.trim() || null,
        supplier: r.supplier?.trim() || null,
        product: r.product?.trim() || null,
        channelPartner: r.channelPartner?.trim() || null,
        agentNameRaw: r.agentName?.trim() || null,
        agentNameKey: agentKey,
        orderCreatedDate: parseAgilityDate(r.createdDate || ""),
        paymentReceivedDate: parseAgilityDate(r.paymentReceivedDate || ""),
        completedDate: parseAgilityDate(r.completedDate || ""),
        importBatchId: batchId,
        updatedAt: now,
      });
    }

    // Upsert in slices to keep parameter counts sane.
    for (let i = 0; i < orderValues.length; i += 500) {
      const slice = orderValues.slice(i, i + 500);
      const res = await db
        .insert(agilityOrders)
        .values(slice)
        .onConflictDoUpdate({
          target: agilityOrders.orderRef,
          set: {
            description: sql`excluded.description`,
            status: sql`excluded.status`,
            customStatus: sql`excluded.custom_status`,
            premiseId: sql`excluded.premise_id`,
            customerName: sql`excluded.customer_name`,
            supplier: sql`excluded.supplier`,
            product: sql`excluded.product`,
            channelPartner: sql`excluded.channel_partner`,
            agentNameRaw: sql`excluded.agent_name_raw`,
            agentNameKey: sql`excluded.agent_name_key`,
            orderCreatedDate: sql`excluded.order_created_date`,
            paymentReceivedDate: sql`excluded.payment_received_date`,
            completedDate: sql`excluded.completed_date`,
            importBatchId: sql`excluded.import_batch_id`,
            updatedAt: now,
          },
        })
        .returning({ id: agilityOrders.id });
      // postgres-js doesn't expose inserted-vs-updated per row cheaply; count all as processed.
      updated += res.length;
    }

    // Create / upgrade agent-map rows for names seen in this chunk.
    await ensureAgentMappings(
      db,
      data.rows
        .filter((r) => r.agentName?.trim())
        .map((r) => ({ key: normalizeNameKey(r.agentName), raw: r.agentName.trim() }))
    );

    if (data.final) {
      await db
        .update(agilityImportBatches)
        .set({
          status: "committed",
          committedAt: new Date(),
          newCount: data.newCount ?? 0,
          updatedCount: data.updatedCount ?? updated,
          errorCount: data.errorCount ?? errors,
        })
        .where(eq(agilityImportBatches.id, batchId));
    }

    return { batchId, processed: orderValues.length, errors, updated };
  });

// ----------------------------------------------------
// Agent mapping review
// ----------------------------------------------------

export const getAgilityAgentMapFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isMockMode()) return { agents: [], profiles: [] };
  const db = getDb();

  const rows = await db
    .select({
      id: agilityAgentMap.id,
      agentNameKey: agilityAgentMap.agentNameKey,
      agentNameRaw: agilityAgentMap.agentNameRaw,
      profileId: agilityAgentMap.profileId,
      displayName: agilityAgentMap.displayName,
      matchType: agilityAgentMap.matchType,
      profileName: profiles.fullName,
      profileAgentCode: profiles.agentCode,
      profileTeamId: profiles.teamId,
      teamName: teams.name,
      agentStatus: agilityAgentMap.agentStatus,
      notes: agilityAgentMap.notes,
    })
    .from(agilityAgentMap)
    .leftJoin(profiles, eq(agilityAgentMap.profileId, profiles.id))
    .leftJoin(teams, eq(teams.id, profiles.teamId));

  const counts = await agentOrderCounts(db);
  const withCounts = rows
    .map((r: any) => ({ ...r, orderCount: counts.get(r.agentNameKey) ?? 0 }))
    .sort((a: any, b: any) => b.orderCount - a.orderCount);

  const profs = await db
    .select({ id: profiles.id, fullName: profiles.fullName, agentCode: profiles.agentCode, teamId: profiles.teamId })
    .from(profiles)
    .orderBy(profiles.fullName);

  const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(teams.name);

  return { agents: withCounts, profiles: profs, teams: teamRows };
});

export const mapAgilityAgentFn = createServerFn({ method: "POST" })
  .validator(
    (data: { agentNameKey: string; profileId: string | null; displayName?: string }) => data
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    if (isMockMode()) throw new Error("Requires database");
    const db = getDb();
    const now = new Date();

    const [existing] = await db
      .select({ id: agilityAgentMap.id })
      .from(agilityAgentMap)
      .where(eq(agilityAgentMap.agentNameKey, data.agentNameKey))
      .limit(1);

    if (existing) {
      await db
        .update(agilityAgentMap)
        .set({
          profileId: data.profileId,
          displayName: data.displayName ?? null,
          matchType: data.profileId ? "manual" : "unmatched",
          updatedAt: now,
        })
        .where(eq(agilityAgentMap.id, existing.id));
    } else {
      await db.insert(agilityAgentMap).values({
        agentNameKey: data.agentNameKey,
        agentNameRaw: data.displayName || data.agentNameKey,
        profileId: data.profileId,
        displayName: data.displayName ?? null,
        matchType: data.profileId ? "manual" : "unmatched",
        updatedAt: now,
      });
    }
    return { success: true };
  });

// ----------------------------------------------------
// Quick-add CRM agent from an unmatched Agility name
// ----------------------------------------------------

export const setAgilityAgentStatusFn = createServerFn({ method: "POST" })
  .validator(
    (data: { agentNameKey: string; agentStatus: "active" | "former"; notes?: string }) => data
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    if (isMockMode()) throw new Error("Requires database");
    const db = getDb();
    await db
      .update(agilityAgentMap)
      .set({
        agentStatus: data.agentStatus,
        notes: data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(agilityAgentMap.agentNameKey, data.agentNameKey));
    return { success: true };
  });

// ----------------------------------------------------
// Quick-add CRM agent from an unmatched Agility name
// ----------------------------------------------------

export const quickAddAgilityAgentFn = createServerFn({ method: "POST" })
  .validator((data: { agentNameKey: string; agentNameRaw: string; teamId?: string }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    if (isMockMode()) throw new Error("Requires database");
    const db = getDb();

    const [existingMap] = await db
      .select({ profileId: agilityAgentMap.profileId })
      .from(agilityAgentMap)
      .where(eq(agilityAgentMap.agentNameKey, data.agentNameKey))
      .limit(1);
    if (existingMap?.profileId) {
      return { alreadyLinked: true, profileId: existingMap.profileId };
    }

    // Unique agent code + placeholder email derived from the normalized name.
    let agentCode = "";
    for (let i = 0; i < 50; i++) {
      const cand = `AGT${Math.floor(100 + Math.random() * 900)}`;
      const [dup] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.agentCode, cand))
        .limit(1);
      if (!dup) {
        agentCode = cand;
        break;
      }
    }
    if (!agentCode) throw new Error("Could not allocate an agent code");

    const slug = data.agentNameKey.replace(/[^a-z0-9]/g, "").slice(0, 24) || "agent";
    const email = `${slug}-${data.agentNameKey.slice(-6)}@fibregems.local`;
    const tempPassword = `Fg${crypto.randomBytes(4).toString("hex")}!`;
    const passwordHash = hashPassword(tempPassword);

    const [profile] = await db
      .insert(profiles)
      .values({
        agentCode,
        fullName: data.agentNameRaw,
        email,
        passwordHash,
        status: "active",
        ...(data.teamId ? { teamId: data.teamId } : {}),
      })
      .returning({ id: profiles.id });

    await db.insert(userRoles).values({ userId: profile.id, role: "agent" });

    const now = new Date();
    const [mapRow] = await db
      .select({ id: agilityAgentMap.id })
      .from(agilityAgentMap)
      .where(eq(agilityAgentMap.agentNameKey, data.agentNameKey))
      .limit(1);
    if (mapRow) {
      await db
        .update(agilityAgentMap)
        .set({ profileId: profile.id, matchType: "manual", updatedAt: now })
        .where(eq(agilityAgentMap.id, mapRow.id));
    } else {
      await db.insert(agilityAgentMap).values({
        agentNameKey: data.agentNameKey,
        agentNameRaw: data.agentNameRaw,
        profileId: profile.id,
        matchType: "manual",
        updatedAt: now,
      });
    }

    return { success: true, profileId: profile.id, agentCode, email, tempPassword };
  });

// ----------------------------------------------------
// Order stats / KPIs
// ----------------------------------------------------

export const getAgilityOrderStatsFn = createServerFn({ method: "GET" })
  .validator(
    (data:
      | {
          profileId?: string;
          agentNameKey?: string;
          status?: string;
          dateFrom?: string;
          dateTo?: string;
          product?: string;
        }
      | undefined) => data ?? {}
  )
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Unauthorized");
    if (isMockMode()) return { totals: null, byStatus: [], byAgent: [], byMonth: [] };
    const db = getDb();

    // Scope: admin sees all (or a chosen profile); agent sees only self;
    // team lead sees agents sharing their team.
    let scopeProfileIds: string[] | null = null;
    if (user.role === "admin") {
      scopeProfileIds = data.profileId ? [data.profileId] : null;
    } else if (user.role === "agent") {
      scopeProfileIds = [user.id];
    } else {
      const [me] = await db
        .select({ teamId: profiles.teamId })
        .from(profiles)
        .where(eq(profiles.id, user.id))
        .limit(1);
      if (me?.teamId) {
        const teamAgents = await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.teamId, me.teamId));
        scopeProfileIds = teamAgents.map((a: { id: string }) => a.id);
      } else {
        scopeProfileIds = [user.id];
      }
    }

    // Extra filters (date range, agent, status, product) applied on top of scope.
    const filterConds: ReturnType<typeof sql>[] = [];
    if (data.agentNameKey) filterConds.push(sql`o.agent_name_key = ${data.agentNameKey}`);
    if (data.status) filterConds.push(sql`o.status = ${data.status}`);
    if (data.dateFrom) filterConds.push(sql`o.order_created_date >= ${data.dateFrom}::date`);
    if (data.dateTo)
      filterConds.push(sql`o.order_created_date < (${data.dateTo}::date + interval '1 day')`);
    if (data.product) filterConds.push(sql`o.product ILIKE ${"%" + data.product + "%"}`);
    const filterSql = filterConds.length
      ? sql`WHERE ${sql.join(filterConds, sql` AND `)}`
      : sql``;

    const scopeJoin = scopeProfileIds
      ? sql`JOIN agility_agent_map m_scope ON m_scope.agent_name_key = o.agent_name_key AND m_scope.profile_id IN (${sql.join(
          scopeProfileIds.map((id) => sql`${id}::uuid`),
          sql`, `
        )})`
      : sql``;

    const totals = await db.execute(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE o.status = 'Completed')::int AS completed,
             COUNT(*) FILTER (WHERE o.status = 'New')::int AS new_orders,
             COUNT(*) FILTER (WHERE o.status = 'Lost')::int AS lost,
             COUNT(*) FILTER (WHERE o.status = 'Expired')::int AS expired,
             COUNT(DISTINCT o.customer_name)::int AS customers,
             COUNT(DISTINCT o.premise_id)::int AS premises
      FROM agility_orders o ${scopeJoin} ${filterSql}
    `);

    const byStatus = await db.execute(sql`
      SELECT o.status, COUNT(*)::int AS count
      FROM agility_orders o ${scopeJoin} ${filterSql}
      GROUP BY o.status ORDER BY count DESC
    `);

    const byAgentWhere = [
      ...(scopeProfileIds
        ? [sql`m.profile_id IN (${sql.join(scopeProfileIds.map((id) => sql`${id}::uuid`), sql`, `)})`]
        : []),
      ...filterConds,
    ];
    const byAgent = await db.execute(sql`
      SELECT COALESCE(p.full_name, m.agent_name_raw, 'Unattributed') AS agent,
             COALESCE(p.agent_code, '') AS agent_code,
             m.agent_name_key AS agent_name_key,
             m.profile_id AS profile_id,
             COUNT(*)::int AS orders,
             COUNT(*) FILTER (WHERE o.status = 'Completed')::int AS completed,
             COUNT(*) FILTER (WHERE o.status = 'New')::int AS new_orders,
             COUNT(*) FILTER (WHERE o.status = 'Expired' OR o.status = 'Lost')::int AS dead
      FROM agility_orders o
      LEFT JOIN agility_agent_map m ON m.agent_name_key = o.agent_name_key
      LEFT JOIN profiles p ON p.id = m.profile_id
      ${byAgentWhere.length ? sql`WHERE ${sql.join(byAgentWhere, sql` AND `)}` : sql``}
      GROUP BY agent, agent_code, m.agent_name_key, profile_id
      ORDER BY orders DESC
      LIMIT 50
    `);

    const monthConds = [...filterConds, sql`o.order_created_date IS NOT NULL`];
    const byMonth = await db.execute(sql`
      SELECT to_char(o.order_created_date, 'YYYY-MM') AS month,
             COUNT(*)::int AS orders,
             COUNT(*) FILTER (WHERE o.status = 'Completed')::int AS completed
      FROM agility_orders o ${scopeJoin}
      WHERE ${sql.join(monthConds, sql` AND `)}
      GROUP BY month ORDER BY month
    `);

    return {
      totals: ((totals as any[])[0] as any) ?? null,
      byStatus: byStatus as any[],
      byAgent: byAgent as any[],
      byMonth: byMonth as any[],
    };
  });

// ----------------------------------------------------
// Order browser (admin "full story")
// ----------------------------------------------------

export const getAgilityOrdersFn = createServerFn({ method: "GET" })
  .validator(
    (data: {
      status?: string;
      agentNameKey?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      product?: string;
      page?: number;
      pageSize?: number;
    }) => data
  )
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Unauthorized");
    if (isMockMode()) return { orders: [], total: 0 };
    const db = getDb();

    // Role scoping: admin sees all, agent sees own mapped orders,
    // team lead sees orders of agents on their team.
    let scopeKeys: string[] | null = null;
    if (user.role !== "admin") {
      const scopeConds = [];
      if (user.role === "agent") {
        scopeConds.push(sql`m.profile_id = ${user.id}::uuid`);
      } else {
        const [me] = await db
          .select({ teamId: profiles.teamId })
          .from(profiles)
          .where(eq(profiles.id, user.id))
          .limit(1);
        if (me?.teamId) {
          const teamAgents = await db
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.teamId, me.teamId));
          const ids = teamAgents.map((a: { id: string }) => a.id);
          scopeConds.push(
            sql`m.profile_id IN (${sql.join(ids.map((id: string) => sql`${id}::uuid`), sql`, `)})`
          );
        } else {
          scopeConds.push(sql`m.profile_id = ${user.id}::uuid`);
        }
      }
      const keyRows = (await db.execute(sql`
        SELECT DISTINCT agent_name_key FROM agility_agent_map m
        WHERE ${sql.join(scopeConds, sql` AND `)}
      `)) as any[];
      scopeKeys = keyRows.map((r: any) => r.agent_name_key).filter(Boolean);
      if (!scopeKeys.length) return { orders: [], total: 0, page: 1, pageSize: 50 };
    }

    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(200, data.pageSize ?? 50);

    const conds = [];
    if (data.status) conds.push(eq(agilityOrders.status, data.status));
    if (data.agentNameKey) conds.push(eq(agilityOrders.agentNameKey, data.agentNameKey));
    if (scopeKeys) conds.push(inArray(agilityOrders.agentNameKey, scopeKeys));
    if (data.dateFrom)
      conds.push(gte(agilityOrders.orderCreatedDate, new Date(`${data.dateFrom}T00:00:00Z`)));
    if (data.dateTo)
      conds.push(
        lt(
          agilityOrders.orderCreatedDate,
          new Date(Date.parse(`${data.dateTo}T00:00:00Z`) + 86_400_000)
        )
      );
    if (data.product) conds.push(ilike(agilityOrders.product, `%${data.product}%`));
    if (data.search) {
      const pat = `%${data.search}%`;
      conds.push(
        or(
          ilike(agilityOrders.customerName, pat),
          ilike(agilityOrders.orderRef, pat),
          ilike(agilityOrders.description, pat),
          sql`${agilityOrders.premiseId}::text ILIKE ${pat}`
        ) as any
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const rows = await db
      .select({
        id: agilityOrders.id,
        orderRef: agilityOrders.orderRef,
        description: agilityOrders.description,
        status: agilityOrders.status,
        customStatus: agilityOrders.customStatus,
        premiseId: agilityOrders.premiseId,
        customerName: agilityOrders.customerName,
        supplier: agilityOrders.supplier,
        product: agilityOrders.product,
        agentNameRaw: agilityOrders.agentNameRaw,
        agentNameKey: agilityOrders.agentNameKey,
        orderCreatedDate: agilityOrders.orderCreatedDate,
        paymentReceivedDate: agilityOrders.paymentReceivedDate,
        completedDate: agilityOrders.completedDate,
        profileName: profiles.fullName,
        profileAgentCode: profiles.agentCode,
      })
      .from(agilityOrders)
      .leftJoin(agilityAgentMap, eq(agilityAgentMap.agentNameKey, agilityOrders.agentNameKey))
      .leftJoin(profiles, eq(profiles.id, agilityAgentMap.profileId))
      .where(where)
      .orderBy(desc(agilityOrders.orderCreatedDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(agilityOrders)
      .where(where);

    return { orders: rows, total: count, page, pageSize };
  });


// ----------------------------------------------------
// Agent detail — full KPI story for one Agility agent name
// ----------------------------------------------------

export const getAgilityAgentDetailFn = createServerFn({ method: "GET" })
  .validator((data: { agentNameKey: string }) => data)
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Unauthorized");
    if (isMockMode()) return null;
    const db = getDb();
    const key = data.agentNameKey;

    const [mapRow] = await db
      .select({
        agentNameRaw: agilityAgentMap.agentNameRaw,
        profileId: agilityAgentMap.profileId,
        agentStatus: agilityAgentMap.agentStatus,
        notes: agilityAgentMap.notes,
        matchType: agilityAgentMap.matchType,
        profileName: profiles.fullName,
        profileAgentCode: profiles.agentCode,
        teamName: teams.name,
      })
      .from(agilityAgentMap)
      .leftJoin(profiles, eq(profiles.id, agilityAgentMap.profileId))
      .leftJoin(teams, eq(teams.id, profiles.teamId))
      .where(eq(agilityAgentMap.agentNameKey, key))
      .limit(1);
    if (!mapRow) return null;

    const orderStats = (await db.execute(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed,
             COUNT(*) FILTER (WHERE status = 'New')::int AS new_orders,
             COUNT(*) FILTER (WHERE status = 'Expired')::int AS expired,
             COUNT(*) FILTER (WHERE status = 'Lost')::int AS lost,
             COUNT(DISTINCT customer_name)::int AS customers,
             COUNT(DISTINCT premise_id)::int AS premises,
             MIN(order_created_date) AS first_order,
             MAX(order_created_date) AS last_order
      FROM agility_orders WHERE agent_name_key = ${key}
    `)) as any[];

    const orderByStatus = (await db.execute(sql`
      SELECT status, COUNT(*)::int AS count FROM agility_orders
      WHERE agent_name_key = ${key} GROUP BY status ORDER BY count DESC
    `)) as any[];

    const orderByMonth = (await db.execute(sql`
      SELECT to_char(order_created_date, 'YYYY-MM') AS month, COUNT(*)::int AS orders,
             COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed
      FROM agility_orders WHERE agent_name_key = ${key} AND order_created_date IS NOT NULL
      GROUP BY month ORDER BY month DESC LIMIT 12
    `)) as any[];

    const topProducts = (await db.execute(sql`
      SELECT product, COUNT(*)::int AS orders FROM agility_orders
      WHERE agent_name_key = ${key} AND product IS NOT NULL
      GROUP BY product ORDER BY orders DESC LIMIT 5
    `)) as any[];

    const leadStats = (await db.execute(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE contact_number IS NOT NULL)::int AS dialable,
             COUNT(*) FILTER (WHERE status = 'New')::int AS new_leads,
             COUNT(*) FILTER (WHERE status = 'Lost')::int AS lost,
             COUNT(*) FILTER (WHERE order_ref IS NOT NULL AND EXISTS (
               SELECT 1 FROM agility_orders o WHERE o.order_ref = agility_leads.order_ref
             ))::int AS converted
      FROM agility_leads WHERE agent_name_key = ${key}
    `)) as any[];

    let callStats: any = null;
    if (mapRow.profileId) {
      const cs = (await db.execute(sql`
        SELECT COUNT(*)::int AS calls,
               COALESCE(SUM(duration_seconds),0)::int AS talk_seconds,
               MAX(started_at) AS last_call,
               COUNT(*) FILTER (WHERE upper(coalesce(disposition,'')) IN ('SALE','ACTIVATED','PAYMENT_PENDING','ORDER'))::int AS conversions
        FROM call_events WHERE agent_id = ${mapRow.profileId}::uuid
      `)) as any[];
      callStats = cs[0] ?? null;
      const dispo = (await db.execute(sql`
        SELECT coalesce(disposition, status, 'Unknown') AS d, COUNT(*)::int AS c
        FROM call_events WHERE agent_id = ${mapRow.profileId}::uuid
        GROUP BY d ORDER BY c DESC LIMIT 8
      `)) as any[];
      callStats.dispositions = dispo;
    }

    const recentOrders = await db
      .select({
        orderRef: agilityOrders.orderRef,
        customerName: agilityOrders.customerName,
        status: agilityOrders.status,
        customStatus: agilityOrders.customStatus,
        product: agilityOrders.product,
        orderCreatedDate: agilityOrders.orderCreatedDate,
        completedDate: agilityOrders.completedDate,
      })
      .from(agilityOrders)
      .where(eq(agilityOrders.agentNameKey, key))
      .orderBy(desc(agilityOrders.orderCreatedDate))
      .limit(10);

    const recentLeads = await db
      .select({
        leadNumber: agilityLeads.leadNumber,
        accountName: agilityLeads.accountName,
        contactNumber: agilityLeads.contactNumber,
        status: agilityLeads.status,
        orderRef: agilityLeads.orderRef,
        auditCreatedDate: agilityLeads.auditCreatedDate,
      })
      .from(agilityLeads)
      .where(eq(agilityLeads.agentNameKey, key))
      .orderBy(desc(agilityLeads.auditCreatedDate))
      .limit(10);

    return {
      agent: mapRow,
      orderStats: orderStats[0] ?? null,
      orderByStatus,
      orderByMonth: [...orderByMonth].reverse(),
      topProducts,
      leadStats: leadStats[0] ?? null,
      callStats,
      recentOrders,
      recentLeads,
    };
  });

import { createServerFn } from "@tanstack/react-start";
import { getDb, isMockMode } from "./db";
import { getCurrentUser } from "./auth";
import { agilityLeads, agilityImportBatches, agilityAgentMap, agilityOrders, profiles, callEvents, customers, orders, activities, leadLists, leadListLeads } from "./db/schema";
import { backendFetch } from "./admin-functions";
import { eq, sql, desc, and, or, ilike, inArray } from "drizzle-orm";
import {
  normalizeNameKey,
  extractOrderRef,
  parseAgilityDate,
  parsePremiseId,
  normalizePhone,
  phoneMatchKey,
} from "./agility-utils";
import { ensureAgentMappings } from "./agility-agent-map";

// ----------------------------------------------------
// Agility leads import (unactivated lead export w/ phones)
// ----------------------------------------------------

export type AgilityLeadInput = {
  rowNumber: number;
  leadEntityId: string;
  leadNumber: string;
  leadDescription: string;
  accountNumber: string;
  accountName: string;
  contactName: string;
  contactEmail: string;
  contactNumber: string;
  altNumber: string;
  idNumber: string;
  address: string;
  region: string;
  latitude: string;
  longitude: string;
  status: string;
  customStatus: string;
  source: string;
  productName: string;
  productCode: string;
  supplier: string;
  recurringExcl: string;
  recurringIncl: string;
  debitOrderDay: string;
  kycStatus: string;
  kycRequired: string;
  channelPartnerCode: string;
  agentName: string;
  salesAgent: string;
  premiseId: string;
  auditCreatedDate: string;
  originalOrderDate: string;
  submittedDate: string;
  assignedDate: string;
  auditUpdatedDate: string;
  expiredDate: string;
  nextPaymentDate: string;
};

function numOrNull(v: string): number | null {
  if (!v?.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: string): number | null {
  if (!v?.trim()) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Admin privileges required");
  return user;
}

async function ensureLeadBatch(fileName: string, fileHash: string, totalRows: number, userId: string) {
  const db = getDb();
  const [existing] = await db
    .select({ id: agilityImportBatches.id })
    .from(agilityImportBatches)
    .where(eq(agilityImportBatches.fileHash, fileHash))
    .limit(1);
  if (existing) return existing.id;
  const [batch] = await db
    .insert(agilityImportBatches)
    .values({ fileName, fileHash, uploadedBy: userId, rowCount: totalRows, status: "importing" })
    .returning({ id: agilityImportBatches.id });
  return batch.id;
}

export const importAgilityLeadsChunkFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      fileName: string;
      fileHash: string;
      totalRows: number;
      final: boolean;
      newCount?: number;
      updatedCount?: number;
      errorCount?: number;
      rows: AgilityLeadInput[];
    }) => data
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    if (isMockMode()) throw new Error("Agility lead import requires the database");
    const db = getDb();

    const batchId = await ensureLeadBatch(data.fileName, data.fileHash, data.totalRows, user.id);
    const now = new Date();
    let errors = 0;
    let processed = 0;

    const values: (typeof agilityLeads.$inferInsert)[] = [];
    for (const r of data.rows) {
      const entityId = Number.parseInt(r.leadEntityId || "", 10);
      if (!Number.isFinite(entityId)) {
        errors++;
        continue;
      }
      const agentRaw = r.agentName?.trim() || "";
      values.push({
        leadEntityId: entityId,
        leadNumber: r.leadNumber?.trim() || `LEAD-${entityId}`,
        leadDescription: r.leadDescription?.trim() || null,
        orderRef: extractOrderRef(r.leadDescription || ""),
        accountNumber: r.accountNumber?.trim() || null,
        accountName: r.accountName?.trim() || null,
        contactName: r.contactName?.trim() || null,
        contactEmail: r.contactEmail?.trim() || null,
        contactNumberRaw: r.contactNumber?.trim() || null,
        contactNumber: normalizePhone(r.contactNumber || ""),
        altNumberRaw: r.altNumber?.trim() || null,
        idNumber: r.idNumber?.trim() || null,
        address: r.address?.trim() || null,
        region: r.region?.trim() || null,
        latitude: numOrNull(r.latitude || ""),
        longitude: numOrNull(r.longitude || ""),
        status: r.status?.trim() || "Unknown",
        customStatus: r.customStatus?.trim() || null,
        source: r.source?.trim() || null,
        productName: r.productName?.trim() || null,
        productCode: r.productCode?.trim() || null,
        supplier: r.supplier?.trim() || null,
        recurringExcl: numOrNull(r.recurringExcl || ""),
        recurringIncl: numOrNull(r.recurringIncl || ""),
        debitOrderDay: intOrNull(r.debitOrderDay || ""),
        kycStatus: r.kycStatus?.trim() || null,
        kycRequired: r.kycRequired?.trim() ? r.kycRequired.trim().toLowerCase() === "true" : null,
        channelPartnerCode: r.channelPartnerCode?.trim() || null,
        agentNameRaw: agentRaw || null,
        agentNameKey: agentRaw ? normalizeNameKey(agentRaw) : null,
        salesAgent: r.salesAgent?.trim() || null,
        premiseId: parsePremiseId(r.premiseId || ""),
        auditCreatedDate: parseAgilityDate(r.auditCreatedDate || ""),
        originalOrderDate: parseAgilityDate(r.originalOrderDate || ""),
        submittedDate: parseAgilityDate(r.submittedDate || ""),
        assignedDate: parseAgilityDate(r.assignedDate || ""),
        auditUpdatedDate: parseAgilityDate(r.auditUpdatedDate || ""),
        expiredDate: parseAgilityDate(r.expiredDate || ""),
        nextPaymentDate: parseAgilityDate(r.nextPaymentDate || ""),
        importBatchId: batchId,
        updatedAt: now,
      });
    }

    for (let i = 0; i < values.length; i += 500) {
      const slice = values.slice(i, i + 500);
      const res = await db
        .insert(agilityLeads)
        .values(slice)
        .onConflictDoUpdate({
          target: agilityLeads.leadEntityId,
          set: {
            leadNumber: sql`excluded.lead_number`,
            leadDescription: sql`excluded.lead_description`,
            orderRef: sql`excluded.order_ref`,
            accountNumber: sql`excluded.account_number`,
            accountName: sql`excluded.account_name`,
            contactName: sql`excluded.contact_name`,
            contactEmail: sql`excluded.contact_email`,
            contactNumberRaw: sql`excluded.contact_number_raw`,
            contactNumber: sql`excluded.contact_number`,
            altNumberRaw: sql`excluded.alt_number_raw`,
            idNumber: sql`excluded.id_number`,
            address: sql`excluded.address`,
            region: sql`excluded.region`,
            latitude: sql`excluded.latitude`,
            longitude: sql`excluded.longitude`,
            status: sql`excluded.status`,
            customStatus: sql`excluded.custom_status`,
            source: sql`excluded.source`,
            productName: sql`excluded.product_name`,
            productCode: sql`excluded.product_code`,
            supplier: sql`excluded.supplier`,
            recurringExcl: sql`excluded.recurring_excl`,
            recurringIncl: sql`excluded.recurring_incl`,
            debitOrderDay: sql`excluded.debit_order_day`,
            kycStatus: sql`excluded.kyc_status`,
            kycRequired: sql`excluded.kyc_required`,
            channelPartnerCode: sql`excluded.channel_partner_code`,
            agentNameRaw: sql`excluded.agent_name_raw`,
            agentNameKey: sql`excluded.agent_name_key`,
            salesAgent: sql`excluded.sales_agent`,
            premiseId: sql`excluded.premise_id`,
            auditCreatedDate: sql`excluded.audit_created_date`,
            originalOrderDate: sql`excluded.original_order_date`,
            submittedDate: sql`excluded.submitted_date`,
            assignedDate: sql`excluded.assigned_date`,
            auditUpdatedDate: sql`excluded.audit_updated_date`,
            expiredDate: sql`excluded.expired_date`,
            nextPaymentDate: sql`excluded.next_payment_date`,
            importBatchId: sql`excluded.import_batch_id`,
            updatedAt: now,
          },
        })
        .returning({ id: agilityLeads.id });
      processed += res.length;
    }

    await ensureAgentMappings(
      db,
      values
        .filter((v) => v.agentNameKey)
        .map((v) => ({ key: v.agentNameKey!, raw: v.agentNameRaw! }))
    );

    if (data.final) {
      await db
        .update(agilityImportBatches)
        .set({
          status: "committed",
          committedAt: new Date(),
          newCount: data.newCount ?? 0,
          updatedCount: data.updatedCount ?? processed,
          errorCount: data.errorCount ?? errors,
        })
        .where(eq(agilityImportBatches.id, batchId));
    }

    return { batchId, processed, errors };
  });

// ----------------------------------------------------
// Lead stats + browser
// ----------------------------------------------------

export const getAgilityLeadStatsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isMockMode()) return { totals: null, byStatus: [], byAgent: [], dialable: 0 };
  const db = getDb();

  const totals = (await db.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'New')::int AS new_leads,
           COUNT(*) FILTER (WHERE status = 'Lost')::int AS lost,
           COUNT(*) FILTER (WHERE contact_number IS NOT NULL)::int AS dialable,
           COUNT(*) FILTER (WHERE contact_email IS NOT NULL)::int AS with_email,
           COUNT(DISTINCT account_name)::int AS accounts
    FROM agility_leads
  `)) as any[];

  const byStatus = (await db.execute(sql`
    SELECT status, COUNT(*)::int AS count FROM agility_leads GROUP BY status
  `)) as any[];

  const byAgent = (await db.execute(sql`
    SELECT COALESCE(p.full_name, l.agent_name_raw, 'Unattributed') AS agent,
           p.agent_code AS agent_code,
           COUNT(*)::int AS leads,
           COUNT(*) FILTER (WHERE l.contact_number IS NOT NULL)::int AS dialable
    FROM agility_leads l
    LEFT JOIN agility_agent_map m ON m.agent_name_key = l.agent_name_key
    LEFT JOIN profiles p ON p.id = m.profile_id
    GROUP BY agent, agent_code
    ORDER BY leads DESC
    LIMIT 50
  `)) as any[];

  return {
    totals: totals[0] ?? null,
    byStatus,
    byAgent,
    dialable: totals[0]?.dialable ?? 0,
  };
});

export const getAgilityLeadsFn = createServerFn({ method: "GET" })
  .validator(
    (data: {
      status?: string;
      agentNameKey?: string;
      search?: string;
      dialableOnly?: boolean;
      page?: number;
      pageSize?: number;
    }) => data
  )
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Unauthorized");
    if (isMockMode()) return { leads: [], total: 0 };
    const db = getDb();

    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(200, data.pageSize ?? 50);

    const conds = [];
    if (data.status) conds.push(eq(agilityLeads.status, data.status));
    if (data.agentNameKey) conds.push(eq(agilityLeads.agentNameKey, data.agentNameKey));
    if (data.dialableOnly) conds.push(sql`${agilityLeads.contactNumber} IS NOT NULL`);
    if (data.search) {
      const pat = `%${data.search}%`;
      conds.push(
        or(
          ilike(agilityLeads.accountName, pat),
          ilike(agilityLeads.leadNumber, pat),
          ilike(agilityLeads.contactName, pat),
          ilike(agilityLeads.contactEmail, pat),
          ilike(agilityLeads.contactNumber, pat),
          ilike(agilityLeads.orderRef, pat),
          ilike(agilityLeads.region, pat)
        ) as any
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const rows = await db
      .select({
        id: agilityLeads.id,
        leadNumber: agilityLeads.leadNumber,
        leadDescription: agilityLeads.leadDescription,
        orderRef: agilityLeads.orderRef,
        accountName: agilityLeads.accountName,
        contactName: agilityLeads.contactName,
        contactEmail: agilityLeads.contactEmail,
        contactNumber: agilityLeads.contactNumber,
        contactNumberRaw: agilityLeads.contactNumberRaw,
        altNumberRaw: agilityLeads.altNumberRaw,
        address: agilityLeads.address,
        region: agilityLeads.region,
        status: agilityLeads.status,
        productName: agilityLeads.productName,
        supplier: agilityLeads.supplier,
        agentNameRaw: agilityLeads.agentNameRaw,
        agentNameKey: agilityLeads.agentNameKey,
        premiseId: agilityLeads.premiseId,
        vicidialLeadId: agilityLeads.vicidialLeadId,
        auditCreatedDate: agilityLeads.auditCreatedDate,
        orderStatus: agilityOrders.status,
        orderCustomStatus: agilityOrders.customStatus,
        orderCompletedDate: agilityOrders.completedDate,
        profileName: profiles.fullName,
        profileAgentCode: profiles.agentCode,
      })
      .from(agilityLeads)
      .leftJoin(agilityOrders, eq(agilityOrders.orderRef, agilityLeads.orderRef))
      .leftJoin(agilityAgentMap, eq(agilityAgentMap.agentNameKey, agilityLeads.agentNameKey))
      .leftJoin(profiles, eq(profiles.id, agilityAgentMap.profileId))
      .where(where)
      .orderBy(desc(agilityLeads.auditCreatedDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(agilityLeads)
      .where(where);

    // Annotate each row with "already called" status:
    //  - CRM call_events (Postgres) with counts + last call
    //  - VICIdial vicidial_log via the FastAPI backend
    const pagePhones = new Set(
      rows.map((r: any) => phoneMatchKey(r.contactNumber)).filter(Boolean) as string[]
    );
    const calledMap = new Map<string, { calls: number; last: string | null; source: string }>();

    if (pagePhones.size) {
      const ceRows = (await db.execute(sql`
        SELECT regexp_replace(phone_number, '[^0-9]', '', 'g') AS digits,
               COUNT(*)::int AS calls, MAX(started_at) AS last_call
        FROM call_events
        WHERE phone_number IS NOT NULL
        GROUP BY digits
      `)) as any[];
      for (const r of ceRows) {
        const key = phoneMatchKey(r.digits);
        if (key && pagePhones.has(key)) {
          calledMap.set(key, {
            calls: r.calls,
            last: r.last_call ? new Date(r.last_call).toISOString() : null,
            source: "CRM",
          });
        }
      }

      try {
        const vici = await backendFetch<{ numbers: Array<{ phone_number: string; calls: number; last_call: string | null }> }>(
          "/api/v1/admin/vicidial/called-numbers"
        );
        for (const n of vici?.numbers ?? []) {
          const key = phoneMatchKey(n.phone_number);
          if (key && pagePhones.has(key) && !calledMap.has(key)) {
            calledMap.set(key, {
              calls: n.calls ?? 0,
              last: n.last_call ?? null,
              source: "VICIDIAL",
            });
          }
        }
      } catch {
        // VICIdial backend optional for this annotation
      }
    }

    const annotated = rows.map((r: any) => {
      const key = phoneMatchKey(r.contactNumber);
      const hit = key ? calledMap.get(key) : undefined;
      return {
        ...r,
        called: !!hit,
        callCount: hit?.calls ?? 0,
        lastCallAt: hit?.last ?? null,
        callSource: hit?.source ?? null,
      };
    });

    return { leads: annotated, total: count, page, pageSize };
  });

// ----------------------------------------------------
// Push dialable leads into VICIdial (add_lead via backend)
// ----------------------------------------------------

export const listDialableAgilityLeadIdsFn = createServerFn({ method: "GET" })
  .validator((data: { skipCalled?: boolean } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Unauthorized");
    if (isMockMode()) return { ids: [], total: 0 };
    const db = getDb();

    // "Called" detection needs the phone-match map; for id listing we only
    // exclude leads already pushed to VICIdial. skipCalled is applied client-side
    // via the annotated list if needed — here we return all unpushed dialable.
    const rows = await db
      .select({ id: agilityLeads.id })
      .from(agilityLeads)
      .where(
        and(
          sql`${agilityLeads.contactNumber} IS NOT NULL`,
          sql`${agilityLeads.vicidialLeadId} IS NULL`
        )
      );
    return { ids: rows.map((r: any) => r.id), total: rows.length };
  });

function splitName(full: string | null): { first: string; last: string } {
  const name = (full || "").trim();
  if (!name) return { first: "Lead", last: "-" };
  const i = name.indexOf(" ");
  if (i === -1) return { first: name, last: "-" };
  return { first: name.slice(0, i), last: name.slice(i + 1) || "-" };
}

export const pushAgilityLeadsChunkFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      leadIds: string[];
      listId?: string;
      crmCampaignId?: string;
      crmListName?: string;
      stageExisting?: boolean;
    }) => data
  )
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin") throw new Error("Admin privileges required");
    if (isMockMode()) throw new Error("Requires database");
    const db = getDb();

    const leads = data.leadIds.length
      ? await db
      .select({
        id: agilityLeads.id,
        phone: agilityLeads.contactNumber,
        name: agilityLeads.accountName,
        contactName: agilityLeads.contactName,
        email: agilityLeads.contactEmail,
        altRaw: agilityLeads.altNumberRaw,
        address: agilityLeads.address,
        region: agilityLeads.region,
        product: agilityLeads.productName,
      })
      .from(agilityLeads)
      .where(
        and(
          inArray(agilityLeads.id, data.leadIds.map((id) => id)),
          sql`${agilityLeads.contactNumber} IS NOT NULL`,
          sql`${agilityLeads.vicidialLeadId} IS NULL`
        )
      )
      : [];
    if (!leads.length && !data.crmCampaignId) return { synced: 0, failed: 0 };

    // Resolve (or create) the CRM lead list so pushed leads show up in
    // Lead List Management and dial stats reconcile via vicidial_lead_id.
    let crmListId: string | null = null;
    let existingListCells = new Set<string>();
    if (data.crmCampaignId) {
      const listName = (data.crmListName || "Agility Leads").trim() || "Agility Leads";
      const [existing] = await db
        .select({ id: leadLists.id })
        .from(leadLists)
        .where(and(eq(leadLists.campaignId, data.crmCampaignId), eq(leadLists.name, listName)))
        .limit(1);
      if (existing) {
        crmListId = existing.id;
      } else {
        const codeRows = (await db.execute(sql`
          select coalesce(max(substring(list_code from 3)::int), 500) + 1 as next_num
          from lead_lists where list_code ~ '^L-[0-9]+$'
        `)) as any[];
        const [created] = await db
          .insert(leadLists)
          .values({
            listCode: `L-${codeRows[0]?.next_num ?? 501}`,
            name: listName,
            campaignId: data.crmCampaignId,
            vicidialListId: data.listId ?? null,
            active: true,
          })
          .returning({ id: leadLists.id });
        crmListId = created?.id ?? null;
      }
      if (crmListId) {
        const cells = await db
          .select({ nc: leadListLeads.normalizedCell })
          .from(leadListLeads)
          .where(eq(leadListLeads.listId, crmListId));
        existingListCells = new Set(cells.map((c: any) => c.nc));

        // One-time backfill: stage Agility leads that were already pushed to
        // VICIdial in earlier runs so they appear in Lead List Management too.
        if (data.stageExisting) {
          const pushed = await db
            .select({
              phone: agilityLeads.contactNumber,
              name: agilityLeads.accountName,
              contactName: agilityLeads.contactName,
              email: agilityLeads.contactEmail,
              altRaw: agilityLeads.altNumberRaw,
              address: agilityLeads.address,
              region: agilityLeads.region,
              product: agilityLeads.productName,
              leadId: agilityLeads.vicidialLeadId,
            })
            .from(agilityLeads)
            .where(sql`${agilityLeads.vicidialLeadId} IS NOT NULL`);
          const backfill: Array<typeof leadListLeads.$inferInsert> = [];
          for (const p of pushed) {
            if (!p.phone || existingListCells.has(p.phone)) continue;
            existingListCells.add(p.phone);
            const { first, last } = splitName(p.name || p.contactName);
            backfill.push({
              listId: crmListId,
              firstName: first,
              surname: last,
              cellNumber: p.phone.startsWith("27") ? `0${p.phone.slice(2)}` : p.phone,
              normalizedCell: p.phone,
              alternateCell: sanitizeAltNumber(p.altRaw),
              email: p.email?.trim() || null,
              address: p.address?.trim() || null,
              suburb: p.region?.trim() || null,
              productPackage: p.product?.trim() || null,
              vicidialLeadId: p.leadId,
            });
          }
          for (let i = 0; i < backfill.length; i += 500) {
            await db.insert(leadListLeads).values(backfill.slice(i, i + 500));
          }
        }
      }
    }

    const base = (
      process.env["REMI_API_URL"] ||
      process.env["VICIDIAL_API_URL"] ||
      "http://127.0.0.1:8000"
    ).replace(/\/+$/, "");
    const token = process.env["REMI_API_TOKEN"] || process.env["VICIDIAL_API_TOKEN"];

    let synced = 0;
    let failed = 0;
    const now = new Date();
    const listRowsToInsert: Array<typeof leadListLeads.$inferInsert> = [];

    for (let i = 0; i < leads.length; i += 200) {
      const slice = leads.slice(i, i + 200);
      try {
        const res = await fetch(`${base}/api/v1/admin/leads/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            ...(data.listId ? { list_id: data.listId } : {}),
            leads: slice.map((l: any) => {
              const { first, last } = splitName(l.name);
              return { phone_number: l.phone, first_name: first, last_name: last };
            }),
          }),
        });
        if (!res.ok) {
          failed += slice.length;
          continue;
        }
        const payload = (await res.json()) as {
          results?: Array<{ phone_number: string; lead_id: string | null; success: boolean }>;
        };
        const byPhone = new Map((payload.results ?? []).map((r) => [r.phone_number, r]));
        for (const l of slice) {
          const r = byPhone.get(l.phone);
          if (r?.success && r.lead_id) {
            await db
              .update(agilityLeads)
              .set({ vicidialLeadId: r.lead_id, pushedAt: now, updatedAt: now })
              .where(eq(agilityLeads.id, l.id));
            if (crmListId && !existingListCells.has(l.phone)) {
              existingListCells.add(l.phone);
              const { first, last } = splitName(l.name || l.contactName);
              listRowsToInsert.push({
                listId: crmListId,
                firstName: first,
                surname: last,
                cellNumber: l.phone.startsWith("27") ? `0${l.phone.slice(2)}` : l.phone,
                normalizedCell: l.phone,
                alternateCell: sanitizeAltNumber(l.altRaw),
                email: l.email?.trim() || null,
                address: l.address?.trim() || null,
                suburb: l.region?.trim() || null,
                productPackage: l.product?.trim() || null,
                vicidialLeadId: r.lead_id,
              });
            }
            synced++;
          } else {
            failed++;
          }
        }
      } catch {
        failed += slice.length;
      }
    }

    for (let i = 0; i < listRowsToInsert.length; i += 500) {
      await db.insert(leadListLeads).values(listRowsToInsert.slice(i, i + 500));
    }

    return { synced, failed, listId: crmListId };
  });

// ----------------------------------------------------
// Sync Agility leads -> CRM customers (+ linked orders)
// ----------------------------------------------------

function splitAgilityName(full: string | null): { firstName: string; surname: string } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Unknown", surname: "Unknown" };
  if (parts.length === 1) return { firstName: parts[0]!, surname: parts[0]! };
  return { firstName: parts[0]!, surname: parts.slice(1).join(" ") };
}

function sanitizeAltNumber(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length < 9 || d.length > 11) return null;
  return d.startsWith("0") ? `27${d.slice(1)}` : d;
}

export const syncAgilityLeadsToCustomersFn = createServerFn({ method: "POST" })
  .validator((data: { batchSize?: number } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    if (isMockMode()) throw new Error("Requires database");
    const db = getDb();
    const limit = Math.min(Math.max(data.batchSize ?? 400, 50), 1000);

    // Leads not yet synced (tracked via customers.external_customer_id = 'AGL-<entityId>')
    const leads = (await db.execute(sql`
      SELECT l.id, l.lead_entity_id, l.account_name, l.contact_name, l.contact_email,
             l.contact_number, l.alt_number_raw, l.address, l.region, l.status,
             l.order_ref, l.product_name, l.agent_name_key, l.vicidial_lead_id,
             l.audit_created_date
      FROM agility_leads l
      WHERE l.contact_number IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM customers c
          WHERE c.external_customer_id = 'AGL-' || l.lead_entity_id::text
        )
      ORDER BY l.lead_entity_id
      LIMIT ${limit}
    `)) as any[];

    if (leads.length === 0) return { created: 0, skipped: 0, done: true };

    const cells = [...new Set(leads.map((l: any) => String(l.contact_number)).filter(Boolean))];
    const existingCells = cells.length
      ? await db
          .select({ nc: customers.normalizedCell })
          .from(customers)
          .where(inArray(customers.normalizedCell, cells))
      : [];
    const existingSet = new Set(existingCells.map((e: any) => e.nc));

    const agentKeys = [...new Set(leads.map((l: any) => l.agent_name_key).filter(Boolean))] as string[];
    const mapRows = agentKeys.length
      ? await db
          .select({ k: agilityAgentMap.agentNameKey, pid: agilityAgentMap.profileId })
          .from(agilityAgentMap)
          .where(inArray(agilityAgentMap.agentNameKey, agentKeys))
      : [];
    const profileByKey = new Map(mapRows.map((m: any) => [m.k, m.pid]));

    const orderRefs = [...new Set(leads.map((l: any) => l.order_ref).filter(Boolean))] as string[];
    const orderRows = orderRefs.length
      ? await db
          .select({ ref: agilityOrders.orderRef, status: agilityOrders.status, created: agilityOrders.orderCreatedDate })
          .from(agilityOrders)
          .where(inArray(agilityOrders.orderRef, orderRefs))
      : [];
    const orderByRef = new Map<string, any>(orderRows.map((o: any) => [o.ref, o]));

    let created = 0;
    let skipped = 0;
    const seen = new Set<string>();

    for (const l of leads) {
      const cell = String(l.contact_number);
      if (!cell || seen.has(cell) || existingSet.has(cell)) {
        skipped++;
        continue;
      }
      seen.add(cell);

      const linkedOrder = l.order_ref ? orderByRef.get(l.order_ref) : null;
      const custStatus =
        linkedOrder?.status === "Completed" ? "activated" : l.status === "Lost" ? "lost" : "new_lead";
      const { firstName, surname } = splitAgilityName(l.account_name || l.contact_name || "");
      const ownerId = (l.agent_name_key && profileByKey.get(l.agent_name_key)) || user.id;

      const [cust] = await db
        .insert(customers)
        .values({
          externalCustomerId: `AGL-${l.lead_entity_id}`,
          firstName,
          surname,
          fullName: (l.account_name || `${firstName} ${surname}`).trim(),
          cellNumber: cell,
          normalizedCell: cell,
          alternateCellNumber: sanitizeAltNumber(l.alt_number_raw),
          email: l.contact_email?.trim() || null,
          fullAddress: l.address?.trim() || null,
          areaSuburb: l.region?.trim() || null,
          productPackage: l.product_name?.trim() || null,
          vicidialLeadId: l.vicidial_lead_id ?? null,
          ownerId,
          originalAgentId: ownerId,
          createdBy: user.id,
          status: custStatus,
        })
        .onConflictDoNothing({ target: customers.normalizedCell })
        .returning({ id: customers.id });

      if (!cust) {
        skipped++;
        continue;
      }
      created++;

      // Mirror the linked Agility order into the CRM orders table when present.
      if (l.order_ref) {
        const isOvr = l.order_ref.startsWith("OVR");
        try {
          await db.insert(orders).values({
            customerId: cust.id,
            externalOrderId: l.order_ref,
            orderDate: l.audit_created_date ? new Date(l.audit_created_date).toISOString().slice(0, 10) : null,
            ...(isOvr ? { ovrNumber: l.order_ref } : { ovkNumber: l.order_ref }),
            status: linkedOrder?.status === "Completed" ? "activated" : "pending",
            nextAction: l.product_name ?? null,
            source: "agility",
          }).onConflictDoNothing();
        } catch {
          // order_ref collision — customer still created; order stays in agility_orders
        }
      }

      await db.insert(activities).values({
        customerId: cust.id,
        actorId: user.id,
        actionType: "Imported from Agility",
        contactMethod: "Import",
        outcome: custStatus,
        customerStatusAfter: custStatus,
        notes: `Agility lead ${l.lead_entity_id}${l.order_ref ? ` / order ${l.order_ref}` : ""}`,
      });
    }

    return { created, skipped, done: leads.length < limit };
  });

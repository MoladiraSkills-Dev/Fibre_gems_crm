import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, RefreshCw, Search, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import {
  importAgilityOrdersChunkFn,
  getAgilityAgentMapFn,
  mapAgilityAgentFn,
  setAgilityAgentStatusFn,
  getAgilityAgentDetailFn,
  quickAddAgilityAgentFn,
  getAgilityOrderStatsFn,
  getAgilityOrdersFn,
  type AgilityOrderInput,
} from "@/server/agility-order-functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ----------------------------------------------------
// CSV parsing (same tolerant parser as AgilitySync)
// ----------------------------------------------------

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      cur.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((c) => c.trim())) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  if (cur.some((c) => c.trim())) rows.push(cur);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const HEADER_MAP = {
  description: "description",
  status: "status",
  custom_status: "customStatus",
  vuma_reach_premise_id: "premiseId",
  customer: "customer",
  core_product_supplier_name: "supplier",
  contractproductname: "product",
  channel_partner_name: "channelPartner",
  channel_partner_user_name: "agentName",
  created_date: "createdDate",
  paymentreceiveddate: "paymentReceivedDate",
  completed_date: "completedDate",
} as const;

function toOrderRows(raw: Record<string, string>[]): AgilityOrderInput[] {
  return raw.map((r, i) => {
    const out: Record<string, string> = {};
    for (const [src, dst] of Object.entries(HEADER_MAP)) {
      out[dst] = r[src] ?? "";
    }
    return { rowNumber: i + 2, ...out } as AgilityOrderInput;
  });
}

async function sha(text: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

const CHUNK = 1200;
const UNMAPPED = "__unmapped__";

// ----------------------------------------------------
// Component
// ----------------------------------------------------

export function AgilityOrders() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [rows, setRows] = useState<AgilityOrderInput[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAgentKey, setFilterAgentKey] = useState("");
  const [filterProduct, setFilterProduct] = useState("");

  const filterParams = {
    ...(orderStatus ? { status: orderStatus } : {}),
    ...(filterAgentKey ? { agentNameKey: filterAgentKey } : {}),
    ...(filterDateFrom ? { dateFrom: filterDateFrom } : {}),
    ...(filterDateTo ? { dateTo: filterDateTo } : {}),
    ...(filterProduct.trim() ? { product: filterProduct.trim() } : {}),
  };

  const stats = useQuery({
    queryKey: ["agility-order-stats", filterParams],
    queryFn: async () => getAgilityOrderStatsFn({ data: filterParams }),
    refetchInterval: 60_000,
  });

  const agentMap = useQuery({
    queryKey: ["agility-agent-map"],
    queryFn: async () => getAgilityAgentMapFn(),
  });

  const orders = useQuery({
    queryKey: ["agility-orders", orderSearch, orderStatus, filterDateFrom, filterDateTo, filterAgentKey, filterProduct, orderPage],
    queryFn: async () =>
      getAgilityOrdersFn({
        data: {
          ...(orderSearch ? { search: orderSearch } : {}),
          ...filterParams,
          page: orderPage,
          pageSize: 50,
        },
      }),
  });

  const profiles = agentMap.data?.profiles ?? [];
  const agents = agentMap.data?.agents ?? [];
  const unmappedCount = agents.filter((a: any) => !a.profileId).length;

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const raw = parseCsv(text);
    const mapped = toOrderRows(raw);
    setFileName(f.name);
    setFileHash(await sha(text));
    setRows(mapped);
    setProgress({ done: 0, total: 0, errors: 0 });
    e.target.value = "";
  }

  async function runImport() {
    if (!fileName || !fileHash || !rows.length) return;
    setImporting(true);
    setProgress({ done: 0, total: rows.length, errors: 0 });
    let errors = 0;
    let processed = 0;
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const res = await importAgilityOrdersChunkFn({
          data: {
            fileName,
            fileHash,
            totalRows: rows.length,
            final: i + CHUNK >= rows.length,
            rows: slice,
          },
        });
        errors += res.errors;
        processed += res.processed;
        setProgress({ done: Math.min(processed, rows.length), total: rows.length, errors });
      }
      toast.success(`Agility orders imported: ${processed} rows${errors ? `, ${errors} skipped` : ""}`);
      void qc.invalidateQueries({ queryKey: ["agility-order-stats"] });
      void qc.invalidateQueries({ queryKey: ["agility-agent-map"] });
      void qc.invalidateQueries({ queryKey: ["agility-orders"] });
      setRows([]);
      setFileName(null);
      setFileHash(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const [addingAgent, setAddingAgent] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [defaultTeamId, setDefaultTeamId] = useState("");

  const agentDetail = useQuery({
    queryKey: ["agility-agent-detail", detailKey],
    queryFn: async () => (detailKey ? getAgilityAgentDetailFn({ data: { agentNameKey: detailKey } }) : null),
    enabled: !!detailKey,
  });

  const teams = (agentMap.data as any)?.teams ?? [];

  async function setAgentStatus(agentNameKey: string, agentStatus: "active" | "former") {
    try {
      await setAgilityAgentStatusFn({ data: { agentNameKey, agentStatus } });
      void qc.invalidateQueries({ queryKey: ["agility-agent-map"] });
      toast.success(agentStatus === "former" ? "Marked as former agent" : "Marked as active agent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function quickAddAgent(agentNameKey: string, agentNameRaw: string) {
    setAddingAgent(agentNameKey);
    try {
      const res = await quickAddAgilityAgentFn({
        data: { agentNameKey, agentNameRaw, ...(defaultTeamId ? { teamId: defaultTeamId } : {}) },
      });
      if ("alreadyLinked" in res && res.alreadyLinked) {
        toast.info("This agent is already linked to a CRM profile");
      } else if ("tempPassword" in res) {
        toast.success(
          `Agent created: ${res.agentCode} — temp password ${res.tempPassword} (share once, they must reset)`,
          { duration: 15000 }
        );
      }
      void qc.invalidateQueries({ queryKey: ["agility-agent-map"] });
      void qc.invalidateQueries({ queryKey: ["agility-order-stats"] });
      void qc.invalidateQueries({ queryKey: ["agility-orders"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create agent");
    } finally {
      setAddingAgent(null);
    }
  }

  async function assignAgent(agentNameKey: string, profileId: string) {
    try {
      await mapAgilityAgentFn({
        data: {
          agentNameKey,
          profileId: profileId === UNMAPPED ? null : profileId,
        },
      });
      void qc.invalidateQueries({ queryKey: ["agility-agent-map"] });
      void qc.invalidateQueries({ queryKey: ["agility-order-stats"] });
      void qc.invalidateQueries({ queryKey: ["agility-orders"] });
      toast.success("Agent mapping saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mapping failed");
    }
  }

  const t = stats.data?.totals;
  const totalPages = orders.data ? Math.max(1, Math.ceil(orders.data.total / (orders.data.pageSize ?? 50))) : 1;

  return (
    <section className="space-y-6">
      {/* KPI strip — click a card to filter by that status */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ["Total Orders", t?.total, ""],
          ["Completed", t?.completed, "Completed"],
          ["New", t?.new_orders, "New"],
          ["Expired", t?.expired, "Expired"],
          ["Lost", t?.lost, "Lost"],
          ["Customers", t?.customers, ""],
        ].map(([label, val, status]) => (
          <button
            key={label as string}
            onClick={() => {
              const s = status as string;
              setOrderStatus(orderStatus === s && s ? "" : s);
              setOrderPage(1);
            }}
            className={`border p-4 text-left transition-colors ${
              orderStatus === status
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-primary/50"
            }`}
          >
            <div className="text-xs uppercase text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-bold">{val ?? "—"}</div>
          </button>
        ))}
      </div>

      {/* Deep filters */}
      <div className="flex flex-wrap items-end gap-3 border border-border bg-card p-4">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">From</label>
          <Input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setOrderPage(1); }} className="h-9 w-40" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">To</label>
          <Input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setOrderPage(1); }} className="h-9 w-40" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Agent</label>
          <Select value={filterAgentKey || "all"} onValueChange={(v) => { setFilterAgentKey(v === "all" ? "" : v); setOrderPage(1); }}>
            <SelectTrigger className="h-9 w-52 text-sm"><SelectValue placeholder="All agents" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {(agentMap.data?.agents ?? []).map((a: any) => (
                <SelectItem key={a.agentNameKey} value={a.agentNameKey}>{a.agentNameRaw}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Product</label>
          <Input value={filterProduct} onChange={(e) => { setFilterProduct(e.target.value); setOrderPage(1); }} placeholder="e.g. FTTR" className="h-9 w-44" />
        </div>
        {(orderStatus || filterDateFrom || filterDateTo || filterAgentKey || filterProduct) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setOrderStatus(""); setFilterDateFrom(""); setFilterDateTo(""); setFilterAgentKey(""); setFilterProduct(""); setOrderPage(1); }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Upload */}
      <div className="border border-border bg-card p-6">
        <h2 className="text-xl font-bold">Agility Order Ledger</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the daily Agility fibre-order report (CSV). Orders are upserted by order reference —
          re-uploading newer files just refreshes statuses. Agent names are matched to CRM profiles
          automatically where possible; unmapped names appear in the review table below.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={pick} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
            <FileUp className="mr-2 size-4" /> Choose CSV
          </Button>
          {fileName && (
            <span className="text-sm text-muted-foreground">
              {fileName} — {rows.length.toLocaleString()} rows
            </span>
          )}
          {rows.length > 0 && (
            <Button onClick={runImport} disabled={importing}>
              {importing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
              {importing ? `Importing ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}…` : "Import orders"}
            </Button>
          )}
          {importing && (
            <div className="h-2 w-64 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${rows.length ? (progress.done / rows.length) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>
        {progress.errors > 0 && (
          <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
            <AlertTriangle className="size-4" /> {progress.errors} rows skipped (no OVR/OVK reference)
          </p>
        )}
      </div>

      {/* Agent mapping review */}
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <Users className="size-4" /> Agent name mapping
            {unmappedCount > 0 && (
              <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
                {unmappedCount} unmapped
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {teams.length > 0 && (
              <Select value={defaultTeamId || "none"} onValueChange={(v) => setDefaultTeamId(v === "none" ? "" : v)}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="Team for new agents" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No team</SelectItem>
                  {teams.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void qc.invalidateQueries({ queryKey: ["agility-agent-map"] })}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
        <div className="max-h-[380px] overflow-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="sticky top-0 bg-muted/60 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Agility name</th>
                <th className="px-4 py-3">CRM agent</th>
                <th className="px-4 py-3">Orders</th>
                <th className="px-4 py-3">Match</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a: any) => (
                <tr
                  key={a.id}
                  className={`cursor-pointer border-t border-border hover:bg-muted/30 ${detailKey === a.agentNameKey ? "bg-muted/40" : ""}`}
                  onClick={() => setDetailKey(detailKey === a.agentNameKey ? null : a.agentNameKey)}
                >
                  <td className="px-4 py-2.5 font-medium">
                    {a.agentNameRaw}
                    {a.teamName ? <span className="ml-1 text-xs text-muted-foreground">· {a.teamName}</span> : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <Select
                      value={a.profileId ?? UNMAPPED}
                      onValueChange={(v) => void assignAgent(a.agentNameKey, v)}
                    >
                      <SelectTrigger className="h-8 w-56 text-xs">
                        <SelectValue placeholder="Unmapped" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNMAPPED}>— Unmapped —</SelectItem>
                        {profiles.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.fullName}
                            {p.agentCode ? ` (${p.agentCode})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2.5">{a.orderCount}</td>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {a.matchType === "auto" ? (
                        <span className="text-success">auto</span>
                      ) : a.matchType === "manual" ? (
                        <span className="text-primary">manual</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertTriangle className="size-3.5" /> unmatched
                        </span>
                      )}
                      {!a.profileId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          disabled={addingAgent === a.agentNameKey}
                          onClick={() => void quickAddAgent(a.agentNameKey, a.agentNameRaw)}
                        >
                          {addingAgent === a.agentNameKey ? "Adding…" : "Quick add"}
                        </Button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={a.agentStatus ?? "active"}
                      onValueChange={(v) => void setAgentStatus(a.agentNameKey, v as "active" | "former")}
                    >
                      <SelectTrigger className="h-7 w-24 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="former">Former</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
              {agents.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    No agent names imported yet — upload an Agility report first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Click any agent row for the full KPI detail. Use Status → Former for departed agents.
        </p>
      </div>

      {/* Agent KPI detail */}
      {detailKey && (
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h3 className="font-semibold">
              {agentDetail.data?.agent?.agentNameRaw ?? "Agent detail"}
              {agentDetail.data?.agent?.profileName ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  → {agentDetail.data.agent.profileName}
                  {agentDetail.data.agent.profileAgentCode ? ` (${agentDetail.data.agent.profileAgentCode})` : ""}
                  {agentDetail.data.agent.teamName ? ` · ${agentDetail.data.agent.teamName}` : ""}
                </span>
              ) : (
                <span className="ml-2 text-sm font-normal text-muted-foreground">— not in CRM</span>
              )}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setDetailKey(null)}>
              Close
            </Button>
          </div>
          {agentDetail.isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : agentDetail.data ? (
            <AgentDetailBody d={agentDetail.data} />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">No data for this agent.</p>
          )}
        </div>
      )}

      {/* Order browser */}
      <div className="border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <h3 className="font-semibold">Orders</h3>
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={orderSearch}
              onChange={(e) => {
                setOrderSearch(e.target.value);
                setOrderPage(1);
              }}
              placeholder="Search name, order ref, premise…"
              className="h-8 w-64 pl-8 text-sm"
            />
          </div>
          <Select
            value={orderStatus || "all"}
            onValueChange={(v) => {
              setOrderStatus(v === "all" ? "" : v);
              setOrderPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["New", "Completed", "Expired", "Lost"].map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="sticky top-0 bg-muted/60 text-xs uppercase text-muted-foreground">
              <tr>
                {["Order", "Customer", "Agent", "Product", "Status", "Placed", "Completed"].map((h) => (
                  <th key={h} className="px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(orders.data?.orders ?? []).map((o: any) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-mono text-xs">{o.orderRef}</td>
                  <td className="px-4 py-2.5">{o.customerName ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {o.profileName ?? o.agentNameRaw ?? "—"}
                    {o.profileAgentCode ? ` · ${o.profileAgentCode}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{o.product ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        o.status === "Completed"
                          ? "bg-success/15 text-success"
                          : o.status === "New"
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {o.status}
                    </span>
                    {o.customStatus ? (
                      <span className="ml-1 text-xs text-muted-foreground">· {o.customStatus}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {o.orderCreatedDate ? new Date(o.orderCreatedDate).toLocaleDateString("en-ZA") : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {o.completedDate ? new Date(o.completedDate).toLocaleDateString("en-ZA") : "—"}
                  </td>
                </tr>
              ))}
              {(orders.data?.orders.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    {orders.isLoading ? "Loading…" : "No orders found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border p-3 text-sm text-muted-foreground">
          <span>
            {orders.data ? `${orders.data.total.toLocaleString()} orders` : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={orderPage <= 1} onClick={() => setOrderPage((p) => p - 1)}>
              Prev
            </Button>
            <span>
              {orderPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={orderPage >= totalPages}
              onClick={() => setOrderPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------
// Agent KPI detail body
// ----------------------------------------------------

function AgentDetailBody({ d }: { d: any }) {
  const os = d.orderStats;
  const ls = d.leadStats;
  const cs = d.callStats;
  const maxMonth = Math.max(1, ...(d.orderByMonth ?? []).map((m: any) => m.orders));

  return (
    <div className="space-y-5 p-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ["Orders", os?.total],
          ["Completed", os?.completed],
          ["In Progress", os?.new_orders],
          ["Leads", ls?.total],
          ["Dialable", ls?.dialable],
          ["Converted", ls?.converted],
        ].map(([label, val]) => (
          <div key={label as string} className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-xl font-bold">{val ?? "—"}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Order funnel */}
        <div className="rounded-lg border border-border p-4">
          <h4 className="mb-3 text-sm font-semibold">Order funnel</h4>
          <div className="space-y-1.5 text-sm">
            {[
              ["Completed", os?.completed, "text-success"],
              ["New / in progress", os?.new_orders, "text-primary"],
              ["Expired", os?.expired, "text-muted-foreground"],
              ["Lost", os?.lost, "text-muted-foreground"],
            ].map(([label, val, cls]) => (
              <div key={label as string} className="flex justify-between">
                <span className="text-muted-foreground">{label}</span>
                <span className={`font-semibold ${cls}`}>{val ?? 0}</span>
              </div>
            ))}
            <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
              {os?.customers ?? 0} customers · {os?.premises ?? 0} premises
              {os?.first_order ? ` · first order ${new Date(os.first_order).toLocaleDateString("en-ZA")}` : ""}
            </div>
          </div>
        </div>

        {/* Monthly trend */}
        <div className="rounded-lg border border-border p-4">
          <h4 className="mb-3 text-sm font-semibold">Orders by month</h4>
          <div className="max-h-40 space-y-1.5 overflow-auto">
            {(d.orderByMonth ?? []).map((m: any) => (
              <div key={m.month} className="space-y-0.5">
                <div className="flex justify-between text-xs">
                  <span>{m.month}</span>
                  <span className="text-muted-foreground">
                    {m.orders} orders · {m.completed} done
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${(m.orders / maxMonth) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {(d.orderByMonth ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">No order history</p>
            )}
          </div>
        </div>

        {/* Calls (if CRM-linked) */}
        <div className="rounded-lg border border-border p-4">
          <h4 className="mb-3 text-sm font-semibold">CRM call activity</h4>
          {cs ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Calls logged</span>
                <span className="font-semibold">{cs.calls ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Talk time</span>
                <span className="font-semibold">
                  {Math.round((cs.talk_seconds ?? 0) / 60)} min
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Conversions</span>
                <span className="font-semibold text-success">{cs.conversions ?? 0}</span>
              </div>
              {cs.last_call ? (
                <div className="text-xs text-muted-foreground">
                  Last call {new Date(cs.last_call).toLocaleString("en-ZA")}
                </div>
              ) : null}
              {(cs.dispositions ?? []).length > 0 && (
                <div className="mt-2 border-t border-border pt-2">
                  {(cs.dispositions ?? []).slice(0, 5).map((x: any) => (
                    <div key={x.d} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{x.d}</span>
                      <span>{x.c}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No linked CRM profile — call stats appear once this agent is quick-added or mapped.
            </p>
          )}
        </div>
      </div>

      {/* Top products + recent records */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h4 className="mb-3 text-sm font-semibold">Top products</h4>
          <div className="space-y-1 text-sm">
            {(d.topProducts ?? []).map((p: any) => (
              <div key={p.product} className="flex justify-between">
                <span className="truncate text-muted-foreground">{p.product}</span>
                <span className="font-medium">{p.orders}</span>
              </div>
            ))}
            {(d.topProducts ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">—</p>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <h4 className="mb-3 text-sm font-semibold">Recent orders</h4>
          <div className="max-h-44 space-y-1 overflow-auto text-sm">
            {(d.recentOrders ?? []).map((o: any) => (
              <div key={o.orderRef} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono">{o.orderRef}</span>
                <span className="truncate text-muted-foreground">{o.customerName ?? ""}</span>
                <span>{o.status}</span>
                <span className="text-muted-foreground">
                  {o.orderCreatedDate ? new Date(o.orderCreatedDate).toLocaleDateString("en-ZA") : ""}
                </span>
              </div>
            ))}
            {(d.recentOrders ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">No orders</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

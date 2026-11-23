import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Search, TrendingUp } from "lucide-react";
import { getAgilityOrderStatsFn, getAgilityOrdersFn } from "@/server/agility-order-functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_OPTIONS = ["Completed", "New", "Expired", "Lost"];

export function OrderStatsView() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [status, setStatus] = useState("");
  const [product, setProduct] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filterParams = {
    ...(status ? { status } : {}),
    ...(agentKey ? { agentNameKey: agentKey } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(product.trim() ? { product: product.trim() } : {}),
  };

  const stats = useQuery({
    queryKey: ["agility-order-stats", "team", filterParams],
    queryFn: async () => getAgilityOrderStatsFn({ data: filterParams }),
    refetchInterval: 60_000,
  });

  const orders = useQuery({
    queryKey: ["agility-orders", "team", search, filterParams, page],
    queryFn: async () =>
      getAgilityOrdersFn({
        data: { ...filterParams, ...(search ? { search } : {}), page, pageSize: 50 },
      }),
  });

  const t = stats.data?.totals;
  const byAgent = (stats.data?.byAgent ?? []) as any[];
  const byMonth = (stats.data?.byMonth ?? []) as any[];
  const maxMonth = Math.max(1, ...byMonth.map((m) => m.orders));
  const totalPages = orders.data ? Math.max(1, Math.ceil(orders.data.total / (orders.data.pageSize ?? 50))) : 1;

  function resetPage() {
    setPage(1);
  }

  function toggleStatus(s: string) {
    setStatus((cur) => (cur === s ? "" : s));
    resetPage();
  }

  function pickMonth(month: string) {
    const [y, m] = month.split("-");
    const last = new Date(Date.UTC(+y!, +m!, 0)).toISOString().slice(0, 10);
    setDateFrom(`${y}-${m}-01`);
    setDateTo(last);
    resetPage();
  }

  const hasFilters = !!(status || agentKey || dateFrom || dateTo || product || search);

  return (
    <section className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <label className="mb-1 block text-[11px] uppercase text-white/50">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetPage(); }} className="h-9 w-40 border-white/10 bg-white/5 text-white" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase text-white/50">To</label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetPage(); }} className="h-9 w-40 border-white/10 bg-white/5 text-white" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase text-white/50">Agent</label>
          <Select value={agentKey || "all"} onValueChange={(v) => { setAgentKey(v === "all" ? "" : v); resetPage(); }}>
            <SelectTrigger className="h-9 w-52 border-white/10 bg-white/5 text-white"><SelectValue placeholder="All agents" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {byAgent.filter((a) => a.agent_name_key).map((a) => (
                <SelectItem key={a.agent_name_key} value={a.agent_name_key}>
                  {a.agent}
                  {a.agent_code ? ` (${a.agent_code})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase text-white/50">Status</label>
          <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); resetPage(); }}>
            <SelectTrigger className="h-9 w-36 border-white/10 bg-white/5 text-white"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase text-white/50">Product</label>
          <Input value={product} onChange={(e) => { setProduct(e.target.value); resetPage(); }} placeholder="e.g. FTTR" className="h-9 w-36 border-white/10 bg-white/5 text-white" />
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-white/40" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); resetPage(); }} placeholder="Name, ref, premise…" className="h-9 w-56 border-white/10 bg-white/5 pl-8 text-white" />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-white/60"
            onClick={() => { setStatus(""); setAgentKey(""); setDateFrom(""); setDateTo(""); setProduct(""); setSearch(""); resetPage(); }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* KPI strip — click to filter by status */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ["Team Orders", t?.total, ""],
          ["Completed", t?.completed, "Completed"],
          ["In Progress", t?.new_orders, "New"],
          ["Expired", t?.expired, "Expired"],
          ["Lost", t?.lost, "Lost"],
          ["Customers", t?.customers, ""],
        ].map(([label, val, s]) => (
          <button
            key={label as string}
            onClick={() => s && toggleStatus(s as string)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              status === s
                ? "border-[#F5B021]/60 bg-[#F5B021]/10"
                : "border-white/10 bg-white/[0.03] hover:border-white/30"
            }`}
          >
            <div className="text-[11px] uppercase tracking-wide text-white/50">{label}</div>
            <div className="mt-1 text-2xl font-bold text-white">{val ?? "—"}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Per-agent orders — click a row to filter */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <h3 className="flex items-center gap-2 border-b border-white/10 p-4 text-sm font-semibold text-white">
            <Package className="size-4 text-[#F5B021]" /> Orders by agent
          </h3>
          <div className="max-h-[380px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#121212] text-[11px] uppercase text-white/50">
                <tr>
                  <th className="px-4 py-2.5">Agent</th>
                  <th className="px-4 py-2.5">Orders</th>
                  <th className="px-4 py-2.5">Completed</th>
                  <th className="px-4 py-2.5">Live</th>
                  <th className="px-4 py-2.5">Dead</th>
                </tr>
              </thead>
              <tbody>
                {byAgent.map((a, i) => (
                  <tr
                    key={i}
                    onClick={() => {
                      setAgentKey((cur) => (cur === a.agent_name_key ? "" : a.agent_name_key));
                      resetPage();
                    }}
                    className={`cursor-pointer border-t border-white/5 ${agentKey === a.agent_name_key ? "bg-[#F5B021]/10" : "hover:bg-white/5"}`}
                  >
                    <td className="px-4 py-2.5 text-white/90">
                      {a.agent}
                      {a.agent_code ? <span className="ml-1 text-xs text-white/40">{a.agent_code}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-white">{a.orders}</td>
                    <td className="px-4 py-2.5 text-emerald-400">{a.completed}</td>
                    <td className="px-4 py-2.5 text-[#F5B021]">{a.new_orders}</td>
                    <td className="px-4 py-2.5 text-white/50">{a.dead}</td>
                  </tr>
                ))}
                {byAgent.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-white/40">
                      {stats.isLoading ? "Loading…" : "No Agility orders match the current filters"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly trend — click a month to filter that period */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <h3 className="flex items-center gap-2 border-b border-white/10 p-4 text-sm font-semibold text-white">
            <TrendingUp className="size-4 text-[#F5B021]" /> Orders by month
          </h3>
          <div className="max-h-[380px] space-y-2 overflow-auto p-4">
            {byMonth.map((m) => {
              const [y, mo] = m.month.split("-");
              const isActive = dateFrom === `${y}-${mo}-01`;
              return (
                <button
                  key={m.month}
                  onClick={() => pickMonth(m.month)}
                  className={`block w-full space-y-1 rounded p-1 text-left transition-colors ${isActive ? "bg-[#F5B021]/10" : "hover:bg-white/5"}`}
                >
                  <div className="flex justify-between text-xs">
                    <span className="text-white/70">{m.month}</span>
                    <span className="text-white/50">
                      {m.orders} orders · {m.completed} completed
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-white/10">
                    <div
                      className="h-full rounded bg-gradient-to-r from-[#E07C2A] to-[#F5B021]"
                      style={{ width: `${(m.orders / maxMonth) * 100}%` }}
                    />
                  </div>
                </button>
              );
            })}
            {byMonth.length === 0 && (
              <p className="py-8 text-center text-sm text-white/40">
                {stats.isLoading ? "Loading…" : "No order history for these filters"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Drill-down order table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03]">
        <h3 className="flex items-center gap-2 border-b border-white/10 p-4 text-sm font-semibold text-white">
          <Package className="size-4 text-[#F5B021]" /> Orders
          <span className="ml-auto text-xs font-normal text-white/40">
            {orders.data ? `${orders.data.total.toLocaleString()} matching` : ""}
          </span>
        </h3>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#121212] text-[11px] uppercase text-white/50">
              <tr>
                {["Order", "Customer", "Agent", "Product", "Status", "Created"].map((h) => (
                  <th key={h} className="px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(orders.data?.orders ?? []).map((o: any) => (
                <tr key={o.id} className="border-t border-white/5">
                  <td className="px-4 py-2 font-mono text-xs text-white/80">{o.orderRef ?? "—"}</td>
                  <td className="px-4 py-2 text-white/90">{o.customerName ?? "—"}</td>
                  <td className="px-4 py-2 text-white/70">{o.profileName ?? o.agentNameRaw ?? "—"}</td>
                  <td className="px-4 py-2 text-white/60">{o.product ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={o.status === "Completed" ? "text-emerald-400" : o.status === "New" ? "text-[#F5B021]" : "text-white/50"}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-white/50">
                    {o.orderCreatedDate ? new Date(o.orderCreatedDate).toLocaleDateString("en-ZA") : "—"}
                  </td>
                </tr>
              ))}
              {(orders.data?.orders.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-white/40">
                    {orders.isLoading ? "Loading…" : "No orders match the current filters"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 p-3 text-sm text-white/50">
          <span>Page {page} / {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

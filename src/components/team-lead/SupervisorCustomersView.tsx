import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Users,
  Phone,
  MapPin,
  Calendar,
  Clock,
  FileText,
  Play,
  X,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Filter,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSupervisorCustomersFn,
  getSupervisorCustomer360Fn,
  type SupervisorCustomer,
  type Customer360Result,
} from "@/server/supervisor-functions";
import { formatDuration } from "./AgentStatusCard";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "new_lead", label: "New Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "callback", label: "Callback Scheduled" },
  { value: "payment_pending", label: "Payment Pending" },
  { value: "sale", label: "Sale" },
  { value: "activated", label: "Activated" },
  { value: "dnc", label: "Do Not Call" },
];

function statusColor(status: string) {
  switch (status.toLowerCase()) {
    case "sale":
    case "activated":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
    case "payment_pending":
      return "border-amber-500/40 bg-amber-500/10 text-amber-400";
    case "callback":
      return "border-blue-500/40 bg-blue-500/10 text-blue-400";
    case "dnc":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "border-white/10 bg-white/5 text-white/70";
  }
}

export function SupervisorCustomersView({
  onPlayRecording,
  initialCustomerId,
}: {
  onPlayRecording?: (recording: { id: string; customer_name: string; agent_name: string; disposition: string }) => void;
  initialCustomerId?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(initialCustomerId ?? null);

  useEffect(() => {
    if (initialCustomerId) {
      setSelectedCustomerId(initialCustomerId);
    }
  }, [initialCustomerId]);

  const queryKey = ["supervisor-customers", { search, statusFilter, page, pageSize }];
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      getSupervisorCustomersFn({
        data: {
          search: search.trim() || undefined,
          status: statusFilter || undefined,
          page,
          page_size: pageSize,
        },
      }),
  });

  const c360Query = useQuery({
    queryKey: ["customer-360", selectedCustomerId],
    queryFn: () =>
      selectedCustomerId ? getSupervisorCustomer360Fn({ data: { customer_id: selectedCustomerId } }) : null,
    enabled: Boolean(selectedCustomerId),
  });

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  return (
    <div className="space-y-6">
      {/* Header & Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="size-5 text-[#F5B021]" />
            <span>Customer Directory & 360° Intelligence</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Full view of all customer accounts, owner agents, call recordings, and audit trails.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, phone, suburb..."
              className="h-10 pl-9 bg-card border-border text-xs text-white"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="size-4 text-white/40" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-border bg-card px-3 text-xs text-white"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Customers Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
            Loading customer accounts...
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-xs text-destructive">
            {error instanceof Error ? error.message : "Failed to load customers."}
          </div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted-foreground">
            No customers match the current search or status filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-white/[0.02] text-muted-foreground uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Suburb</th>
                  <th className="px-4 py-3">Package</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assigned Agent</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {customers.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCustomerId(c.id)}
                    className="cursor-pointer transition hover:bg-white/[0.04]"
                  >
                    <td className="px-4 py-3.5 font-semibold text-white">
                      {c.full_name || `${c.first_name} ${c.surname}`}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-white/80">{c.cell_number}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{c.area_suburb || "—"}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{c.product_package || "—"}</td>
                    <td className="px-4 py-3.5">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${statusColor(c.status)}`}>
                        {c.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-white/90">
                      {c.assigned_agent?.full_name ? (
                        <span className="font-medium text-[#F5B021]">{c.assigned_agent.full_name}</span>
                      ) : (
                        <span className="text-muted-foreground/60">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCustomerId(c.id);
                        }}
                        className="h-7 text-xs text-[#F5B021] hover:bg-[#F5B021]/15"
                      >
                        <span>360° Profile</span>
                        <ExternalLink className="ml-1.5 size-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span>
            Total <strong className="text-white">{total}</strong> accounts (Page {page} of {totalPages})
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 gap-1 text-xs"
            >
              <ChevronLeft className="size-3.5" />
              <span>Prev</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 gap-1 text-xs"
            >
              <span>Next</span>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Customer 360 Slide-over Modal / Drawer */}
      {selectedCustomerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-[#0d0d0d] p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>Customer 360° View</span>
                  {c360Query.data?.customer && (
                    <span
                      className={`rounded border px-2 py-0.5 text-xs font-semibold ${statusColor(
                        c360Query.data.customer.status,
                      )}`}
                    >
                      {c360Query.data.customer.status.replace(/_/g, " ")}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground">Comprehensive profile, call logs, and customer journey.</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedCustomerId(null)}
                className="text-white/60 hover:text-white"
              >
                <X className="size-5" />
              </Button>
            </div>

            {c360Query.isLoading ? (
              <div className="p-12 text-center text-xs text-muted-foreground animate-pulse">
                Loading complete customer 360 records...
              </div>
            ) : c360Query.isError ? (
              <div className="p-6 text-xs text-destructive">
                Could not load customer 360 profile.
              </div>
            ) : c360Query.data ? (
              <div className="mt-6 space-y-6">
                {/* Profile Card */}
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#F5B021]">Account Details</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Full Name:</span>
                      <p className="font-semibold text-white">{c360Query.data.customer.full_name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cell Number:</span>
                      <p className="font-mono text-white">{c360Query.data.customer.cell_number}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Email:</span>
                      <p className="text-white">{c360Query.data.customer.email || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Area / Suburb:</span>
                      <p className="text-white">{c360Query.data.customer.area_suburb || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Package:</span>
                      <p className="text-white">{c360Query.data.customer.product_package || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Payment Type:</span>
                      <p className="text-white">{c360Query.data.customer.payment_type || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">EasyPay Number:</span>
                      <p className="font-mono text-white">{c360Query.data.customer.easypay_number || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Assigned Agent:</span>
                      <p className="font-semibold text-[#F5B021]">
                        {c360Query.data.assigned_agent?.full_name || "Unassigned"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Call History */}
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#F5B021] flex items-center justify-between">
                    <span>Call History ({c360Query.data.call_history.length})</span>
                  </h4>
                  {c360Query.data.call_history.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No telephony call events recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {c360Query.data.call_history.map((call) => (
                        <div
                          key={call.id}
                          className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white">
                                {call.disposition || call.status || "Call"}
                              </span>
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {formatDuration(call.duration_seconds)}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {call.started_at ? new Date(call.started_at).toLocaleString() : "Date unknown"}
                              {call.notes ? ` · ${call.notes}` : ""}
                            </p>
                          </div>
                          {call.recording_url && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                onPlayRecording?.({
                                  id: call.id,
                                  customer_name: c360Query.data.customer.full_name,
                                  agent_name: c360Query.data.assigned_agent?.full_name || "Agent",
                                  disposition: call.disposition || "Call",
                                });
                              }}
                              className="h-8 gap-1.5 text-xs text-[#F5B021] border-[#F5B021]/30 hover:bg-[#F5B021]/15"
                            >
                              <Play className="size-3 fill-current" />
                              <span>Play Audio</span>
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Activity Trail */}
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#F5B021]">
                    Activity Trail ({c360Query.data.activity_logs.length})
                  </h4>
                  {c360Query.data.activity_logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No activity log entries recorded.</p>
                  ) : (
                    <div className="space-y-2">
                      {c360Query.data.activity_logs.map((act) => (
                        <div
                          key={act.id}
                          className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white">{act.action_type}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {act.created_at ? new Date(act.created_at).toLocaleString() : ""}
                            </span>
                          </div>
                          {act.notes && <p className="text-white/80">{act.notes}</p>}
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>Actor: {act.actor_name}</span>
                            {act.outcome && <span>· Outcome: {act.outcome}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

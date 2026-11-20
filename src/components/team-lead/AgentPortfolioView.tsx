import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Users,
  Clock,
  Award,
  Calendar,
  ChevronRight,
  TrendingUp,
  UserCheck,
  Mail,
  Phone,
  Shield,
  X,
  Play,
  ExternalLink,
  MapPin,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getAllAgentsFn,
  getAgentPortfolioFn,
  getSupervisorCustomer360Fn,
  type AgentPortfolioResult,
} from "@/server/supervisor-functions";
import { formatDuration } from "./AgentStatusCard";

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

export function AgentPortfolioView({
  onSelectCustomer,
  onPlayRecording,
  initialAgentId,
}: {
  onSelectCustomer?: (customerId: string) => void;
  onPlayRecording?: (recording: { id: string; customer_name: string; agent_name: string; disposition: string }) => void;
  initialAgentId?: string;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(initialAgentId ?? "");
  const [modalCustomerId, setModalCustomerId] = useState<string | null>(null);

  const allAgentsQuery = useQuery({
    queryKey: ["supervisor-all-agents"],
    queryFn: () => getAllAgentsFn(),
  });

  const allAgents = (allAgentsQuery.data ?? []).filter(
    (a) =>
      !a.agent_code?.startsWith("TML") &&
      !a.agent_code?.startsWith("SUP") &&
      !a.full_name?.toLowerCase().includes("fibre gems"),
  );

  useEffect(() => {
    if (!selectedAgentId && allAgents.length > 0) {
      const defaultAgent =
        allAgents.find(
          (a) =>
            a.full_name.toUpperCase().includes("MM MUSIA") ||
            a.full_name.toUpperCase().includes("MUKONA") ||
            a.agent_code?.startsWith("AGT"),
        ) || allAgents[0];
      if (defaultAgent?.id) {
        setSelectedAgentId(defaultAgent.id);
      }
    }
  }, [allAgents, selectedAgentId]);

  useEffect(() => {
    if (initialAgentId) setSelectedAgentId(initialAgentId);
  }, [initialAgentId]);

  const portfolioQuery = useQuery({
    queryKey: ["agent-portfolio", selectedAgentId],
    queryFn: () => (selectedAgentId ? getAgentPortfolioFn({ data: { agent_id: selectedAgentId } }) : null),
    enabled: Boolean(selectedAgentId),
  });

  const c360Query = useQuery({
    queryKey: ["customer-360-modal", modalCustomerId],
    queryFn: () =>
      modalCustomerId ? getSupervisorCustomer360Fn({ data: { customer_id: modalCustomerId } }) : null,
    enabled: Boolean(modalCustomerId),
  });

  const portfolio = portfolioQuery.data;

  return (
    <div className="space-y-6">
      {/* Header and Agent Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Briefcase className="size-5 text-[#F5B021]" />
            <span>Agent Portfolio &amp; Performance Audit</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Examine individual agent customer books, pipeline ownership, and productivity metrics.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground">Select Agent:</label>
          {allAgentsQuery.isLoading ? (
            <div className="h-10 w-48 animate-pulse rounded-lg border border-border bg-card" />
          ) : (
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-white min-w-[220px]"
            >
              {allAgents.length === 0 && (
                <option value="">No agents found</option>
              )}
              {allAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name} ({a.agent_code ?? "—"})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {portfolioQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl border border-border bg-card" />
          ))}
        </div>
      ) : portfolioQuery.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive">
          {portfolioQuery.error instanceof Error
            ? portfolioQuery.error.message
            : "Could not load agent portfolio."}
        </div>
      ) : portfolio ? (
        <div className="space-y-6">
          {/* Agent Profile & Details Card */}
          <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-card via-card to-white/[0.03] p-5 shadow-lg">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#E07C2A] to-[#F5B021] text-lg font-bold text-black shadow-md shadow-[#F5B021]/15">
                  {portfolio.agent.full_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-bold text-white">{portfolio.agent.full_name}</h3>
                    <span className="rounded-full border border-[#F5B021]/40 bg-[#F5B021]/15 px-2.5 py-0.5 text-[11px] font-mono font-bold text-[#F5B021]">
                      {portfolio.agent.agent_code || "AGT"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Active Agent
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Mail className="size-3.5 text-white/50" />
                      <span className="text-white/80">{portfolio.agent.email || "—"}</span>
                    </span>
                    {portfolio.agent.phone_login && (
                      <span className="flex items-center gap-1.5">
                        <Phone className="size-3.5 text-white/50" />
                        <span>Phone Login: <strong className="text-white/90 font-mono">{portfolio.agent.phone_login}</strong></span>
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <Shield className="size-3.5 text-white/50" />
                      <span className="capitalize text-white/70">{portfolio.agent.role.replace(/_/g, " ")}</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-right">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Assigned Portfolio</span>
                  <p className="text-sm font-bold text-[#F5B021]">{portfolio.customers.length} Accounts</p>
                </div>
              </div>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs uppercase font-medium">Assigned Customers</span>
                <Users className="size-4 text-[#F5B021]" />
              </div>
              <p className="mt-2 text-2xl font-bold text-white tabular-nums">
                {portfolio.metrics.total_assigned_customers}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Book of accounts</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs uppercase font-medium">Talk Time</span>
                <Clock className="size-4 text-cyan-400" />
              </div>
              <p className="mt-2 text-2xl font-bold text-cyan-300 tabular-nums">
                {formatDuration(portfolio.metrics.total_talk_time_seconds)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Across {portfolio.metrics.total_calls_logged} calls</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs uppercase font-medium">Closed Sales</span>
                <Award className="size-4 text-emerald-400" />
              </div>
              <p className="mt-2 text-2xl font-bold text-emerald-400 tabular-nums">
                {portfolio.metrics.sales_closed}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Confirmed deals</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs uppercase font-medium">Pending Callbacks</span>
                <Calendar className="size-4 text-amber-400" />
              </div>
              <p className="mt-2 text-2xl font-bold text-amber-300 tabular-nums">
                {portfolio.metrics.callbacks_pending}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Follow-ups required</p>
            </div>
          </div>

          {/* Status Breakdown Pills */}
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/80 flex items-center gap-2">
              <TrendingUp className="size-4 text-[#F5B021]" />
              <span>Customer Status Distribution</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(portfolio.metrics.status_breakdown).length === 0 ? (
                <span className="text-xs text-muted-foreground">No accounts assigned yet.</span>
              ) : (
                Object.entries(portfolio.metrics.status_breakdown).map(([status, count]) => (
                  <div
                    key={status}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white"
                  >
                    <span className="capitalize">{status.replace(/_/g, " ")}:</span>
                    <strong className="text-[#F5B021] tabular-nums">{count}</strong>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Assigned Customers Table */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border bg-white/[0.02] px-4 py-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Assigned Accounts ({portfolio.customers.length})
              </h3>
              <span className="text-[11px] text-muted-foreground">
                Click any row or button to view complete 360° details
              </span>
            </div>
            {portfolio.customers.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                This agent has no assigned customers in their portfolio.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-white/[0.02] text-muted-foreground uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Package</th>
                      <th className="px-4 py-3">Next Action</th>
                      <th className="px-4 py-3">Assigned Agent</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {portfolio.customers.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => setModalCustomerId(c.id)}
                        className="cursor-pointer transition hover:bg-white/[0.04]"
                      >
                        <td className="px-4 py-3 font-semibold text-white">{c.full_name}</td>
                        <td className="px-4 py-3 font-mono text-white/80">{c.cell_number}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${statusColor(c.status)}`}>
                            {c.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{c.product_package || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {c.next_action_date ? c.next_action_date.slice(0, 10) : c.next_action || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 font-medium text-[#F5B021]">
                            <UserCheck className="size-3" />
                            <span>{portfolio.agent.full_name}</span>
                            <span className="text-[10px] font-mono text-white/40">({portfolio.agent.agent_code})</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setModalCustomerId(c.id);
                            }}
                            className="h-7 text-xs text-[#F5B021] hover:bg-[#F5B021]/15"
                          >
                            <span>360° View</span>
                            <ChevronRight className="ml-1 size-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Seamless Customer 360 Slide-over Modal / Drawer */}
      {modalCustomerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-[#0d0d0d] p-6 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>Customer 360° Profile</span>
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
                <p className="text-xs text-muted-foreground">
                  Complete customer records, call recordings, and ownership audit.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setModalCustomerId(null)}
                className="text-white/60 hover:text-white"
              >
                <X className="size-5" />
              </Button>
            </div>

            {c360Query.isLoading ? (
              <div className="p-12 text-center text-xs text-muted-foreground animate-pulse">
                Loading complete customer records...
              </div>
            ) : c360Query.isError ? (
              <div className="p-6 text-xs text-destructive">
                Could not load customer 360 profile.
              </div>
            ) : c360Query.data ? (
              <div className="mt-6 space-y-6">
                {/* Account Details Card */}
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#F5B021] flex items-center gap-1.5">
                    <FileText className="size-3.5" />
                    <span>Account Details</span>
                  </h4>
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
                    <div className="rounded-lg border border-[#F5B021]/20 bg-[#F5B021]/5 p-2">
                      <span className="text-muted-foreground">Assigned Agent:</span>
                      <p className="font-semibold text-[#F5B021] flex items-center gap-1.5 mt-0.5">
                        <UserCheck className="size-3.5" />
                        <span>{c360Query.data.assigned_agent?.full_name || portfolio?.agent.full_name || "Unassigned"}</span>
                        {(c360Query.data.assigned_agent?.agent_code || portfolio?.agent.agent_code) && (
                          <span className="text-[10px] font-mono text-white/50">
                            ({c360Query.data.assigned_agent?.agent_code || portfolio?.agent.agent_code})
                          </span>
                        )}
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
                                  agent_name: c360Query.data.assigned_agent?.full_name || portfolio?.agent.full_name || "Agent",
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

                {/* Action buttons in modal */}
                {onSelectCustomer && (
                  <div className="pt-2 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const id = modalCustomerId;
                        setModalCustomerId(null);
                        onSelectCustomer(id);
                      }}
                      className="text-xs gap-1.5 text-muted-foreground hover:text-white"
                    >
                      <span>Open in Directory Drawer</span>
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

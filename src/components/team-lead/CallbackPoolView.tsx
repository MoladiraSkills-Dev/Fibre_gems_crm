import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  X,
  Play,
  UserCheck,
  FileText,
  ExternalLink,
  ChevronRight,
  Phone,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getTeamCallbacksFn, reassignCallbacksFn } from "@/server/team-lead-functions";
import { getSupervisorCustomer360Fn } from "@/server/supervisor-functions";
import { formatDuration } from "./AgentStatusCard";

type Tab = "overdue" | "today" | "upcoming";

const TABS: { id: Tab; label: string }[] = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Due today" },
  { id: "upcoming", label: "Upcoming" },
];

const selectClass = "mt-1 h-10 w-full border border-input bg-background px-3 text-sm";

function todayInJohannesburg() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function bucketOf(date: string | null, today: string): Tab {
  const day = (date ?? "").slice(0, 10);
  if (day < today) return "overdue";
  if (day === today) return "today";
  return "upcoming";
}

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

export function CallbackPoolView({
  onViewCustomer,
  onPlayRecording,
}: {
  onViewCustomer?: (customerId: string) => void;
  onPlayRecording?: (recording: { id: string; customer_name: string; agent_name: string; disposition: string }) => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overdue");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [targetAgentId, setTargetAgentId] = useState("");
  const [modalCustomerId, setModalCustomerId] = useState<string | null>(null);
  const today = todayInJohannesburg();

  const query = useQuery({
    queryKey: ["team-callbacks"],
    queryFn: () => getTeamCallbacksFn(),
  });

  const c360Query = useQuery({
    queryKey: ["customer-360-callback-modal", modalCustomerId],
    queryFn: () =>
      modalCustomerId ? getSupervisorCustomer360Fn({ data: { customer_id: modalCustomerId } }) : null,
    enabled: Boolean(modalCustomerId),
  });

  const reassign = useMutation({
    mutationFn: (vars: { customerIds: string[]; targetAgentId: string }) =>
      reassignCallbacksFn({ data: vars }),
    onSuccess: (res) => {
      toast.success(`Reassigned ${res.reassigned} callback${res.reassigned === 1 ? "" : "s"}`);
      setSelected(new Set());
      setTargetAgentId("");
      setReassignOpen(false);
      void qc.invalidateQueries({ queryKey: ["team-callbacks"] });
      void qc.invalidateQueries({ queryKey: ["crm-workspace"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Reassignment failed"),
  });

  const callbacks = query.data?.callbacks ?? [];
  const agents = query.data?.agents ?? [];
  const agentName = new Map(agents.map((a) => [a.id, a.full_name]));
  const agentCodeMap = new Map(agents.map((a) => [a.id, a.agent_code]));

  const counts: Record<Tab, number> = { overdue: 0, today: 0, upcoming: 0 };
  for (const c of callbacks) counts[bucketOf(c.next_action_date, today)] += 1;

  const shown = callbacks.filter((c) => bucketOf(c.next_action_date, today) === tab);
  const allShownSelected = shown.length > 0 && shown.every((c) => selected.has(c.id));

  function switchTab(next: Tab) {
    setTab(next);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of shown) {
        if (allShownSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-full border border-border bg-card p-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {label} ({counts[id]})
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <Button onClick={() => setReassignOpen(true)}>Reassign selected</Button>
          </div>
        )}
      </div>

      {query.isPending && <p className="text-sm text-muted-foreground">Loading callbacks…</p>}

      {query.isError && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Could not load callbacks."}
        </p>
      )}

      {query.isSuccess && shown.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No callbacks in this list.
        </p>
      )}

      {query.isSuccess && shown.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    aria-label="Select all callbacks in this list"
                    checked={allShownSelected}
                    onChange={toggleAllShown}
                  />
                </th>
                <th className="p-3">Customer</th>
                <th className="p-3">Phone</th>
                <th className="hidden p-3 md:table-cell">Suburb</th>
                <th className="hidden p-3 lg:table-cell">Package</th>
                <th className="hidden p-3 lg:table-cell">Status</th>
                <th className="p-3">Assigned agent</th>
                <th className="p-3">Scheduled</th>
                <th className="hidden p-3 xl:table-cell">Notes</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const assignedName = agentName.get(c.owner_id);
                const assignedCode = agentCodeMap.get(c.owner_id);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setModalCustomerId(c.id)}
                    className="border-b border-border last:border-0 hover:bg-muted/40 cursor-pointer transition"
                  >
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.full_name}`}
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                      />
                    </td>
                    <td className="p-3 font-semibold text-foreground">{c.full_name}</td>
                    <td className="p-3 font-mono text-muted-foreground">{c.cell_number}</td>
                    <td className="hidden p-3 text-muted-foreground md:table-cell">{c.area_suburb ?? "—"}</td>
                    <td className="hidden p-3 text-muted-foreground lg:table-cell">
                      {(c as any).product_package ?? "—"}
                    </td>
                    <td className="hidden p-3 lg:table-cell">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${statusColor(String((c as any).status ?? "callback"))}`}>
                        {String((c as any).status ?? "callback").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3">
                      {assignedName ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-[#F5B021]">
                          <UserCheck className="size-3" />
                          <span>{assignedName}</span>
                          {assignedCode && (
                            <span className="text-[10px] font-mono text-muted-foreground">({assignedCode})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">Unassigned</span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground font-mono text-xs">
                      {c.next_action_date?.slice(0, 10) ?? "—"}
                    </td>
                    <td className="hidden p-3 text-muted-foreground xl:table-cell">{c.next_action ?? "—"}</td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setModalCustomerId(c.id)}
                        className="h-7 text-xs text-[#F5B021] hover:bg-[#F5B021]/15"
                      >
                        <span>360° View</span>
                        <ChevronRight className="ml-1 size-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Seamless Customer 360 Slide-over Modal / Drawer */}
      {modalCustomerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-[#0d0d0d] p-6 shadow-2xl text-white">
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
                  Callback account history, call recordings, and assignment status.
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
                        <span>{c360Query.data.assigned_agent?.full_name || agentName.get(c360Query.data.customer.owner_id ?? "") || "Unassigned"}</span>
                        {(c360Query.data.assigned_agent?.agent_code || agentCodeMap.get(c360Query.data.customer.owner_id ?? "")) && (
                          <span className="text-[10px] font-mono text-white/50">
                            ({c360Query.data.assigned_agent?.agent_code || agentCodeMap.get(c360Query.data.customer.owner_id ?? "")})
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

                {/* Navigation Link to Directory Drawer */}
                {onViewCustomer && (
                  <div className="pt-2 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const id = modalCustomerId;
                        setModalCustomerId(null);
                        onViewCustomer(id);
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

      {/* Reassign Dialog */}
      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reassign {selected.size} callback{selected.size === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>
          <label htmlFor="reassign_agent" className="text-sm font-medium text-foreground">
            Move to agent
          </label>
          <select
            id="reassign_agent"
            className={selectClass}
            value={targetAgentId}
            onChange={(e) => setTargetAgentId(e.target.value)}
          >
            <option value="">Select an agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
                {a.agent_code ? ` (${a.agent_code})` : ""}
              </option>
            ))}
          </select>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReassignOpen(false)}
              disabled={reassign.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={!targetAgentId || reassign.isPending}
              onClick={() =>
                reassign.mutate({ customerIds: [...selected], targetAgentId })
              }
            >
              {reassign.isPending ? "Reassigning…" : "Confirm reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

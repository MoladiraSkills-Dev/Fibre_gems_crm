import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileSpreadsheet,
  PhoneCall,
  History,
  Search,
  Filter,
  Play,
  ChevronLeft,
  ChevronRight,
  User,
  Calendar,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSupervisorCallLogsFn,
  getSupervisorActivityLogsFn,
  type CallLogItem,
  type ActivityLogItem,
} from "@/server/supervisor-functions";
import { formatDuration } from "./AgentStatusCard";

const DISPOSITION_OPTIONS = [
  { value: "", label: "All Dispositions" },
  { value: "SALE", label: "Sale" },
  { value: "CALLBACK", label: "Callback Scheduled" },
  { value: "PAYMENT_PROMISED", label: "Payment Promised" },
  { value: "NI", label: "Not Interested" },
  { value: "DNC", label: "Do Not Call" },
];

export function FloorLogsView({
  onPlayRecording,
}: {
  onPlayRecording?: (recording: { id: string; customer_name: string; agent_name: string; disposition: string }) => void;
}) {
  const [subTab, setSubTab] = useState<"calls" | "activity">("calls");

  // Call Logs state
  const [callSearch, setCallSearch] = useState("");
  const [callDispo, setCallDispo] = useState("");
  const [callPage, setCallPage] = useState(1);
  const pageSize = 20;

  // Activity Logs state
  const [actPage, setActPage] = useState(1);

  const callLogsQuery = useQuery({
    queryKey: ["supervisor-call-logs", { callSearch, callDispo, callPage }],
    queryFn: () =>
      getSupervisorCallLogsFn({
        data: {
          search: callSearch.trim() || undefined,
          disposition: callDispo || undefined,
          page: callPage,
          page_size: pageSize,
        },
      }),
    enabled: subTab === "calls",
  });

  const activityLogsQuery = useQuery({
    queryKey: ["supervisor-activity-logs", { actPage }],
    queryFn: () =>
      getSupervisorActivityLogsFn({
        data: {
          page: actPage,
          page_size: pageSize,
        },
      }),
    enabled: subTab === "activity",
  });

  const calls = callLogsQuery.data?.calls ?? [];
  const callsTotal = callLogsQuery.data?.total ?? 0;
  const callsTotalPages = callLogsQuery.data?.total_pages ?? 1;

  const activities = activityLogsQuery.data?.activities ?? [];
  const actTotal = activityLogsQuery.data?.total ?? 0;
  const actTotalPages = activityLogsQuery.data?.total_pages ?? 1;

  return (
    <div className="space-y-6">
      {/* Top Header & Sub-Tab Switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-[#F5B021]" />
            <span>Telephony Logs & Operational Audit Trail</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Full audit log of every call dialed, answered, and workflow action taken across the floor.
          </p>
        </div>

        <div className="flex items-center rounded-xl border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setSubTab("calls")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              subTab === "calls"
                ? "bg-[#F5B021] text-black shadow"
                : "text-white/60 hover:text-white"
            }`}
          >
            <PhoneCall className="size-3.5" />
            <span>Call Logs</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab("activity")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              subTab === "activity"
                ? "bg-[#F5B021] text-black shadow"
                : "text-white/60 hover:text-white"
            }`}
          >
            <History className="size-3.5" />
            <span>Activity Trail</span>
          </button>
        </div>
      </div>

      {/* Sub-Tab 1: Call Logs */}
      {subTab === "calls" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
              <Input
                value={callSearch}
                onChange={(e) => {
                  setCallSearch(e.target.value);
                  setCallPage(1);
                }}
                placeholder="Search phone number..."
                className="h-10 pl-9 bg-card border-border text-xs text-white"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="size-4 text-white/40" />
              <select
                value={callDispo}
                onChange={(e) => {
                  setCallDispo(e.target.value);
                  setCallPage(1);
                }}
                className="h-10 rounded-lg border border-border bg-card px-3 text-xs text-white"
              >
                {DISPOSITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {callLogsQuery.isLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
                Loading call records...
              </div>
            ) : callLogsQuery.isError ? (
              <div className="p-8 text-center text-xs text-destructive">Failed to load call logs.</div>
            ) : calls.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground">No call logs recorded.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-white/[0.02] text-muted-foreground uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Agent</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Duration</th>
                      <th className="px-4 py-3">Disposition / Status</th>
                      <th className="px-4 py-3">Notes</th>
                      <th className="px-4 py-3">Date / Time</th>
                      <th className="px-4 py-3 text-right">Recording</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {calls.map((c) => (
                      <tr key={c.id} className="transition hover:bg-white/[0.04]">
                        <td className="px-4 py-3 font-semibold text-[#F5B021]">{c.agent_name}</td>
                        <td className="px-4 py-3 font-medium text-white">{c.customer_name}</td>
                        <td className="px-4 py-3 font-mono text-white/80">{c.phone_number}</td>
                        <td className="px-4 py-3 font-mono text-white/90">
                          {formatDuration(c.duration_seconds)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white">
                            {c.disposition || c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                          {c.notes || "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {c.started_at ? new Date(c.started_at).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {c.recording_url ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                onPlayRecording?.({
                                  id: c.id,
                                  customer_name: c.customer_name,
                                  agent_name: c.agent_name,
                                  disposition: c.disposition || "Call",
                                })
                              }
                              className="h-7 gap-1 text-xs text-[#F5B021] border-[#F5B021]/30 hover:bg-[#F5B021]/15"
                            >
                              <Play className="size-3 fill-current" />
                              <span>Listen</span>
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/40">No audio</span>
                          )}
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
                Total <strong className="text-white">{callsTotal}</strong> calls (Page {callPage} of{" "}
                {callsTotalPages})
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={callPage <= 1}
                  onClick={() => setCallPage((p) => Math.max(1, p - 1))}
                  className="h-8 gap-1 text-xs"
                >
                  <ChevronLeft className="size-3.5" />
                  <span>Prev</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={callPage >= callsTotalPages}
                  onClick={() => setCallPage((p) => p + 1)}
                  className="h-8 gap-1 text-xs"
                >
                  <span>Next</span>
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 2: Activity Trail */}
      {subTab === "activity" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {activityLogsQuery.isLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
              Loading audit trail...
            </div>
          ) : activityLogsQuery.isError ? (
            <div className="p-8 text-center text-xs text-destructive">Failed to load activity logs.</div>
          ) : activities.length === 0 ? (
            <div className="p-12 text-center text-xs text-muted-foreground">No activity log entries recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-white/[0.02] text-muted-foreground uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Action Type</th>
                    <th className="px-4 py-3">Outcome</th>
                    <th className="px-4 py-3">Status After</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {activities.map((a) => (
                    <tr key={a.id} className="transition hover:bg-white/[0.04]">
                      <td className="px-4 py-3 font-semibold text-[#F5B021]">{a.actor_name}</td>
                      <td className="px-4 py-3 font-medium text-white">{a.customer_name}</td>
                      <td className="px-4 py-3 text-white/90">{a.action_type}</td>
                      <td className="px-4 py-3">
                        {a.outcome ? (
                          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white">
                            {a.outcome}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {a.customer_status_after || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                        {a.notes || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {a.created_at ? new Date(a.created_at).toLocaleString() : "—"}
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
              Total <strong className="text-white">{actTotal}</strong> audit logs (Page {actPage} of{" "}
              {actTotalPages})
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={actPage <= 1}
                onClick={() => setActPage((p) => Math.max(1, p - 1))}
                className="h-8 gap-1 text-xs"
              >
                <ChevronLeft className="size-3.5" />
                <span>Prev</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={actPage >= actTotalPages}
                onClick={() => setActPage((p) => p + 1)}
                className="h-8 gap-1 text-xs"
              >
                <span>Next</span>
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

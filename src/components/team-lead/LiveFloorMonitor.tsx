import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getLiveAgentsFn,
  hangupAgentFn,
  pauseAgentFn,
  resumeAgentFn,
  startSupervisionFn,
  stopSupervisionFn,
  type LiveAgent,
} from "@/server/supervisor-functions";
import { AgentStatusCard, type AgentAction } from "./AgentStatusCard";
import { getStoredTeamLeadSettings } from "./TeamLeadSettings";
import { useTelephonySocket } from "@/components/telephony/use-telephony-socket";
import { DraggableCallDock, type DockSession } from "./DraggableCallDock";

const LIVE_QUERY_KEY = ["supervisor-live-agents"];

function successMessage(action: AgentAction, supervisorExt: string) {
  switch (action.kind) {
    case "monitor":
      if (action.mode === "LISTEN") return `Connecting silent monitor on your extension ${supervisorExt}...`;
      if (action.mode === "WHISPER") return `Connecting whisper coaching on your extension ${supervisorExt}...`;
      return `Connecting barge conference on your extension ${supervisorExt}...`;
    case "pause":
      return `Agent ${action.agent.full_name} has been remotely paused.`;
    case "resume":
      return `Agent ${action.agent.full_name} has been resumed.`;
    case "hangup":
      return `Call for ${action.agent.full_name} has been terminated.`;
  }
}

async function runAction(action: AgentAction, supervisorExt: string): Promise<unknown> {
  switch (action.kind) {
    case "monitor":
      return await startSupervisionFn({
        data: {
          target_agent_extension: action.agent.agent_code,
          supervisor_extension: supervisorExt,
          mode: action.mode,
        },
      });
    case "pause":
      return await pauseAgentFn({ data: { agent_code: action.agent.agent_code, pause_code: "SUPERVISOR" } });
    case "resume":
      return await resumeAgentFn({ data: { agent_code: action.agent.agent_code } });
    case "hangup":
      return await hangupAgentFn({
        data: { agent_code: action.agent.agent_code, reason: "Supervisor terminated call" },
      });
  }
}

export function LiveFloorMonitor() {
  const qc = useQueryClient();
  const [supervisorExt, setSupervisorExt] = useState("101");
  const [dockSession, setDockSession] = useState<DockSession | null>(null);

  useEffect(() => {
    setSupervisorExt(getStoredTeamLeadSettings().supervisorExtension || "101");
  }, []);

  const liveQuery = useQuery({
    queryKey: LIVE_QUERY_KEY,
    queryFn: () => getLiveAgentsFn(),
    refetchInterval: 4_000,   // snappy 4s polling fallback
    staleTime: 2_000,
  });

  type FloorData = Awaited<ReturnType<typeof getLiveAgentsFn>>;
  type FloorAgentState = {
    agent_code?: string;
    call_state?: string;
    duration_seconds?: number;
    callerid?: string;
    pause_code?: string;
    active_customer?: { customer_id: string; full_name: string; phone: string; suburb: string } | null;
  };
  type FloorEvent = {
    type?: string;
    summary?: { in_call?: number; paused?: number };
    agent_states?: FloorAgentState[];
  };

  const onFloorEvent = useCallback((event: FloorEvent) => {
    if (event.type && event.type !== "FLOOR_UPDATE") return;
    if (!event.agent_states?.length && !event.summary) return;

    qc.setQueryData<FloorData>(LIVE_QUERY_KEY, (previous) => {
      if (!previous) return previous;
      const agents = previous.agents.map((agent) => {
        const delta = event.agent_states?.find((s) => s.agent_code?.toLowerCase() === agent.agent_code?.toLowerCase());
        if (!delta) return agent;
        const callState = delta.call_state ?? "idle";
        const isIncall = callState === "connected" || callState === "ringing" || callState === "dialing";
        const isPaused = callState === "paused";
        const nextStatus = isIncall ? ("INCALL" as const) : isPaused ? ("PAUSED" as const) : ("READY" as const);
        return {
          ...agent,
          status: nextStatus,
          seconds_in_state: Math.max(0, Math.floor(delta.duration_seconds ?? 0)),
          active_customer: delta.active_customer ?? (isIncall ? agent.active_customer : null),
          pause_code: delta.pause_code ?? (isPaused ? agent.pause_code : null),
        };
      });
      const inCallCount = agents.filter((a) => a.status === "INCALL").length;
      const pausedCount = agents.filter((a) => a.status === "PAUSED").length;
      const readyCount = Math.max(0, agents.length - inCallCount - pausedCount);
      return {
        summary: {
          total_logged_in: agents.length,
          in_call: inCallCount,
          ready: readyCount,
          paused: pausedCount,
        },
        agents,
      };
    });
  }, [qc]);

  const floorSocket = useTelephonySocket<FloorEvent>({ path: "ws/floor", onMessage: onFloorEvent });

  const action = useMutation({
    mutationFn: (act: AgentAction) => runAction(act, supervisorExt),
    onSuccess: (_res, vars) => {
      toast.success(successMessage(vars, supervisorExt));
      if (vars.kind === "monitor") {
        setDockSession({ kind: "live", agent: vars.agent, mode: vars.mode, durationSeconds: 0 });
      }
      void qc.invalidateQueries({ queryKey: LIVE_QUERY_KEY });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Supervisor action failed"),
  });

  function handleAction(next: AgentAction) {
    if (next.kind === "hangup" && !window.confirm(`Force hang up the call for ${next.agent.full_name}?`)) return;
    action.mutate(next);
  }

  async function closeDock() {
    if (dockSession?.kind === "live") {
      await stopSupervisionFn({ data: { supervisor_extension: supervisorExt } });
      toast.success("Monitoring disconnected");
    }
    setDockSession(null);
  }

  async function changeMonitorMode(mode: "LISTEN" | "WHISPER" | "BARGE") {
    if (dockSession?.kind !== "live") return;
    await startSupervisionFn({
      data: {
        target_agent_extension: dockSession.agent.agent_code,
        supervisor_extension: supervisorExt,
        mode,
      },
    });
    setDockSession((current) => current?.kind === "live" ? { ...current, mode } : current);
    toast.success(`Monitoring mode changed to ${mode}`);
  }

  if (liveQuery.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-48 animate-pulse rounded-2xl border border-border bg-card" />
        ))}
      </div>
    );
  }

  if (liveQuery.isError) {
    return (
      <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {liveQuery.error instanceof Error ? liveQuery.error.message : "Could not load the live floor."}
      </p>
    );
  }

  const { summary, agents } = liveQuery.data;

  // Highlight priority: IN CALL first, then READY, then PAUSED, with Team Leader clearly designated
  const sortedAgents = [...agents].sort((a, b) => {
    const priority = (ag: LiveAgent) => {
      if (ag.status === "INCALL") return 0;
      if (ag.status === "READY") return 1;
      if (ag.status === "PAUSED") return 2;
      return 3;
    };
    return priority(a) - priority(b);
  });

  const tiles = [
    { label: "Logged in", value: summary.total_logged_in, className: "text-foreground" },
    { label: "In call", value: summary.in_call, className: "text-emerald-400 font-bold" },
    { label: "Ready", value: summary.ready, className: "text-cyan-300" },
    { label: "On pause", value: summary.paused, className: "text-amber-300" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <span className={`size-2 rounded-full ${floorSocket.status === "connected" ? "bg-success" : "bg-warning animate-pulse"}`} />
        {floorSocket.status === "connected" ? "Live floor connected" : floorSocket.status === "connecting" ? "Connecting to live floor…" : "Reconnecting to live floor…"}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.className}`}>{t.value}</p>
          </div>
        ))}
      </div>

      {sortedAgents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No agents are logged in right now.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedAgents.map((agent, idx) => (
            <AgentStatusCard
              key={agent.agent_id || agent.agent_code || `agent-${idx}`}
              agent={agent}
              pending={action.isPending}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
      {dockSession && <DraggableCallDock session={dockSession} onClose={closeDock} onModeChange={changeMonitorMode} />}
    </div>
  );
}

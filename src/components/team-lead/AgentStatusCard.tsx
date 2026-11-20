import { useState, useEffect } from "react";
import type { LiveAgent } from "@/server/supervisor-functions";
import { Button } from "@/components/ui/button";

export type AgentAction =
  | { kind: "monitor"; agent: LiveAgent; mode: "LISTEN" | "WHISPER" | "BARGE" }
  | { kind: "pause"; agent: LiveAgent }
  | { kind: "resume"; agent: LiveAgent }
  | { kind: "hangup"; agent: LiveAgent };

const STATUS_BADGE: Record<LiveAgent["status"], { label: string; className: string }> = {
  INCALL: { label: "In call", className: "border-emerald-500/50 bg-emerald-500/15 text-emerald-400" },
  READY: { label: "Ready", className: "border-cyan-500/50 bg-cyan-500/15 text-cyan-300" },
  PAUSED: { label: "Paused", className: "border-amber-500/50 bg-amber-500/15 text-amber-300" },
  DEAD: { label: "Finalising", className: "border-red-500/50 bg-red-500/15 text-red-400" },
};

const PAUSE_WARNING_SECONDS = 15 * 60;
const CALL_WARNING_SECONDS = 25 * 60;

export function formatDuration(totalSeconds?: number | null) {
  const num = Number(totalSeconds);
  if (isNaN(num) || num <= 0) return "00:00";
  const s = Math.floor(num);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

function maskPhone(phone: string) {
  return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ****`;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AgentStatusCard({
  agent,
  pending,
  onAction,
}: {
  agent: LiveAgent;
  pending: boolean;
  onAction: (action: AgentAction) => void;
}) {
  const badge = STATUS_BADGE[agent.status];
  const secInState = Number(agent.seconds_in_state) || 0;
  const [localSec, setLocalSec] = useState(secInState);

  // Sync with incoming poll updates
  useEffect(() => {
    setLocalSec(secInState);
  }, [secInState]);

  // Tick elapsed time smoothly every second ONLY if agent is in a call or on pause
  useEffect(() => {
    if (agent.status !== "INCALL" && agent.status !== "PAUSED") return;
    const timer = setInterval(() => {
      setLocalSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [agent.status]);

  const isTeamLeader = Boolean(
    agent.is_team_leader ||
    agent.role === "team_leader" ||
    agent.agent_code?.toUpperCase().startsWith("TML")
  );

  const overThreshold =
    (agent.status === "PAUSED" && localSec > PAUSE_WARNING_SECONDS) ||
    (agent.status === "INCALL" && localSec > CALL_WARNING_SECONDS);
  const badgeLabel =
    agent.status === "PAUSED" && agent.pause_code ? `Paused · ${agent.pause_code}` : badge.label;
  const inCall = agent.status === "INCALL";

  return (
    <article
      className={`flex flex-col gap-4 rounded-2xl border p-4 backdrop-blur-xl transition-all ${
        inCall
          ? "border-emerald-500/50 bg-emerald-500/10 shadow-lg shadow-emerald-500/5 ring-1 ring-emerald-500/30"
          : overThreshold
          ? "border-amber-500/50 bg-amber-500/10"
          : "border-border bg-card"
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
            {initials(agent.full_name || "MUKONA")}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold text-foreground">{agent.full_name || "MUKONA"}</p>
              {isTeamLeader && (
                <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  Team Leader
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {agent.agent_code && agent.agent_code !== "fg_api"
                ? `Agent ID: ${agent.agent_code}`
                : `Ext ${agent.extension || "101"}`}
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
          {badgeLabel}
        </span>
      </header>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Time in state</span>
        <span
          className={`font-mono font-semibold tabular-nums ${
            inCall
              ? "text-emerald-400 font-bold"
              : overThreshold
              ? "animate-pulse text-amber-300"
              : "text-foreground"
          }`}
        >
          {formatDuration(localSec)}
        </span>
      </div>

      {inCall && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          {agent.active_customer ? (
            <>
              <p className="font-medium text-foreground">{agent.active_customer.full_name}</p>
              <p className="text-xs text-muted-foreground">
                {maskPhone(agent.active_customer.phone)} · {agent.active_customer.suburb}
              </p>
            </>
          ) : (
            <p className="font-medium text-emerald-400">Active live call in progress</p>
          )}
        </div>
      )}

      {!isTeamLeader && (
        <div className="flex flex-wrap gap-2 pt-1">
          {inCall && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction({ kind: "monitor", agent, mode: "LISTEN" })}>
                Listen
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction({ kind: "monitor", agent, mode: "WHISPER" })}>
                Whisper
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction({ kind: "monitor", agent, mode: "BARGE" })}>
                Barge
              </Button>
              <Button size="sm" variant="destructive" disabled={pending} onClick={() => onAction({ kind: "hangup", agent })}>
                Force hang up
              </Button>
            </>
          )}
          {agent.status === "PAUSED" && (
            <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-400" disabled={pending} onClick={() => onAction({ kind: "resume", agent })}>
              Resume
            </Button>
          )}
          {agent.status === "READY" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction({ kind: "pause", agent })}>
              Force pause
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Clock, Award, ChevronDown, ChevronUp, Briefcase, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAgentStatsFn, getAgentPortfolioFn } from "@/server/supervisor-functions";
import { formatDuration } from "./AgentStatusCard";

export function AgentLeaderboardView({
  onViewPortfolio,
}: {
  onViewPortfolio?: (agentId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: stats = [], isLoading } = useQuery({
    queryKey: ["supervisor-agent-stats"],
    queryFn: () => getAgentStatsFn(),
    refetchInterval: 30000,
  });

  // Portfolio for expanded row — uses agent_id directly from stats
  const { data: portfolio, isLoading: portfolioLoading } = useQuery({
    queryKey: ["agent-portfolio", expandedId],
    queryFn: () =>
      expandedId ? getAgentPortfolioFn({ data: { agent_id: expandedId } }) : null,
    enabled: Boolean(expandedId),
  });

  // Strictly filter out non-agent roles (team leaders, supervisors, admins)
  const agentStats = stats.filter(
    (s) =>
      !s.agent_code?.startsWith("TML") &&
      !s.agent_code?.startsWith("SUP") &&
      !s.full_name?.toLowerCase().includes("fibre gems"),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white">
          Agent Shift Performance &amp; Leaderboard
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Daily dials, talk time, sales conversions, and QA score per agent. Click any row to
          inspect their customer book and performance audit.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : agentStats.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#121212]/95 p-8 text-center text-muted-foreground text-sm">
          No agent activity recorded yet today.
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-[#121212]/95 overflow-hidden backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 bg-white/5 text-muted-foreground">
                <tr>
                  <th className="py-3 px-4 font-semibold">Rank</th>
                  <th className="py-3 px-4 font-semibold">Agent</th>
                  <th className="py-3 px-4 font-semibold text-center">Dials Today</th>
                  <th className="py-3 px-4 font-semibold text-center">Contacts</th>
                  <th className="py-3 px-4 font-semibold text-center">Sales</th>
                  <th className="py-3 px-4 font-semibold text-center">Conversion</th>
                  <th className="py-3 px-4 font-semibold text-center">Total Talk Time</th>
                  <th className="py-3 px-4 font-semibold text-center">Avg QA Score</th>
                  <th className="py-3 px-4 font-semibold text-center">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/90">
                {agentStats.map((stat, idx) => {
                  const isTop = idx === 0;
                  // Use agent_id from stats directly (populated by backend)
                  const agentId = stat.agent_id ?? null;
                  const isExpanded = expandedId !== null && expandedId === agentId;
                  const totalSec = Number(stat.talk_seconds) || 0;
                  const mins = Math.floor(totalSec / 60);
                  const hrs = Math.floor(mins / 60);
                  const formattedTime = `${hrs.toString().padStart(2, "0")}:${(mins % 60).toString().padStart(2, "0")}`;

                  return (
                    <Fragment key={agentId ?? stat.agent_code}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : (agentId ?? null))}
                        className="hover:bg-white/5 transition cursor-pointer"
                      >
                        <td className="py-3 px-4 font-bold">
                          {isTop ? (
                            <span className="flex items-center gap-1.5 text-[#F5B021]">
                              <Trophy className="size-4" /> #1
                            </span>
                          ) : (
                            <span className="text-muted-foreground">#{idx + 1}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{stat.full_name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {stat.agent_code}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-medium">
                          {stat.calls_placed}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-[#06B6D4] font-medium">
                          {stat.contacts}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-[#22C55E]">
                          {stat.sales}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="inline-flex rounded-full bg-[#22C55E]/15 px-2.5 py-0.5 font-bold text-[#22C55E]">
                            {stat.conversion_rate_percent}%
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-white/80">
                          {formattedTime}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {stat.average_qa_score !== null ? (
                            <span className="inline-flex items-center gap-1 font-bold text-[#F5B021]">
                              <Award className="size-3.5" />
                              {stat.average_qa_score}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {isExpanded ? (
                            <ChevronUp className="size-4 mx-auto text-[#F5B021]" />
                          ) : (
                            <ChevronDown className="size-4 mx-auto text-white/40" />
                          )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${agentId}-detail`} className="bg-white/[0.02]">
                          <td colSpan={9} className="px-6 py-5">
                            {portfolioLoading ? (
                              <div className="animate-pulse text-xs text-muted-foreground">
                                Loading agent details…
                              </div>
                            ) : portfolio ? (
                              <div className="space-y-4">
                                {/* Header */}
                                <div className="flex items-center justify-between">
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#F5B021] flex items-center gap-2">
                                    <Briefcase className="size-3.5" />
                                    {portfolio.agent.full_name} — Portfolio Overview
                                  </h4>
                                  {agentId && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onViewPortfolio?.(agentId);
                                      }}
                                      className="h-7 text-xs text-[#F5B021] border-[#F5B021]/30 hover:bg-[#F5B021]/10"
                                    >
                                      Full Portfolio →
                                    </Button>
                                  )}
                                </div>

                                {/* KPIs */}
                                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs md:grid-cols-4">
                                  <div>
                                    <span className="text-muted-foreground flex items-center gap-1">
                                      <Users className="size-3" /> Assigned Customers
                                    </span>
                                    <p className="font-bold text-white text-base">
                                      {portfolio.metrics.total_assigned_customers}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground flex items-center gap-1">
                                      <Clock className="size-3" /> Talk Time
                                    </span>
                                    <p className="font-bold text-cyan-300 text-base">
                                      {formatDuration(portfolio.metrics.total_talk_time_seconds)}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Sales Closed</span>
                                    <p className="font-bold text-emerald-400 text-base">
                                      {portfolio.metrics.sales_closed}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Callbacks Pending</span>
                                    <p className="font-bold text-amber-300 text-base">
                                      {portfolio.metrics.callbacks_pending}
                                    </p>
                                  </div>
                                </div>

                                {/* Status pills */}
                                {Object.keys(portfolio.metrics.status_breakdown).length > 0 && (
                                  <div className="flex flex-wrap gap-2 pt-1">
                                    {Object.entries(portfolio.metrics.status_breakdown).map(
                                      ([s, n]) => (
                                        <span
                                          key={s}
                                          className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white capitalize"
                                        >
                                          {s.replace(/_/g, " ")}:{" "}
                                          <strong className="text-[#F5B021]">{n as number}</strong>
                                        </span>
                                      )
                                    )}
                                  </div>
                                )}

                                {/* Top 5 customers */}
                                {portfolio.customers.length > 0 && (
                                  <div className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
                                    <div className="px-4 py-2 border-b border-white/5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                      Assigned Customers ({portfolio.customers.length})
                                    </div>
                                    <table className="w-full text-xs">
                                      <tbody className="divide-y divide-white/5">
                                        {portfolio.customers.slice(0, 5).map((c) => (
                                          <tr key={c.id} className="px-4">
                                            <td className="px-4 py-2 font-semibold text-white">
                                              {c.full_name}
                                            </td>
                                            <td className="px-4 py-2 font-mono text-white/60">
                                              {c.cell_number}
                                            </td>
                                            <td className="px-4 py-2">
                                              <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] capitalize text-white">
                                                {c.status.replace(/_/g, " ")}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2 text-muted-foreground">
                                              {c.product_package || "—"}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {portfolio.customers.length > 5 && (
                                      <div className="px-4 py-2 text-[10px] text-muted-foreground border-t border-white/5">
                                        +{portfolio.customers.length - 5} more — click "Full Portfolio" to view all
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-xs text-destructive">
                                Could not load agent details.{" "}
                                {!agentId && (
                                  <span className="text-muted-foreground">
                                    (No agent ID in stats — check backend)
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

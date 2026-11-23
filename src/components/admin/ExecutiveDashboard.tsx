import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Headphones,
  Info,
  Mic,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOff,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  TrendingUp,
  UserCheck,
  Users,
  Volume2,
  X,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getExecutiveDashboardStatsFn } from "@/server/admin-functions";

interface ExecutiveDashboardProps {
  onNavigateTab: (tab: string) => void;
}

type DrillDownType =
  | "floor"
  | "in_call"
  | "ready"
  | "paused"
  | "dials"
  | "contact_rate"
  | "sales"
  | "aht"
  | "disposition"
  | "call_detail"
  | null;

export function ExecutiveDashboard({ onNavigateTab }: ExecutiveDashboardProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [drillDown, setDrillDown] = useState<DrillDownType>(null);
  const [selectedDisposition, setSelectedDisposition] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<any | null>(null);
  const [selectedHour, setSelectedHour] = useState<string | null>(null);

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["admin-executive-stats"],
    queryFn: () => getExecutiveDashboardStatsFn(),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatHours = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const floor = data?.floor ?? { loggedIn: 0, inCall: 0, ready: 0, paused: 0 };
  const kpis = data?.kpis ?? {
    totalDialsToday: 0,
    answersToday: 0,
    contactRatePct: 0,
    salesToday: 0,
    conversionRatePct: 0,
    ahtSeconds: 0,
    totalTalkSeconds: 0,
    dropRatePct: 0,
  };

  const liveAgents = data?.liveAgents ?? [];
  const recentCalls = data?.recentCalls ?? [];
  const salesLeads = data?.salesLeads ?? [];

  // Filtered live agents for modal
  const filteredAgents =
    drillDown === "in_call"
      ? liveAgents.filter((a) => a.status === "INCALL")
      : drillDown === "ready"
        ? liveAgents.filter((a) => a.status === "READY")
        : drillDown === "paused"
          ? liveAgents.filter((a) => a.status === "PAUSED")
          : liveAgents;

  // Calls filtered by the hour selected on the velocity chart ("HH:00" labels)
  const hourFilteredCalls = selectedHour
    ? recentCalls.filter((c) => {
        const d = new Date(c.startedAt);
        return `${d.getHours().toString().padStart(2, "0")}:00` === selectedHour;
      })
    : recentCalls;

  // Contact-rate breakdown: connected (duration > 0) vs unanswered dials
  const answeredCalls = hourFilteredCalls.filter((c) => c.durationSeconds > 0);
  const unansweredCalls = hourFilteredCalls.filter((c) => c.durationSeconds === 0);

  return (
    <div className="space-y-6">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Radio className="h-5 w-5 text-emerald-400 animate-pulse" />
            Executive Command Centre
          </h2>
          <p className="text-sm text-muted-foreground">
            Accurate, real-time telephony floor metrics and campaign conversion telemetry
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="gap-1.5 text-xs font-mono"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh Live
          </Button>

          {/* Admin's Own Live Floor Tab */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigateTab("floor")}
            className="gap-1.5 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 font-semibold"
          >
            <Headphones className="h-3.5 w-3.5" />
            Live Floor Monitor
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => onNavigateTab("campaigns")}
            className="gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-black font-semibold"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Campaign Control
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigateTab("agents")}
            className="gap-1.5 text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          >
            <Plus className="h-3.5 w-3.5" />
            Provision Agent
          </Button>
        </div>
      </div>

      {/* KPI Ribbon - ALL CARDS ARE INTERACTIVE DRILL-DOWNS */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* Floor Status Card */}
        <Card
          onClick={() => setDrillDown("floor")}
          className="bg-card/70 border-border/60 p-4 col-span-2 cursor-pointer hover:border-emerald-500/50 hover:bg-card/90 transition-all group"
        >
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-emerald-400 transition-colors">
              Live Floor State
            </span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-bold font-mono">{floor.loggedIn}</span>
            <span className="text-xs text-muted-foreground">Agents Logged In &bull; Click to inspect</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div
              onClick={(e) => {
                e.stopPropagation();
                setDrillDown("in_call");
              }}
              className="bg-emerald-500/10 border border-emerald-500/20 rounded p-1.5 hover:bg-emerald-500/20 transition-colors"
            >
              <div className="text-emerald-400 font-bold font-mono">{floor.inCall}</div>
              <div className="text-[10px] text-emerald-400/80">In Call</div>
            </div>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setDrillDown("ready");
              }}
              className="bg-cyan-500/10 border border-cyan-500/20 rounded p-1.5 hover:bg-cyan-500/20 transition-colors"
            >
              <div className="text-cyan-400 font-bold font-mono">{floor.ready}</div>
              <div className="text-[10px] text-cyan-400/80">Ready</div>
            </div>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setDrillDown("paused");
              }}
              className="bg-amber-500/10 border border-amber-500/20 rounded p-1.5 hover:bg-amber-500/20 transition-colors"
            >
              <div className="text-amber-400 font-bold font-mono">{floor.paused}</div>
              <div className="text-[10px] text-amber-400/80">Paused</div>
            </div>
          </div>
        </Card>

        {/* Calls Placed Today */}
        <Card
          onClick={() => setDrillDown("dials")}
          className="bg-card/70 border-border/60 p-4 cursor-pointer hover:border-primary/50 hover:bg-card/90 transition-all group"
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-primary transition-colors">
              Calls Placed
            </span>
            <PhoneCall className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold font-mono mt-1">{kpis.totalDialsToday}</div>
          <p className="text-[11px] text-muted-foreground mt-2 flex items-center justify-between">
            <span>Today's Total</span>
            <span className="text-primary text-[10px]">Details &rarr;</span>
          </p>
        </Card>

        {/* Contact Rate */}
        <Card
          onClick={() => setDrillDown("contact_rate")}
          className="bg-card/70 border-border/60 p-4 cursor-pointer hover:border-cyan-500/50 hover:bg-card/90 transition-all group"
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-cyan-400 transition-colors">
              Contact Rate
            </span>
            <UserCheck className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold font-mono mt-1 text-cyan-400">
            {kpis.contactRatePct}%
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 flex items-center justify-between">
            <span>{kpis.answersToday} answered</span>
            <span className="text-cyan-400 text-[10px]">Details &rarr;</span>
          </p>
        </Card>

        {/* Sales Closed */}
        <Card
          onClick={() => setDrillDown("sales")}
          className="bg-card/70 border-border/60 p-4 cursor-pointer hover:border-emerald-500/50 hover:bg-card/90 transition-all group"
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-emerald-400 transition-colors">
              Sales Today
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono mt-1 text-emerald-400">{kpis.salesToday}</div>
          <p className="text-[11px] text-emerald-400/80 mt-2 flex items-center justify-between">
            <span>{kpis.conversionRatePct}% conv.</span>
            <span className="text-emerald-400 text-[10px]">View leads &rarr;</span>
          </p>
        </Card>

        {/* Average Handling Time */}
        <Card
          onClick={() => setDrillDown("aht")}
          className="bg-card/70 border-border/60 p-4 cursor-pointer hover:border-amber-500/50 hover:bg-card/90 transition-all group"
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-amber-400 transition-colors">
              Avg AHT
            </span>
            <Clock className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono mt-1 text-amber-400">
            {formatDuration(kpis.ahtSeconds)}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 flex items-center justify-between">
            <span>Talk + wrap</span>
            <span className="text-amber-400 text-[10px]">Analysis &rarr;</span>
          </p>
        </Card>
      </div>

      {/* Visual Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hourly Call Flow Area Chart */}
        <Card className="bg-card/70 border-border/60 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-semibold">Hourly Call Velocity</CardTitle>
              <p className="text-xs text-muted-foreground">
                Actual outbound dials placed vs human answers (Click any hour to filter)
              </p>
            </div>
            {selectedHour && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedHour(null)}
                className="text-xs h-7 gap-1"
              >
                Clear filter ({selectedHour})
                <X className="h-3 w-3" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data?.hourlyFlow ?? []}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  onClick={(e) => {
                    if (e && e.activeLabel) {
                      setSelectedHour(e.activeLabel);
                    }
                  }}
                >
                  <defs>
                    <linearGradient id="colorDials" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorConnected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262b35" vertical={false} />
                  <XAxis dataKey="hour" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="dials"
                    name="Dials Placed"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorDials)"
                  />
                  <Area
                    type="monotone"
                    dataKey="connected"
                    name="Connected Calls"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorConnected)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Dispositions Donut Chart */}
        <Card className="bg-card/70 border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Call Dispositions</CardTitle>
            <p className="text-xs text-muted-foreground">Click any outcome slice to view call list</p>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-56 w-full flex items-center justify-center">
              {(data?.dispositionBreakdown?.length ?? 0) > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data?.dispositionBreakdown ?? []}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="count"
                      onClick={(entry) => {
                        setSelectedDisposition(entry.name);
                        setDrillDown("disposition");
                      }}
                      className="cursor-pointer"
                    >
                      {(data?.dispositionBreakdown ?? []).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-xs text-muted-foreground py-12">
                  No dispositioned calls recorded today yet
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] mt-2">
              {(data?.dispositionBreakdown ?? []).map((d) => (
                <button
                  key={d.name}
                  onClick={() => {
                    setSelectedDisposition(d.name);
                    setDrillDown("disposition");
                  }}
                  className="flex items-center gap-1.5 p-1 rounded hover:bg-muted/30 text-left transition-colors"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                  <span className="text-muted-foreground truncate">{d.name}:</span>
                  <span className="font-mono font-semibold ml-auto">{d.count}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Floor Time Allocation & Recent Calls Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Floor Time Allocation */}
        <Card className="bg-card/70 border-border/60 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Agent Time Allocation</h3>
            <span className="text-xs text-muted-foreground font-mono">Shift Cumulative</span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-emerald-400">Talk Time (Live Bridge)</span>
                <span className="font-mono">{data?.timeAllocation?.talkPct ?? 0}%</span>
              </div>
              <Progress value={data?.timeAllocation?.talkPct ?? 0} className="h-2 bg-muted/30" />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-cyan-400">Waiting in Queue (Ready)</span>
                <span className="font-mono">{data?.timeAllocation?.waitPct ?? 0}%</span>
              </div>
              <Progress value={data?.timeAllocation?.waitPct ?? 0} className="h-2 bg-muted/30" />
            </div>
          </div>

          <div className="pt-2 border-t border-border/40 text-xs text-muted-foreground flex justify-between">
            <span>Cumulative Talk Time:</span>
            <span className="font-mono font-bold text-foreground">
              {formatHours(kpis.totalTalkSeconds)}
            </span>
          </div>
        </Card>

        {/* Live Call Stream Ticker */}
        <Card className="bg-card/70 border-border/60 lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Headphones className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Recent Call Events</h3>
            </div>
            <span className="text-xs text-muted-foreground">Click any call to inspect recording</span>
          </div>

          <div className="space-y-2">
            {hourFilteredCalls.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                {selectedHour
                  ? `No calls recorded in hour ${selectedHour}`
                  : "No recent calls recorded yet today"}
              </div>
            ) : (
              hourFilteredCalls.map((call) => (
                <div
                  key={call.id}
                  onClick={() => {
                    setSelectedCall(call);
                    setDrillDown("call_detail");
                  }}
                  className="flex items-center justify-between p-2.5 rounded-md bg-background/50 border border-border/40 text-xs hover:border-primary/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-[11px]">
                      {call.agentName ? call.agentName.slice(0, 2).toUpperCase() : "AG"}
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{call.customerName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {call.agentName} ({call.agentCode}) &bull; {call.customerPhone}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-mono text-muted-foreground">
                      {formatDuration(call.durationSeconds)}
                    </span>
                    <Badge
                      variant="outline"
                      className={`font-mono text-[10px] ${
                        call.disposition === "SALE" || call.disposition === "ACTIVATED"
                          ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                          : call.disposition === "CALLBACK"
                            ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                            : "border-slate-500/40 text-slate-400 bg-slate-500/10"
                      }`}
                    >
                      {call.disposition}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      title="Inspect call"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* DRILL-DOWN MODAL / DIALOG */}
      <Dialog open={Boolean(drillDown)} onOpenChange={(open) => !open && setDrillDown(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border border-border/60 bg-[#12161F] text-foreground sm:max-w-2xl">
          {/* FLOOR / AGENT DRILL-DOWN */}
          {(drillDown === "floor" ||
            drillDown === "in_call" ||
            drillDown === "ready" ||
            drillDown === "paused") && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-bold">
                  <Headphones className="size-5 text-emerald-400" />
                  Live Floor Agents &bull; {filteredAgents.length} Active
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Current real-time state of telephony agents on the Asterisk PBX.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 mt-4">
                {filteredAgents.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    No agents currently matching this state
                  </div>
                ) : (
                  filteredAgents.map((a) => (
                    <div
                      key={a.agent_id}
                      className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-[#0B0D11] text-xs"
                    >
                      <div>
                        <div className="font-semibold text-white">{a.full_name}</div>
                        <div className="text-white/40 text-[11px]">
                          Code: <span className="font-mono text-cyan-400">{a.agent_code}</span> &bull; Ext: {a.extension}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-white/50">
                          {formatDuration(a.seconds_in_state || 0)}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            a.status === "INCALL"
                              ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                              : a.status === "READY"
                                ? "border-cyan-500/40 text-cyan-400 bg-cyan-500/10"
                                : "border-amber-500/40 text-amber-400 bg-amber-500/10"
                          }
                        >
                          {a.status}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-white/10 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setDrillDown(null);
                    onNavigateTab("floor");
                  }}
                  className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs"
                >
                  Open Live Floor Monitor Tab &rarr;
                </Button>
              </div>
            </>
          )}

          {/* SALES LEADS DRILL-DOWN */}
          {drillDown === "sales" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-bold text-emerald-400">
                  <CheckCircle2 className="size-5" />
                  Today's Closed Sales Leads ({salesLeads.length})
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Actual closed sales and payment commitments recorded today.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 mt-4">
                {salesLeads.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    No sales closed yet today
                  </div>
                ) : (
                  salesLeads.map((s) => (
                    <div
                      key={s.id}
                      className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-xs flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold text-white">{s.customerName}</div>
                        <div className="text-white/40 text-[11px]">
                          {s.phone} &bull; Package: {s.package}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-emerald-400 font-semibold">{s.agentName}</div>
                        <div className="text-white/40 font-mono text-[10px]">{s.time}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* DIALS & VELOCITY DRILL-DOWN */}
          {drillDown === "dials" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-bold">
                  <PhoneCall className="size-5 text-primary" />
                  Today's Call Placement Telemetry
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Detailed call progression and answer ratios across campaigns.
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                <div className="p-3 rounded-lg bg-card/60 border border-border/40">
                  <span className="text-muted-foreground">Total Dials Placed</span>
                  <div className="text-xl font-bold font-mono mt-1">{kpis.totalDialsToday}</div>
                </div>
                <div className="p-3 rounded-lg bg-card/60 border border-border/40">
                  <span className="text-muted-foreground">Answered by Customer</span>
                  <div className="text-xl font-bold font-mono mt-1 text-cyan-400">{kpis.answersToday}</div>
                </div>
                <div className="p-3 rounded-lg bg-card/60 border border-border/40">
                  <span className="text-muted-foreground">Contact Rate</span>
                  <div className="text-xl font-bold font-mono mt-1 text-emerald-400">{kpis.contactRatePct}%</div>
                </div>
                <div className="p-3 rounded-lg bg-card/60 border border-border/40">
                  <span className="text-muted-foreground">Cumulative Talk Time</span>
                  <div className="text-xl font-bold font-mono mt-1">{formatHours(kpis.totalTalkSeconds)}</div>
                </div>
              </div>
            </>
          )}

          {/* CONTACT RATE DRILL-DOWN */}
          {drillDown === "contact_rate" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-bold text-cyan-400">
                  <UserCheck className="size-5" />
                  Contact Rate Analysis{selectedHour ? ` &bull; ${selectedHour}` : ""}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Human answer rate: {kpis.answersToday} of {kpis.totalDialsToday} dials connected
                  {selectedHour ? " in the selected hour" : " today"}.
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                <div className="p-3 rounded-lg bg-card/60 border border-border/40">
                  <span className="text-muted-foreground">Dials Placed</span>
                  <div className="text-xl font-bold font-mono mt-1">{kpis.totalDialsToday}</div>
                </div>
                <div className="p-3 rounded-lg bg-card/60 border border-border/40">
                  <span className="text-muted-foreground">Answered (Connected)</span>
                  <div className="text-xl font-bold font-mono mt-1 text-cyan-400">{kpis.answersToday}</div>
                </div>
                <div className="p-3 rounded-lg bg-card/60 border border-border/40">
                  <span className="text-muted-foreground">Unanswered / No Answer</span>
                  <div className="text-xl font-bold font-mono mt-1 text-amber-400">
                    {Math.max(0, kpis.totalDialsToday - kpis.answersToday)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-card/60 border border-border/40">
                  <span className="text-muted-foreground">Contact Rate</span>
                  <div className="text-xl font-bold font-mono mt-1 text-emerald-400">{kpis.contactRatePct}%</div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">
                  Connected Calls ({answeredCalls.length})
                </div>
                {answeredCalls.length === 0 ? (
                  <div className="text-center py-4 text-xs text-muted-foreground">
                    No connected calls in this scope
                  </div>
                ) : (
                  answeredCalls.map((c) => (
                    <div
                      key={c.id}
                      className="p-2.5 rounded-lg border border-border/40 bg-card/50 text-xs flex justify-between items-center"
                    >
                      <div>
                        <div className="font-semibold text-foreground">{c.customerName}</div>
                        <div className="text-muted-foreground text-[11px]">
                          {c.agentName} ({c.agentCode}) &bull; {c.customerPhone}
                        </div>
                      </div>
                      <span className="font-mono text-muted-foreground">
                        {formatDuration(c.durationSeconds)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 space-y-2">
                <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                  Unanswered Dials ({unansweredCalls.length})
                </div>
                {unansweredCalls.length === 0 ? (
                  <div className="text-center py-4 text-xs text-muted-foreground">
                    No unanswered dials in this scope
                  </div>
                ) : (
                  unansweredCalls.map((c) => (
                    <div
                      key={c.id}
                      className="p-2.5 rounded-lg border border-border/40 bg-card/50 text-xs flex justify-between items-center"
                    >
                      <div>
                        <div className="font-semibold text-foreground">{c.customerName}</div>
                        <div className="text-muted-foreground text-[11px]">
                          {c.agentName} ({c.agentCode}) &bull; {c.customerPhone}
                        </div>
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px] border-amber-500/40 text-amber-400 bg-amber-500/10">
                        {c.disposition}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* AHT DRILL-DOWN */}
          {drillDown === "aht" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-bold text-amber-400">
                  <Clock className="size-5" />
                  Handling Time Intelligence
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Average call duration and conversation efficiency benchmarks.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4 text-xs">
                <div className="p-4 rounded-lg bg-card/60 border border-border/40">
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="text-muted-foreground">Average Handling Time (AHT)</span>
                    <span className="text-2xl font-bold font-mono text-amber-400">
                      {formatDuration(kpis.ahtSeconds)}
                    </span>
                  </div>
                  <Progress value={Math.min(100, (kpis.ahtSeconds / 240) * 100)} className="h-2 bg-muted/40" />
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Target benchmark is 04:00 (240s) per connected touch.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* DISPOSITION DRILL-DOWN */}
          {drillDown === "disposition" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-bold">
                  <Activity className="size-5 text-primary" />
                  Calls Tagged as "{selectedDisposition}"
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  All call records dispositioned with this outcome today.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 mt-4">
                {hourFilteredCalls.filter(
                  (c) => c.disposition.toUpperCase() === (selectedDisposition ?? "").toUpperCase(),
                ).length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    No calls recorded with disposition {selectedDisposition}
                    {selectedHour ? ` in hour ${selectedHour}` : ""}
                  </div>
                ) : (
                  hourFilteredCalls
                    .filter((c) => c.disposition.toUpperCase() === (selectedDisposition ?? "").toUpperCase())
                    .map((c) => (
                      <div
                        key={c.id}
                        className="p-3 rounded-lg border border-border/40 bg-card/50 text-xs flex justify-between items-center"
                      >
                        <div>
                          <div className="font-semibold text-foreground">{c.customerName}</div>
                          <div className="text-muted-foreground text-[11px]">
                            {c.agentName} ({c.agentCode}) &bull; {c.customerPhone}
                          </div>
                        </div>
                        <span className="font-mono text-muted-foreground">
                          {formatDuration(c.durationSeconds)}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </>
          )}

          {/* CALL DETAIL INSPECTION */}
          {drillDown === "call_detail" && selectedCall && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-bold">
                  <Phone className="size-5 text-primary" />
                  Call Record Details
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Call event ID: {selectedCall.id}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded bg-card/50 border border-border/40">
                    <span className="text-muted-foreground">Customer</span>
                    <div className="font-semibold text-foreground mt-1">{selectedCall.customerName}</div>
                    <div className="text-muted-foreground">{selectedCall.customerPhone}</div>
                  </div>
                  <div className="p-3 rounded bg-card/50 border border-border/40">
                    <span className="text-muted-foreground">Agent</span>
                    <div className="font-semibold text-foreground mt-1">{selectedCall.agentName}</div>
                    <div className="text-cyan-400 font-mono">{selectedCall.agentCode}</div>
                  </div>
                  <div className="p-3 rounded bg-card/50 border border-border/40">
                    <span className="text-muted-foreground">Disposition</span>
                    <div className="font-semibold text-emerald-400 mt-1">{selectedCall.disposition}</div>
                  </div>
                  <div className="p-3 rounded bg-card/50 border border-border/40">
                    <span className="text-muted-foreground">Duration</span>
                    <div className="font-semibold font-mono text-foreground mt-1">
                      {formatDuration(selectedCall.durationSeconds)} ({selectedCall.durationSeconds}s)
                    </div>
                  </div>
                </div>

                {selectedCall.recordingUrl ? (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                    <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <Volume2 className="h-4 w-4" />
                      Audio Recording Available
                    </span>
                    <audio controls className="w-full h-8" src={selectedCall.recordingUrl} />
                  </div>
                ) : (
                  <div className="p-3 rounded bg-muted/20 border border-border/40 text-muted-foreground text-center">
                    No external audio recording URL attached for this local event
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

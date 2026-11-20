import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Gauge,
  ListFilter,
  PhoneCall,
  Plus,
  RefreshCw,
  Megaphone,
  Pencil,
  Target,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  getCampaignsFn,
  createCampaignFn,
  updateCampaignFn,
  reloadHopperFn,
  type Campaign,
  type CampaignInput,
  type DialMethod,
  type RetryRule,
} from "@/server/campaign-functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------

const DIAL_METHOD_LABEL: Record<DialMethod, string> = {
  MANUAL: "MANUAL",
  RATIO: "RATIO",
  ADAPT_AVERAGE: "ADAPTIVE",
};

const HOPPER_OPTIONS = [50, 100, 200, 500];

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Megaphone;
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#12161F] p-5 transition hover:border-white/10">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white/30">
        <span>{label}</span>
        <Icon className={`size-4 ${accent}`} />
      </div>
      <div className="mt-3 text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

function HopperGauge({ current, target }: { current: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const barColor =
    pct >= 75 ? "bg-[#22C55E]" : pct >= 40 ? "bg-[#F5B021]" : "bg-[#EF4444]";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-white/50">Hopper</span>
        <span className="font-mono font-semibold text-white">
          {current} / {target}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------
// Campaign Form Drawer
// ----------------------------------------------------

type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Campaign | null;
  onSaved: () => void;
};

const DEFAULT_RETRY_RULES: RetryRule[] = [
  { status: "NO_ANSWER", retryAfterMinutes: 30, maxAttempts: 3 },
  { status: "BUSY", retryAfterMinutes: 15, maxAttempts: 5 },
];

function CampaignDrawer({ open, onOpenChange, editing, onSaved }: DrawerProps) {
  const qc = useQueryClient();
  const isEdit = Boolean(editing);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("identity");

  // Identity
  const [name, setName] = useState("");
  const [campaignCid, setCampaignCid] = useState("");
  const [description, setDescription] = useState("");

  // Pacing
  const [dialMethod, setDialMethod] = useState<DialMethod>("RATIO");
  const [autoDialLevel, setAutoDialLevel] = useState(1.5);
  const [ringingTimeout, setRingingTimeout] = useState(25);
  const [hopperLevel, setHopperLevel] = useState(200);

  // Switches
  const [active, setActive] = useState(true);
  const [forceRecording, setForceRecording] = useState(true);
  const [amdEnabled, setAmdEnabled] = useState(true);
  const [autoAlternateCell, setAutoAlternateCell] = useState(true);
  const [blendedInbound, setBlendedInbound] = useState(false);

  // Retry rules
  const [retryRules, setRetryRules] = useState<RetryRule[]>(DEFAULT_RETRY_RULES);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setCampaignCid(editing.campaignCid);
      setDescription(editing.description);
      setDialMethod(editing.dialMethod);
      setAutoDialLevel(editing.autoDialLevel);
      setRingingTimeout(editing.ringingTimeout);
      setHopperLevel(editing.hopperLevel);
      setActive(editing.active);
      setForceRecording(editing.forceRecording);
      setAmdEnabled(editing.amdEnabled);
      setAutoAlternateCell(editing.autoAlternateCell);
      setBlendedInbound(editing.blendedInbound);
      setRetryRules(editing.retryRules.length ? editing.retryRules : DEFAULT_RETRY_RULES);
    } else {
      setName("");
      setCampaignCid("");
      setDescription("");
      setDialMethod("RATIO");
      setAutoDialLevel(1.5);
      setRingingTimeout(25);
      setHopperLevel(200);
      setActive(true);
      setForceRecording(true);
      setAmdEnabled(true);
      setAutoAlternateCell(true);
      setBlendedInbound(false);
      setRetryRules(DEFAULT_RETRY_RULES);
    }
    setTab("identity");
  }, [open, editing]);

  const updateRetry = (idx: number, patch: Partial<RetryRule>) => {
    setRetryRules((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };

  const addRetryRule = () => {
    setRetryRules((prev) => [
      ...prev,
      { status: "NO_ANSWER", retryAfterMinutes: 30, maxAttempts: 3 },
    ]);
  };

  const removeRetryRule = (idx: number) => {
    setRetryRules((prev) => prev.filter((_, i) => i !== idx));
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload: CampaignInput = {
        name,
        campaignCid,
        description,
        dialMethod,
        autoDialLevel,
        ringingTimeout,
        hopperLevel,
        active,
        forceRecording,
        amdEnabled,
        autoAlternateCell,
        blendedInbound,
        retryRules,
      };
      if (isEdit && editing) {
        await updateCampaignFn({ data: { id: editing.id, ...payload } });
        toast.success("Campaign updated");
      } else {
        await createCampaignFn({ data: payload });
        toast.success("Campaign created");
      }
      void qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save campaign");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 border-white/10 bg-[#12161F] p-0 text-white sm:max-w-2xl">
        <SheetHeader className="border-b border-white/5 px-6 py-5">
          <SheetTitle className="flex items-center gap-2 text-lg font-bold">
            <Megaphone className="size-5 text-[#F5B021]" />
            {isEdit ? "Edit Campaign" : "Create New Campaign"}
          </SheetTitle>
          <SheetDescription className="text-white/50">
            {isEdit
              ? "Update campaign identity, pacing, and operational settings."
              : "Configure a new dialing campaign with pacing and retry rules."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid w-full grid-cols-3 bg-[#0B0D11]">
                <TabsTrigger value="identity">Identity</TabsTrigger>
                <TabsTrigger value="pacing">Pacing & Engine</TabsTrigger>
                <TabsTrigger value="lists">Lead Lists & Retries</TabsTrigger>
              </TabsList>

              {/* Identity */}
              <TabsContent value="identity" className="mt-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase text-white/60">
                      Campaign Name
                    </Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      placeholder="e.g. Outbound Sales"
                      className="border-white/10 bg-[#0B0D11] text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase text-white/60">
                      Outbound Caller ID
                    </Label>
                    <Input
                      value={campaignCid}
                      onChange={(e) => setCampaignCid(e.target.value)}
                      required
                      placeholder="e.g. 0842840069"
                      className="border-white/10 bg-[#0B0D11] text-white"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase text-white/60">
                    Description
                  </Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="What is this campaign for?"
                    className="border-white/10 bg-[#0B0D11] text-white"
                  />
                </div>
              </TabsContent>

              {/* Pacing & Engine */}
              <TabsContent value="pacing" className="mt-5 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase text-white/60">
                      Dial Method
                    </Label>
                    <Select value={dialMethod} onValueChange={(v) => setDialMethod(v as DialMethod)}>
                      <SelectTrigger className="border-white/10 bg-[#0B0D11] text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-white/10 bg-[#12161F] text-white">
                        <SelectItem value="MANUAL">Manual</SelectItem>
                        <SelectItem value="RATIO">Ratio</SelectItem>
                        <SelectItem value="ADAPT_AVERAGE">Adaptive Average</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase text-white/60">
                      Hopper Level
                    </Label>
                    <Select
                      value={String(hopperLevel)}
                      onValueChange={(v) => setHopperLevel(parseInt(v, 10))}
                    >
                      <SelectTrigger className="border-white/10 bg-[#0B0D11] text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-white/10 bg-[#12161F] text-white">
                        {HOPPER_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={String(opt)}>
                            {opt} leads
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-white/5 bg-[#0B0D11] p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase text-white/60">
                      Auto-Dial Multiplier
                    </Label>
                    <span className="font-mono text-sm font-bold text-[#F5B021]">
                      {autoDialLevel.toFixed(1)}x
                    </span>
                  </div>
                  <Slider
                    value={[autoDialLevel]}
                    onValueChange={([v]) => setAutoDialLevel(v)}
                    min={1.0}
                    max={3.5}
                    step={0.1}
                  />
                  <p className="text-xs text-white/40">
                    Controls the dialing ratio. 1.0x = 1 call per agent, 3.5x = aggressive predictive dialing.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase text-white/60">
                    Ringing Timeout (seconds)
                  </Label>
                  <Input
                    type="number"
                    min={18}
                    max={45}
                    value={ringingTimeout}
                    onChange={(e) => setRingingTimeout(parseInt(e.target.value, 10) || 25)}
                    className="border-white/10 bg-[#0B0D11] text-white"
                  />
                  <p className="text-xs text-white/40">Range: 18s to 45s</p>
                </div>

                {/* Operational switches */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#F5B021]/80">
                    Operational Settings
                  </h4>
                  <ToggleRow
                    label="Campaign Active"
                    on="Active"
                    off="Inactive"
                    checked={active}
                    onChange={setActive}
                  />
                  <ToggleRow
                    label="Force Full Call Recording"
                    on="Force All Calls"
                    off="Agent Discretion"
                    checked={forceRecording}
                    onChange={setForceRecording}
                  />
                  <ToggleRow
                    label="Answering Machine Detection (AMD)"
                    on="Enabled"
                    off="Disabled"
                    checked={amdEnabled}
                    onChange={setAmdEnabled}
                  />
                  <ToggleRow
                    label="Auto Alternate Cell Dialing"
                    on="Enabled"
                    off="Disabled"
                    checked={autoAlternateCell}
                    onChange={setAutoAlternateCell}
                  />
                  <ToggleRow
                    label="Inbound Blended Routing"
                    on="Allowed"
                    off="Outbound Only"
                    checked={blendedInbound}
                    onChange={setBlendedInbound}
                  />
                </div>
              </TabsContent>

              {/* Lead Lists & Retries */}
              <TabsContent value="lists" className="mt-5 space-y-6">
                {/* Assigned lead lists */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ListFilter className="size-4 text-[#06B6D4]" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#06B6D4]">
                      Assigned Lead Lists
                    </h4>
                  </div>
                  {editing && editing.leadLists.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-white/5">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-white/[0.02] text-xs uppercase tracking-wider text-white/40">
                          <tr>
                            <th className="px-3 py-2 font-semibold">List Name</th>
                            <th className="px-3 py-2 font-semibold">Leads</th>
                            <th className="px-3 py-2 font-semibold">Active</th>
                          </tr>
                        </thead>
                        <tbody>
                          {editing.leadLists.map((list) => (
                            <tr key={list.id} className="border-t border-white/5">
                              <td className="px-3 py-2 font-medium text-white">{list.name}</td>
                              <td className="px-3 py-2 font-mono text-white/60">{list.leadCount}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                    list.active
                                      ? "bg-[#22C55E]/15 text-[#22C55E]"
                                      : "bg-white/5 text-white/40"
                                  }`}
                                >
                                  {list.active ? "Active" : "Paused"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-xs text-white/40">
                      {isEdit
                        ? "No lead lists assigned to this campaign yet."
                        : "Lead lists can be assigned after the campaign is created."}
                    </p>
                  )}
                </div>

                {/* Call recycling & retries */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="size-4 text-[#F5B021]" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#F5B021]/80">
                        Call Recycling & Retries
                      </h4>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addRetryRule}
                      className="border-white/10 text-white"
                    >
                      <Plus className="size-3.5" /> Add Rule
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {retryRules.map((rule, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr_80px_70px_36px] items-center gap-2 rounded-lg border border-white/5 bg-[#0B0D11] px-3 py-2.5"
                      >
                        <Input
                          value={rule.status}
                          onChange={(e) => updateRetry(idx, { status: e.target.value })}
                          placeholder="e.g. NO_ANSWER"
                          className="h-8 border-white/10 bg-[#12161F] text-xs text-white"
                        />
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase text-white/30">Minutes</span>
                          <Input
                            type="number"
                            value={rule.retryAfterMinutes}
                            onChange={(e) =>
                              updateRetry(idx, {
                                retryAfterMinutes: parseInt(e.target.value, 10) || 0,
                              })
                            }
                            className="h-8 border-white/10 bg-[#12161F] text-xs text-white"
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase text-white/30">Max</span>
                          <Input
                            type="number"
                            value={rule.maxAttempts}
                            onChange={(e) =>
                              updateRetry(idx, {
                                maxAttempts: parseInt(e.target.value, 10) || 0,
                              })
                            }
                            className="h-8 border-white/10 bg-[#12161F] text-xs text-white"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRetryRule(idx)}
                          className="h-8 text-white/40 hover:text-[#EF4444]"
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <SheetFooter className="border-t border-white/5 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-white/10 text-white"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
            >
              {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Campaign"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ToggleRow({
  label,
  on,
  off,
  checked,
  onChange,
}: {
  label: string;
  on: string;
  off: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-[#0B0D11] px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-white/40">{checked ? on : off}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// ----------------------------------------------------
// Campaign Card
// ----------------------------------------------------

function CampaignCard({
  campaign,
  onToggle,
  onReload,
  onEdit,
  toggling,
  reloading,
}: {
  campaign: Campaign;
  onToggle: (c: Campaign) => void;
  onReload: (c: Campaign) => void;
  onEdit: (c: Campaign) => void;
  toggling: boolean;
  reloading: boolean;
}) {
  const dialLabel = DIAL_METHOD_LABEL[campaign.dialMethod];
  const conversionPct =
    campaign.callsToday > 0
      ? Math.round((campaign.conversionsToday / campaign.callsToday) * 100)
      : 0;

  return (
    <div
      className={`rounded-xl border bg-[#12161F] p-5 transition hover:border-white/15 ${
        campaign.active ? "border-[#22C55E]/20" : "border-white/5"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white/50">
              {campaign.campaignId}
            </span>
            <h3 className="truncate text-base font-bold text-white">{campaign.name}</h3>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-white/40">{campaign.description}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
            campaign.active
              ? "border-[#22C55E]/30 bg-[#22C55E]/15 text-[#22C55E]"
              : "border-[#F5B021]/30 bg-[#F5B021]/15 text-[#F5B021]"
          }`}
        >
          {campaign.active ? "ACTIVE" : "PAUSED"}
        </span>
      </div>

      {/* Badges */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-[#06B6D4]/20 bg-[#06B6D4]/10 px-2 py-1 text-[11px] font-semibold text-[#06B6D4]">
          {dialLabel}
          {campaign.dialMethod !== "MANUAL" && ` ${campaign.autoDialLevel.toFixed(1)}x`}
        </span>
        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/60">
          CID {campaign.campaignCid}
        </span>
      </div>

      {/* Hopper gauge */}
      <div className="mt-4">
        <HopperGauge current={campaign.hopperCurrent} target={campaign.hopperLevel} />
      </div>

      {/* Mini stats */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/[0.02] py-2">
          <p className="text-[10px] uppercase tracking-wider text-white/30">Calls Today</p>
          <p className="mt-0.5 text-sm font-bold text-white">{campaign.callsToday}</p>
        </div>
        <div className="rounded-lg bg-white/[0.02] py-2">
          <p className="text-[10px] uppercase tracking-wider text-white/30">Won</p>
          <p className="mt-0.5 text-sm font-bold text-[#22C55E]">{campaign.conversionsToday}</p>
        </div>
        <div className="rounded-lg bg-white/[0.02] py-2">
          <p className="text-[10px] uppercase tracking-wider text-white/30">Conv %</p>
          <p className="mt-0.5 text-sm font-bold text-[#F5B021]">{conversionPct}%</p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
        <div className="flex items-center gap-2">
          <Switch
            checked={campaign.active}
            disabled={toggling}
            onCheckedChange={() => onToggle(campaign)}
          />
          <span className="text-xs font-medium text-white/50">
            {campaign.active ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReload(campaign)}
            disabled={reloading}
            className="border-white/10 text-white hover:border-[#06B6D4]/40 hover:text-[#06B6D4]"
          >
            <RefreshCw className={`size-3.5 ${reloading ? "animate-spin" : ""}`} />
            Reload Hopper
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(campaign)}
            className="border-white/10 text-white hover:border-[#F5B021]/40 hover:text-[#F5B021]"
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// Main View
// ----------------------------------------------------

export function CampaignManager() {
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [reloadingId, setReloadingId] = useState<string | null>(null);

  const campaignsQ = useQuery({
    queryKey: ["admin-campaigns"],
    queryFn: async () => await getCampaignsFn(),
    refetchInterval: 15000,
  });

  const campaigns = campaignsQ.data?.campaigns ?? [];

  const stats = useMemo(() => {
    const activeCount = campaigns.filter((c) => c.active).length;
    const totalHopper = campaigns.reduce((sum, c) => sum + c.hopperCurrent, 0);
    const totalCallsToday = campaigns.reduce((sum, c) => sum + c.callsToday, 0);
    const totalConversions = campaigns.reduce((sum, c) => sum + c.conversionsToday, 0);
    const conversionPct =
      totalCallsToday > 0 ? Math.round((totalConversions / totalCallsToday) * 100) : 0;
    return { activeCount, totalHopper, totalCallsToday, conversionPct };
  }, [campaigns]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-campaigns"] });

  const handleAdd = () => {
    setEditingCampaign(null);
    setDrawerOpen(true);
  };

  const handleEdit = (c: Campaign) => {
    setEditingCampaign(c);
    setDrawerOpen(true);
  };

  const handleToggle = async (c: Campaign) => {
    setTogglingId(c.id);
    try {
      await updateCampaignFn({ data: { id: c.id, active: !c.active } });
      toast.success(c.active ? "Campaign paused" : "Campaign activated");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle campaign");
    } finally {
      setTogglingId(null);
    }
  };

  const handleReload = async (c: Campaign) => {
    setReloadingId(c.id);
    try {
      const res = await reloadHopperFn({ data: { id: c.id } });
      toast.success(`Hopper reloaded with ${res.hopperCurrent} leads`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reload hopper");
    } finally {
      setReloadingId(null);
    }
  };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Megaphone className="size-5 text-[#F5B021]" />
            Campaign & Queue Control Center
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Manage dialing campaigns, pacing, hopper levels, and retry rules — no VICIdial admin required.
          </p>
        </div>
        <Button
          onClick={handleAdd}
          className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
        >
          <Plus className="size-4" />
          Create Campaign
        </Button>
      </div>

      {/* Top Metric Cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Megaphone}
          label="Active Campaigns"
          value={stats.activeCount}
          accent="text-[#F5B021]/50"
        />
        <StatCard
          icon={Gauge}
          label="Leads in Hopper"
          value={stats.totalHopper}
          accent="text-[#06B6D4]/50"
        />
        <StatCard
          icon={PhoneCall}
          label="Calls Today"
          value={stats.totalCallsToday}
          accent="text-[#22C55E]/50"
        />
        <StatCard
          icon={TrendingUp}
          label="Conversion %"
          value={`${stats.conversionPct}%`}
          accent="text-[#D44B2E]/50"
        />
      </div>

      {/* Campaign grid */}
      {campaignsQ.isLoading ? (
        <div className="rounded-xl border border-white/5 bg-[#12161F] px-4 py-16 text-center text-sm text-white/30">
          Loading campaigns…
        </div>
      ) : campaignsQ.isError ? (
        <div className="rounded-xl border border-[#EF4444]/20 bg-[#EF4444]/5 px-4 py-16 text-center text-sm text-[#EF4444]">
          Failed to load campaigns.{" "}
          <Button variant="link" onClick={() => void campaignsQ.refetch()} className="text-[#F5B021]">
            Retry
          </Button>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#12161F] px-4 py-16 text-center text-sm text-white/30">
          No campaigns yet. Click "Create Campaign" to get started.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onToggle={handleToggle}
              onReload={handleReload}
              onEdit={handleEdit}
              toggling={togglingId === c.id}
              reloading={reloadingId === c.id}
            />
          ))}
        </div>
      )}

      <CampaignDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        editing={editingCampaign}
        onSaved={refresh}
      />
    </section>
  );
}

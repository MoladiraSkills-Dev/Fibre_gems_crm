import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  UserCog,
  Mail,
  Phone,
  Shield,
  Users,
  Pencil,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import {
  listAgentsFn,
  toggleAgentStatusFn,
  type AdminAgentRow,
} from "@/server/admin-functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProvisioningModal } from "./ProvisioningModal";

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-[#D44B2E]/15 text-[#D44B2E] border-[#D44B2E]/30",
  team_leader: "bg-[#F5B021]/15 text-[#F5B021] border-[#F5B021]/30",
  agent: "bg-[#06B6D4]/15 text-[#06B6D4] border-[#06B6D4]/30",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  team_leader: "Team Lead",
  agent: "Agent",
};

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: number; accent: string }) {
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

export function AgentProvisioningView() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AdminAgentRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const agentsQ = useQuery({
    queryKey: ["admin-agents", search, roleFilter],
    queryFn: async () => {
      return await listAgentsFn({
        data: {
          search: search || undefined,
          role: roleFilter === "all" ? undefined : roleFilter,
        },
      });
    },
    refetchInterval: 15000,
  });

  const agents = agentsQ.data?.agents ?? [];
  const totalAgents = agentsQ.data?.total ?? 0;
  const activeCount = agents.filter((a) => a.status === "active").length;
  const phoneProvisioned = agents.filter((a) => Boolean(a.phone_login)).length;

  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-agents"] });

  const handleAdd = () => {
    setEditingAgent(null);
    setModalOpen(true);
  };

  const handleEdit = (agent: AdminAgentRow) => {
    setEditingAgent(agent);
    setModalOpen(true);
  };

  const handleToggle = async (agent: AdminAgentRow) => {
    setTogglingId(agent.id);
    try {
      await toggleAgentStatusFn({
        data: { id: agent.id, active: agent.status !== "active" },
      });
      toast.success(
        agent.status === "active" ? "Agent suspended" : "Agent activated",
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle agent");
    } finally {
      setTogglingId(null);
    }
  };

  const copyField = (text: string, label: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <UserCog className="size-5 text-[#F5B021]" />
            Agent & SIP Phone Provisioning
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Create agent accounts, assign roles, and provision SIP phone credentials — all without
            touching VICIdial admin.
          </p>
        </div>
        <Button
          onClick={handleAdd}
          className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
        >
          <Plus className="size-4" />
          Provision Agent
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="Total Agents" value={totalAgents} accent="text-[#F5B021]/50" />
        <StatCard icon={Shield} label="Active" value={activeCount} accent="text-[#22C55E]/50" />
        <StatCard icon={Phone} label="Phone Provisioned" value={phoneProvisioned} accent="text-[#06B6D4]/50" />
        <StatCard icon={UserCog} label="Team Leaders" value={agents.filter((a) => a.role === "team_leader").length} accent="text-[#D44B2E]/50" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/30" />
          <Input
            placeholder="Search name, email, code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-white/10 bg-[#12161F] pl-9 text-white"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[160px] border-white/10 bg-[#12161F] text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-[#12161F] text-white">
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="agent">Agents</SelectItem>
            <SelectItem value="team_leader">Team Leaders</SelectItem>
            <SelectItem value="admin">Admins</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void agentsQ.refetch()}
          disabled={agentsQ.isFetching}
          className="border-white/10 text-white"
          aria-label="Refresh"
        >
          <Search className="size-4 animate-pulse" />
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#12161F]">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-white/[0.02] text-xs uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3 font-semibold">Agent</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">SIP Extension</th>
              <th className="px-4 py-3 font-semibold">Phone Pass</th>
              <th className="px-4 py-3 font-semibold">Active</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr
                key={agent.id}
                className="border-t border-white/5 transition hover:bg-white/[0.02]"
              >
                {/* Agent name + email */}
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-tr from-[#E07C2A] to-[#F5B021] text-xs font-bold text-black">
                      {agent.full_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{agent.full_name}</p>
                      <p className="flex items-center gap-1 truncate text-xs text-white/40">
                        <Mail className="size-3" />
                        {agent.email}
                      </p>
                      {agent.agent_code && (
                        <span className="mt-0.5 inline-block rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/50">
                          {agent.agent_code}
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* Role badge */}
                <td className="px-4 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${ROLE_BADGE[agent.role]}`}
                  >
                    {ROLE_LABEL[agent.role] ?? agent.role}
                  </span>
                </td>

                {/* SIP extension */}
                <td className="px-4 py-4">
                  {agent.phone_login ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-[#06B6D4]">{agent.phone_login}</span>
                      <button
                        type="button"
                        onClick={() => copyField(agent.phone_login!, "Extension")}
                        className="text-white/30 hover:text-white"
                      >
                        <Copy className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-white/30 italic">Not provisioned</span>
                  )}
                </td>

                {/* Phone pass (masked) */}
                <td className="px-4 py-4">
                  {agent.phone_pass ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-white/50">••••••••</span>
                      <button
                        type="button"
                        onClick={() => copyField(agent.phone_pass!, "Phone password")}
                        className="text-white/30 hover:text-white"
                      >
                        <Copy className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-white/30 italic">—</span>
                  )}
                </td>

                {/* Active toggle */}
                <td className="px-4 py-4">
                  <Switch
                    checked={agent.status === "active"}
                    disabled={togglingId === agent.id}
                    onCheckedChange={() => void handleToggle(agent)}
                  />
                </td>

                {/* Edit button */}
                <td className="px-4 py-4 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(agent)}
                    className="border-white/10 text-white hover:border-[#F5B021]/40 hover:text-[#F5B021]"
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                </td>
              </tr>
            ))}

            {!agents.length && !agentsQ.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-sm text-white/30">
                  No agents found. Click "Provision Agent" to create one.
                </td>
              </tr>
            )}

            {agentsQ.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-sm text-white/30">
                  Loading agents…
                </td>
              </tr>
            )}

            {agentsQ.isError && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-sm text-[#EF4444]">
                  Failed to load agents.{" "}
                  <Button variant="link" onClick={() => void agentsQ.refetch()} className="text-[#F5B021]">
                    Retry
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Provisioning Modal */}
      <ProvisioningModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        editingAgent={editingAgent}
        onSaved={refresh}
      />
    </section>
  );
}

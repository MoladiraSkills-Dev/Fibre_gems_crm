import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Users, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listTeamsFn,
  createTeamFn,
  updateTeamFn,
  deleteTeamFn,
  setAgentTeamFn,
  type Team,
} from "@/server/team-functions";
import { listAgentsFn } from "@/server/admin-functions";

const UNASSIGNED = "__unassigned__";

const roleBadge: Record<string, string> = {
  admin: "border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]",
  team_leader: "border-[#F5B021]/30 bg-[#F5B021]/10 text-[#F5B021]",
  agent: "border-[#06B6D4]/30 bg-[#06B6D4]/10 text-[#06B6D4]",
};

export function TeamManager() {
  const qc = useQueryClient();
  const [nameDialog, setNameDialog] = useState<{ mode: "create" } | { mode: "edit"; team: Team } | null>(null);
  const [teamName, setTeamName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  const [assignPick, setAssignPick] = useState<Record<string, string>>({});

  const teamsQ = useQuery({ queryKey: ["admin-teams"], queryFn: () => listTeamsFn() });
  const agentsQ = useQuery({ queryKey: ["admin-agents"], queryFn: () => listAgentsFn({}) });

  const teams = teamsQ.data?.teams ?? [];
  const agents = useMemo(
    () => (agentsQ.data?.agents ?? []).filter((a) => a.role !== "admin"),
    [agentsQ.data],
  );
  const assignedIds = useMemo(
    () => new Set(teams.flatMap((t) => t.members.map((m) => m.id))),
    [teams],
  );
  const unassignedAgents = agents.filter((a) => !assignedIds.has(a.id));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-teams"] });
    void qc.invalidateQueries({ queryKey: ["admin-agents"] });
  };

  const saveTeam = useMutation({
    mutationFn: async () => {
      const name = teamName.trim();
      if (nameDialog?.mode === "edit") {
        return updateTeamFn({ data: { id: nameDialog.team.id, name } });
      }
      return createTeamFn({ data: { name } });
    },
    onSuccess: () => {
      toast.success(nameDialog?.mode === "edit" ? "Team renamed" : "Team created");
      setNameDialog(null);
      setTeamName("");
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save team"),
  });

  const removeTeam = useMutation({
    mutationFn: (id: string) => deleteTeamFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Team deleted");
      setDeleteTarget(null);
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete team"),
  });

  const assign = useMutation({
    mutationFn: (vars: { profileId: string; teamId: string | null }) =>
      setAgentTeamFn({ data: vars }),
    onSuccess: () => {
      toast.success("Team assignment updated");
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Assignment failed"),
  });

  function openCreate() {
    setTeamName("");
    setNameDialog({ mode: "create" });
  }

  function openEdit(team: Team) {
    setTeamName(team.name);
    setNameDialog({ mode: "edit", team });
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Users className="size-5 text-[#06B6D4]" />
            Team Management
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Create teams and assign agents and team leaders. Admins are never placed in teams.
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
        >
          <Plus className="size-4" />
          New Team
        </Button>
      </div>

      {teamsQ.isLoading ? (
        <div className="rounded-xl border border-white/5 bg-[#12161F] px-4 py-16 text-center text-sm text-white/30">
          Loading teams…
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#12161F] px-4 py-16 text-center text-sm text-white/30">
          No teams yet. Click "New Team" to create one.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <div
              key={team.id}
              className="rounded-xl border border-white/10 bg-[#12161F] p-5 transition hover:border-white/15"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-white">{team.name}</h3>
                  <p className="mt-0.5 text-xs text-white/40">
                    {team.member_count} member{team.member_count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(team)}
                    className="text-white/50 hover:text-[#F5B021]"
                    aria-label="Rename team"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(team)}
                    className="text-white/50 hover:text-[#EF4444]"
                    aria-label="Delete team"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Members */}
              <div className="mt-4 space-y-1.5">
                {team.members.length === 0 && (
                  <p className="rounded-lg bg-white/[0.02] px-3 py-2 text-xs text-white/30">
                    No members assigned
                  </p>
                )}
                {team.members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{m.full_name}</p>
                      <p className="truncate text-[11px] text-white/35">
                        {m.agent_code ?? "—"} · {m.email}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roleBadge[m.role] ?? roleBadge.agent}`}
                      >
                        {m.role === "team_leader" ? "TL" : m.role.toUpperCase()}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={assign.isPending}
                        onClick={() => assign.mutate({ profileId: m.id, teamId: null })}
                        className="text-white/40 hover:text-[#EF4444]"
                        aria-label={`Remove ${m.full_name} from team`}
                        title="Remove from team"
                      >
                        <UserMinus className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Assign member */}
              <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-4">
                <Select
                  value={assignPick[team.id] ?? ""}
                  onValueChange={(v) => setAssignPick((p) => ({ ...p, [team.id]: v }))}
                >
                  <SelectTrigger className="h-9 flex-1 border-white/10 bg-white/[0.02] text-xs text-white">
                    <SelectValue placeholder="Add member…" />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedAgents.length === 0 && (
                      <SelectItem value="__none__" disabled>
                        No unassigned agents
                      </SelectItem>
                    )}
                    {unassignedAgents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.full_name} ({a.role === "team_leader" ? "TL" : "Agent"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!assignPick[team.id] || assign.isPending}
                  onClick={() => {
                    const pid = assignPick[team.id];
                    if (!pid) return;
                    assign.mutate(
                      { profileId: pid, teamId: team.id },
                      { onSuccess: () => setAssignPick((p) => ({ ...p, [team.id]: "" })) },
                    );
                  }}
                  className="border-white/10 text-white hover:border-[#06B6D4]/40 hover:text-[#06B6D4]"
                >
                  Add
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unassigned agents summary */}
      {unassignedAgents.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-[#12161F] px-4 py-3 text-xs text-white/40">
          {unassignedAgents.length} agent{unassignedAgents.length === 1 ? "" : "s"} not in any team:{" "}
          {unassignedAgents.map((a) => a.full_name).join(", ")}
        </div>
      )}

      {/* Create / rename dialog */}
      <Dialog open={Boolean(nameDialog)} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent className="border-white/10 bg-[#12161F] text-white">
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === "edit" ? "Rename team" : "New team"}</DialogTitle>
          </DialogHeader>
          <Input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            maxLength={60}
            onKeyDown={(e) => e.key === "Enter" && teamName.trim().length >= 2 && saveTeam.mutate()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNameDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveTeam.mutate()}
              disabled={teamName.trim().length < 2 || saveTeam.isPending}
              className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
            >
              {saveTeam.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="border-white/10 bg-[#12161F] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              This permanently deletes the team "{deleteTarget?.name}".
              {deleteTarget && deleteTarget.member_count > 0
                ? ` It still has ${deleteTarget.member_count} member(s) — remove them first.`
                : " This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) removeTeam.mutate(deleteTarget.id);
              }}
              disabled={removeTeam.isPending || (deleteTarget?.member_count ?? 0) > 0}
              className="bg-[#EF4444] text-white hover:bg-[#EF4444]/90"
            >
              {removeTeam.isPending ? "Deleting…" : "Delete team"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  ListFilter,
  PhoneCall,
  Plus,
  Trash2,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  getLeadListsFn,
  toggleListActiveFn,
  flushLeadListFn,
  deleteLeadListFn,
  type LeadList,
} from "@/server/lead-list-functions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { LeadImporterModal } from "./LeadImporterModal";

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Users;
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

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso.slice(0, 10) + "T12:00:00Z"));
}

// ----------------------------------------------------
// Main View
// ----------------------------------------------------

export function LeadListManager() {
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [preselectList, setPreselectList] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [flushTarget, setFlushTarget] = useState<LeadList | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LeadList | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const listsQ = useQuery({
    queryKey: ["admin-lead-lists"],
    queryFn: async () => await getLeadListsFn(),
    refetchInterval: 15000,
  });

  const lists = listsQ.data?.lists ?? [];

  const stats = useMemo(() => {
    const totalLists = lists.length;
    const totalLeads = lists.reduce((sum, l) => sum + l.totalLeads, 0);
    const remaining = lists.reduce((sum, l) => sum + (l.totalLeads - l.dialedLeads), 0);
    const activeLists = lists.filter((l) => l.active && l.totalLeads > 0);
    const totalDialed = activeLists.reduce((sum, l) => sum + l.dialedLeads, 0);
    const totalLeadsActive = activeLists.reduce((sum, l) => sum + l.totalLeads, 0);
    const avgConnect =
      totalLeadsActive > 0 ? Math.round((totalDialed / totalLeadsActive) * 100) : 0;
    return { totalLists, totalLeads, remaining, avgConnect };
  }, [lists]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-lead-lists"] });
    void qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
  };

  const handleUpload = (list?: LeadList) => {
    setPreselectList(list?.id ?? null);
    setImportOpen(true);
  };

  const handleToggle = async (list: LeadList) => {
    setTogglingId(list.id);
    try {
      await toggleListActiveFn({ data: { id: list.id, active: !list.active } });
      toast.success(list.active ? "List paused" : "List activated");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle list");
    } finally {
      setTogglingId(null);
    }
  };

  const handleFlush = async () => {
    if (!flushTarget) return;
    setActionBusy(flushTarget.id);
    try {
      const res = await flushLeadListFn({ data: { id: flushTarget.id } });
      toast.success(`Flushed ${res.removed} undialed leads`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to flush list");
    } finally {
      setActionBusy(null);
      setFlushTarget(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionBusy(deleteTarget.id);
    try {
      await deleteLeadListFn({ data: { id: deleteTarget.id } });
      toast.success("List deleted");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete list");
    } finally {
      setActionBusy(null);
      setDeleteTarget(null);
    }
  };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <ListFilter className="size-5 text-[#F5B021]" />
            Lead Upload & List Management
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Upload CSV lead lists, map columns, scrub data, and assign to campaigns — no VICIdial admin required.
          </p>
        </div>
        <Button
          onClick={() => handleUpload()}
          className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
        >
          <Upload className="size-4" />
          Upload & Import Leads
        </Button>
      </div>

      {/* Top Metric Cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Database}
          label="Total Lead Lists"
          value={stats.totalLists}
          accent="text-[#F5B021]/50"
        />
        <StatCard
          icon={Users}
          label="Total Ingested Leads"
          value={stats.totalLeads.toLocaleString()}
          accent="text-[#06B6D4]/50"
        />
        <StatCard
          icon={PhoneCall}
          label="Remaining to Dial"
          value={stats.remaining.toLocaleString()}
          accent="text-[#22C55E]/50"
        />
        <StatCard
          icon={Zap}
          label="Avg Connect Rate"
          value={`${stats.avgConnect}%`}
          accent="text-[#D44B2E]/50"
        />
      </div>

      {/* Lists Table */}
      {listsQ.isLoading ? (
        <div className="rounded-xl border border-white/5 bg-[#12161F] px-4 py-16 text-center text-sm text-white/30">
          Loading lead lists…
        </div>
      ) : listsQ.isError ? (
        <div className="rounded-xl border border-[#EF4444]/20 bg-[#EF4444]/5 px-4 py-16 text-center text-sm text-[#EF4444]">
          Failed to load lead lists.{" "}
          <Button variant="link" onClick={() => void listsQ.refetch()} className="text-[#F5B021]">
            Retry
          </Button>
        </div>
      ) : lists.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#12161F] px-4 py-16 text-center text-sm text-white/30">
          No lead lists yet. Click "Upload & Import Leads" to create your first list.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#12161F]">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="bg-white/[0.02] text-xs uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3 font-semibold">List</th>
                <th className="px-4 py-3 font-semibold">Campaign</th>
                <th className="px-4 py-3 font-semibold">Total Leads</th>
                <th className="px-4 py-3 font-semibold">Dialed / Remaining</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold">Active</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((list) => {
                const remaining = list.totalLeads - list.dialedLeads;
                const dialedPct =
                  list.totalLeads > 0
                    ? Math.round((list.dialedLeads / list.totalLeads) * 100)
                    : 0;
                return (
                  <tr
                    key={list.id}
                    className="border-t border-white/5 transition hover:bg-white/[0.02]"
                  >
                    {/* List ID badge + name */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white/50">
                          {list.listId}
                        </span>
                        <span className="truncate font-semibold text-white">{list.name}</span>
                      </div>
                    </td>

                    {/* Campaign pill */}
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center rounded-full border border-[#06B6D4]/20 bg-[#06B6D4]/10 px-2.5 py-1 text-xs font-semibold text-[#06B6D4]">
                        {list.campaignName}
                      </span>
                    </td>

                    {/* Total leads */}
                    <td className="px-4 py-4 font-mono font-semibold text-white">
                      {list.totalLeads.toLocaleString()}
                    </td>

                    {/* Dialed / Remaining with progress bar */}
                    <td className="px-4 py-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono text-white/60">
                            {list.dialedLeads.toLocaleString()} / {remaining.toLocaleString()}
                          </span>
                          <span className="font-semibold text-[#F5B021]">{dialedPct}%</span>
                        </div>
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/5">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#E07C2A] to-[#F5B021] transition-all"
                            style={{ width: `${dialedPct}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Created date */}
                    <td className="px-4 py-4 text-xs text-white/50">
                      {formatDate(list.createdAt)}
                    </td>

                    {/* Active switch */}
                    <td className="px-4 py-4">
                      <Switch
                        checked={list.active}
                        disabled={togglingId === list.id}
                        onCheckedChange={() => void handleToggle(list)}
                      />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUpload(list)}
                          className="border-white/10 text-white hover:border-[#F5B021]/40 hover:text-[#F5B021]"
                        >
                          <Upload className="size-3.5" />
                          Upload
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setFlushTarget(list)}
                          disabled={actionBusy === list.id}
                          className="border-white/10 text-white hover:border-[#06B6D4]/40 hover:text-[#06B6D4]"
                        >
                          <Zap className="size-3.5" />
                          Flush
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setDeleteTarget(list)}
                          disabled={actionBusy === list.id}
                          className="border-white/10 text-white/40 hover:border-[#EF4444]/40 hover:text-[#EF4444]"
                          aria-label="Delete list"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Importer Modal */}
      <LeadImporterModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={refresh}
        preselectListId={preselectList}
      />

      {/* Flush confirmation */}
      <AlertDialog open={Boolean(flushTarget)} onOpenChange={(open) => !open && setFlushTarget(null)}>
        <AlertDialogContent className="border-white/10 bg-[#12161F] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="size-5 text-[#06B6D4]" />
              Flush Undialed Leads
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              This will permanently remove all undialed leads from{" "}
              <span className="font-semibold text-white">{flushTarget?.name}</span>. Dialed leads
              and their call history will be preserved. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFlush}
              className="bg-[#06B6D4] text-black hover:opacity-90"
            >
              Flush Leads
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="border-white/10 bg-[#12161F] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5 text-[#EF4444]" />
              Delete Lead List
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              This will permanently delete{" "}
              <span className="font-semibold text-white">{deleteTarget?.name}</span> and all of its
              leads (including dialed ones). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-[#EF4444] text-white hover:opacity-90"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

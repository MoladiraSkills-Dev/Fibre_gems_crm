import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Phone,
  Users,
  Radio,
  List,
  PhoneCall,
  Disc3,
  Activity,
  Pencil,
  Plus,
  Trash2,
  Search,
  ShieldBan,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  getVicidialOverviewFn,
  getVicidialPhonesFn,
  updateVicidialPhoneFn,
  getVicidialUsersFn,
  getVicidialCarriersFn,
  createVicidialCarrierFn,
  updateVicidialCarrierFn,
  deleteVicidialCarrierFn,
  getVicidialPauseCodesFn,
  getVicidialListsFn,
  getVicidialDncFn,
  addVicidialDncFn,
  removeVicidialDncFn,
  getVicidialCallsFn,
  getVicidialRecordingsFn,
  getVicidialLiveAgentsFn,
  createVicidialPhoneFn,
  createVicidialUserFn,
  updateVicidialUserFn,
  deleteVicidialUserFn,
  createVicidialPauseCodeFn,
  deleteVicidialPauseCodeFn,
  getRecordingPlayUrlFn,
  type VicidialPhone,
  type VicidialCarrier,
  type VicidialUser,
} from "@/server/vicidial-admin-functions";

// ----------------------------------------------------
// Small shared bits
// ----------------------------------------------------

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#12161F] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-white/40">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-sm text-white/80 ${className}`}>{children}</td>;
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-8 text-center text-sm text-white/30">
        {text}
      </td>
    </tr>
  );
}

const mask = (v: string | null | undefined) => (v ? "••••••••" : "—");
const fmtDt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-ZA", { hour12: false }) : "—";
const fmtDur = (s: number | null | undefined) =>
  s == null ? "—" : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

// ----------------------------------------------------
// Component
// ----------------------------------------------------

export function VicidialAdmin() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("phones");

  const overviewQ = useQuery({ queryKey: ["vici-overview"], queryFn: () => getVicidialOverviewFn() });
  const refreshAll = () => {
    for (const k of ["vici-overview", "vici-phones", "vici-users", "vici-carriers", "vici-lists", "vici-dnc", "vici-calls", "vici-recordings", "vici-live", "vici-pause"]) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };

  const ov = overviewQ.data;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-white">
          <Radio className="size-5 text-[#06B6D4]" />
          VICIdial Administration
        </h2>
        <p className="mt-1 text-sm text-white/50">
          Live dialer configuration and telemetry — read directly from the VICIdial database.
        </p>
      </div>

      {ov && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Phones" value={ov.phones} />
          <Stat label="Users" value={ov.users} />
          <Stat label="Campaigns" value={ov.campaigns} />
          <Stat label="Lists" value={ov.lists} />
          <Stat label="Leads" value={ov.leads} />
          <Stat label="Live Agents" value={ov.live_agents} />
          <Stat label="Calls Today" value={ov.calls_today} />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap gap-1 border border-white/10 bg-[#12161F] p-1">
          <TabsTrigger value="phones" className="text-xs"><Phone className="mr-1 size-3.5" />Phones</TabsTrigger>
          <TabsTrigger value="users" className="text-xs"><Users className="mr-1 size-3.5" />Users</TabsTrigger>
          <TabsTrigger value="carriers" className="text-xs"><Radio className="mr-1 size-3.5" />Carriers</TabsTrigger>
          <TabsTrigger value="lists" className="text-xs"><List className="mr-1 size-3.5" />Lists & DNC</TabsTrigger>
          <TabsTrigger value="calls" className="text-xs"><PhoneCall className="mr-1 size-3.5" />Call Log</TabsTrigger>
          <TabsTrigger value="recordings" className="text-xs"><Disc3 className="mr-1 size-3.5" />Recordings</TabsTrigger>
          <TabsTrigger value="live" className="text-xs"><Activity className="mr-1 size-3.5" />Live Agents</TabsTrigger>
        </TabsList>

        <TabsContent value="phones" className="mt-4"><PhonesTab onChanged={refreshAll} /></TabsContent>
        <TabsContent value="users" className="mt-4"><UsersTab onChanged={refreshAll} /></TabsContent>
        <TabsContent value="carriers" className="mt-4"><CarriersTab onChanged={refreshAll} /></TabsContent>
        <TabsContent value="lists" className="mt-4"><ListsDncTab onChanged={refreshAll} /></TabsContent>
        <TabsContent value="calls" className="mt-4"><CallsTab /></TabsContent>
        <TabsContent value="recordings" className="mt-4"><RecordingsTab /></TabsContent>
        <TabsContent value="live" className="mt-4"><LiveAgentsTab /></TabsContent>
      </Tabs>
    </section>
  );
}

// ----------------------------------------------------
// Phones
// ----------------------------------------------------

function PhonesTab({ onChanged }: { onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<VicidialPhone | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VicidialPhone | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ extension: "", phone_full_name: "", phone_login: "", phone_pass: "" });
  const [form, setForm] = useState({ phone_full_name: "", phone_login: "", phone_pass: "", phone_context: "default", local_gmt: "2.00" });

  const q = useQuery({ queryKey: ["vici-phones"], queryFn: () => getVicidialPhonesFn() });
  const phones = useMemo(() => {
    const rows = q.data ?? [];
    const s = search.toLowerCase();
    return s ? rows.filter((p) => `${p.extension} ${p.login} ${p.fullname ?? ""} ${p.server_ip}`.toLowerCase().includes(s)) : rows;
  }, [q.data, search]);

  const save = useMutation({
    mutationFn: () =>
      updateVicidialPhoneFn({
        data: {
          extension: editTarget!.extension,
          server_ip: editTarget!.server_ip,
          ...(form.phone_full_name ? { phone_full_name: form.phone_full_name } : {}),
          ...(form.phone_login ? { phone_login: form.phone_login } : {}),
          ...(form.phone_pass ? { phone_pass: form.phone_pass } : {}),
          ...(form.phone_context ? { phone_context: form.phone_context } : {}),
          ...(form.local_gmt ? { local_gmt: form.local_gmt } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Phone updated in VICIdial");
      setEditTarget(null);
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const del = useMutation({
    mutationFn: () =>
      updateVicidialPhoneFn({
        data: { extension: deleteTarget!.extension, server_ip: deleteTarget!.server_ip, delete_phone: "Y" },
      }),
    onSuccess: () => {
      toast.success(`Phone ${deleteTarget?.extension} deleted`);
      setDeleteTarget(null);
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const create = useMutation({
    mutationFn: () =>
      createVicidialPhoneFn({
        data: {
          extension: createForm.extension.trim(),
          ...(createForm.phone_full_name.trim() ? { phone_full_name: createForm.phone_full_name.trim() } : {}),
          ...(createForm.phone_login.trim() ? { phone_login: createForm.phone_login.trim() } : {}),
          ...(createForm.phone_pass ? { phone_pass: createForm.phone_pass } : {}),
        },
      }),
    onSuccess: (res) => {
      toast.success(`Phone ${createForm.extension} created${res.sip_password ? ` — SIP password: ${res.sip_password}` : ""}`);
      setCreateOpen(false);
      setCreateForm({ extension: "", phone_full_name: "", phone_login: "", phone_pass: "" });
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search extension, login, name…" className="pl-9" />
        </div>
        <span className="text-xs text-white/40">{phones.length} phones</span>
        <Button size="sm" onClick={() => setCreateOpen(true)}
          className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90">
          <Plus className="mr-1 size-3.5" /> Add phone
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[900px] text-left">
          <thead className="bg-white/[0.02]">
            <tr>
              <Th>Ext</Th><Th>Login</Th><Th>Name</Th><Th>Protocol</Th><Th>Server</Th><Th>Status</Th><Th>Context</Th><Th>Pass</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <EmptyRow cols={9} text="Loading phones…" />}
            {!q.isLoading && phones.length === 0 && <EmptyRow cols={9} text="No phones found" />}
            {phones.map((p) => (
              <tr key={`${p.extension}-${p.server_ip}`} className="border-t border-white/5 hover:bg-white/[0.02]">
                <Td className="font-mono font-semibold text-[#06B6D4]">{p.extension}</Td>
                <Td className="font-mono">{p.login}</Td>
                <Td>{p.fullname || "—"}</Td>
                <Td>{p.protocol || "—"}</Td>
                <Td className="font-mono text-xs">{p.server_ip}</Td>
                <Td>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${p.active === "Y" || p.status === "ACTIVE" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-white/20 bg-white/5 text-white/50"}`}>
                    {p.status || p.active || "—"}
                  </span>
                </Td>
                <Td className="text-xs">{p.phone_context || "default"}</Td>
                <Td className="font-mono text-xs text-white/40">{mask(p.pass)}</Td>
                <Td className="whitespace-nowrap">
                  <Button variant="ghost" size="sm" className="text-white/50 hover:text-[#F5B021]"
                    onClick={() => {
                      setEditTarget(p);
                      setForm({ phone_full_name: p.fullname ?? "", phone_login: p.login ?? "", phone_pass: "", phone_context: p.phone_context ?? "default", local_gmt: p.local_gmt ?? "2.00" });
                    }}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-white/50 hover:text-[#EF4444]" onClick={() => setDeleteTarget(p)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create phone */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-white/10 bg-[#12161F] text-white">
          <DialogHeader><DialogTitle>Add SIP phone</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">Extension *</Label>
                <Input value={createForm.extension} onChange={(e) => setCreateForm({ ...createForm, extension: e.target.value })} placeholder="e.g. 111" className="font-mono" /></div>
              <div><Label className="text-xs text-white/60">Full name</Label>
                <Input value={createForm.phone_full_name} onChange={(e) => setCreateForm({ ...createForm, phone_full_name: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">Phone login (blank = extension)</Label>
                <Input value={createForm.phone_login} onChange={(e) => setCreateForm({ ...createForm, phone_login: e.target.value })} className="font-mono" /></div>
              <div><Label className="text-xs text-white/60">SIP password (blank = auto)</Label>
                <Input type="password" value={createForm.phone_pass} onChange={(e) => setCreateForm({ ...createForm, phone_pass: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !createForm.extension.trim()}
              className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90">
              {create.isPending ? "Creating…" : "Create in VICIdial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit phone */}
      <Dialog open={Boolean(editTarget)} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="border-white/10 bg-[#12161F] text-white">
          <DialogHeader><DialogTitle>Edit phone {editTarget?.extension}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="text-xs text-white/60">Full name</Label>
              <Input value={form.phone_full_name} onChange={(e) => setForm({ ...form, phone_full_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">Phone login</Label>
                <Input value={form.phone_login} onChange={(e) => setForm({ ...form, phone_login: e.target.value })} /></div>
              <div><Label className="text-xs text-white/60">New password (blank = keep)</Label>
                <Input type="password" value={form.phone_pass} onChange={(e) => setForm({ ...form, phone_pass: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">Context</Label>
                <Input value={form.phone_context} onChange={(e) => setForm({ ...form, phone_context: e.target.value })} /></div>
              <div><Label className="text-xs text-white/60">Local GMT</Label>
                <Input value={form.local_gmt} onChange={(e) => setForm({ ...form, local_gmt: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}
              className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90">
              {save.isPending ? "Saving…" : "Save to VICIdial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="border-white/10 bg-[#12161F] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete phone {deleteTarget?.extension}?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              This permanently removes the phone from VICIdial. Any agent using this extension will lose registration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); del.mutate(); }}
              className="bg-[#EF4444] text-white hover:bg-[#EF4444]/90">
              {del.isPending ? "Deleting…" : "Delete phone"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ----------------------------------------------------
// Users
// ----------------------------------------------------

function UsersTab({ onChanged }: { onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VicidialUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VicidialUser | null>(null);
  const [createForm, setCreateForm] = useState({ agent_user: "", agent_pass: "", agent_full_name: "", phone_login: "", phone_pass: "", email: "", agent_user_level: "1", agent_user_group: "AGENTS" });
  const [editForm, setEditForm] = useState({ full_name: "", phone_login: "", pass_: "", active: "Y" });

  const q = useQuery({ queryKey: ["vici-users"], queryFn: () => getVicidialUsersFn() });
  const users = useMemo(() => {
    const rows = q.data ?? [];
    const s = search.toLowerCase();
    return s ? rows.filter((u) => `${u.user} ${u.full_name ?? ""} ${u.user_group ?? ""} ${u.phone_login ?? ""}`.toLowerCase().includes(s)) : rows;
  }, [q.data, search]);

  const create = useMutation({
    mutationFn: () =>
      createVicidialUserFn({
        data: {
          agent_user: createForm.agent_user.trim(),
          agent_pass: createForm.agent_pass,
          agent_user_level: Number(createForm.agent_user_level) || 1,
          agent_user_group: createForm.agent_user_group || "AGENTS",
          ...(createForm.agent_full_name.trim() ? { agent_full_name: createForm.agent_full_name.trim() } : {}),
          ...(createForm.phone_login.trim() ? { phone_login: createForm.phone_login.trim() } : {}),
          ...(createForm.phone_pass ? { phone_pass: createForm.phone_pass } : {}),
          ...(createForm.email.trim() ? { email: createForm.email.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("VICIdial user created");
      setCreateOpen(false);
      setCreateForm({ agent_user: "", agent_pass: "", agent_full_name: "", phone_login: "", phone_pass: "", email: "", agent_user_level: "1", agent_user_group: "AGENTS" });
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const save = useMutation({
    mutationFn: () =>
      updateVicidialUserFn({
        data: {
          user: editTarget!.user,
          ...(editForm.full_name ? { full_name: editForm.full_name } : {}),
          ...(editForm.phone_login ? { phone_login: editForm.phone_login } : {}),
          active: editForm.active,
          ...(editForm.pass_ ? { pass_: editForm.pass_ } : {}),
        },
      }),
    onSuccess: () => {
      toast.success(`User ${editTarget?.user} updated`);
      setEditTarget(null);
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteVicidialUserFn({ data: { user: deleteTarget!.user } }),
    onSuccess: () => {
      toast.success(`User ${deleteTarget?.user} deactivated`);
      setDeleteTarget(null);
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Deactivate failed"),
  });

  const isProtected = (u: string) => ["6666", "FG_API", "9001", "VDAD", "VDCL"].includes(u.toUpperCase());

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, name, group…" className="pl-9" />
        </div>
        <span className="text-xs text-white/40">{users.length} users</span>
        <Button size="sm" onClick={() => setCreateOpen(true)}
          className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90">
          <Plus className="mr-1 size-3.5" /> Add user
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[900px] text-left">
          <thead className="bg-white/[0.02]">
            <tr>
              <Th>User</Th><Th>Name</Th><Th>Level</Th><Th>Group</Th><Th>Phone</Th><Th>Active</Th><Th>AST Admin</Th><Th>Modify Users</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <EmptyRow cols={9} text="Loading users…" />}
            {users.map((u) => (
              <tr key={u.user} className="border-t border-white/5 hover:bg-white/[0.02]">
                <Td className="font-mono font-semibold text-[#06B6D4]">{u.user}</Td>
                <Td>{u.full_name || "—"}</Td>
                <Td>{u.user_level ?? "—"}</Td>
                <Td>{u.user_group || "—"}</Td>
                <Td className="font-mono text-xs">{u.phone_login || "—"}</Td>
                <Td>{u.active === "Y" ? <span className="text-emerald-400">Y</span> : <span className="text-white/40">{u.active ?? "—"}</span>}</Td>
                <Td>{u.ast_admin_access === "Y" ? <span className="text-emerald-400">Y</span> : <span className="text-white/40">{u.ast_admin_access ?? "—"}</span>}</Td>
                <Td>{u.modify_users === "Y" ? <span className="text-emerald-400">Y</span> : <span className="text-white/40">{u.modify_users ?? "—"}</span>}</Td>
                <Td className="whitespace-nowrap">
                  {!isProtected(u.user) && (
                    <>
                      <Button variant="ghost" size="sm" className="text-white/50 hover:text-[#F5B021]"
                        onClick={() => {
                          setEditTarget(u);
                          setEditForm({ full_name: u.full_name ?? "", phone_login: u.phone_login ?? "", pass_: "", active: u.active ?? "Y" });
                        }}>
                        <Pencil className="size-3.5" />
                      </Button>
                      {u.active === "Y" && (
                        <Button variant="ghost" size="sm" className="text-white/50 hover:text-[#EF4444]" onClick={() => setDeleteTarget(u)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create user */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-white/10 bg-[#12161F] text-white">
          <DialogHeader><DialogTitle>Add VICIdial user</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">Username *</Label>
                <Input value={createForm.agent_user} onChange={(e) => setCreateForm({ ...createForm, agent_user: e.target.value })} className="font-mono" placeholder="AGT500" /></div>
              <div><Label className="text-xs text-white/60">Password *</Label>
                <Input type="password" value={createForm.agent_pass} onChange={(e) => setCreateForm({ ...createForm, agent_pass: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">Full name</Label>
                <Input value={createForm.agent_full_name} onChange={(e) => setCreateForm({ ...createForm, agent_full_name: e.target.value })} /></div>
              <div><Label className="text-xs text-white/60">Email</Label>
                <Input value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs text-white/60">Level (1=agent, 4=TL, 9=admin)</Label>
                <Input value={createForm.agent_user_level} onChange={(e) => setCreateForm({ ...createForm, agent_user_level: e.target.value })} className="font-mono" /></div>
              <div><Label className="text-xs text-white/60">Group</Label>
                <Input value={createForm.agent_user_group} onChange={(e) => setCreateForm({ ...createForm, agent_user_group: e.target.value })} /></div>
              <div><Label className="text-xs text-white/60">Phone ext</Label>
                <Input value={createForm.phone_login} onChange={(e) => setCreateForm({ ...createForm, phone_login: e.target.value })} className="font-mono" /></div>
            </div>
            <div><Label className="text-xs text-white/60">Phone password (blank = same as user password)</Label>
              <Input type="password" value={createForm.phone_pass} onChange={(e) => setCreateForm({ ...createForm, phone_pass: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !createForm.agent_user.trim() || !createForm.agent_pass}
              className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90">
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit user */}
      <Dialog open={Boolean(editTarget)} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="border-white/10 bg-[#12161F] text-white">
          <DialogHeader><DialogTitle>Edit user {editTarget?.user}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">Full name</Label>
                <Input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} /></div>
              <div><Label className="text-xs text-white/60">Phone login</Label>
                <Input value={editForm.phone_login} onChange={(e) => setEditForm({ ...editForm, phone_login: e.target.value })} className="font-mono" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">New password (blank = keep)</Label>
                <Input type="password" value={editForm.pass_} onChange={(e) => setEditForm({ ...editForm, pass_: e.target.value })} /></div>
              <div><Label className="text-xs text-white/60">Active</Label>
                <select value={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.value })}
                  className="h-9 w-full rounded-md border border-white/10 bg-[#0B0E14] px-3 text-sm text-white">
                  <option value="Y">Y — active</option>
                  <option value="N">N — inactive</option>
                </select></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}
              className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90">
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="border-white/10 bg-[#12161F] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate user {deleteTarget?.user}?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              The user stays in VICIdial but can no longer log in. You can re-activate them later via Edit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); del.mutate(); }}
              className="bg-[#EF4444] text-white hover:bg-[#EF4444]/90">
              {del.isPending ? "Deactivating…" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ----------------------------------------------------
// Carriers
// ----------------------------------------------------

function CarriersTab({ onChanged }: { onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<VicidialCarrier | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ carrier_name: "", server_ip: "10.0.0.128", protocol: "SIP", registration_string: "", dialplan_entry: "", carrier_description: "", user_group: "", active: "Y" });
  const [deleteTarget, setDeleteTarget] = useState<VicidialCarrier | null>(null);

  const q = useQuery({ queryKey: ["vici-carriers"], queryFn: () => getVicidialCarriersFn() });
  const carriers = useMemo(() => {
    const rows = q.data ?? [];
    const s = search.toLowerCase();
    return s ? rows.filter((c) => `${c.carrier_id} ${c.carrier_name ?? ""} ${c.server_ip ?? ""}`.toLowerCase().includes(s)) : rows;
  }, [q.data, search]);

  const save = useMutation({
    mutationFn: () =>
      editTarget
        ? updateVicidialCarrierFn({ data: { carrier_id: editTarget.carrier_id, ...form } })
        : createVicidialCarrierFn({ data: { carrier_id: (form as any).carrier_id || `CARRIER${Date.now() % 100000}`, ...form } }),
    onSuccess: () => {
      toast.success(editTarget ? "Carrier updated" : "Carrier created");
      setEditTarget(null); setCreateOpen(false); onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteVicidialCarrierFn({ data: { carrier_id: id } }),
    onSuccess: () => { toast.success("Carrier deleted"); setDeleteTarget(null); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const openCreate = () => {
    setForm({ carrier_name: "", server_ip: "10.0.0.128", protocol: "SIP", registration_string: "", dialplan_entry: "", carrier_description: "", user_group: "", active: "Y" });
    setCreateOpen(true);
  };
  const openEdit = (c: VicidialCarrier) => {
    setEditTarget(c);
    setForm({
      carrier_name: c.carrier_name ?? "", server_ip: c.server_ip ?? "10.0.0.128",
      protocol: c.protocol ?? "SIP", registration_string: c.registration_string ?? "",
      dialplan_entry: c.dialplan_entry ?? "", carrier_description: c.carrier_description ?? "",
      user_group: c.user_group ?? "", active: c.active ?? "Y",
    });
  };

  const dialogOpen = createOpen || Boolean(editTarget);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search carrier…" className="pl-9" />
        </div>
        <span className="text-xs text-white/40">{carriers.length} carriers</span>
        <Button size="sm" onClick={openCreate} className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90">
          <Plus className="size-4" /> Carrier
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[900px] text-left">
          <thead className="bg-white/[0.02]">
            <tr>
              <Th>ID</Th><Th>Name</Th><Th>Protocol</Th><Th>Server</Th><Th>Dialplan</Th><Th>User Group</Th><Th>Active</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <EmptyRow cols={8} text="Loading carriers…" />}
            {carriers.map((c) => (
              <tr key={c.carrier_id} className="border-t border-white/5 hover:bg-white/[0.02]">
                <Td className="font-mono font-semibold text-[#06B6D4]">{c.carrier_id}</Td>
                <Td>{c.carrier_name || "—"}</Td>
                <Td>{c.protocol || "—"}</Td>
                <Td className="font-mono text-xs">{c.server_ip || "—"}</Td>
                <Td className="font-mono text-xs">{c.dialplan_entry || "—"}</Td>
                <Td>{c.user_group || "—"}</Td>
                <Td>{c.active === "Y" ? <span className="text-emerald-400">Y</span> : <span className="text-white/40">{c.active ?? "—"}</span>}</Td>
                <Td className="whitespace-nowrap">
                  <Button variant="ghost" size="sm" className="text-white/50 hover:text-[#F5B021]" onClick={() => openEdit(c)}><Pencil className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="text-white/50 hover:text-[#EF4444]" onClick={() => setDeleteTarget(c)}><Trash2 className="size-3.5" /></Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-white/30">
        Carriers are SIP trunks used for outbound routing. Registration/account fields map to the carrier's provider credentials — VICIdial generates the Asterisk config from these rows.
      </p>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditTarget(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#12161F] text-white">
          <DialogHeader><DialogTitle>{editTarget ? `Edit carrier ${editTarget.carrier_id}` : "New carrier"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {!editTarget && (
              <div><Label className="text-xs text-white/60">Carrier ID (unique)</Label>
                <Input value={(form as any).carrier_id ?? ""} onChange={(e) => setForm({ ...form, carrier_id: e.target.value } as any)} placeholder="e.g. BT_ELEVEN" /></div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">Carrier name</Label>
                <Input value={form.carrier_name} onChange={(e) => setForm({ ...form, carrier_name: e.target.value })} /></div>
              <div><Label className="text-xs text-white/60">Server IP</Label>
                <Input value={form.server_ip} onChange={(e) => setForm({ ...form, server_ip: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-white/60">Protocol</Label>
                <Input value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })} placeholder="SIP or IAX2" /></div>
              <div><Label className="text-xs text-white/60">User group</Label>
                <Input value={form.user_group} onChange={(e) => setForm({ ...form, user_group: e.target.value })} placeholder="AGENTS" /></div>
            </div>
            <div><Label className="text-xs text-white/60">Registration string</Label>
              <Input value={form.registration_string} onChange={(e) => setForm({ ...form, registration_string: e.target.value })} placeholder="user:pass@provider.com" /></div>
            <div><Label className="text-xs text-white/60">Dialplan entry</Label>
              <Input value={form.dialplan_entry} onChange={(e) => setForm({ ...form, dialplan_entry: e.target.value })} placeholder="e.g. PJSIP/ or SIP/" /></div>
            <div><Label className="text-xs text-white/60">Description</Label>
              <Input value={form.carrier_description} onChange={(e) => setForm({ ...form, carrier_description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditTarget(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || (!editTarget && !(form as any).carrier_id?.trim())}
              className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90">
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="border-white/10 bg-[#12161F] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete carrier {deleteTarget?.carrier_id}?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              Removes the trunk from VICIdial. Calls routed through this carrier will fail until it is restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (deleteTarget) del.mutate(deleteTarget.carrier_id); }}
              className="bg-[#EF4444] text-white hover:bg-[#EF4444]/90">
              {del.isPending ? "Deleting…" : "Delete carrier"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ----------------------------------------------------
// Lists & DNC
// ----------------------------------------------------

function ListsDncTab({ onChanged }: { onChanged: () => void }) {
  const [dncInput, setDncInput] = useState("");
  const [pcCode, setPcCode] = useState("");
  const [pcName, setPcName] = useState("");
  const listsQ = useQuery({ queryKey: ["vici-lists"], queryFn: () => getVicidialListsFn() });
  const dncQ = useQuery({ queryKey: ["vici-dnc"], queryFn: () => getVicidialDncFn() });
  const pauseQ = useQuery({ queryKey: ["vici-pause"], queryFn: () => getVicidialPauseCodesFn() });

  const addDnc = useMutation({
    mutationFn: (phone: string) => addVicidialDncFn({ data: { phone_number: phone } }),
    onSuccess: () => { toast.success("Number added to DNC"); setDncInput(""); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const removeDnc = useMutation({
    mutationFn: (phone: string) => removeVicidialDncFn({ data: { phone_number: phone } }),
    onSuccess: () => { toast.success("Number removed from DNC"); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const pcAdd = useMutation({
    mutationFn: () =>
      createVicidialPauseCodeFn({
        data: { pause_code: pcCode.trim(), pause_code_name: pcName.trim(), campaign_id: "1001" },
      }),
    onSuccess: () => { toast.success("Pause code added"); setPcCode(""); setPcName(""); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const pcDel = useMutation({
    mutationFn: (code: string) => deleteVicidialPauseCodeFn({ data: { pause_code: code } }),
    onSuccess: () => { toast.success("Pause code deleted"); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">VICIdial Lists</div>
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-[#12161F]"><tr><Th>ID</Th><Th>Name</Th><Th>Campaign</Th><Th>Leads</Th><Th>Active</Th></tr></thead>
            <tbody>
              {(listsQ.data ?? []).map((l) => (
                <tr key={l.list_id} className="border-t border-white/5">
                  <Td className="font-mono font-semibold text-[#06B6D4]">{l.list_id}</Td>
                  <Td>{l.list_name || "—"}</Td>
                  <Td className="font-mono text-xs">{l.campaign_id || "—"}</Td>
                  <Td>{l.lead_count}</Td>
                  <Td>{l.active === "Y" || l.active === "1" ? <span className="text-emerald-400">Y</span> : <span className="text-white/40">{l.active ?? "—"}</span>}</Td>
                </tr>
              ))}
              {listsQ.data?.length === 0 && <EmptyRow cols={5} text="No lists" />}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-white/10">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">
            <ShieldBan className="size-4 text-[#EF4444]" /> DNC List ({dncQ.data?.length ?? 0})
          </div>
          <div className="flex gap-2 p-3">
            <Input value={dncInput} onChange={(e) => setDncInput(e.target.value)} placeholder="Phone number e.g. 27821234567" className="font-mono" />
            <Button size="sm" disabled={!dncInput.trim() || addDnc.isPending} onClick={() => addDnc.mutate(dncInput.trim())}
              className="bg-[#EF4444] text-white hover:bg-[#EF4444]/90">Add</Button>
          </div>
          <div className="max-h-[300px] overflow-y-auto px-3 pb-3">
            {(dncQ.data ?? []).slice(0, 200).map((n) => (
              <div key={n} className="flex items-center justify-between border-b border-white/5 py-1.5 text-sm">
                <span className="font-mono text-white/80">{n}</span>
                <Button variant="ghost" size="sm" className="text-white/40 hover:text-[#EF4444]" onClick={() => removeDnc.mutate(n)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            {(dncQ.data?.length ?? 0) === 0 && <p className="py-4 text-center text-xs text-white/30">DNC list is empty</p>}
          </div>
        </div>

        <div className="rounded-xl border border-white/10">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-semibold text-white">Pause Codes ({pauseQ.data?.length ?? 0})</span>
          </div>
          <div className="flex gap-2 p-3">
            <Input value={pcCode} onChange={(e) => setPcCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="Code (max 6)" className="w-28 font-mono uppercase" />
            <Input value={pcName} onChange={(e) => setPcName(e.target.value)} placeholder="Name e.g. Lunch Break" className="flex-1" />
            <Button size="sm" disabled={!pcCode.trim() || !pcName.trim() || pcAdd.isPending}
              onClick={() => pcAdd.mutate()} className="bg-[#F5B021] text-black hover:bg-[#F5B021]/90">Add</Button>
          </div>
          <div className="max-h-[220px] overflow-y-auto px-3 pb-3">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-[#12161F]"><tr><Th>Code</Th><Th>Name</Th><Th>Billable</Th><Th>Campaign</Th><Th>Time Limit</Th><Th></Th></tr></thead>
              <tbody>
                {(pauseQ.data ?? []).map((p: any) => (
                  <tr key={p.pause_code} className="border-t border-white/5">
                    <Td className="font-mono font-semibold text-[#F5B021]">{p.pause_code}</Td>
                    <Td>{p.pause_code_name || "—"}</Td>
                    <Td>{p.billable ?? "—"}</Td>
                    <Td className="font-mono text-xs">{p.campaign_id ?? "—"}</Td>
                    <Td>{p.time_limit ?? "—"}</Td>
                    <Td>
                      <Button variant="ghost" size="sm" className="text-white/40 hover:text-[#EF4444]"
                        onClick={() => pcDel.mutate(p.pause_code)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </Td>
                  </tr>
                ))}
                {pauseQ.data?.length === 0 && <EmptyRow cols={6} text="No pause codes configured" />}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// Call Log
// ----------------------------------------------------

function CallsTab() {
  const [campaign, setCampaign] = useState("");
  const q = useQuery({
    queryKey: ["vici-calls", campaign],
    queryFn: () => getVicidialCallsFn({ data: { ...(campaign ? { campaign_id: campaign } : {}), limit: 300 } }),
  });
  const calls = q.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Filter by campaign_id (blank = all)" className="max-w-xs font-mono" />
        <span className="text-xs text-white/40">{calls.length} calls</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[1000px] text-left">
          <thead className="bg-white/[0.02]">
            <tr>
              <Th>Date</Th><Th>Agent</Th><Th>Campaign</Th><Th>List</Th><Th>Phone</Th><Th>Duration</Th><Th>Status</Th><Th>Term Reason</Th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <EmptyRow cols={8} text="Loading call log…" />}
            {calls.map((c) => (
              <tr key={c.uniqueid} className="border-t border-white/5 hover:bg-white/[0.02]">
                <Td className="whitespace-nowrap text-xs">{fmtDt(c.call_date)}</Td>
                <Td className="font-mono text-xs">
                  {c.user || "—"}
                  {c.source === "CRM" && <span className="ml-1.5 rounded bg-[#06B6D4]/10 px-1 py-px text-[9px] font-semibold text-[#06B6D4]">CRM</span>}
                </Td>
                <Td className="font-mono text-xs">{c.campaign_id || "—"}</Td>
                <Td className="font-mono text-xs">{c.list_id || "—"}</Td>
                <Td className="font-mono text-xs">{c.phone_number ? `${c.phone_code ?? ""}${c.phone_number}` : "—"}</Td>
                <Td>{fmtDur(c.length_in_sec)}</Td>
                <Td><span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold">{c.status || "—"}</span></Td>
                <Td className="text-xs text-white/50">{c.term_reason || "—"}</Td>
              </tr>
            ))}
            {!q.isLoading && calls.length === 0 && <EmptyRow cols={8} text="No calls logged yet" />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// Recordings
// ----------------------------------------------------

function RecordingsTab() {
  const q = useQuery({ queryKey: ["vici-recordings"], queryFn: () => getVicidialRecordingsFn({ data: { limit: 200 } }) });
  const recs = q.data ?? [];
  const [playing, setPlaying] = useState<{ ref: string; url: string } | null>(null);
  const [loadingRef, setLoadingRef] = useState<string | null>(null);

  const play = async (ref: string) => {
    if (playing?.ref === ref) {
      setPlaying(null);
      return;
    }
    setLoadingRef(ref);
    try {
      const url = await getRecordingPlayUrlFn({ data: { ref } });
      setPlaying({ ref, url });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load recording");
    } finally {
      setLoadingRef(null);
    }
  };

  return (
    <div className="space-y-3">
      {playing && (
        <div className="flex items-center gap-3 rounded-xl border border-[#06B6D4]/30 bg-[#06B6D4]/5 px-4 py-3">
          <Disc3 className="size-4 text-[#06B6D4]" />
          <audio controls autoPlay src={playing.url} className="h-9 flex-1" />
          <Button variant="ghost" size="sm" className="text-white/50" onClick={() => setPlaying(null)}>Close</Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[900px] text-left">
          <thead className="bg-white/[0.02]">
            <tr>
              <Th>Start</Th><Th>Agent</Th><Th>Ext</Th><Th>Lead</Th><Th>Duration</Th><Th>File</Th><Th>Listen</Th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <EmptyRow cols={7} text="Loading recordings…" />}
            {recs.map((r) => (
              <tr key={r.recording_id} className="border-t border-white/5 hover:bg-white/[0.02]">
                <Td className="whitespace-nowrap text-xs">{fmtDt(r.start_time)}</Td>
                <Td className="font-mono text-xs">
                  {r.user || "—"}
                  {r.source === "CRM" && <span className="ml-1.5 rounded bg-[#06B6D4]/10 px-1 py-px text-[9px] font-semibold text-[#06B6D4]">CRM</span>}
                </Td>
                <Td className="font-mono text-xs">{r.extension || "—"}</Td>
                <Td className="font-mono text-xs">{r.lead_id || "—"}</Td>
                <Td>{fmtDur(r.length_in_sec)}</Td>
                <Td className="max-w-[220px] truncate font-mono text-xs text-white/50">{r.filename || "—"}</Td>
                <Td>
                  {r.play_ref ? (
                    <Button variant="ghost" size="sm" className="text-[#06B6D4] hover:text-[#06B6D4]/80"
                      disabled={loadingRef === r.play_ref} onClick={() => play(r.play_ref!)}>
                      {loadingRef === r.play_ref ? "Loading…" : playing?.ref === r.play_ref ? "Playing" : "Play"}
                    </Button>
                  ) : r.location ? (
                    <a href={r.location} target="_blank" rel="noreferrer" className="text-xs text-[#06B6D4] hover:underline">Open</a>
                  ) : "—"}
                </Td>
              </tr>
            ))}
            {!q.isLoading && recs.length === 0 && <EmptyRow cols={7} text="No recordings yet" />}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-white/30">
        Recordings are fetched from the VICIdial monitor share on first play and cached locally on the API server, so playback keeps working even if the dialer later purges the files.
      </p>
    </div>
  );
}

// ----------------------------------------------------
// Live Agents (VICIdial view)
// ----------------------------------------------------

function LiveAgentsTab() {
  const q = useQuery({ queryKey: ["vici-live"], queryFn: () => getVicidialLiveAgentsFn(), refetchInterval: 10000 });
  const agents = q.data ?? [];

  const statusColor = (s: string | null) => {
    const v = (s ?? "").toUpperCase();
    if (v.includes("INCALL") || v === "INCALL") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    if (v.includes("READY")) return "border-[#06B6D4]/30 bg-[#06B6D4]/10 text-[#06B6D4]";
    if (v.includes("PAUSE") || v.includes("BREAK")) return "border-[#F5B021]/30 bg-[#F5B021]/10 text-[#F5B021]";
    return "border-white/20 bg-white/5 text-white/60";
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[900px] text-left">
        <thead className="bg-white/[0.02]">
          <tr>
            <Th>Agent</Th><Th>Status</Th><Th>Campaign</Th><Th>Lead</Th><Th>Caller ID</Th><Th>Ext</Th><Th>Calls Today</Th><Th>Last Update</Th>
          </tr>
        </thead>
        <tbody>
          {q.isLoading && <EmptyRow cols={8} text="Loading live agents…" />}
          {agents.map((a) => (
            <tr key={`${a.user}-${a.uniqueid ?? ""}`} className="border-t border-white/5 hover:bg-white/[0.02]">
              <Td>
                <p className="font-medium text-white">{a.full_name || a.user}</p>
                <p className="font-mono text-[11px] text-white/40">
                  {a.user}
                  {a.source && a.source !== "VICIDIAL" && (
                    <span className="ml-1.5 rounded bg-[#06B6D4]/10 px-1 py-px text-[9px] font-semibold text-[#06B6D4]">
                      {a.source === "BOTH" ? "CRM+VICIDIAL" : "CRM"}
                    </span>
                  )}
                </p>
              </Td>
              <Td><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusColor(a.status)}`}>{a.status || "—"}</span></Td>
              <Td className="font-mono text-xs">{a.campaign_id || "—"}</Td>
              <Td className="font-mono text-xs">{a.lead_id || "—"}</Td>
              <Td className="font-mono text-xs">{a.callerid || "—"}</Td>
              <Td className="font-mono text-xs">{a.extension || "—"}</Td>
              <Td>{a.calls_today ?? "—"}</Td>
              <Td className="whitespace-nowrap text-xs text-white/50">{fmtDt(a.last_update_time)}</Td>
            </tr>
          ))}
          {!q.isLoading && agents.length === 0 && <EmptyRow cols={8} text="No agents currently active on the CRM or VICIdial" />}
        </tbody>
      </table>
      <p className="border-t border-white/5 px-4 py-2 text-[11px] text-white/30">
        Auto-refreshes every 10 seconds — merges live CRM sessions/call state with vicidial_live_agents.
      </p>
    </div>
  );
}

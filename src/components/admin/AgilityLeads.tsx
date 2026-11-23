import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileUp, Loader2, Phone, PhoneOutgoing, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  importAgilityLeadsChunkFn,
  getAgilityLeadStatsFn,
  getAgilityLeadsFn,
  listDialableAgilityLeadIdsFn,
  pushAgilityLeadsChunkFn,
  syncAgilityLeadsToCustomersFn,
  type AgilityLeadInput,
} from "@/server/agility-lead-functions";
import { getVicidialListsFn } from "@/server/vicidial-admin-functions";
import { getCampaignsFn } from "@/server/campaign-functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      cur.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((c) => c.trim())) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  if (cur.some((c) => c.trim())) rows.push(cur);
  const [head, ...body] = rows;
  if (!head) return [];
  // Strip trailing underscores from headers (vuma_reach_premise_id_ etc.)
  const keys = head.map((h) => h.trim().toLowerCase().replace(/_+$/, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const HEADER_MAP: Record<string, keyof AgilityLeadInput> = {
  leadentityid: "leadEntityId",
  leadnumber: "leadNumber",
  leaddescription: "leadDescription",
  account_number: "accountNumber",
  account: "accountName",
  contact_name: "contactName",
  contact_email: "contactEmail",
  contact_number: "contactNumber",
  contact_alternative_number: "altNumber",
  contact_id_number: "idNumber",
  address: "address",
  region: "region",
  latitude: "latitude",
  longitude: "longitude",
  status: "status",
  custom_status: "customStatus",
  source: "source",
  core_product_name: "productName",
  core_product_code: "productCode",
  core_product_supplier: "supplier",
  contracttotalrecurringexcl: "recurringExcl",
  contracttotalrecurringincl: "recurringIncl",
  debit_order_day: "debitOrderDay",
  kyc_status: "kycStatus",
  kyc_required: "kycRequired",
  kyc_requiredbool: "kycRequired",
  channel_partner_code: "channelPartnerCode",
  channel_partner_user_name: "agentName",
  sales_agent: "salesAgent",
  vuma_reach_premise_id: "premiseId",
  audit_createddate: "auditCreatedDate",
  original_order_date: "originalOrderDate",
  submitted_date: "submittedDate",
  assigneddate: "assignedDate",
  audit_updateddate: "auditUpdatedDate",
  expired_date: "expiredDate",
  next_payment_date: "nextPaymentDate",
};

function toLeadRows(raw: Record<string, string>[]): AgilityLeadInput[] {
  return raw.map((r, i) => {
    const out: any = { rowNumber: i + 2 };
    for (const [src, dst] of Object.entries(HEADER_MAP)) {
      const v = r[src];
      if (v !== undefined) out[dst as string] = v;
    }
    return out as AgilityLeadInput;
  });
}

async function sha(text: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

const CHUNK = 1200;

export function AgilityLeads() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [rows, setRows] = useState<AgilityLeadInput[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dialableOnly, setDialableOnly] = useState(false);
  const [page, setPage] = useState(1);

  const stats = useQuery({
    queryKey: ["agility-lead-stats"],
    queryFn: async () => getAgilityLeadStatsFn(),
    refetchInterval: 60_000,
  });

  const leads = useQuery({
    queryKey: ["agility-leads", search, status, dialableOnly, page],
    queryFn: async () =>
      getAgilityLeadsFn({
        data: {
          ...(search ? { search } : {}),
          ...(status ? { status } : {}),
          ...(dialableOnly ? { dialableOnly: true } : {}),
          page,
          pageSize: 50,
        },
      }),
  });

  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState({ done: 0, total: 0 });
  const [syncingCustomers, setSyncingCustomers] = useState(false);
  const [customerSyncProgress, setCustomerSyncProgress] = useState({ done: 0, created: 0, skipped: 0 });
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState("");
  const [customListId, setCustomListId] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [crmListName, setCrmListName] = useState("Agility Leads");

  const vicidialLists = useQuery({
    queryKey: ["vicidial-lists"],
    queryFn: () => getVicidialListsFn(),
    enabled: pushDialogOpen,
  });

  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => getCampaignsFn(),
    enabled: pushDialogOpen,
  });

  function confirmPush() {
    const listId = selectedListId === "__custom__" ? customListId.trim() : selectedListId;
    if (!listId) {
      toast.error("Select a VICIdial lead list first");
      return;
    }
    if (!selectedCampaignId) {
      toast.error("Select a CRM campaign for lead tracking");
      return;
    }
    setPushDialogOpen(false);
    void pushToVicidial(listId, selectedCampaignId, crmListName.trim() || "Agility Leads");
  }

  async function syncToCustomers() {
    setSyncingCustomers(true);
    setCustomerSyncProgress({ done: 0, created: 0, skipped: 0 });
    try {
      let totalCreated = 0;
      let totalSkipped = 0;
      let done = false;
      while (!done) {
        const res = await syncAgilityLeadsToCustomersFn({ data: {} });
        totalCreated += res.created;
        totalSkipped += res.skipped;
        setCustomerSyncProgress({ done: totalCreated + totalSkipped, created: totalCreated, skipped: totalSkipped });
        done = res.done;
      }
      toast.success(`Created ${totalCreated} customers from Agility leads (${totalSkipped} skipped)`);
      void qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Customer sync failed");
    } finally {
      setSyncingCustomers(false);
      setCustomerSyncProgress({ done: 0, created: 0, skipped: 0 });
    }
  }

  async function pushToVicidial(listId: string, crmCampaignId: string, crmListNameValue: string) {
    setPushing(true);
    try {
      const { ids } = await listDialableAgilityLeadIdsFn();
      setPushProgress({ done: 0, total: ids.length });
      let synced = 0;
      let failed = 0;
      const CH = 300;
      // Always run at least one chunk so the CRM lead-list backfill
      // (stageExisting) executes even when everything is already pushed.
      const iterations = Math.max(1, Math.ceil(ids.length / CH));
      for (let i = 0; i < iterations * CH; i += CH) {
        const res = await pushAgilityLeadsChunkFn({
          data: {
            leadIds: ids.slice(i, i + CH),
            listId,
            crmCampaignId,
            crmListName: crmListNameValue,
            ...(i === 0 ? { stageExisting: true } : {}),
          },
        });
        synced += res.synced;
        failed += res.failed;
        setPushProgress({ done: Math.min(i + CH, ids.length), total: ids.length });
      }
      toast.success(
        ids.length
          ? `Pushed ${synced} leads to VICIdial${failed ? `, ${failed} failed` : ""}`
          : "Lead lists synced — already-pushed leads recorded in Lead List Management",
      );
      void qc.invalidateQueries({ queryKey: ["agility-leads"] });
      void qc.invalidateQueries({ queryKey: ["agility-lead-stats"] });
      void qc.invalidateQueries({ queryKey: ["admin-lead-lists"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushing(false);
      setPushProgress({ done: 0, total: 0 });
    }
  }

  const t = stats.data?.totals;
  const totalPages = leads.data ? Math.max(1, Math.ceil(leads.data.total / (leads.data.pageSize ?? 50))) : 1;

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const mapped = toLeadRows(parseCsv(text));
    setFileName(f.name);
    setFileHash(await sha(text));
    setRows(mapped);
    setProgress({ done: 0, total: 0, errors: 0 });
    e.target.value = "";
  }

  async function runImport() {
    if (!fileName || !fileHash || !rows.length) return;
    setImporting(true);
    setProgress({ done: 0, total: rows.length, errors: 0 });
    let errors = 0;
    let processed = 0;
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const res = await importAgilityLeadsChunkFn({
          data: {
            fileName,
            fileHash,
            totalRows: rows.length,
            final: i + CHUNK >= rows.length,
            rows: slice,
          },
        });
        errors += res.errors;
        processed += res.processed;
        setProgress({ done: Math.min(processed, rows.length), total: rows.length, errors });
      }
      toast.success(`Agility leads imported: ${processed.toLocaleString()} rows${errors ? `, ${errors} skipped` : ""}`);
      void qc.invalidateQueries({ queryKey: ["agility-lead-stats"] });
      void qc.invalidateQueries({ queryKey: ["agility-leads"] });
      void qc.invalidateQueries({ queryKey: ["agility-agent-map"] });
      setRows([]);
      setFileName(null);
      setFileHash(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Total Leads", t?.total],
          ["New", t?.new_leads],
          ["Lost", t?.lost],
          ["Dialable", t?.dialable],
          ["Accounts", t?.accounts],
        ].map(([label, val]) => (
          <div key={label as string} className="border border-border bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-bold">{val ?? "—"}</div>
          </div>
        ))}
      </div>

      <div className="border border-border bg-card p-6">
        <h2 className="text-xl font-bold">Agility Lead Export</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the Agility leads CSV (e.g. JUN_ATT.csv). Leads join to the order ledger via the
          OVR/OVK reference inside each description. Phone numbers are normalized to 27… format;
          the Dialable filter shows leads ready for VICIdial lists.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={pick} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
            <FileUp className="mr-2 size-4" /> Choose CSV
          </Button>
          {fileName && (
            <span className="text-sm text-muted-foreground">
              {fileName} — {rows.length.toLocaleString()} rows
            </span>
          )}
          {rows.length > 0 && (
            <Button onClick={runImport} disabled={importing}>
              {importing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
              {importing ? `Importing ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}…` : "Import leads"}
            </Button>
          )}
          {importing && (
            <div className="h-2 w-64 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${rows.length ? (progress.done / rows.length) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>
        {progress.errors > 0 && (
          <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
            <AlertTriangle className="size-4" /> {progress.errors} rows skipped (missing lead entity id)
          </p>
        )}
      </div>

      <div className="border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <h3 className="font-semibold">Leads</h3>
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, phone, lead #, order ref, region…"
              className="h-8 w-72 pl-8 text-sm"
            />
          </div>
          <Select
            value={status || "all"}
            onValueChange={(v) => {
              setStatus(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="New">New</SelectItem>
              <SelectItem value="Lost">Lost</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={dialableOnly ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDialableOnly((d) => !d);
              setPage(1);
            }}
          >
            <Phone className="mr-1.5 size-3.5" /> Dialable only
          </Button>
          <Button size="sm" onClick={() => setPushDialogOpen(true)} disabled={pushing || !t?.dialable}>
            {pushing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <PhoneOutgoing className="mr-1.5 size-3.5" />}
            {pushing
              ? `Pushing ${pushProgress.done.toLocaleString()}/${pushProgress.total.toLocaleString()}…`
              : "Push to VICIdial"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void syncToCustomers()}
            disabled={syncingCustomers}
          >
            {syncingCustomers ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 size-3.5" />
            )}
            {syncingCustomers
              ? `Syncing ${customerSyncProgress.created.toLocaleString()} customers…`
              : "Sync to Customers"}
          </Button>
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="sticky top-0 bg-muted/60 text-xs uppercase text-muted-foreground">
              <tr>
                {["Lead", "Account / Contact", "Phone", "Agent", "Product", "Region", "Status", "Called", "Order Ref"].map((h) => (
                  <th key={h} className="px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(leads.data?.leads ?? []).map((l: any) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-mono text-xs">{l.leadNumber}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{l.accountName ?? l.contactName ?? "—"}</div>
                    {l.contactEmail ? <div className="text-xs text-muted-foreground">{l.contactEmail}</div> : null}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {l.contactNumber ? `0${l.contactNumber.slice(2)}` : l.contactNumberRaw ?? "—"}
                    {l.vicidialLeadId ? (
                      <div className="mt-0.5 font-sans text-[10px] text-success">in VICIdial</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    {l.profileName ?? l.agentNameRaw ?? "—"}
                    {l.profileAgentCode ? ` · ${l.profileAgentCode}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{l.productName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{l.region ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        l.status === "New"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {l.called ? (
                      <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-2 py-0.5 text-xs text-warning">
                        <Phone className="size-3" />
                        {l.callCount > 0 ? `${l.callCount}×` : "yes"}
                        {l.callSource ? ` · ${l.callSource}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {l.orderRef ? (
                      <span
                        className="font-mono text-primary"
                        title={l.orderStatus ? `Order: ${l.orderStatus}${l.orderCustomStatus ? ` · ${l.orderCustomStatus}` : ""}` : "Linked order"}
                      >
                        {l.orderRef}
                        {l.orderStatus ? <span className="ml-1 text-muted-foreground">({l.orderStatus})</span> : null}
                      </span>
                    ) : (
                      <span className="font-mono text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {(leads.data?.leads.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">
                    {leads.isLoading ? "Loading…" : "No leads found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border p-3 text-sm text-muted-foreground">
          <span>{leads.data ? `${leads.data.total.toLocaleString()} leads` : ""}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Lead list selection for VICIdial push */}
      <Dialog open={pushDialogOpen} onOpenChange={setPushDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Push leads to VICIdial</DialogTitle>
            <DialogDescription>
              Choose the VICIdial lead list these leads will be added to. Leads are added via the
              dialer's add_lead API — pick the list/campaign the agents will dial from.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {vicidialLists.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading VICIdial lists…
              </div>
            ) : (
              <RadioGroup value={selectedListId} onValueChange={setSelectedListId}>
                {(vicidialLists.data ?? [])
                  .filter((l: any) => l.active === "Y")
                  .map((l: any) => (
                    <div key={l.list_id} className="flex items-center gap-2">
                      <RadioGroupItem value={String(l.list_id)} id={`list-${l.list_id}`} />
                      <Label htmlFor={`list-${l.list_id}`} className="flex-1 cursor-pointer text-sm">
                        <span className="font-medium">{l.list_name ?? `List ${l.list_id}`}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          ID {l.list_id} · campaign {l.campaign_id} · {l.lead_count ?? 0} leads
                        </span>
                      </Label>
                    </div>
                  ))}
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="__custom__" id="list-custom" />
                  <Label htmlFor="list-custom" className="cursor-pointer text-sm">
                    Custom list ID
                  </Label>
                  {selectedListId === "__custom__" && (
                    <Input
                      value={customListId}
                      onChange={(e) => setCustomListId(e.target.value)}
                      placeholder="e.g. 2001"
                      className="ml-auto h-8 w-28"
                    />
                  )}
                </div>
              </RadioGroup>
            )}
            {!vicidialLists.isLoading && (vicidialLists.data ?? []).filter((l: any) => l.active === "Y").length === 0 && !vicidialLists.isError && (
              <p className="text-sm text-muted-foreground">
                No active lists returned by VICIdial — use a custom list ID.
              </p>
            )}
            {vicidialLists.isError && (
              <p className="text-sm text-destructive">
                Couldn't load VICIdial lists — enter a custom list ID.
              </p>
            )}

            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                CRM tracking (Lead List Management)
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Campaign…" />
                  </SelectTrigger>
                  <SelectContent>
                    {((campaigns.data as any)?.campaigns ?? []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={crmListName}
                  onChange={(e) => setCrmListName(e.target.value)}
                  placeholder="List name"
                  className="h-9"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Pushed leads are also recorded under this CRM list so Lead List Management and
                dial stats stay in sync. Re-using the same name adds to the existing list.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPushDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmPush} disabled={pushing || vicidialLists.isLoading}>
              {pushing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <PhoneOutgoing className="mr-1.5 size-3.5" />}
              Push leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

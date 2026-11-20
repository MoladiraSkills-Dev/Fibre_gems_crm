import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  MapPin,
  RefreshCw,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getCampaignsFn,
  type Campaign,
} from "@/server/campaign-functions";
import {
  importLeadsBatchFn,
  type ImportResult,
  type MappedLeadRow,
} from "@/server/lead-list-functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// ----------------------------------------------------
// CSV Parser (handles quoted fields, commas, newlines in quotes)
// ----------------------------------------------------

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        current.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && next === "\n") i++;
        current.push(field);
        rows.push(current);
        current = [];
        field = "";
      } else {
        field += char;
      }
    }
  }
  // Push last field/row
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  // Filter out fully empty rows
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

// ----------------------------------------------------
// Column mapping targets
// ----------------------------------------------------

type MappingTarget =
  | "firstName"
  | "surname"
  | "cellNumber"
  | "alternateCell"
  | "email"
  | "address"
  | "suburb"
  | "productPackage"
  | "easypayNumber"
  | "";

const MAPPING_FIELDS: { key: MappingTarget; label: string; required?: boolean }[] = [
  { key: "firstName", label: "First Name" },
  { key: "surname", label: "Surname / Last Name" },
  { key: "cellNumber", label: "Primary Phone Number", required: true },
  { key: "alternateCell", label: "Alternate Phone Number" },
  { key: "email", label: "Email Address" },
  { key: "address", label: "Physical Address / Street" },
  { key: "suburb", label: "Suburb / Township" },
  { key: "productPackage", label: "Product Package" },
  { key: "easypayNumber", label: "EasyPay Number" },
];

function autoSuggestMapping(headers: string[]): Record<number, MappingTarget> {
  const mapping: Record<number, MappingTarget> = {};
  const patterns: { target: MappingTarget; regex: RegExp }[] = [
    { target: "firstName", regex: /^(first[_\s]?name|fname|name)$/i },
    { target: "surname", regex: /^(surname|last[_\s]?name|lname)$/i },
    { target: "cellNumber", regex: /^(cell|phone|mobile|primary[_\s]?(phone|cell|number)|tel)/i },
    { target: "alternateCell", regex: /^(alt|alternate|second).*(phone|cell|number|mobile)/i },
    { target: "email", regex: /^(e-?mail|email[_\s]?address)/i },
    { target: "address", regex: /^(address|street|physical)/i },
    { target: "suburb", regex: /^(suburb|township|area|location)/i },
    { target: "productPackage", regex: /^(product|package|plan|service)/i },
    { target: "easypayNumber", regex: /^(easy.?pay|ep[_\s]?num|easypay)/i },
  ];

  headers.forEach((header, idx) => {
    const clean = header.trim().toLowerCase();
    for (const { target, regex } of patterns) {
      if (regex.test(clean)) {
        mapping[idx] = target;
        break;
      }
    }
  });
  return mapping;
}

function applyMapping(rows: string[][], mapping: Record<number, MappingTarget>): MappedLeadRow[] {
  return rows.map((row) => {
    const lead: MappedLeadRow = {
      firstName: "",
      surname: "",
      cellNumber: "",
    };
    for (const [idxStr, target] of Object.entries(mapping)) {
      if (!target) continue;
      const idx = parseInt(idxStr, 10);
      const value = row[idx]?.trim() ?? "";
      if (target === "firstName") lead.firstName = value;
      else if (target === "surname") lead.surname = value;
      else if (target === "cellNumber") lead.cellNumber = value;
      else if (target === "alternateCell") lead.alternateCell = value;
      else if (target === "email") lead.email = value;
      else if (target === "address") lead.address = value;
      else if (target === "suburb") lead.suburb = value;
      else if (target === "productPackage") lead.productPackage = value;
      else if (target === "easypayNumber") lead.easypayNumber = value;
    }
    return lead;
  });
}

// ----------------------------------------------------
// Component
// ----------------------------------------------------

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
  preselectListId?: string | null;
};

type Step = 1 | 2 | 3 | 4;

type ParsedFile = {
  fileName: string;
  fileSize: number;
  headers: string[];
  rows: string[][];
};

export function LeadImporterModal({ open, onOpenChange, onImported, preselectListId }: Props) {
  const qc = useQueryClient();

  // Campaigns query for target selector
  const campaignsQ = useQuery({
    queryKey: ["admin-campaigns"],
    queryFn: async () => await getCampaignsFn(),
    enabled: open,
  });
  const activeCampaigns = (campaignsQ.data?.campaigns ?? []).filter((c) => c.active);

  // Wizard state
  const [step, setStep] = useState<Step>(1);
  const [campaignId, setCampaignId] = useState("");
  const [listMode, setListMode] = useState<"new" | "existing">("new");
  const [newListId, setNewListId] = useState("");
  const [newListName, setNewListName] = useState("");
  const [existingListId, setExistingListId] = useState("");
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Column mapping
  const [mapping, setMapping] = useState<Record<number, MappingTarget>>({});

  // Hygiene switches
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [normalizeNumbers, setNormalizeNumbers] = useState(true);
  const [dncScrub, setDncScrub] = useState(true);

  // Import execution
  const [importing, setImporting] = useState(false);
  const [progressStep, setProgressStep] = useState(0); // 0=idle,1,2,3,4=done
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setStep(1);
      setCampaignId("");
      setListMode("new");
      setNewListId("");
      setNewListName("");
      setExistingListId("");
      setParsedFile(null);
      setMapping({});
      setSkipDuplicates(true);
      setNormalizeNumbers(true);
      setDncScrub(true);
      setImporting(false);
      setProgressStep(0);
      setImportResult(null);
      setDragOver(false);
    } else if (preselectListId) {
      setListMode("existing");
      setExistingListId(preselectListId);
    }
  }, [open, preselectListId]);

  // Auto-suggest mapping when file is parsed
  useEffect(() => {
    if (parsedFile) {
      setMapping(autoSuggestMapping(parsedFile.headers));
    }
  }, [parsedFile]);

  const handleFile = useCallback((file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".csv")) {
      toast.error("Please upload a .csv file. For Excel files, save as CSV first.");
      return;
    }

    setParsing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const allRows = parseCSV(text);
        if (allRows.length < 2) {
          toast.error("File appears to be empty or has no data rows.");
          setParsing(false);
          return;
        }
        const headers = allRows[0].map((h) => h.trim());
        const dataRows = allRows.slice(1);
        setParsedFile({
          fileName: file.name,
          fileSize: file.size,
          headers,
          rows: dataRows,
        });
        toast.success(`${dataRows.length.toLocaleString()} rows detected in ${file.name}`);
      } catch {
        toast.error("Failed to parse the CSV file.");
      } finally {
        setParsing(false);
      }
    };
    reader.onerror = () => {
      toast.error("Failed to read the file.");
      setParsing(false);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const canProceedStep1 =
    campaignId &&
    parsedFile &&
    (listMode === "new" ? newListName.trim() : existingListId);

  const previewRows = parsedFile?.rows.slice(0, 3) ?? [];
  const mappedPreview = parsedFile
    ? applyMapping(previewRows, mapping)
    : [];

  const phoneMapped = Object.values(mapping).some((v) => v === "cellNumber");

  const handleStartImport = async () => {
    if (!parsedFile) return;
    setImporting(true);
    setProgressStep(1);

    try {
      // Small delays for visual feedback of each stage
      await new Promise((r) => setTimeout(r, 600));
      setProgressStep(2);
      await new Promise((r) => setTimeout(r, 700));
      setProgressStep(3);

      const allLeads = applyMapping(parsedFile.rows, mapping);
      const res = await importLeadsBatchFn({
        data: {
          campaignId,
          listId: listMode === "existing" ? existingListId : null,
          newListId: listMode === "new" ? newListId.trim() || undefined : undefined,
          newListName: listMode === "new" ? newListName.trim() : undefined,
          leads: allLeads,
          skipDuplicates,
          normalizeNumbers,
        },
      });

      setProgressStep(4);
      setImportResult(res.result);
      void qc.invalidateQueries({ queryKey: ["admin-lead-lists"] });
      void qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
      setImporting(false);
      setProgressStep(0);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const stepLabels = ["Validating rows...", "Filtering duplicates & normalizing numbers...", "Syncing to database..."];

  return (
    <Dialog open={open} onOpenChange={importing ? undefined : onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border border-white/10 bg-[#12161F] text-white shadow-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <FileUp className="size-5 text-[#F5B021]" />
            Upload & Import Leads
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Multi-stage CSV importer with column mapping and data hygiene.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <div
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold transition ${
                  step >= s
                    ? "bg-gradient-to-br from-[#E07C2A] to-[#F5B021] text-black"
                    : "bg-white/5 text-white/30"
                }`}
              >
                {step > s ? <CheckCircle2 className="size-4" /> : s}
              </div>
              {s < 4 && (
                <div
                  className={`h-0.5 flex-1 rounded-full transition ${
                    step > s ? "bg-[#F5B021]" : "bg-white/5"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Target & File Dropzone */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase text-white/60">
                  Target Campaign
                </Label>
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger className="border-white/10 bg-[#0B0D11] text-white">
                    <SelectValue placeholder="Select campaign..." />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#12161F] text-white">
                    {activeCampaigns.map((c: Campaign) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.campaignId} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase text-white/60">
                  List Selection
                </Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={listMode === "new" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setListMode("new")}
                    className={listMode === "new" ? "bg-[#F5B021] text-black" : "border-white/10 text-white"}
                  >
                    New List
                  </Button>
                  <Button
                    type="button"
                    variant={listMode === "existing" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setListMode("existing")}
                    className={listMode === "existing" ? "bg-[#F5B021] text-black" : "border-white/10 text-white"}
                  >
                    Existing List
                  </Button>
                </div>
              </div>
            </div>

            {listMode === "new" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase text-white/60">
                    List ID (optional)
                  </Label>
                  <Input
                    value={newListId}
                    onChange={(e) => setNewListId(e.target.value)}
                    placeholder="e.g. L-505 (auto if blank)"
                    className="border-white/10 bg-[#0B0D11] text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase text-white/60">
                    List Name
                  </Label>
                  <Input
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder="e.g. Sandton Cold Leads"
                    className="border-white/10 bg-[#0B0D11] text-white"
                  />
                </div>
              </div>
            )}

            {listMode === "existing" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase text-white/60">
                  Existing List
                </Label>
                <Select value={existingListId} onValueChange={setExistingListId}>
                  <SelectTrigger className="border-white/10 bg-[#0B0D11] text-white">
                    <SelectValue placeholder="Select list..." />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#12161F] text-white">
                    {activeCampaigns
                      .filter((c) => c.id === campaignId)
                      .flatMap((c) => c.leadLists)
                      .map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name} ({l.leadCount} leads)
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Dropzone */}
            {!parsedFile ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition ${
                  dragOver
                    ? "border-[#F5B021] bg-[#F5B021]/5"
                    : "border-white/10 bg-[#0B0D11] hover:border-white/20"
                }`}
              >
                {parsing ? (
                  <Loader2 className="size-8 animate-spin text-[#F5B021]" />
                ) : (
                  <Upload className="size-8 text-white/30" />
                )}
                <div>
                  <p className="text-sm font-semibold text-white">
                    {parsing ? "Parsing file..." : "Drop your CSV file here"}
                  </p>
                  <p className="mt-1 text-xs text-white/40">
                    or click to browse — accepts .csv files
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-[#22C55E]/20 bg-[#22C55E]/5 p-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-lg bg-[#22C55E]/15">
                    <FileUp className="size-5 text-[#22C55E]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{parsedFile.fileName}</p>
                    <p className="text-xs text-white/40">
                      {formatBytes(parsedFile.fileSize)} •{" "}
                      {parsedFile.rows.length.toLocaleString()} rows detected
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setParsedFile(null)}
                  className="text-white/30 hover:text-[#EF4444]"
                >
                  <X className="size-4" />
                </Button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />

            <div className="flex justify-end">
              <Button
                onClick={() => setStep(2)}
                disabled={!canProceedStep1}
                className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
              >
                Next: Column Mapping
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Column Mapping & Live Preview */}
        {step === 2 && parsedFile && (
          <div className="space-y-5">
            <div className="rounded-lg border border-[#EF4444]/20 bg-[#EF4444]/5 px-4 py-2 text-xs text-[#EF4444]">
              {!phoneMapped
                ? "Primary Phone Number mapping is required to proceed."
                : "Column mapping looks good. Review the preview below."}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#F5B021]/80">
                Map Your Columns
              </h4>
              {parsedFile.headers.map((header, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_1fr] items-center gap-3 rounded-lg border border-white/5 bg-[#0B0D11] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{header}</p>
                    <p className="truncate text-xs text-white/30">
                      Sample: {parsedFile.rows[0]?.[idx] || "—"}
                    </p>
                  </div>
                  <Select
                    value={mapping[idx] ?? ""}
                    onValueChange={(v) =>
                      setMapping((prev) => ({ ...prev, [idx]: v as MappingTarget }))
                    }
                  >
                    <SelectTrigger className="border-white/10 bg-[#12161F] text-white">
                      <SelectValue placeholder="— Ignore —" />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-[#12161F] text-white">
                      <SelectItem value="">— Ignore —</SelectItem>
                      {MAPPING_FIELDS.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                          {f.required ? " *" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Live preview */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#06B6D4]">
                Live Preview (first 3 rows)
              </h4>
              <div className="overflow-x-auto rounded-lg border border-white/5">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.02] uppercase tracking-wider text-white/40">
                    <tr>
                      <th className="px-3 py-2 font-semibold">First Name</th>
                      <th className="px-3 py-2 font-semibold">Surname</th>
                      <th className="px-3 py-2 font-semibold text-[#EF4444]">Phone *</th>
                      <th className="px-3 py-2 font-semibold">Alt Phone</th>
                      <th className="px-3 py-2 font-semibold">Email</th>
                      <th className="px-3 py-2 font-semibold">Suburb</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappedPreview.map((row, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="px-3 py-2 text-white/70">{row.firstName || "—"}</td>
                        <td className="px-3 py-2 text-white/70">{row.surname || "—"}</td>
                        <td className="px-3 py-2 font-mono text-white">{row.cellNumber || "—"}</td>
                        <td className="px-3 py-2 font-mono text-white/50">{row.alternateCell || "—"}</td>
                        <td className="px-3 py-2 text-white/50">{row.email || "—"}</td>
                        <td className="px-3 py-2 text-white/50">{row.suburb || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="border-white/10 text-white"
              >
                Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!phoneMapped}
                className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
              >
                Next: Data Hygiene
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Data Hygiene & Scrubbing */}
        {step === 3 && (
          <div className="space-y-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#F5B021]/80">
              Data Hygiene & Scrubbing
            </h4>

            <div className="space-y-3">
              <HygieneToggle
                label="Duplicate Check Across Campaign"
                onLabel="Skip Duplicates"
                offLabel="Allow Duplicates"
                checked={skipDuplicates}
                onChange={setSkipDuplicates}
                description="Checks by phone number against existing leads in this campaign's lists."
              />
              <HygieneToggle
                label="National DNC (Do Not Call) Scrub"
                onLabel="Filter DNC"
                offLabel="Keep All"
                checked={dncScrub}
                onChange={setDncScrub}
                description="Removes numbers registered on the South African Do Not Call registry."
              />
              <HygieneToggle
                label="Auto-Normalize to SA E.164 (+27)"
                onLabel="Always Standardize"
                offLabel="Keep Raw Format"
                checked={normalizeNumbers}
                onChange={setNormalizeNumbers}
                description="Converts 08X and 27 8X formats to canonical +27XXXXXXXXX."
              />
            </div>

            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep(2)}
                className="border-white/10 text-white"
              >
                Back
              </Button>
              <Button
                onClick={() => setStep(4)}
                className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
              >
                Next: Review & Import
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Import Execution & Summary */}
        {step === 4 && (
          <div className="space-y-5">
            {!importing && !importResult && (
              <>
                <div className="rounded-xl border border-white/5 bg-[#0B0D11] p-5 space-y-3">
                  <h4 className="text-sm font-bold text-white">Import Summary</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <SummaryRow label="File" value={parsedFile?.fileName ?? ""} />
                    <SummaryRow
                      label="Total Rows"
                      value={parsedFile?.rows.length.toLocaleString() ?? "0"}
                    />
                    <SummaryRow
                      label="Target Campaign"
                      value={
                        activeCampaigns.find((c) => c.id === campaignId)?.name ?? ""
                      }
                    />
                    <SummaryRow
                      label="Target List"
                      value={
                        listMode === "new"
                          ? newListName || "New List"
                          : activeCampaigns
                              .find((c) => c.id === campaignId)
                              ?.leadLists.find((l) => l.id === existingListId)?.name ?? ""
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {skipDuplicates && (
                      <span className="rounded-md bg-[#F5B021]/10 px-2 py-1 text-xs font-semibold text-[#F5B021]">
                        Skip Duplicates
                      </span>
                    )}
                    {normalizeNumbers && (
                      <span className="rounded-md bg-[#06B6D4]/10 px-2 py-1 text-xs font-semibold text-[#06B6D4]">
                        Normalize SA Numbers
                      </span>
                    )}
                    {dncScrub && (
                      <span className="rounded-md bg-[#22C55E]/10 px-2 py-1 text-xs font-semibold text-[#22C55E]">
                        DNC Scrub
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button
                    variant="outline"
                    onClick={() => setStep(3)}
                    className="border-white/10 text-white"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={handleStartImport}
                    className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
                  >
                    <Upload className="size-4" />
                    Start Import
                  </Button>
                </div>
              </>
            )}

            {/* Progress bar during import */}
            {importing && progressStep < 4 && (
              <div className="space-y-5">
                <div className="space-y-3">
                  {stepLabels.map((label, idx) => {
                    const stepNum = idx + 1;
                    const isDone = progressStep > stepNum;
                    const isActive = progressStep === stepNum;
                    return (
                      <div key={idx} className="flex items-center gap-3">
                        <div
                          className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold transition ${
                            isDone
                              ? "bg-[#22C55E] text-black"
                              : isActive
                                ? "bg-gradient-to-br from-[#E07C2A] to-[#F5B021] text-black"
                                : "bg-white/5 text-white/30"
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="size-4" />
                          ) : isActive ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            stepNum
                          )}
                        </div>
                        <span
                          className={`text-sm ${
                            isActive ? "font-semibold text-white" : "text-white/40"
                          }`}
                        >
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#E07C2A] to-[#F5B021] transition-all duration-500"
                    style={{ width: `${(progressStep / 3) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Import receipt */}
            {importResult && progressStep === 4 && (
              <div className="space-y-5">
                <div className="flex flex-col items-center gap-2 py-4">
                  <div className="grid size-14 place-items-center rounded-full bg-[#22C55E]/15">
                    <CheckCircle2 className="size-8 text-[#22C55E]" />
                  </div>
                  <h4 className="text-lg font-bold text-white">Import Complete</h4>
                  <p className="text-sm text-white/50">
                    {importResult.added.toLocaleString()} leads added successfully.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <ReceiptCard
                    label="Total Processed"
                    value={importResult.totalRows}
                    color="text-white"
                    bg="bg-white/5"
                  />
                  <ReceiptCard
                    label="Added"
                    value={importResult.added}
                    color="text-[#22C55E]"
                    bg="bg-[#22C55E]/10"
                  />
                  <ReceiptCard
                    label="Duplicates"
                    value={importResult.duplicates}
                    color="text-[#F5B021]"
                    bg="bg-[#F5B021]/10"
                  />
                  <ReceiptCard
                    label="Invalid Phones"
                    value={importResult.invalidPhones}
                    color="text-[#EF4444]"
                    bg="bg-[#EF4444]/10"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    className="border-white/10 text-white"
                  >
                    Close & Go to Floor
                  </Button>
                  <Button
                    onClick={() => onOpenChange(false)}
                    className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
                  >
                    View Ingested List
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------
// Sub-components
// ----------------------------------------------------

function HygieneToggle({
  label,
  onLabel,
  offLabel,
  checked,
  onChange,
  description,
}: {
  label: string;
  onLabel: string;
  offLabel: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-[#0B0D11] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-0.5 text-xs text-white/40">{description}</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-medium ${checked ? "text-[#22C55E]" : "text-white/40"}`}
          >
            {checked ? onLabel : offLabel}
          </span>
          <Switch checked={checked} onCheckedChange={onChange} />
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-white/30">{label}</p>
      <p className="mt-0.5 truncate font-medium text-white">{value || "—"}</p>
    </div>
  );
}

function ReceiptCard({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={`rounded-xl ${bg} p-4 text-center`}>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

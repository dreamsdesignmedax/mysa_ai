import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  useListLeads,
  useCreateLead,
  useDeleteLead,
  useBulkUpdateLeads,
  useImportLeadsPaste,
  useImportLeadsCsv,
  useGetLead,
  useUpdateLead,
  useListSequences,
  useInitiateWhatsApp,
  useInitiateWhatsAppBulk,
} from "@workspace/api-client-react";
import type { ImportResult, OutreachSequence, LeadDetail } from "@workspace/api-client-react";
import { getListLeadsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { StatusBadge, Tag } from "@/components/Badge";
import { bandColorFromKey, bandHexFromKey, bandGradientFromKey, bandLabelFromKey, scoreToBandKey, formatDate, bantSubScoreColor, statusLabel, statusColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Plus, Search, Trash2, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, X, Download, ExternalLink, Building2, Globe, ArrowUpDown, ArrowUp, ArrowDown, Zap, Loader2, BarChart2, MessageCircle, Sparkles, Layers, ListPlus,
} from "lucide-react";
import FetchLeads from "./FetchLeads";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import * as XLSX from "xlsx-js-style";

type BantBreakdown = {
  budget?: number;
  authority?: number;
  need?: number;
  timeline?: number;
  reasoning?: {
    budget?: string;
    authority?: string;
    need?: string;
    timeline?: string;
  };
};

const BANT_KEYS = ["budget", "authority", "need", "timeline"] as const;
type BantKey = typeof BANT_KEYS[number];

const CSV_COLUMNS = ["firstName", "lastName", "email", "company", "designation", "industry", "country"] as const;
type CsvColumn = typeof CSV_COLUMNS[number];

const STATUSES = ["all", "new_enquiry", "enquiry_qualified", "discovery_call", "quote_sent", "follow_up", "project_won", "project_lost"];
const STATUS_DISPLAY: Record<string, string> = {
  all: "All", new_enquiry: "New Enquiry", enquiry_qualified: "Enquiry Qualified",
  discovery_call: "Discovery Call", quote_sent: "Quote / Estimation Sent",
  follow_up: "Follow Up / Negotiation", project_won: "Project Won", project_lost: "Project Lost",
};

export default function Leads() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [loadingLeads, setLoadingLeads] = useState<Set<number>>(new Set());
  const [scoringLeads, setScoringLeads] = useState<Set<number>>(new Set());
  const [scoreErrors, setScoreErrors] = useState<Map<number, string>>(new Map());
  const initiateWa = useInitiateWhatsApp();
  const initiateWaBulk = useInitiateWhatsAppBulk();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterBehavior, setFilterBehavior] = useState("");
  const [filterIntent, setFilterIntent] = useState("");
  const [filterInterest, setFilterInterest] = useState("");
  const [enrichingKeywords, setEnrichingKeywords] = useState<Set<number>>(new Set());
  const [enrichingBulk, setEnrichingBulk] = useState(false);
  const [sortCol, setSortCol] = useState<"bantScore" | "createdAt" | "company" | "sequenceDay" | "lastContactedAt" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [bantPopoverLeadId, setBantPopoverLeadId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [generatingReports, setGeneratingReports] = useState(false);
  const [reportsMsg, setReportsMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [viewTab, setViewTab] = useState<"leads" | "lists">("leads");
  const [showListModal, setShowListModal] = useState(false);
  const [importTab, setImportTab] = useState<"paste" | "csv" | "manual" | "vibe">("paste");
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, CsvColumn | "">>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [drawerLeadId, setDrawerLeadId] = useState<number | null>(null);
  const [showAssignSeq, setShowAssignSeq] = useState(false);
  const [showFetch, setShowFetch] = useState(false);
  const [waInitiating, setWaInitiating] = useState(false);
  const [waMsg, setWaMsg] = useState<string | null>(null);

  // Debounce search — fires API only after 350ms of inactivity
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const params = {
    search: debouncedSearch || undefined,
    status: status !== "all" ? status : undefined,
    page,
    limit: 500,
  };

  const navParams = {
    search: debouncedSearch || undefined,
    status: status !== "all" ? status : undefined,
    page: 1,
    limit: 500,
  };

  const { data, isLoading, isFetching } = useListLeads(params, {
    query: { queryKey: getListLeadsQueryKey(params) },
  });

  const { data: navData } = useListLeads(navParams, {
    query: { queryKey: getListLeadsQueryKey(navParams) },
  });

  const { data: seqData } = useListSequences();

  const createLead = useCreateLead({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey() }); setShowAdd(false); } },
  });
  const deleteLead = useDeleteLead({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey() }); } },
  });
  const bulkUpdate = useBulkUpdateLeads({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey() }); setSelected([]); } },
  });
  const importPaste = useImportLeadsPaste({
    mutation: {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
        setImportResult(result as ImportResult);
        setPasteText("");
        setImporting(false);
      },
    },
  });

  const importCsv = useImportLeadsCsv({
    mutation: {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
        setImportResult(result as ImportResult);
        setCsvRows([]);
        setCsvHeaders([]);
        setImporting(false);
      },
    },
  });

  const handleManualCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setImporting(true);
    const fd = new FormData(e.currentTarget);
    createLead.mutate(
      {
        data: {
          firstName: String(fd.get("firstName")),
          lastName: String(fd.get("lastName")),
          email: String(fd.get("email")),
          company: String(fd.get("company")),
          designation: String(fd.get("designation") || "Unknown"),
          industry: String(fd.get("industry") || "Other"),
          country: String(fd.get("country") || "UAE"),
          source: "manual",
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          setImportResult({ imported: 1, skipped: 0, errors: [] });
          setImporting(false);
        },
        onError: () => {
          setImportResult({ imported: 0, skipped: 0, errors: ["Failed to add lead — email may already exist"] });
          setImporting(false);
        },
      },
    );
  };

  const parseCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) return;
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
      });
      setCsvHeaders(headers);
      setCsvRows(rows);
      const autoMap: Record<string, CsvColumn | ""> = {};
      headers.forEach((h) => {
        const lower = h.toLowerCase();
        if (lower.includes("first")) autoMap[h] = "firstName";
        else if (lower.includes("last")) autoMap[h] = "lastName";
        else if (lower.includes("email")) autoMap[h] = "email";
        else if (lower.includes("company") || lower.includes("org")) autoMap[h] = "company";
        else if (lower.includes("title") || lower.includes("designation") || lower.includes("role")) autoMap[h] = "designation";
        else if (lower.includes("industry") || lower.includes("sector")) autoMap[h] = "industry";
        else if (lower.includes("country") || lower.includes("location")) autoMap[h] = "country";
        else autoMap[h] = "";
      });
      setCsvMapping(autoMap);
    };
    reader.readAsText(file);
  };

  const handleCsvImport = () => {
    if (csvRows.length === 0) return;
    setImporting(true);
    const rows = csvRows.map((row) => {
      const mapped: Record<string, string> = {};
      Object.entries(csvMapping).forEach(([header, field]) => {
        if (field) mapped[field] = row[header] ?? "";
      });
      return mapped;
    });
    importCsv.mutate({ data: { rows } });
  };

  const closeImport = () => {
    setShowImport(false);
    setPasteText("");
    setCsvRows([]);
    setCsvHeaders([]);
    setImportResult(null);
    setImporting(false);
  };

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const hasMore = page < totalPages;
  const sequences: OutreachSequence[] = Array.isArray(seqData) ? seqData : [];

  // Reset accumulated leads when server-side filters change
  useEffect(() => {
    setAllLeads([]);
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status]);

  // Replace/append incoming page data — also handles empty results correctly
  useEffect(() => {
    if (data?.leads == null) return;
    const incoming = data.leads;
    if (page === 1) {
      setAllLeads(incoming);
    } else {
      setAllLeads((prev) => {
        const ids = new Set(prev.map((l) => l.id));
        return [...prev, ...incoming.filter((l) => !ids.has(l.id))];
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Sentinel ref for infinite scroll
  const sentinelObserver = useRef<IntersectionObserver | null>(null);
  const sentinelCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (sentinelObserver.current) sentinelObserver.current.disconnect();
      if (!node) return;
      sentinelObserver.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !isFetching) {
            setPage((p) => p + 1);
          }
        },
        { threshold: 0.1 }
      );
      sentinelObserver.current.observe(node);
    },
    [hasMore, isFetching]
  );

  const filteredLeads = [...allLeads.filter((l) => {
    if (filterIndustry && !(l.industry ?? "").toLowerCase().includes(filterIndustry.toLowerCase())) return false;
    if (filterCountry && !(l.country ?? "").toLowerCase().includes(filterCountry.toLowerCase())) return false;
    if (filterSource && !(l.source ?? "").toLowerCase().includes(filterSource.toLowerCase())) return false;
    if (filterBehavior) {
      const kws = (l.behaviorKeywords as string[] | null) ?? [];
      if (!kws.some((k: string) => k.toLowerCase().includes(filterBehavior.toLowerCase()))) return false;
    }
    if (filterIntent) {
      const kws = (l.intentKeywords as string[] | null) ?? [];
      if (!kws.some((k: string) => k.toLowerCase().includes(filterIntent.toLowerCase()))) return false;
    }
    if (filterInterest) {
      const kws = (l.interestKeywords as string[] | null) ?? [];
      if (!kws.some((k: string) => k.toLowerCase().includes(filterInterest.toLowerCase()))) return false;
    }
    return true;
  })].sort((a, b) => {
    if (!sortCol) return 0;
    const aVal = a[sortCol] ?? (sortCol === "bantScore" || sortCol === "sequenceDay" ? 0 : "");
    const bVal = b[sortCol] ?? (sortCol === "bantScore" || sortCol === "sequenceDay" ? 0 : "");
    if (typeof aVal === "number" && typeof bVal === "number") return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    return sortDir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
  });

  useEffect(() => {
    const navLeads = navData?.leads ?? [];
    const navFiltered = navLeads.filter((l) => {
      if (filterIndustry && !(l.industry ?? "").toLowerCase().includes(filterIndustry.toLowerCase())) return false;
      if (filterCountry && !(l.country ?? "").toLowerCase().includes(filterCountry.toLowerCase())) return false;
      if (filterSource && !(l.source ?? "").toLowerCase().includes(filterSource.toLowerCase())) return false;
      if (filterBehavior) {
        const kws = ((l as unknown as { behaviorKeywords?: string[] }).behaviorKeywords) ?? [];
        if (!kws.some((k: string) => k.toLowerCase().includes(filterBehavior.toLowerCase()))) return false;
      }
      if (filterIntent) {
        const kws = ((l as unknown as { intentKeywords?: string[] }).intentKeywords) ?? [];
        if (!kws.some((k: string) => k.toLowerCase().includes(filterIntent.toLowerCase()))) return false;
      }
      if (filterInterest) {
        const kws = ((l as unknown as { interestKeywords?: string[] }).interestKeywords) ?? [];
        if (!kws.some((k: string) => k.toLowerCase().includes(filterInterest.toLowerCase()))) return false;
      }
      return true;
    });
    const navSorted = [...navFiltered].sort((a, b) => {
      if (!sortCol) return 0;
      const aVal = a[sortCol] ?? (sortCol === "bantScore" || sortCol === "sequenceDay" ? 0 : "");
      const bVal = b[sortCol] ?? (sortCol === "bantScore" || sortCol === "sequenceDay" ? 0 : "");
      if (typeof aVal === "number" && typeof bVal === "number") return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      return sortDir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });
    sessionStorage.setItem("leadsNavList", JSON.stringify(navSorted.map((l) => l.id)));
  }, [navData, filterIndustry, filterCountry, filterSource, sortCol, sortDir]);

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: typeof sortCol }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-2.5 h-2.5 ml-0.5 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-2.5 h-2.5 ml-0.5 text-teal-600" /> : <ArrowDown className="w-2.5 h-2.5 ml-0.5 text-teal-600" />;
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  // Toggle all visible (filtered) leads — header checkbox behaviour
  const selectPage = () => {
    const allIds = filteredLeads.map((l: any) => l.id);
    const allSelected = allIds.every((id: number) => selected.includes(id));
    if (allSelected) {
      setSelected((prev) => prev.filter((id) => !allIds.includes(id)));
    } else {
      setSelected((prev) => [...new Set([...prev, ...allIds])]);
    }
  };

  // Select ALL filtered leads (alias, used by banner)
  const selectAll = () => {
    setSelected(filteredLeads.map((l: any) => l.id));
  };

  // Sync header checkbox indeterminate state
  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    const allIds = filteredLeads.map((l: any) => l.id);
    const selectedCount = allIds.filter((id: number) => selected.includes(id)).length;
    if (selectedCount === 0) {
      headerCheckboxRef.current.checked = false;
      headerCheckboxRef.current.indeterminate = false;
    } else if (selectedCount === allIds.length) {
      headerCheckboxRef.current.checked = true;
      headerCheckboxRef.current.indeterminate = false;
    } else {
      headerCheckboxRef.current.checked = false;
      headerCheckboxRef.current.indeterminate = true;
    }
  }, [selected, filteredLeads]);

  const EXPORT_HEADERS = [
    "ID", "First Name", "Last Name", "Email", "Phone", "WhatsApp",
    "LinkedIn URL", "Company", "Designation", "Industry", "City", "Country",
    "Website", "Company Size", "Annual Revenue", "Source", "Status",
    "BANT Score", "Keywords", "Notes", "Assigned To", "Created At",
  ];

  const buildExportRow = (l: any) => [
    l.id ?? "",
    l.firstName ?? "",
    l.lastName ?? "",
    l.email ?? "",
    l.phone ?? "",
    l.whatsapp ?? "",
    l.linkedInUrl ?? "",
    l.company ?? "",
    l.designation ?? "",
    l.industry ?? "",
    l.city ?? "",
    l.country ?? "",
    l.website ?? "",
    l.companySize ?? "",
    l.annualRevenue ?? "",
    l.source ?? "",
    l.status ?? "",
    l.bantScore != null ? l.bantScore : "",
    Array.isArray(l.keywords) ? l.keywords.join(", ") : (l.keywords ?? ""),
    l.notes ?? "",
    l.assignedToName ?? "",
    l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
  ];

  const exportLeads = (format: "csv" | "xlsx", filename: string) => {
    const rows = filteredLeads.filter((l: any) => selected.length === 0 || selected.includes(l.id));

    if (format === "csv") {
      const csvLines = [
        EXPORT_HEADERS.map((h) => `"${h}"`).join(","),
        ...rows.map((l: any) => buildExportRow(l).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
      ];
      const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${filename}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const wsData = [EXPORT_HEADERS, ...rows.map(buildExportRow)];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Style header row — bold + dark green background
      const headerRange = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      for (let c = headerRange.s.c; c <= headerRange.e.c; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r: 0, c });
        if (!ws[cellAddr]) continue;
        ws[cellAddr].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "1A3D2B" } },
          alignment: { horizontal: "center" },
        };
      }

      // Auto column widths
      ws["!cols"] = EXPORT_HEADERS.map((h, i) => {
        const maxLen = Math.max(
          h.length,
          ...rows.map((l: any) => String(buildExportRow(l)[i] ?? "").length),
        );
        return { wch: Math.min(maxLen + 2, 40) };
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Leads");
      XLSX.writeFile(wb, `${filename}.xlsx`);
    }
  };

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const g = (k: string) => fd.get(k) ? String(fd.get(k)) : undefined;
    const keywordsRaw = g("keywords") ?? "";
    const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()).filter(Boolean) : [];
    createLead.mutate({
      data: {
        firstName:     String(fd.get("firstName")),
        lastName:      String(fd.get("lastName") || "-"),
        email:         String(fd.get("email")),
        phone:         g("phone") ?? null,
        whatsapp:      g("whatsapp") ?? null,
        linkedInUrl:   g("linkedInUrl") || null,
        photoUrl:      g("photoUrl") || null,
        companyLogo:   g("companyLogo") || null,
        company:       String(fd.get("company")),
        city:          g("city") ?? null,
        country:       g("country") || undefined,
        designation:   g("designation") || undefined,
        website:       g("website") || null,
        industry:      g("industry") || undefined,
        companySize:   g("companySize") ?? null,
        annualRevenue: g("annualRevenue") ?? null,
        source:        g("source") ?? "manual",
        keywords,
        notes:         g("notes") ?? null,
      },
    });
  };

  const handleImport = () => {
    if (!pasteText.trim()) return;
    setImporting(true);
    importPaste.mutate({ data: { text: pasteText } });
  };

  const handleAiScore = async (leadId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setScoringLeads((prev) => new Set([...prev, leadId]));
    setScoreErrors((prev) => { const next = new Map(prev); next.delete(leadId); return next; });
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
      const res = await fetch(`${base}/qualify/${leadId}/ai`, { method: "POST" });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        const msg = (typeof body === "object" && body !== null && "error" in body && typeof (body as Record<string, unknown>).error === "string")
          ? (body as Record<string, unknown>).error as string
          : "Scoring failed";
        setScoreErrors((prev) => { const next = new Map(prev); next.set(leadId, msg); return next; });
        toast({ title: "Score failed", description: msg, variant: "destructive" });
        return;
      }
      const updated = await res.json();
      setAllLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, bantScore: updated.bantScore, bantBreakdown: updated.bantBreakdown, status: updated.status } : l));
      qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
      toast({ title: "Lead scored", description: `BANT score: ${updated.bantScore}` });
    } catch {
      setScoreErrors((prev) => { const next = new Map(prev); next.set(leadId, "Network error"); return next; });
      toast({ title: "Score failed", description: "Network error", variant: "destructive" });
    } finally {
      setScoringLeads((prev) => { const next = new Set(prev); next.delete(leadId); return next; });
    }
  };

  return (
    <div className="p-3 md:p-6 space-y-3 md:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base md:text-lg font-bold text-foreground">Lead Database</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{viewTab === "leads" ? `${total} total leads` : "Saved lists for targeted outreach"}</p>
          </div>
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setViewTab("leads")} className={cn("flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md font-medium transition-all", viewTab === "leads" ? "bg-white shadow-sm text-gray-800" : "text-gray-500 hover:text-gray-700")}>
              <Layers className="w-3 h-3" /> All Leads
            </button>
            <button onClick={() => setViewTab("lists")} className={cn("flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md font-medium transition-all", viewTab === "lists" ? "bg-white shadow-sm text-gray-800" : "text-gray-500 hover:text-gray-700")}>
              <ListPlus className="w-3 h-3" /> Lead Lists
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <button
            onClick={() => setShowFetch(true)}
            className="flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded text-xs font-semibold border border-transparent transition-colors text-white"
            style={{ background: "#1A3D2B" }}
          >
            <Zap className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Fetch Leads</span>
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded text-xs font-medium bg-gray-50 hover:bg-gray-50 text-muted-foreground border border-gray-200 transition-colors">
            <Upload className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Import</span>
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded text-xs font-medium text-white border border-transparent transition-colors" style={{ background: "#1A7A45" }}>
            <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Add</span>
          </button>
        </div>
      </div>

      {viewTab === "lists" && <LeadListsPanel selectedIds={selected} onSaveList={() => setShowListModal(true)} />}
      {showListModal && <SaveToListModal leadIds={selected} onClose={() => setShowListModal(false)} />}

      {/* Filters */}
      <div className="space-y-2" style={{ display: viewTab === "leads" ? undefined : "none" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            {isFetching && search ? (
              <Loader2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-teal-500 animate-spin" />
            ) : (
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            )}
            <input
              type="text"
              placeholder="Search name, company, email, phone, city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="relative">
            <Building2 className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Industry"
              value={filterIndustry}
              onChange={(e) => setFilterIndustry(e.target.value)}
              className="pl-6 pr-3 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50 w-32"
            />
          </div>
          <div className="relative">
            <Globe className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Country"
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value)}
              className="pl-6 pr-3 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50 w-28"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Source"
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="pl-6 pr-3 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50 w-28"
            />
          </div>
          <div className="relative">
            <Sparkles className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Behavior"
              value={filterBehavior}
              onChange={(e) => setFilterBehavior(e.target.value)}
              className="pl-6 pr-3 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50 w-28"
            />
          </div>
          <div className="relative">
            <Zap className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Intent"
              value={filterIntent}
              onChange={(e) => setFilterIntent(e.target.value)}
              className="pl-6 pr-3 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50 w-28"
            />
          </div>
          <div className="relative">
            <BarChart2 className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Interest"
              value={filterInterest}
              onChange={(e) => setFilterInterest(e.target.value)}
              className="pl-6 pr-3 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50 w-28"
            />
          </div>
          {(filterIndustry || filterCountry || filterSource || filterBehavior || filterIntent || filterInterest) && (
            <button onClick={() => { setFilterIndustry(""); setFilterCountry(""); setFilterSource(""); setFilterBehavior(""); setFilterIntent(""); setFilterInterest(""); }} className="text-[11px] text-muted-foreground hover:text-gray-900">✕ Clear</button>
          )}
          <button onClick={() => setShowExportModal(true)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border border-gray-200 bg-gray-50 text-muted-foreground hover:text-gray-900 ml-auto">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={cn("px-2.5 py-1 text-[11px] rounded border transition-colors", s === status ? "border-teal-300 text-teal-700 bg-teal-50" : "border-gray-200 text-muted-foreground hover:text-gray-900 bg-gray-50")}
            >
              {STATUS_DISPLAY[s] ?? s}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk actions */}
      {selected.length > 0 && viewTab === "leads" && (
        <div className="flex items-center gap-3 px-3 py-2 rounded border border-amber-200 bg-amber-50 flex-wrap">
          <span className="text-xs text-amber-600 font-medium">{selected.length} selected</span>
          <button onClick={() => bulkUpdate.mutate({ data: { ids: selected, status: "enquiry_qualified" } })} className="text-xs text-purple-400 hover:text-purple-300 underline">Mark Qualified</button>
          <button onClick={() => bulkUpdate.mutate({ data: { ids: selected, status: "discovery_call" } })} className="text-xs text-teal-400 hover:text-teal-300 underline">Book Discovery Call</button>
          <button onClick={() => bulkUpdate.mutate({ data: { ids: selected, status: "follow_up" } })} className="text-xs text-orange-400 hover:text-orange-300 underline">Move to Follow Up</button>
          <button
            onClick={async () => {
              if (!confirm(`Delete ${selected.length} lead(s)? This cannot be undone.`)) return;
              const base = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
              await Promise.all(selected.map((id) => fetch(`${base}/leads/${id}`, { method: "DELETE" })));
              qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
              setSelected([]);
            }}
            className="text-xs text-red-600 hover:text-red-600 underline"
          >
            Delete Selected
          </button>
          <button onClick={() => setShowExportModal(true)} className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 underline">
            <Download className="w-3 h-3" /> Export
          </button>
          <button
            disabled={enrichingBulk}
            onClick={async () => {
              if (!confirm(`Enrich AI keywords for ${selected.length} lead(s)?`)) return;
              setEnrichingBulk(true);
              try {
                const base = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
                const r = await fetch(`${base}/leads/enrich-keywords-bulk`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ids: selected }),
                });
                const result = await r.json();
                qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
                toast({ title: `Keywords enriched for ${result.enriched ?? selected.length} lead(s)`, variant: "default" });
                setSelected([]);
              } catch {
                toast({ title: "Enrichment failed", variant: "destructive" });
              } finally {
                setEnrichingBulk(false);
              }
            }}
            className="flex items-center gap-1 text-xs text-teal-700 hover:text-teal-600 underline disabled:opacity-50"
          >
            {enrichingBulk ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Enrich Keywords
          </button>
          {sequences.length > 0 && (
            <div className="relative">
              <button onClick={() => setShowAssignSeq((p) => !p)} className="text-xs text-purple-700 hover:text-purple-200 underline">Assign Sequence ▾</button>
              {showAssignSeq && (
                <div className="absolute top-6 left-0 z-20 rounded border border-gray-200 shadow-xl w-48 overflow-hidden">
                  {sequences.map((seq: OutreachSequence) => (
                    <button
                      key={seq.id}
                      onClick={async () => {
                        const base = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
                        await Promise.all(selected.map((leadId) =>
                          fetch(`${base}/leads/${leadId}/assign-sequence`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ sequenceId: seq.id }),
                          })
                        ));
                        qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
                        setShowAssignSeq(false);
                        setSelected([]);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      {seq.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={async () => {
              if (!confirm(`Generate brand reports for ${selected.length} lead(s)? This may take a minute.`)) return;
              setGeneratingReports(true);
              setReportsMsg(null);
              try {
                const base = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
                const r = await fetch(`${base}/audit/bulk-run`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ leadIds: selected }),
                });
                if (r.ok) {
                  const result = await r.json();
                  setReportsMsg(`✓ ${result.completed} report${result.completed !== 1 ? "s" : ""} generated`);
                } else {
                  setReportsMsg("✕ Generation failed");
                }
              } catch {
                setReportsMsg("✕ Network error");
              } finally {
                setGeneratingReports(false);
              }
            }}
            disabled={generatingReports}
            className="flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 underline disabled:opacity-50"
          >
            {generatingReports ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart2 className="w-3 h-3" />}
            {generatingReports ? "Generating…" : "Generate Brand Reports"}
          </button>
          {reportsMsg && <span className="text-xs text-emerald-700 font-medium">{reportsMsg}</span>}
          <button
            onClick={() => {
              if (!confirm(`Send WhatsApp hook messages to ${selected.length} lead(s)?`)) return;
              setWaInitiating(true);
              setWaMsg(null);
              initiateWaBulk.mutate(
                { data: { leadIds: selected } },
                {
                  onSuccess: (result) => {
                    const succeeded = result.succeeded ?? selected.length;
                    const failed = result.failed ?? 0;
                    const msg = failed > 0
                      ? `✓ Sent to ${succeeded} lead(s), ${failed} failed`
                      : `✓ WhatsApp hook sent to ${succeeded} lead(s)`;
                    setWaMsg(msg);
                    setSelected([]);
                  },
                  onError: () => {
                    setWaMsg("✕ Failed to initiate");
                  },
                  onSettled: () => {
                    setWaInitiating(false);
                  },
                }
              );
            }}
            disabled={waInitiating}
            className="flex items-center gap-1 text-xs text-green-700 hover:text-green-900 underline disabled:opacity-50"
          >
            {waInitiating ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
            {waInitiating ? "Sending…" : "WhatsApp Hook"}
          </button>
          {waMsg && <span className="text-xs text-green-700 font-medium">{waMsg}</span>}
          <button onClick={() => setShowListModal(true)} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 underline">
            <ListPlus className="w-3 h-3" /> Save to List
          </button>
          <button onClick={() => setSelected([])} className="text-xs text-muted-foreground hover:text-gray-900 underline ml-auto">Clear</button>
        </div>
      )}

      {/* ── Selection info banner ────────────────────────────────────── */}
      {selected.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-700">
          {selected.length === filteredLeads.length ? (
            <span className="font-medium">All {filteredLeads.length.toLocaleString()} leads are selected.</span>
          ) : (
            <>
              <span>{selected.length} of {filteredLeads.length.toLocaleString()} leads selected.</span>
              <button onClick={selectAll} className="font-semibold underline hover:text-blue-900">
                Select all {filteredLeads.length.toLocaleString()}
              </button>
            </>
          )}
          <button onClick={() => setSelected([])} className="ml-auto text-blue-500 hover:text-blue-800 underline">Clear</button>
        </div>
      )}

      {/* ── Mobile card list (hidden on desktop) ──────────────────────── */}
      <div className="block md:hidden space-y-2" style={{ display: viewTab === "leads" ? undefined : "none" }}>
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-gray-100 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))
        ) : filteredLeads.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-400 text-sm">No leads found</div>
        ) : (
          filteredLeads.map((lead) => {
            const bantScore = (lead as any).bantScore;
            const scoreColor = bandHexFromKey(scoreToBandKey(bantScore)) ?? "#6B7280";
            const rawPhone = lead.whatsapp || lead.phone || "";
            const waNumber = (() => {
              const d = rawPhone.replace(/\D/g, "");
              if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
              return d;
            })();
            return (
              <div
                key={lead.id}
                className="rounded-xl border border-gray-200 bg-white p-3.5 active:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => setDrawerLeadId(lead.id)}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="flex-shrink-0 relative">
                    <input
                      type="checkbox"
                      checked={selected.includes(lead.id)}
                      onChange={(e) => { e.stopPropagation(); toggleSelect(lead.id); }}
                      className="absolute -top-1 -left-1 z-10 w-4 h-4 accent-teal-500"
                      onClick={e => e.stopPropagation()}
                    />
                    {(lead as any).photoUrl ? (
                      <img src={(lead as any).photoUrl} alt="" className="w-10 h-10 rounded-full object-cover border border-gray-100" />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-bold text-white flex-shrink-0" style={{ background: "#1A3D2B" }}>
                        {lead.firstName?.[0]}{lead.lastName?.[0]}
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-gray-900 truncate">{lead.firstName} {lead.lastName}</div>
                        <div className="text-xs text-gray-500 truncate">{lead.designation ?? ""}{lead.designation && lead.company ? " · " : ""}{lead.company}</div>
                      </div>
                      {/* Score badge — always visible; tap to re-score */}
                      {scoringLeads.has(lead.id) ? (
                        <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-teal-600 font-medium">
                          <Loader2 className="w-3 h-3 animate-spin" /> Scoring…
                        </span>
                      ) : bantScore != null ? (
                        <button
                          onClick={(e) => handleAiScore(lead.id, e)}
                          title="Re-score with AI"
                          className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border transition-colors"
                          style={{ background: scoreColor + "15", color: scoreColor, borderColor: scoreColor + "40" }}
                        >
                          <span style={{ fontSize: "15px", lineHeight: 1 }}>{bantScore}</span>
                          <span className="text-[9px] font-normal opacity-70">{bandLabelFromKey(scoreToBandKey(bantScore))}</span>
                        </button>
                      ) : scoreErrors.get(lead.id) ? (
                        <button
                          title={scoreErrors.get(lead.id)}
                          onClick={(e) => handleAiScore(lead.id, e)}
                          className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-red-200 text-red-500 bg-red-50 active:bg-red-100 transition-colors"
                        >
                          <Sparkles className="w-3 h-3" /> Retry
                        </button>
                      ) : (
                        <button
                          onClick={(e) => handleAiScore(lead.id, e)}
                          title="Score this lead with AI"
                          className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-teal-200 text-teal-700 bg-teal-50 active:bg-teal-100 transition-colors"
                        >
                          <Sparkles className="w-3 h-3" /> Score
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <StatusBadge status={lead.status} />
                      {lead.industry && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{lead.industry}</span>
                      )}
                      {lead.country && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{lead.country}</span>
                      )}
                    </div>

                    {lead.email && (
                      <div className="text-[11px] text-gray-400 mt-1.5 truncate">{lead.email}</div>
                    )}

                    {/* WhatsApp — opens device WhatsApp via wa.me deep link */}
                    <div className="mt-2 flex justify-end" onClick={e => e.stopPropagation()}>
                      <a
                        href={waNumber ? `https://wa.me/${waNumber}` : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => { if (!waNumber) e.preventDefault(); }}
                        className={cn(
                          "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors no-underline",
                          waNumber
                            ? "border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
                            : "border-gray-100 text-gray-300 bg-gray-50 cursor-not-allowed pointer-events-none"
                        )}
                        title={waNumber ? `Open WhatsApp for ${rawPhone}` : "No phone number"}
                      >
                        <MessageCircle className="w-3 h-3" />
                        WhatsApp
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {isFetching && !isLoading && (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Table — 21 columns, equal width, horizontally scrollable (desktop only) */}
      <div className="hidden md:block rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" style={{ display: viewTab === "leads" ? undefined : "none" }}>
        <div className="overflow-x-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 #f8fafc" }}>
          <table className="text-xs" style={{ minWidth: "2700px", tableLayout: "fixed", width: "2700px" }}>
            <colgroup>
              <col style={{ width: "40px" }} />
              <col style={{ width: "52px" }} />
              <col style={{ width: "160px" }} />
              <col style={{ width: "140px" }} />
              <col style={{ width: "155px" }} />
              <col style={{ width: "185px" }} />
              <col style={{ width: "155px" }} />
              <col style={{ width: "155px" }} />
              <col style={{ width: "140px" }} />
              <col style={{ width: "130px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "130px" }} />
              <col style={{ width: "190px" }} />
              <col style={{ width: "125px" }} />
              <col style={{ width: "115px" }} />
              <col style={{ width: "95px" }} />
              <col style={{ width: "115px" }} />
              <col style={{ width: "105px" }} />
              <col style={{ width: "60px" }} />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="sticky left-0 z-20 bg-gray-50 px-2 py-2.5">
                  <input ref={headerCheckboxRef} type="checkbox" onChange={selectPage} className="w-3.5 h-3.5 accent-teal-500" />
                </th>
                <th className="bg-gray-50 px-2 py-2.5" />
                {([
                  ["Name", null],
                  ["Designation", null],
                  ["Company", "company"],
                  ["Email", null],
                  ["Phone / WhatsApp", null],
                  ["Website", null],
                  ["LinkedIn", null],
                  ["Industry", null],
                  ["City", null],
                  ["Country", null],
                  ["Source", null],
                  ["Co. Size", null],
                  ["Revenue", null],
                  ["Keywords", null],
                  ["Status", null],
                  ["BANT", "bantScore"],
                  ["Seq Day", "sequenceDay"],
                  ["Last Contact", "lastContactedAt"],
                  ["Added", "createdAt"],
                ] as [string, string | null][]).map(([label, col]) => (
                  <th
                    key={label}
                    className={cn(
                      "text-left px-3 py-2.5 font-semibold text-[10px] text-gray-400 uppercase tracking-wider overflow-hidden",
                      col && "cursor-pointer hover:text-gray-700"
                    )}
                    onClick={col ? () => handleSort(col as any) : undefined}
                  >
                    {col ? (
                      <span className="flex items-center gap-1">{label} <SortIcon col={col as any} /></span>
                    ) : label}
                  </th>
                ))}
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={22} className="px-3 py-3">
                      <div className="h-4 rounded bg-gray-100 animate-pulse" style={{ width: `${60 + i * 8}%` }} />
                    </td>
                  </tr>
                ))
              ) : leads.length === 0 ? (
                <tr><td colSpan={22} className="text-center py-10 text-gray-400">No leads found</td></tr>
              ) : filteredLeads.map((lead) => {
                const l = lead as any;
                const phoneDisplay = [lead.phone, l.whatsapp].filter(Boolean).join(" · ") || null;
                return (
                <tr
                  key={lead.id}
                  className="hover:bg-green-50/30 transition-colors cursor-pointer"
                  onClick={() => setDrawerLeadId(lead.id)}
                >
                  {/* Checkbox */}
                  <td className="sticky left-0 z-10 bg-white px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggleSelect(lead.id)} className="w-3.5 h-3.5 accent-teal-500" />
                  </td>
                  {/* Photo / Avatar */}
                  <td className="px-2 py-2.5">
                    {lead.photoUrl ? (
                      <img src={lead.photoUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-gray-100" />
                    ) : (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "#1A3D2B" }}>
                        {lead.firstName?.[0]}{lead.lastName?.[0]}
                      </div>
                    )}
                  </td>
                  {/* Name — merged */}
                  <td className="px-3 py-2.5 text-gray-800 font-medium truncate">{lead.firstName} {lead.lastName}</td>
                  {/* Designation */}
                  <td className="px-3 py-2.5 text-gray-500 truncate">{lead.designation ?? <span className="text-gray-300">—</span>}</td>
                  {/* Company */}
                  <td className="px-3 py-2.5 text-gray-800 truncate">{lead.company}</td>
                  {/* Email */}
                  <td className="px-3 py-2.5 truncate">
                    <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>{lead.email}</a>
                  </td>
                  {/* Phone / WhatsApp */}
                  <td className="px-3 py-2.5 text-gray-500 truncate">
                    {phoneDisplay ?? <span className="text-gray-300">—</span>}
                  </td>
                  {/* Website — before LinkedIn */}
                  <td className="px-3 py-2.5 truncate">
                    {lead.website ? (
                      <a href={lead.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {lead.website.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  {/* LinkedIn */}
                  <td className="px-3 py-2.5 truncate">
                    {lead.linkedInUrl ? (
                      <a href={lead.linkedInUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {lead.linkedInUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "") || "View"}
                      </a>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Industry — after LinkedIn */}
                  <td className="px-3 py-2.5 text-gray-500 truncate">{lead.industry ?? <span className="text-gray-300">—</span>}</td>
                  {/* City */}
                  <td className="px-3 py-2.5 text-gray-500 truncate">{l.city ?? <span className="text-gray-300">—</span>}</td>
                  {/* Country */}
                  <td className="px-3 py-2.5 text-gray-500 truncate">{lead.country ?? <span className="text-gray-300">—</span>}</td>
                  {/* Source */}
                  <td className="px-3 py-2.5 text-gray-500 capitalize truncate">{lead.source?.replace(/_/g, " ") ?? <span className="text-gray-300">—</span>}</td>
                  {/* Company Size */}
                  <td className="px-3 py-2.5 text-gray-500 truncate">{lead.companySize ?? <span className="text-gray-300">—</span>}</td>
                  {/* Annual Revenue */}
                  <td className="px-3 py-2.5 text-gray-500 truncate">{l.annualRevenue ?? <span className="text-gray-300">—</span>}</td>
                  {/* Keywords */}
                  <td className="px-3 py-2.5 max-w-[180px]">
                    <div className="flex flex-col gap-0.5">
                      {(l.intentKeywords as string[] | null)?.slice(0, 2).map((k: string) => (
                        <span key={k} className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-violet-50 text-violet-700 border border-violet-100 whitespace-nowrap truncate">{k}</span>
                      ))}
                      {(l.behaviorKeywords as string[] | null)?.slice(0, 1).map((k: string) => (
                        <span key={k} className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-amber-50 text-amber-700 border border-amber-100 whitespace-nowrap truncate">{k}</span>
                      ))}
                      {!(l.intentKeywords as string[] | null)?.length && !(l.behaviorKeywords as string[] | null)?.length && <span className="text-gray-300">—</span>}
                    </div>
                  </td>
                  {/* Status */}
                  <td className="px-3 py-2.5"><StatusBadge status={lead.status} /></td>
                  {/* BANT */}
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {lead.bantScore != null ? (() => {
                      const raw = (lead as { bantBreakdown?: unknown }).bantBreakdown;
                      const bd: BantBreakdown | null =
                        raw && typeof raw === "object" && !Array.isArray(raw)
                          ? (raw as BantBreakdown)
                          : null;
                      const isOpen = bantPopoverLeadId === lead.id;
                      if (bd === null || !BANT_KEYS.some(k => typeof bd[k] === "number")) {
                        return (
                          <span className="inline-flex items-baseline gap-1">
                            <span className={cn("font-bold", bandColorFromKey(scoreToBandKey(lead.bantScore)))}>{lead.bantScore}</span>
                            <span className="text-gray-400 text-[10px]">{bandLabelFromKey(scoreToBandKey(lead.bantScore))}</span>
                          </span>
                        );
                      }
                      const reasoning = bd.reasoning;
                      return (
                        <HoverCard
                          open={isOpen}
                          onOpenChange={(o) => setBantPopoverLeadId(o ? lead.id : null)}
                          openDelay={200}
                          closeDelay={100}
                        >
                          <HoverCardTrigger asChild>
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={`BANT breakdown for score ${lead.bantScore}`}
                              className="inline-flex items-baseline gap-1 cursor-pointer select-none bg-transparent border-0 p-0 font-inherit"
                              onClick={(e) => { e.stopPropagation(); setBantPopoverLeadId(isOpen ? null : lead.id); }}
                            >
                              <span className={cn("font-bold underline decoration-dotted underline-offset-2", bandColorFromKey(scoreToBandKey(lead.bantScore)))}>{lead.bantScore}</span>
                              <span className="text-gray-400 text-[10px]">{bandLabelFromKey(scoreToBandKey(lead.bantScore))}</span>
                            </button>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-56 p-3" align="start" sideOffset={6}>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">BANT Breakdown</div>
                            <div className="space-y-1.5">
                              {BANT_KEYS.map((key: BantKey) => {
                                const val = typeof bd[key] === "number" ? (bd[key] as number) : null;
                                if (val === null) return null;
                                const pct = Math.min(100, Math.max(0, Math.round((val / 25) * 100)));
                                const barColor = bantSubScoreColor(pct);
                                return (
                                  <div key={key}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{key[0].toUpperCase() + key.slice(1)}</span>
                                      <span className="text-[11px] font-bold" style={{ color: barColor }}>{val}<span className="text-gray-300 font-normal">/25</span></span>
                                    </div>
                                    <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
                                    </div>
                                    {reasoning?.[key] && (
                                      <p className="text-[10px] text-gray-400 mt-0.5 leading-snug line-clamp-2">{reasoning[key]}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      );
                    })() : scoreErrors.get(lead.id) ? (
                      <button
                        title={scoreErrors.get(lead.id)}
                        onClick={(e) => handleAiScore(lead.id, e)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-colors"
                      >
                        <Sparkles className="w-3 h-3" /> Retry
                      </button>
                    ) : scoringLeads.has(lead.id) ? (
                      <span className="flex items-center gap-1 text-[10px] text-teal-600">
                        <Loader2 className="w-3 h-3 animate-spin" /> Scoring…
                      </span>
                    ) : (
                      <button
                        onClick={(e) => handleAiScore(lead.id, e)}
                        title="Score this lead with AI"
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors"
                      >
                        <Sparkles className="w-3 h-3" /> Score
                      </button>
                    )}
                  </td>
                  {/* Seq Day */}
                  <td className="px-3 py-2.5 text-gray-500 text-center">
                    {lead.sequenceDay != null && lead.sequenceDay > 0 ? `Day ${lead.sequenceDay}` : "—"}
                  </td>
                  {/* Last Contact */}
                  <td className="px-3 py-2.5 text-gray-400">{lead.lastContactedAt ? formatDate(lead.lastContactedAt) : "—"}</td>
                  {/* Added */}
                  <td className="px-3 py-2.5 text-gray-400">{formatDate(lead.createdAt)}</td>
                  {/* Actions */}
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setDrawerLeadId(lead.id)} title="Open detail">
                        <ExternalLink className="w-3.5 h-3.5 text-gray-300 hover:text-gray-700" />
                      </button>
                      {(() => {
                        const rp = lead.whatsapp || lead.phone || "";
                        const wd = rp.replace(/\D/g, "");
                        const wn = wd.length === 10 && /^[6-9]/.test(wd) ? `91${wd}` : wd;
                        return wn ? (
                          <a
                            href={`https://wa.me/${wn}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open WhatsApp for ${rp}`}
                            onClick={e => e.stopPropagation()}
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-gray-300 hover:text-green-600" />
                          </a>
                        ) : (
                          <span title="No phone number — add one to enable WhatsApp">
                            <MessageCircle className="w-3.5 h-3.5 text-gray-200 cursor-not-allowed" />
                          </span>
                        );
                      })()}
                      <button onClick={() => { if (confirm("Delete this lead?")) deleteLead.mutate({ id: lead.id }); }}>
                        <Trash2 className="w-3.5 h-3.5 text-gray-300 hover:text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </div>

      {/* Infinite scroll sentinel + loading indicator */}
      <div ref={sentinelCallback} className="h-1" />
      {isFetching && allLeads.length > 0 && (
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading more leads…
        </div>
      )}
      {!hasMore && allLeads.length > 0 && (
        <div className="py-3 text-center text-[11px] text-muted-foreground">
          All {total.toLocaleString()} leads loaded
        </div>
      )}

      {/* Add Lead Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div
            className="rounded-xl border border-gray-200 w-full max-w-2xl bg-white shadow-sm"
            style={{ maxHeight: "90vh", overflowY: "auto" }}
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
              <h2 className="text-sm font-bold text-gray-900">Add New Lead</h2>
              <button type="button" onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <form onSubmit={handleAddSubmit} className="p-6 space-y-5">

              {/* ── Contact ── */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Contact</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">First Name *</label>
                    <input name="firstName" required className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Last Name</label>
                    <input name="lastName" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-[11px] text-gray-500 mb-1">Email *</label>
                  <input name="email" type="email" required className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Phone *</label>
                    <input name="phone" required className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">WhatsApp Number</label>
                    <input name="whatsapp" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  {[["linkedInUrl","LinkedIn URL"],["photoUrl","Profile Photo URL"]].map(([n,l]) => (
                    <div key={n}>
                      <label className="block text-[11px] text-gray-500 mb-1">{l}</label>
                      <input name={n} type="url" placeholder="https://" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Company ── */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Company</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Company Logo URL</label>
                    <input name="companyLogo" type="url" placeholder="https://" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Company Name *</label>
                    <input name="company" required className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  {[["city","City"],["country","Country"]].map(([n,l]) => (
                    <div key={n}>
                      <label className="block text-[11px] text-gray-500 mb-1">{l}</label>
                      <input name={n} className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Designation</label>
                    <input name="designation" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Website URL *</label>
                    <input name="website" type="url" placeholder="https://" required className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Industry</label>
                    <input name="industry" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Company Size</label>
                    <select name="companySize" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300">
                      <option value="">Select…</option>
                      {["1-10","11-50","51-200","201-500","501-2000","2000+"].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Annual Revenue</label>
                    <input name="annualRevenue" placeholder="e.g. $5M" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                </div>
              </div>

              {/* ── Classification ── */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Classification</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Lead Source *</label>
                    <select name="source" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300">
                      {["manual","linkedin","cold-email","referral","event","instagram","website","csv_import"].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Keywords <span className="text-gray-400 font-normal">(comma-separated)</span></label>
                    <input name="keywords" placeholder="e.g. branding, luxury, ecommerce" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-[11px] text-gray-500 mb-1">Notes</label>
                  <textarea name="notes" rows={2} className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none" />
                </div>
              </div>

              <div className="flex gap-2 pt-1 border-t border-gray-100">
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 px-3 py-2 rounded-lg text-xs text-gray-600 bg-gray-50 border border-gray-200 hover:bg-gray-100">Cancel</button>
                <button type="submit" disabled={createLead.isPending} className="flex-1 px-3 py-2 rounded-lg text-xs text-white font-semibold" style={{ background: "#1A3D2B" }}>
                  {createLead.isPending ? "Adding..." : "Add Lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeImport}>
          <div className="rounded-xl border border-gray-200 p-6 w-full max-w-xl bg-white shadow-sm" style={{ maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-foreground mb-1">Import Leads</h2>
            <p className="text-xs text-muted-foreground mb-4">Duplicate emails are automatically detected and skipped.</p>

            {importResult ? (
              <div className="space-y-3">
                <div className={cn("flex items-center gap-2 px-3 py-2.5 rounded border", importResult.imported > 0 ? "border-teal-200 bg-teal-50" : "border-gray-200 bg-gray-50")}>
                  <CheckCircle2 className="w-4 h-4 text-teal-600" />
                  <div className="text-xs font-medium text-foreground">{importResult.imported} leads imported successfully</div>
                </div>
                {importResult.skipped > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded border border-amber-200 bg-amber-50">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <div className="text-xs text-amber-600">{importResult.skipped} duplicates skipped (email already exists)</div>
                  </div>
                )}
                {importResult.errors.length > 0 && (
                  <div className="px-3 py-2.5 rounded border border-red-500/30 bg-red-500/5 text-xs text-red-600">
                    <div className="font-medium mb-1">Errors:</div>
                    {importResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
                <button onClick={closeImport} className="w-full px-3 py-1.5 rounded text-xs text-white font-medium" style={{ background: "#1A7A45" }}>Done</button>
              </div>
            ) : (
              <>
                <div className="flex gap-1 mb-4">
                  {[["paste", "Paste Text (AI)"], ["csv", "Apollo CSV"], ["manual", "Manual Entry"], ["vibe", "Vibe Prospecting"]].map(([tab, label]) => (
                    <button
                      key={tab}
                      onClick={() => setImportTab(tab as "paste" | "csv" | "manual" | "vibe")}
                      className={cn("px-3 py-1.5 text-[11px] rounded border transition-colors", importTab === tab ? "border-teal-300 text-teal-700 bg-teal-50" : "border-gray-200 text-muted-foreground hover:text-gray-900")}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {importTab === "paste" ? (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">Paste names, emails, LinkedIn URLs, or any structured text — AI will parse it into leads.</p>
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={7}
                      placeholder="John Smith, CMO, Acme Corp, john@acme.com, Dubai, Healthcare..."
                      className="w-full px-3 py-2 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50 font-mono resize-none"
                    />
                    <div className="flex gap-2 mt-3">
                      <button onClick={closeImport} className="flex-1 px-3 py-1.5 rounded text-xs text-muted-foreground bg-gray-50 hover:bg-gray-50 border border-gray-200">Cancel</button>
                      <button
                        onClick={() => { setImporting(true); importPaste.mutate({ data: { text: pasteText } }); }}
                        disabled={importing || !pasteText.trim()}
                        className="flex-1 px-3 py-1.5 rounded text-xs text-white font-medium disabled:opacity-50"
                        style={{ background: "#1A7A45" }}
                      >
                        {importing ? "Parsing with AI..." : "Import Leads"}
                      </button>
                    </div>
                  </>
                ) : importTab === "manual" ? (
                  <>
                    <form onSubmit={handleManualCreate} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-1">First Name *</label>
                          <input name="firstName" required placeholder="John" className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-1">Last Name *</label>
                          <input name="lastName" required placeholder="Smith" className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">Email *</label>
                        <input name="email" type="email" required placeholder="john@company.com" className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">Company *</label>
                        <input name="company" required placeholder="Acme Corp" className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-1">Designation</label>
                          <input name="designation" placeholder="CMO" className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-1">Industry</label>
                          <input name="industry" placeholder="Retail" className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">Country</label>
                        <input name="country" defaultValue="UAE" placeholder="UAE" className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none" />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button type="button" onClick={closeImport} className="flex-1 px-3 py-1.5 rounded text-xs text-muted-foreground bg-gray-50 border border-gray-200">Cancel</button>
                        <button type="submit" disabled={importing} className="flex-1 px-3 py-1.5 rounded text-xs text-white font-medium disabled:opacity-50" style={{ background: "#1A7A45" }}>
                          {importing ? "Adding..." : "Add Lead"}
                        </button>
                      </div>
                    </form>
                  </>
                ) : importTab === "vibe" ? (
                  <>
                    <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
                      <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl" style={{ background: "rgba(245,158,11,0.15)" }}>✨</div>
                      <div className="text-sm font-medium text-foreground">Vibe Prospecting</div>
                      <div className="text-xs text-muted-foreground max-w-xs">Describe your ideal customer in plain language and AI will generate a targeted prospect list for you.</div>
                      <div className="px-3 py-1.5 text-[11px] rounded border border-amber-200 text-amber-600 bg-amber-50">Coming in v1.1</div>
                      <button onClick={closeImport} className="mt-4 px-4 py-1.5 rounded text-xs text-muted-foreground bg-gray-50 border border-gray-200">Close</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-gray-200 hover:border-teal-500/40 rounded-lg p-6 text-center cursor-pointer transition-colors mb-3"
                    >
                      <FileSpreadsheet className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <div className="text-xs text-gray-700">{csvRows.length > 0 ? `${csvRows.length} rows loaded` : "Upload Apollo.io export CSV"}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Supports Apollo export format — email, firstName/first_name, lastName/last_name, company, title</div>
                    </div>
                    <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) parseCsvFile(e.target.files[0]); }} />

                    {csvHeaders.length > 0 && (
                      <div className="mb-3">
                        <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">Map CSV Columns</div>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {csvHeaders.map((header) => (
                            <div key={header} className="flex items-center gap-2">
                              <span className="text-[11px] text-gray-700 w-32 truncate">{header}</span>
                              <span className="text-muted-foreground text-[11px]">→</span>
                              <select
                                value={csvMapping[header] ?? ""}
                                onChange={(e) => setCsvMapping((prev) => ({ ...prev, [header]: e.target.value as CsvColumn | "" }))}
                                className="flex-1 text-[11px] rounded border border-gray-200 bg-white text-gray-900 px-2 py-1 focus:outline-none"
                              >
                                <option value="">Skip</option>
                                {CSV_COLUMNS.map((col) => <option key={col} value={col}>{col}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button onClick={closeImport} className="flex-1 px-3 py-1.5 rounded text-xs text-muted-foreground bg-gray-50 border border-gray-200">Cancel</button>
                      <button
                        onClick={handleCsvImport}
                        disabled={importing || csvRows.length === 0}
                        className="flex-1 px-3 py-1.5 rounded text-xs text-white font-medium disabled:opacity-50"
                        style={{ background: "#1A7A45" }}
                      >
                        {importing ? "Importing..." : `Import ${csvRows.length} Rows`}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Lead Detail Drawer */}
      {drawerLeadId != null && (
        <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
      )}

      {/* AI Fetch Leads panel */}
      {showFetch && <FetchLeads onClose={() => setShowFetch(false)} />}

      {/* Export Modal */}
      {showExportModal && (
        <ExportModal
          rowCount={selected.length > 0 ? selected.length : filteredLeads.length}
          defaultName={selected.length > 0 ? `${selected.length} leads selected` : "All leads"}
          onExport={(format, filename) => { exportLeads(format, filename); setShowExportModal(false); }}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}

function ExportModal({
  rowCount,
  defaultName,
  onExport,
  onClose,
}: {
  rowCount: number;
  defaultName: string;
  onExport: (format: "csv" | "xlsx", filename: string) => void;
  onClose: () => void;
}) {
  const [filename, setFilename] = useState(defaultName);
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100" style={{ background: "#1A3D2B" }}>
          <h3 className="text-[15px] font-bold text-white">Export leads</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-[12px] text-gray-600">
            <Download className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span>Exporting <span className="font-semibold text-gray-900">{rowCount.toLocaleString()} leads</span> · 22 columns · 1 file</span>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1.5">Export name</label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1A3D2B]/20 focus:border-[#1A3D2B]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-2">File format</label>
            <div className="grid grid-cols-2 gap-2">
              {(["xlsx", "csv"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={cn(
                    "flex items-center gap-2.5 px-4 py-3 rounded-xl border text-[13px] font-medium transition-all",
                    format === f
                      ? "border-[#1A3D2B] bg-[#1A3D2B]/5 text-[#1A3D2B]"
                      : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50",
                  )}
                >
                  <FileSpreadsheet className="w-4 h-4 flex-shrink-0" />
                  {f === "xlsx" ? "Excel (.xlsx)" : "CSV (.csv)"}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3 py-3 rounded-lg bg-green-50 border border-green-100 text-[11px] text-green-800 space-y-1">
            <div className="font-semibold text-green-900 mb-1">Columns included in export</div>
            <div className="text-green-700 leading-relaxed">
              ID · First Name · Last Name · Email · Phone · WhatsApp · LinkedIn URL · Company · Designation · Industry · City · Country · Website · Company Size · Annual Revenue · Source · Status · BANT Score · Keywords · Notes · Assigned To · Created At
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={() => onExport(format, (filename.trim() || "leads").replace(/\.(csv|xlsx?)$/i, ""))}
            disabled={!filename.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all disabled:opacity-50"
            style={{ background: "#1A3D2B" }}
          >
            <Download className="w-4 h-4" />
            Export {format.toUpperCase()}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const LIST_COLORS = ["#4F35A8","#C9A84C","#10b981","#ef4444","#3b82f6","#f59e0b","#8b5cf6","#06b6d4"];

function LeadListsPanel({ selectedIds, onSaveList }: { selectedIds: number[]; onSaveList: () => void }) {
  const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
  const [lists, setLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(LIST_COLORS[0]);
  const [creating, setCreating] = useState(false);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`${API_BASE}/lead-lists`, { credentials: "include" }).catch(() => null);
    if (r?.ok) setLists(await r.json());
    setLoading(false);
  }, [API_BASE]);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this list?")) return;
    setDeleting(id);
    await fetch(`${API_BASE}/lead-lists/${id}`, { method: "DELETE", credentials: "include" });
    setLists(l => l.filter(x => x.id !== id));
    setDeleting(null);
  };

  const handleRename = async (id: number) => {
    if (!editName.trim()) return;
    const r = await fetch(`${API_BASE}/lead-lists/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: editName }) });
    if (r.ok) { const updated = await r.json(); setLists(l => l.map(x => x.id === id ? { ...x, name: updated.name } : x)); }
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const r = await fetch(`${API_BASE}/lead-lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (r.ok) { setNewName(""); setShowCreate(false); await fetchLists(); }
    } finally { setCreating(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-indigo-400" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{lists.length} saved list{lists.length !== 1 ? "s" : ""}</p>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button onClick={onSaveList} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700">
              <ListPlus className="w-3.5 h-3.5" /> Save {selectedIds.length} lead{selectedIds.length !== 1 ? "s" : ""}
            </button>
          )}
          <button onClick={() => setShowCreate(v => !v)} className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold border border-gray-200 hover:border-indigo-300 hover:text-indigo-700 text-gray-600 bg-white transition-colors">
            <Plus className="w-3 h-3" /> New List
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
          <p className="text-xs font-semibold text-indigo-700">Create New List</p>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="List name…" onKeyDown={e => e.key === "Enter" && handleCreate()}
            className="w-full px-3 py-2 rounded-lg text-xs border border-gray-200 outline-none focus:border-indigo-400" />
          <div className="flex items-center gap-2 flex-wrap">
            {LIST_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)} className="w-5 h-5 rounded-full border-2 transition-all" style={{ background: c, borderColor: newColor === c ? "#111" : "transparent" }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-500">Cancel</button>
            <button onClick={handleCreate} disabled={!newName.trim() || creating} className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ background: "#4F35A8" }}>
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {lists.length === 0 && !showCreate ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <Layers className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No lead lists yet</p>
          <p className="text-xs text-gray-400 mb-3">Create a list or select leads and use "Save to List"</p>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 text-xs font-semibold text-white rounded-lg" style={{ background: "#4F35A8" }}>Create First List</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {lists.map((list) => {
            const color = list.color || LIST_COLORS[0];
            const isExpanded = expandedId === list.id;
            return (
              <div key={list.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3" style={{ borderLeft: `4px solid ${color}` }}>
                  <div className="flex-1 min-w-0">
                    {editingId === list.id ? (
                      <div className="flex items-center gap-1">
                        <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleRename(list.id); if (e.key === "Escape") setEditingId(null); }} autoFocus className="text-sm font-semibold border-b border-indigo-300 outline-none bg-transparent flex-1" />
                        <button onClick={() => handleRename(list.id)} className="text-xs text-indigo-600 hover:underline">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
                      </div>
                    ) : (
                      <p className="text-sm font-semibold text-gray-800 truncate">{list.name}</p>
                    )}
                    <p className="text-xs text-gray-400">{list.count ?? 0} lead{(list.count ?? 0) !== 1 ? "s" : ""} · {list.createdAt ? new Date(list.createdAt).toLocaleDateString() : ""}</p>
                  </div>
                  <button onClick={() => { setEditingId(list.id); setEditName(list.name); }} className="p-1 text-gray-300 hover:text-gray-600"><Search className="w-3 h-3" /></button>
                  <button onClick={() => setExpandedId(isExpanded ? null : list.id)} className="p-1 text-gray-300 hover:text-gray-600"><ArrowUpDown className="w-3 h-3" /></button>
                  <button onClick={() => handleDelete(list.id)} disabled={deleting === list.id} className="p-1 text-gray-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                </div>
                {isExpanded && <ListLeads listId={list.id} apiBase={API_BASE} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListLeads({ listId, apiBase }: { listId: number; apiBase: string }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`${apiBase}/lead-lists/${listId}`, { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => { if (d) setLeads(d.leads ?? []); setLoading(false); });
  }, [listId, apiBase]);
  if (loading) return <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>;
  if (leads.length === 0) return <div className="px-4 py-3 text-xs text-gray-400 italic">No leads in this list</div>;
  return (
    <div className="border-t border-gray-100 divide-y divide-gray-50">
      {leads.slice(0, 5).map((l: any) => (
        <div key={l.id} className="flex items-center gap-2 px-4 py-2">
          <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600 flex-shrink-0">
            {(l.name || "?")[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-700 truncate">{l.name || "Unknown"}</p>
            <p className="text-[10px] text-gray-400 truncate">{l.company || l.email || ""}</p>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: statusColor(l.status) + "20", color: statusColor(l.status) }}>{statusLabel(l.status)}</span>
        </div>
      ))}
      {leads.length > 5 && <div className="px-4 py-2 text-[10px] text-gray-400 text-center">+{leads.length - 5} more</div>}
    </div>
  );
}

function SaveToListModal({ leadIds, onClose }: { leadIds: number[]; onClose: () => void }) {
  const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
  const [lists, setLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListColor, setNewListColor] = useState(LIST_COLORS[0]);
  const [mode, setMode] = useState<"existing" | "new">("new");

  useEffect(() => {
    fetch(`${API_BASE}/lead-lists`, { credentials: "include" }).then(r => r.ok ? r.json() : []).then(d => { setLists(d); setLoading(false); });
  }, [API_BASE]);

  const handleSaveNew = async () => {
    if (!newListName.trim()) return;
    setSaving(true);
    const r = await fetch(`${API_BASE}/lead-lists`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: newListName.trim(), color: newListColor, leadIds }) });
    if (r.ok) { onClose(); } else { setSaving(false); }
  };

  const handleSaveExisting = async (listId: number) => {
    setSaving(true);
    const r = await fetch(`${API_BASE}/lead-lists/${listId}/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ leadIds }) });
    if (r.ok) { onClose(); } else { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Save {leadIds.length} lead{leadIds.length !== 1 ? "s" : ""} to list</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setMode("new")} className={cn("flex-1 py-2 text-xs font-medium rounded-lg border transition-all", mode === "new" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-500 hover:border-gray-300")}>Create new list</button>
            <button onClick={() => setMode("existing")} className={cn("flex-1 py-2 text-xs font-medium rounded-lg border transition-all", mode === "existing" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-500 hover:border-gray-300")}>Add to existing</button>
          </div>
          {mode === "new" ? (
            <div className="space-y-3">
              <input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="List name (e.g. Hot Leads July)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" onKeyDown={e => { if (e.key === "Enter") handleSaveNew(); }} autoFocus />
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Color:</span>
                {LIST_COLORS.map(c => (
                  <button key={c} onClick={() => setNewListColor(c)} className="w-5 h-5 rounded-full border-2 transition-all" style={{ background: c, borderColor: newListColor === c ? "#1e1b4b" : "transparent" }} />
                ))}
              </div>
              <button onClick={handleSaveNew} disabled={saving || !newListName.trim()} className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                {saving ? "Saving…" : "Create list & save leads"}
              </button>
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {loading ? <div className="text-center py-4 text-xs text-gray-400">Loading lists…</div> : lists.length === 0 ? (
                <div className="text-center py-4 text-xs text-gray-400">No lists yet — create one instead</div>
              ) : lists.map(list => (
                <button key={list.id} onClick={() => handleSaveExisting(list.id)} disabled={saving} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all text-left">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: list.color || LIST_COLORS[0] }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{list.name}</p>
                    <p className="text-xs text-gray-400">{list.leadCount ?? 0} leads</p>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-gray-300" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const LEAD_STATUSES = ["new_enquiry", "enquiry_qualified", "discovery_call", "quote_sent", "follow_up", "project_won", "project_lost"] as const;
const LEAD_STATUS_DISPLAY: Record<string, string> = {
  new_enquiry: "New Enquiry", enquiry_qualified: "Enquiry Qualified",
  discovery_call: "Discovery Call", quote_sent: "Quote / Estimation Sent",
  follow_up: "Follow Up / Negotiation", project_won: "Project Won", project_lost: "Project Lost",
};

type DrawerTab = "overview" | "audit" | "touchpoints" | "meetings" | "proposals";

function LeadDrawer({ leadId, onClose }: { leadId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DrawerTab>("overview");
  const [enrichingKeywords, setEnrichingKeywords] = useState<Set<number>>(new Set());
  const { data: lead, isLoading } = useGetLead<LeadDetail>(leadId);
  const updateLead = useUpdateLead({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey() }); } },
  });
  const API_BASE = "/api";

  const tabs: { id: DrawerTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "audit", label: "Audit" },
    { id: "touchpoints", label: `Touchpoints${lead ? ` (${lead.touchpoints?.length ?? 0})` : ""}` },
    { id: "meetings", label: `Meetings${lead ? ` (${lead.meetings?.length ?? 0})` : ""}` },
    { id: "proposals", label: `Proposals${lead ? ` (${lead.proposals?.length ?? 0})` : ""}` },
  ];

  const handleRunAudit = () => {
    if (!lead) return;
    fetch(`${API_BASE}/audit/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId: lead.id,
        companyName: lead.company,
        websiteUrl: lead.website ?? undefined,
        linkedInUrl: lead.linkedInUrl ?? undefined,
      }),
    })
      .then(() => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey() }); setActiveTab("audit"); })
      .catch(() => null);
  };

  const handleGenerateEmail = () => {
    if (!lead) return;
    fetch(`${API_BASE}/outreach/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, sequenceDay: lead.sequenceDay ?? 1, channel: "email" }),
    }).catch(() => null);
  };

  const handleBookMeeting = () => {
    if (!lead) return;
    fetch(`${API_BASE}/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, scheduledAt: new Date(Date.now() + 86400000 * 3).toISOString(), duration: 30, type: "discovery", status: "scheduled", painPoints: [], nextAction: "Follow up after meeting" }),
    }).then(() => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey() }); setActiveTab("meetings"); })
    .catch(() => null);
  };

  const handleCreateProposal = () => {
    if (!lead) return;
    fetch(`${API_BASE}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, title: "Proposal", services: [], investment: 0, status: "draft", followups: [] }),
    }).then(() => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey() }); setActiveTab("proposals"); })
    .catch(() => null);
  };

  const initials = lead
    ? `${lead.firstName?.[0] ?? ""}${lead.lastName?.[0] ?? ""}`.toUpperCase()
    : "?";

  const bantBreakdownEntries = lead?.bantBreakdown
    ? Object.entries(lead.bantBreakdown as Record<string, unknown>).filter(
        ([, v]) => typeof v === "number"
      ) as [string, number][]
    : [];

  // ── Dark theme tokens ──────────────────────────────────────────────────────
  const D = {
    panel:      "#0D1B12",
    header:     "#0A1610",
    card:       "#132218",
    cardBorder: "#1E3A27",
    divider:    "#1A2E20",
    textPrimary:"#E8F5EF",
    textMuted:  "#5E8A6E",
    textDim:    "#3A5C46",
    accent:     "#34D399",
    accentDim:  "#1B4D36",
    accentText: "#6EE7B7",
  } as const;

  const statusColor = (s: string) => {
    if (s === "new_enquiry")       return { bg: "#0D1A33", text: "#60A5FA", dot: "#60A5FA" };
    if (s === "enquiry_qualified") return { bg: "#1A0D33", text: "#C084FC", dot: "#A855F7" };
    if (s === "discovery_call")    return { bg: "#051A18", text: "#2DD4BF", dot: "#0D9488" };
    if (s === "quote_sent")        return { bg: "#2D1F06", text: "#FCD34D", dot: "#F59E0B" };
    if (s === "follow_up")         return { bg: "#2D1006", text: "#FCA572", dot: "#F97316" };
    if (s === "project_won")       return { bg: "#0D3320", text: "#34D399", dot: "#16A34A" };
    if (s === "project_lost")      return { bg: "#2D0A0A", text: "#F87171", dot: "#EF4444" };
    return { bg: "#1A2820", text: D.textMuted, dot: D.textDim };
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(2px)" }} onClick={onClose} />

      {/* ── Dark drawer panel ── */}
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{ width: "min(490px, 100vw)", background: D.panel, borderLeft: `1px solid ${D.cardBorder}`, boxShadow: "-8px 0 48px rgba(0,0,0,0.6)" }}
      >

        {/* ══ HERO HEADER ══════════════════════════════════════════════════════ */}
        <div className="flex-shrink-0 relative overflow-hidden px-5 pt-5 pb-4"
          style={{ background: D.header, borderBottom: `1px solid ${D.divider}` }}>
          {/* Glow blob behind avatar */}
          <div className="absolute top-0 left-0 w-48 h-48 rounded-full opacity-10 pointer-events-none"
            style={{ background: D.accent, filter: "blur(60px)", transform: "translate(-30%, -30%)" }} />

          <div className="relative flex items-start gap-3.5">
            {/* Avatar with ring */}
            <div className="relative flex-shrink-0">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-base font-black"
                style={{
                  background: `linear-gradient(135deg, #1A4D33 0%, #0D2B1C 100%)`,
                  boxShadow: `0 0 0 1px ${D.cardBorder}, 0 0 20px rgba(52,211,153,0.15)`,
                  color: D.accent,
                  letterSpacing: "-0.03em",
                }}
              >
                {initials}
              </div>
              {/* Online dot */}
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                style={{ background: D.accent, borderColor: D.header }} />
            </div>

            <div className="flex-1 min-w-0 pt-0.5">
              <div className="text-base font-bold truncate" style={{ color: D.textPrimary }}>
                {lead ? `${lead.firstName} ${lead.lastName}` : "Lead Detail"}
              </div>
              {lead && (
                <div className="text-[11px] truncate mt-0.5" style={{ color: D.textMuted }}>
                  {[lead.designation, lead.company].filter(Boolean).join(" · ")}
                </div>
              )}
              {lead?.status && (() => {
                const sc = statusColor(lead.status);
                return (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: sc.text }}>
                      {LEAD_STATUS_DISPLAY[lead.status] ?? lead.status.replace(/_/g, " ")}
                    </span>
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Link
                href={`/leads/${leadId}`}
                onClick={onClose}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                style={{ background: D.accentDim, color: D.accentText, border: `1px solid ${D.cardBorder}` }}
              >
                <ExternalLink className="w-3 h-3" /> Profile
              </Link>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                style={{ color: D.textMuted, border: `1px solid ${D.divider}` }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ── Action buttons ── */}
          {lead && (
            <div className="grid grid-cols-4 gap-2 mt-4">
              {[
                { label: "Audit",    icon: "🔍", onClick: handleRunAudit,     glow: D.accent },
                { label: "Email",    icon: "✉️", onClick: handleGenerateEmail, glow: "#60A5FA" },
                { label: "Meeting",  icon: "📅", onClick: handleBookMeeting,   glow: "#FBBF24" },
                { label: "Proposal", icon: "📄", onClick: handleCreateProposal,glow: "#A78BFA" },
              ].map(({ label, icon, onClick, glow }) => (
                <button
                  key={label}
                  onClick={onClick}
                  className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
                  style={{ background: D.card, border: `1px solid ${D.cardBorder}`, color: D.textMuted }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = glow; (e.currentTarget as HTMLButtonElement).style.borderColor = glow + "44"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = D.textMuted; (e.currentTarget as HTMLButtonElement).style.borderColor = D.cardBorder; }}
                >
                  <span className="text-lg leading-none">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ══ TABS ═════════════════════════════════════════════════════════════ */}
        <div className="flex flex-shrink-0 px-2 gap-0.5" style={{ background: D.header, borderBottom: `1px solid ${D.divider}` }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-2.5 text-[11px] font-semibold transition-all whitespace-nowrap relative"
              style={{
                color: activeTab === tab.id ? D.accent : D.textMuted,
                borderBottom: activeTab === tab.id ? `2px solid ${D.accent}` : "2px solid transparent",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══ SCROLLABLE BODY ══════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-y-auto" style={{ background: D.panel, scrollbarWidth: "thin", scrollbarColor: `${D.divider} transparent` }}>
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[75, 55, 90, 60].map((w, i) => (
                <div key={i} className="h-3 rounded-full animate-pulse" style={{ width: `${w}%`, background: D.card }} />
              ))}
            </div>
          ) : !lead ? (
            <div className="p-5 text-center pt-16 text-sm" style={{ color: D.textMuted }}>Lead not found.</div>

          ) : activeTab === "overview" ? (
            <div className="p-4 space-y-3">

              {/* ── Pipeline Status ── */}
              <DarkCard title="Pipeline Status" d={D}>
                <select
                  value={lead.status}
                  onChange={(e) => updateLead.mutate({ id: leadId, data: { status: e.target.value } })}
                  className="w-full px-3 py-2 text-xs rounded-lg font-semibold focus:outline-none transition-all"
                  style={{ background: D.accentDim, color: D.accentText, border: `1px solid ${D.cardBorder}` }}
                >
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s} style={{ background: D.card, color: D.textPrimary }}>
                      {LEAD_STATUS_DISPLAY[s] ?? s}
                    </option>
                  ))}
                </select>
              </DarkCard>

              {/* ── BANT Score ── */}
              <DarkCard title="BANT Score" d={D}>
                {lead.bantScore != null ? (
                  <>
                    <div className="flex items-end gap-3 mb-4">
                      <div
                        className="text-5xl font-black leading-none"
                        style={{ color: bandHexFromKey(scoreToBandKey(lead.bantScore), D.accent) }}
                      >
                        {lead.bantScore}
                      </div>
                      <div className="pb-1">
                        <div className="text-xs font-bold" style={{ color: bandHexFromKey(scoreToBandKey(lead.bantScore), D.accent) }}>
                          {bandLabelFromKey(scoreToBandKey(lead.bantScore))}
                        </div>
                        <div className="text-[10px]" style={{ color: D.textDim }}>out of 100</div>
                      </div>
                    </div>
                    {/* Progress bar with glow */}
                    <div className="relative h-1.5 rounded-full mb-4 overflow-hidden" style={{ background: D.cardBorder }}>
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${lead.bantScore}%`,
                          background: bandGradientFromKey(scoreToBandKey(lead.bantScore), D.accent),
                          boxShadow: `0 0 8px ${bandHexFromKey(scoreToBandKey(lead.bantScore), D.accent)}66`,
                          transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
                        }}
                      />
                    </div>
                    {bantBreakdownEntries.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {bantBreakdownEntries.map(([k, v]) => (
                          <div key={k} className="rounded-xl px-3 py-2.5" style={{ background: D.accentDim, border: `1px solid ${D.cardBorder}` }}>
                            <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: D.textDim }}>
                              {k}
                            </div>
                            <div className="flex items-baseline gap-0.5">
                              <span className="text-xl font-black" style={{ color: D.accent }}>{v}</span>
                              <span className="text-[10px]" style={{ color: D.textDim }}>/25</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs py-2" style={{ color: D.textDim }}>Not scored yet — qualify this lead to generate BANT scores.</div>
                )}
              </DarkCard>

              {/* ── Contact ── */}
              <DarkCard title="Contact" d={D}>
                <div className="space-y-2.5">
                  {lead.email    && <DarkInfoRow icon="✉️" label="Email"    value={lead.email}    href={`mailto:${lead.email}`}    d={D} />}
                  {lead.phone    && <DarkInfoRow icon="📞" label="Phone"    value={lead.phone}    href={`tel:${lead.phone}`}       d={D} />}
                  {lead.website  && <DarkInfoRow icon="🌐" label="Website"  value={lead.website}  href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} d={D} />}
                  {lead.linkedInUrl && <DarkInfoRow icon="🔗" label="LinkedIn" value="View Profile" href={lead.linkedInUrl} d={D} />}
                </div>
              </DarkCard>

              {/* ── Company ── */}
              <DarkCard title="Company" d={D}>
                <div className="space-y-2.5">
                  {lead.company     && <DarkInfoRow icon="🏢" label="Company"  value={lead.company}     d={D} />}
                  {lead.designation && <DarkInfoRow icon="👤" label="Title"    value={lead.designation} d={D} />}
                  {lead.industry    && <DarkInfoRow icon="🏭" label="Industry" value={lead.industry}    d={D} />}
                  {lead.country     && <DarkInfoRow icon="🌍" label="Location" value={`${lead.city ? lead.city + ", " : ""}${lead.country}`} d={D} />}
                  {lead.companySize && <DarkInfoRow icon="👥" label="Size"     value={lead.companySize} d={D} />}
                </div>
              </DarkCard>

              {/* ── Details & Tags ── */}
              <DarkCard title="Details" d={D}>
                <div className="space-y-2.5">
                  {lead.source && <DarkInfoRow icon="📡" label="Source"       value={lead.source}                   d={D} />}
                  <DarkInfoRow   icon="🗓️" label="Added"        value={formatDate(lead.createdAt)}         d={D} />
                  {lead.lastContactedAt && <DarkInfoRow icon="📬" label="Contacted" value={formatDate(lead.lastContactedAt)} d={D} />}
                </div>
                {lead.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3 pt-3" style={{ borderTop: `1px solid ${D.divider}` }}>
                    {lead.tags.map((t: string) => (
                      <span key={t} className="text-[10px] px-2.5 py-1 rounded-full font-semibold"
                        style={{ background: D.accentDim, color: D.accentText, border: `1px solid ${D.cardBorder}` }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </DarkCard>

              {/* ── AI Keywords ── */}
              <DarkCard title="AI Keywords" d={D}>
                <div className="space-y-3">
                  {/* Intent */}
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: D.textMuted }}>Intent (what they want)</div>
                    <div className="flex flex-wrap gap-1">
                      {((lead as unknown as { intentKeywords?: string[] }).intentKeywords)?.length
                        ? ((lead as unknown as { intentKeywords: string[] }).intentKeywords).map((k: string) => (
                            <span key={k} className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "#1E1A2E", color: "#C4B5FD", border: "1px solid #3D2D6E" }}>{k}</span>
                          ))
                        : <span className="text-[11px]" style={{ color: D.textDim }}>None yet</span>
                      }
                    </div>
                  </div>
                  {/* Behavior */}
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: D.textMuted }}>Behavior (how they buy)</div>
                    <div className="flex flex-wrap gap-1">
                      {((lead as unknown as { behaviorKeywords?: string[] }).behaviorKeywords)?.length
                        ? ((lead as unknown as { behaviorKeywords: string[] }).behaviorKeywords).map((k: string) => (
                            <span key={k} className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "#1A2A1E", color: "#6EE7B7", border: "1px solid #1F4731" }}>{k}</span>
                          ))
                        : <span className="text-[11px]" style={{ color: D.textDim }}>None yet</span>
                      }
                    </div>
                  </div>
                  {/* Interest */}
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: D.textMuted }}>Interests (topics)</div>
                    <div className="flex flex-wrap gap-1">
                      {((lead as unknown as { interestKeywords?: string[] }).interestKeywords)?.length
                        ? ((lead as unknown as { interestKeywords: string[] }).interestKeywords).map((k: string) => (
                            <span key={k} className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "#1A2330", color: "#60A5FA", border: "1px solid #1E3A5E" }}>{k}</span>
                          ))
                        : <span className="text-[11px]" style={{ color: D.textDim }}>None yet</span>
                      }
                    </div>
                  </div>
                </div>
                {/* Enrich button */}
                <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${D.divider}` }}>
                  <button
                    disabled={enrichingKeywords.has(lead.id)}
                    onClick={async () => {
                      setEnrichingKeywords((prev) => new Set(prev).add(lead.id));
                      try {
                        const base = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
                        await fetch(`${base}/leads/${lead.id}/enrich-keywords`, { method: "POST" });
                        qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
                        toast({ title: "Keywords enriched!", variant: "default" });
                      } catch {
                        toast({ title: "Enrichment failed", variant: "destructive" });
                      } finally {
                        setEnrichingKeywords((prev) => { const s = new Set(prev); s.delete(lead.id); return s; });
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: D.accentDim, color: D.accentText, border: `1px solid ${D.cardBorder}` }}
                  >
                    {enrichingKeywords.has(lead.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {enrichingKeywords.has(lead.id) ? "Enriching…" : "Enrich with AI"}
                  </button>
                </div>
              </DarkCard>

              {lead.notes && (
                <DarkCard title="Notes" d={D}>
                  <p className="text-xs leading-relaxed" style={{ color: D.textPrimary }}>{lead.notes}</p>
                </DarkCard>
              )}
            </div>

          ) : activeTab === "audit" ? (
            <div className="p-4 space-y-3">
              {lead.auditData ? (
                <DarkCard title="Audit Data" d={D}>
                  <pre className="text-[11px] whitespace-pre-wrap break-all" style={{ color: D.accentText }}>{JSON.stringify(lead.auditData, null, 2)}</pre>
                </DarkCard>
              ) : (
                <DarkEmptyState icon="🔍" title="No audit run yet" desc="Analyse this lead's brand presence" d={D}
                  action={<button onClick={handleRunAudit} className="px-5 py-2 rounded-xl text-xs font-bold transition-all hover:scale-105"
                    style={{ background: D.accentDim, color: D.accentText, border: `1px solid ${D.cardBorder}` }}>Run Brand Audit</button>} />
              )}
            </div>

          ) : activeTab === "touchpoints" ? (
            <div className="p-4 space-y-2">
              {lead.touchpoints?.length === 0 ? (
                <DarkEmptyState icon="✉️" title="No outreach yet" desc="Generate a personalised first email" d={D}
                  action={<button onClick={handleGenerateEmail} className="px-5 py-2 rounded-xl text-xs font-bold transition-all hover:scale-105"
                    style={{ background: "#0D1A33", color: "#60A5FA", border: "1px solid #1E3A6E" }}>Generate Email</button>} />
              ) : (lead.touchpoints ?? []).map((tp) => (
                <DarkCard key={tp.id} d={D}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold" style={{ color: D.textPrimary }}>Day {tp.day} · {tp.channel}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: tp.status === "replied" ? "#0D3320" : "#0D1A2D", color: tp.status === "replied" ? D.accent : "#60A5FA" }}>
                      {tp.status}
                    </span>
                  </div>
                  {tp.subject && <div className="text-[11px] mb-1" style={{ color: D.textMuted }}>Subject: {tp.subject}</div>}
                  {tp.body && <p className="text-[11px] line-clamp-2 leading-relaxed" style={{ color: D.textDim }}>{tp.body}</p>}
                  {tp.sentAt && <div className="text-[10px] mt-1.5" style={{ color: D.textDim }}>{formatDate(tp.sentAt)}</div>}
                </DarkCard>
              ))}
            </div>

          ) : activeTab === "meetings" ? (
            <div className="p-4 space-y-2">
              {lead.meetings?.length === 0 ? (
                <DarkEmptyState icon="📅" title="No meetings yet" desc="Book a discovery call to move forward" d={D}
                  action={<button onClick={handleBookMeeting} className="px-5 py-2 rounded-xl text-xs font-bold transition-all hover:scale-105"
                    style={{ background: "#2D1B06", color: "#FCD34D", border: "1px solid #4A2E10" }}>Book Discovery Call</button>} />
              ) : (lead.meetings ?? []).map((m) => (
                <DarkCard key={m.id} d={D}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold capitalize" style={{ color: D.textPrimary }}>{m.type}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: m.status === "completed" ? "#0D3320" : "#2D1B06", color: m.status === "completed" ? D.accent : "#FBBF24" }}>
                      {m.status}
                    </span>
                  </div>
                  <div className="text-[11px]" style={{ color: D.textMuted }}>{formatDate(m.scheduledAt)} · {m.duration} min</div>
                  {m.notes && <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: D.textDim }}>{m.notes}</p>}
                  {m.nextAction && <div className="text-[11px] font-semibold mt-1.5" style={{ color: "#FBBF24" }}>→ {m.nextAction}</div>}
                </DarkCard>
              ))}
            </div>

          ) : (
            <div className="p-4 space-y-2">
              {lead.proposals?.length === 0 ? (
                <DarkEmptyState icon="📄" title="No proposals yet" desc="Create a tailored proposal for this lead" d={D}
                  action={<button onClick={handleCreateProposal} className="px-5 py-2 rounded-xl text-xs font-bold transition-all hover:scale-105"
                    style={{ background: "#1E0D3A", color: "#C4B5FD", border: "1px solid #3D1F6E" }}>Create Proposal</button>} />
              ) : (lead.proposals ?? []).map((p) => (
                <DarkCard key={p.id} d={D}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold capitalize" style={{ color: D.textPrimary }}>{p.status}</span>
                    <span className="text-xs font-black" style={{ color: "#A78BFA" }}>
                      {p.investment ? `AED ${Number(p.investment).toLocaleString()}` : "—"}
                    </span>
                  </div>
                  <div className="text-[11px]" style={{ color: D.textDim }}>{formatDate(p.createdAt)}</div>
                </DarkCard>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Dark theme sub-components ────────────────────────────────────────────────

type DarkTokens = {
  panel: string; header: string; card: string; cardBorder: string; divider: string;
  textPrimary: string; textMuted: string; textDim: string;
  accent: string; accentDim: string; accentText: string;
};

function DarkCard({ title, children, d }: { title?: string; children: React.ReactNode; d: DarkTokens }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: d.card, border: `1px solid ${d.cardBorder}` }}>
      {title && (
        <div className="text-[9px] font-black uppercase tracking-[0.15em] mb-3" style={{ color: d.textDim }}>{title}</div>
      )}
      {children}
    </div>
  );
}

function DarkInfoRow({ icon, label, value, href, d }: { icon: string; label: string; value: string; href?: string; d: DarkTokens }) {
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <span className="text-sm w-5 text-center flex-shrink-0 opacity-80">{icon}</span>
      <span className="text-[10px] w-16 flex-shrink-0 font-medium uppercase tracking-wide" style={{ color: d.textDim }}>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className="text-[11px] font-semibold hover:underline truncate flex-1"
          style={{ color: d.accentText }}>
          {value}
        </a>
      ) : (
        <span className="text-[11px] font-semibold truncate flex-1" style={{ color: d.textPrimary }}>{value}</span>
      )}
    </div>
  );
}

function DarkEmptyState({ icon, title, desc, action, d }: { icon: string; title: string; desc: string; action: React.ReactNode; d: DarkTokens }) {
  return (
    <div className="flex flex-col items-center text-center pt-12 pb-8 px-6">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4"
        style={{ background: d.accentDim, border: `1px solid ${d.cardBorder}` }}>
        {icon}
      </div>
      <div className="text-sm font-bold mb-1" style={{ color: d.textPrimary }}>{title}</div>
      <div className="text-xs mb-5" style={{ color: d.textDim }}>{desc}</div>
      {action}
    </div>
  );
}


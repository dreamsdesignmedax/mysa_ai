import { useState, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx-js-style";
import { Link, useLocation } from "wouter";
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
  useListIcps,
  useListTeamMembers,
  useLeadAssigneeCounts,
} from "@workspace/api-client-react";
import { useAuthUser } from "@/contexts/AuthContext";
import type { ImportResult, OutreachSequence, LeadDetail, Lead } from "@workspace/api-client-react";
import { getListLeadsQueryKey, getLeadAssigneeCountsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { StatusBadge, Tag } from "@/components/Badge";
import { bandColorFromKey, bandLabelFromKey, formatDate, bantSubScoreColor, scoreToBandKey, bandHexFromKey, bantBandDarkColor, bantBandDarkGradient, statusLabel, statusColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Plus, Search, Trash2, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, X, Download, ExternalLink, Building2, Globe, ArrowUpDown, ArrowUp, ArrowDown, Zap, Loader2, BarChart2, MessageCircle, Sparkles, Layers, ListPlus, Brain, ShieldAlert, RotateCcw, Users,
  Phone, Mail, ChevronDown, MoreVertical, SlidersHorizontal,
} from "lucide-react";
import FetchLeads from "./FetchLeads";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";

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

const CSV_COLUMNS = ["firstName", "lastName", "email", "company", "designation", "industry", "country", "phone", "whatsapp", "website", "city", "companySize", "linkedInUrl", "notes"] as const;
type CsvColumn = typeof CSV_COLUMNS[number];

const CSV_COLUMN_LABELS: Record<CsvColumn, string> = {
  firstName: "First Name *",
  lastName: "Last Name *",
  email: "Email *",
  company: "Company *",
  designation: "Designation / Title",
  industry: "Industry",
  country: "Country",
  phone: "Phone",
  whatsapp: "WhatsApp",
  website: "Website",
  city: "City",
  companySize: "Company Size",
  linkedInUrl: "LinkedIn URL",
  notes: "Notes",
};

const STATUSES = ["all", "new_enquiry", "enquiry_qualified", "discovery_call", "quote_sent", "follow_up", "project_won", "project_lost"];
const STATUS_DISPLAY: Record<string, string> = {
  all: "All", new_enquiry: "New Enquiry", enquiry_qualified: "Enquiry Qualified",
  discovery_call: "Discovery Call", quote_sent: "Quote / Estimation Sent",
  follow_up: "Follow Up / Negotiation", project_won: "Project Won", project_lost: "Project Lost",
};
const STATUS_DOT: Record<string, string> = {
  all: "#9CA3AF", new_enquiry: "#3B82F6", enquiry_qualified: "#8B5CF6",
  discovery_call: "#0D9488", quote_sent: "#F59E0B", follow_up: "#F97316",
  project_won: "#16A34A", project_lost: "#EF4444",
};

const MOBILE_AVATAR_COLORS = [
  "#6C63FF", "#3B82F6", "#0D9488", "#7C3AED",
  "#DC2626", "#0891B2", "#D97706", "#BE185D",
];

export default function Leads() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const currentUser = useAuthUser();
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
  const [filterIcp, setFilterIcp] = useState<string>("");
  const [filterAssignedTo, setFilterAssignedTo] = useState<string>(() => sessionStorage.getItem("leadsFilterAssignedTo") ?? "");
  const [enrichingBulk, setEnrichingBulk] = useState(false);
  const [sortCol, setSortCol] = useState<"bantScore" | "createdAt" | "company" | "sequenceDay" | "lastContactedAt" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [bantPopoverLeadId, setBantPopoverLeadId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [generatingReports, setGeneratingReports] = useState(false);
  const [reportsMsg, setReportsMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [viewTab, setViewTab] = useState<"leads" | "lists" | "unqualified">("leads");
  const [unqualifiedLeads, setUnqualifiedLeads] = useState<Lead[]>([]);
  const [unqualifiedTotal, setUnqualifiedTotal] = useState(0);
  const [unqualifiedLoading, setUnqualifiedLoading] = useState(false);
  const [showListModal, setShowListModal] = useState(false);
  const [importTab, setImportTab] = useState<"paste" | "csv" | "manual" | "vibe">("paste");
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
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
  const [showExportModal, setShowExportModal] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  // Debounce search — fires API only after 350ms of inactivity
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const resolvedAssignedToId = filterAssignedTo === "me" ? (currentUser?.id ? String(currentUser.id) : undefined) : (filterAssignedTo || undefined);

  const params = {
    search: debouncedSearch || undefined,
    status: status !== "all" ? status : undefined,
    assignedToId: resolvedAssignedToId,
    page: 1,
    limit: 2000,
  };

  const navParams = {
    search: debouncedSearch || undefined,
    status: status !== "all" ? status : undefined,
    assignedToId: resolvedAssignedToId,
    page: 1,
    limit: 2000,
  };

  const { data, isLoading, isFetching } = useListLeads(params, {
    query: { queryKey: getListLeadsQueryKey(params) },
  });

  const { data: navData } = useListLeads(navParams, {
    query: { queryKey: getListLeadsQueryKey(navParams) },
  });

  const { data: seqData } = useListSequences();
  const { data: icpsData } = useListIcps();
  const { data: teamMembers } = useListTeamMembers();
  const { data: assigneeCounts } = useLeadAssigneeCounts();

  const createLead = useCreateLead({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey() }); qc.invalidateQueries({ queryKey: getLeadAssigneeCountsQueryKey() }); setShowAdd(false); } },
  });
  const deleteLead = useDeleteLead({
    mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey() }); qc.invalidateQueries({ queryKey: getLeadAssigneeCountsQueryKey() }); } },
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

  const autoMapHeaders = (headers: string[]) => {
    const autoMap: Record<string, CsvColumn | ""> = {};
    headers.forEach((h) => {
      const lower = h.toLowerCase().replace(/[\s_-]/g, "");
      if (lower.includes("firstname") || lower === "fname" || lower === "first") autoMap[h] = "firstName";
      else if (lower.includes("lastname") || lower === "lname" || lower === "last") autoMap[h] = "lastName";
      else if (lower.includes("name") && !autoMap[h]) autoMap[h] = "firstName";
      else if (lower.includes("email") || lower === "emailaddress") autoMap[h] = "email";
      else if (lower.includes("company") || lower.includes("organisation") || lower.includes("organization") || lower.includes("employer")) autoMap[h] = "company";
      else if (lower.includes("title") || lower.includes("designation") || lower.includes("jobtitle") || lower.includes("position") || lower.includes("role")) autoMap[h] = "designation";
      else if (lower.includes("industry") || lower.includes("sector") || lower.includes("vertical")) autoMap[h] = "industry";
      else if (lower.includes("country")) autoMap[h] = "country";
      else if (lower.includes("phone") || lower.includes("mobile") || lower.includes("contact")) autoMap[h] = "phone";
      else if (lower.includes("whatsapp")) autoMap[h] = "whatsapp";
      else if (lower.includes("website") || lower.includes("url") || lower.includes("domain")) autoMap[h] = "website";
      else if (lower.includes("city") || lower.includes("location") || lower.includes("region")) autoMap[h] = "city";
      else if (lower.includes("companysize") || lower.includes("employees") || lower.includes("headcount") || lower.includes("size")) autoMap[h] = "companySize";
      else if (lower.includes("linkedin") || lower.includes("linkedinurl")) autoMap[h] = "linkedInUrl";
      else if (lower.includes("note") || lower.includes("comment") || lower.includes("remark")) autoMap[h] = "notes";
      else autoMap[h] = "";
    });
    return autoMap;
  };

  const parseFileIntoRows = (headers: string[], rawRows: Record<string, string>[]) => {
    setCsvHeaders(headers);
    setCsvRows(rawRows);
    setCsvMapping(autoMapHeaders(headers));
  };

  const parseCsvFile = (file: File) => {
    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
        if (jsonRows.length === 0) return;
        const headers = Object.keys(jsonRows[0]);
        const rows = jsonRows.map((r) => Object.fromEntries(headers.map((h) => [h, String(r[h] ?? "")])));
        parseFileIntoRows(headers, rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) return;
        const parseCSVLine = (line: string) => {
          const result: string[] = [];
          let cur = "", inQ = false;
          for (let i = 0; i < line.length; i++) {
            if (line[i] === '"') { inQ = !inQ; }
            else if (line[i] === "," && !inQ) { result.push(cur.trim()); cur = ""; }
            else { cur += line[i]; }
          }
          result.push(cur.trim());
          return result;
        };
        const headers = parseCSVLine(lines[0]);
        const rows = lines.slice(1).map((line) => {
          const vals = parseCSVLine(line);
          return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
        });
        parseFileIntoRows(headers, rows);
      };
      reader.readAsText(file);
    }
  };

  const CHUNK_SIZE = 300;
  const handleCsvImport = async () => {
    if (csvRows.length === 0) return;
    setImporting(true);
    setImportProgress(null);

    const allRows = csvRows.map((row) => {
      const mapped: Record<string, string> = {};
      Object.entries(csvMapping).forEach(([header, field]) => {
        if (field) mapped[field] = row[header] ?? "";
      });
      return mapped;
    });

    const chunks: typeof allRows[] = [];
    for (let i = 0; i < allRows.length; i += CHUNK_SIZE) chunks.push(allRows.slice(i, i + CHUNK_SIZE));

    let totalImported = 0;
    let totalSkipped = 0;
    const allErrors: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      setImportProgress({ current: i + 1, total: chunks.length });
      try {
        const res = await fetch("/api/leads/import/csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ rows: chunks[i] }),
        });
        if (!res.ok) { allErrors.push(`Chunk ${i + 1}: server error ${res.status}`); totalSkipped += chunks[i].length; continue; }
        const result = await res.json() as { imported: number; skipped: number; errors: string[] };
        totalImported += result.imported ?? 0;
        totalSkipped  += result.skipped  ?? 0;
        allErrors.push(...(result.errors ?? []));
      } catch (e) {
        allErrors.push(`Chunk ${i + 1}: ${String(e)}`);
        totalSkipped += chunks[i].length;
      }
    }

    qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
    setImportResult({ imported: totalImported, skipped: totalSkipped, errors: allErrors } as ImportResult);
    setCsvRows([]);
    setCsvHeaders([]);
    setImporting(false);
    setImportProgress(null);
  };

  const closeImport = () => {
    setShowImport(false);
    setPasteText("");
    setCsvRows([]);
    setCsvHeaders([]);
    setImportResult(null);
    setImporting(false);
    setImportProgress(null);
  };

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const hasMore = page < totalPages;
  const sequences: OutreachSequence[] = Array.isArray(seqData) ? seqData : [];

  // Persist assignedTo filter to sessionStorage
  useEffect(() => {
    if (filterAssignedTo) sessionStorage.setItem("leadsFilterAssignedTo", filterAssignedTo);
    else sessionStorage.removeItem("leadsFilterAssignedTo");
  }, [filterAssignedTo]);

  // Reset accumulated leads when server-side filters change
  useEffect(() => {
    setAllLeads([]);
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status, resolvedAssignedToId]);

  // Replace list whenever data arrives (single-page load, no accumulation needed)
  useEffect(() => {
    if (data?.leads == null) return;
    // De-duplicate by id as a safety net (in case of any caching artefact)
    const seen = new Set<number>();
    const deduped = data.leads.filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
    setAllLeads(deduped);
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
    if (filterIcp && String(l.icpId ?? "") !== filterIcp) return false;
    return true;
  })].sort((a, b) => {
    if (!sortCol) return 0;
    const aVal = a[sortCol] ?? (sortCol === "bantScore" || sortCol === "sequenceDay" ? 0 : "");
    const bVal = b[sortCol] ?? (sortCol === "bantScore" || sortCol === "sequenceDay" ? 0 : "");
    if (typeof aVal === "number" && typeof bVal === "number") return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    return sortDir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
  });

  const PAGE_SIZE = 25;
  const totalFilteredPages = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const pagedLeads = filteredLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const uniqueIndustries = [...new Set(allLeads.map((l) => l.industry).filter(Boolean))].sort();
  const uniqueCountries  = [...new Set(allLeads.map((l) => l.country).filter(Boolean))].sort();
  const uniqueSources    = [...new Set(allLeads.map((l) => l.source).filter(Boolean))].sort();

  function rowBgColor(s: string): string {
    switch (s) {
      case "new_enquiry":       return "#E8F1FF";
      case "enquiry_qualified": return "#F0ECFF";
      case "discovery_call":    return "#E0F5F2";
      case "quote_sent":        return "#FFF3D4";
      case "follow_up":         return "#FFE8D6";
      case "project_won":       return "#E4F0E8";
      case "project_lost":      return "#FEDFDF";
      default:                  return "#F2F2F2";
    }
  }

  useEffect(() => {
    const navLeads = navData?.leads ?? [];
    const navFiltered = navLeads.filter((l) => {
      if (filterIndustry && !(l.industry ?? "").toLowerCase().includes(filterIndustry.toLowerCase())) return false;
      if (filterCountry && !(l.country ?? "").toLowerCase().includes(filterCountry.toLowerCase())) return false;
      if (filterSource && !(l.source ?? "").toLowerCase().includes(filterSource.toLowerCase())) return false;
      if (filterIcp && String(l.icpId ?? "") !== filterIcp) return false;
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
  }, [navData, filterIndustry, filterCountry, filterSource, filterIcp, sortCol, sortDir]);

  // Reset to page 1 when any client-side filter/sort changes
  useEffect(() => {
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterIndustry, filterCountry, filterSource, filterIcp, sortCol, sortDir]);

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

  // Select only the current page (HubSpot-style: first select page, then offer "select all")
  const selectPage = () => {
    const pageIds = pagedLeads.map((l) => l.id);
    const allPageSelected = pageIds.every((id) => selected.includes(id));
    if (allPageSelected) {
      setSelected((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelected((prev) => [...new Set([...prev, ...pageIds])]);
    }
  };

  // Select ALL filtered leads across all pages
  const selectAll = () => {
    setSelected(filteredLeads.map((l) => l.id));
  };

  // Sync header checkbox indeterminate state
  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    const pageIds = pagedLeads.map((l) => l.id);
    const selectedOnPage = pageIds.filter((id) => selected.includes(id));
    if (selectedOnPage.length === 0) {
      headerCheckboxRef.current.checked = false;
      headerCheckboxRef.current.indeterminate = false;
    } else if (selectedOnPage.length === pageIds.length) {
      headerCheckboxRef.current.checked = true;
      headerCheckboxRef.current.indeterminate = false;
    } else {
      headerCheckboxRef.current.checked = false;
      headerCheckboxRef.current.indeterminate = true;
    }
  }, [selected, pagedLeads]);

  const EXPORT_HEADERS = [
    "ID", "First Name", "Last Name", "Email", "Phone", "WhatsApp",
    "LinkedIn URL", "Company", "Designation", "Industry", "City", "Country",
    "Website", "Company Size", "Annual Revenue", "Source", "Status",
    "BANT Score", "Keywords", "Notes", "Assigned To", "Created At",
  ];

  const buildExportRow = (l: Lead) => [
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
    (l as unknown as { assignedToName?: string }).assignedToName ?? "",
    l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
  ];

  const exportLeads = (format: "csv" | "xlsx", filename: string) => {
    const rows = filteredLeads.filter((l) => selected.length === 0 || selected.includes(l.id));

    if (format === "csv") {
      const csvLines = [
        EXPORT_HEADERS.map((h) => `"${h}"`).join(","),
        ...rows.map((l) => buildExportRow(l).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
      ];
      const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${filename}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const wsData = [EXPORT_HEADERS, ...rows.map(buildExportRow)];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Style header row — bold + green background
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
          ...rows.map((l) => String(buildExportRow(l)[i] ?? "").length),
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
      const base = "/api";
      const res = await fetch(`${base}/qualify/${leadId}/ai`, { method: "POST", credentials: "include" });
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

  const loadUnqualifiedLeads = async () => {
    setUnqualifiedLoading(true);
    try {
      const res = await fetch("/api/leads/not-qualified?limit=500", { credentials: "include" });
      if (res.ok) {
        const body = await res.json() as { data: Lead[]; total: number };
        setUnqualifiedLeads(body.data);
        setUnqualifiedTotal(body.total);
      }
    } catch { /* non-fatal */ }
    finally { setUnqualifiedLoading(false); }
  };

  const restoreUnqualifiedLead = async (id: number) => {
    await fetch(`/api/leads/${id}/mark-fake`, { method: "DELETE", credentials: "include" });
    setUnqualifiedLeads(prev => prev.filter(l => l.id !== id));
    setUnqualifiedTotal(prev => Math.max(0, prev - 1));
    toast({ title: "Lead restored", description: "Lead moved back to main list." });
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-white">
        {/* Title + action buttons */}
        <div className="px-5 pt-3 pb-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-500" />
            <span className="text-[13px] font-semibold text-gray-800">Contacts</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowFetch(true)} className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 transition-colors">
              <Zap className="w-3.5 h-3.5" /> Fetch Leads
            </button>
            <button onClick={() => setShowImport(true)} className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
              <Upload className="w-3.5 h-3.5" /> Import
            </button>
            <button onClick={() => setShowExportModal(true)} className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-md text-white bg-orange-500 hover:bg-orange-600 transition-colors shadow-sm">
              <Plus className="w-3.5 h-3.5" /> Add Contact
            </button>
          </div>
        </div>
        {/* Underline tabs */}
        <div className="px-5 pt-2 flex items-center gap-1">
          <button
            onClick={() => setViewTab("leads")}
            className={cn("flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap",
              viewTab === "leads" ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            All Contacts
            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", viewTab === "leads" ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-500")}>
              {filteredLeads.length.toLocaleString()}
            </span>
          </button>
          <button
            onClick={() => setViewTab("lists")}
            className={cn("flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap",
              viewTab === "lists" ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            )}
          >
            <ListPlus className="w-3.5 h-3.5" /> My Leads
          </button>
          <button
            onClick={() => { setViewTab("unqualified"); loadUnqualifiedLeads(); }}
            className={cn("flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap",
              viewTab === "unqualified" ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            )}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Unqualified
            {unqualifiedTotal > 0 && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 text-[10px] font-semibold">{unqualifiedTotal}</span>}
          </button>
        </div>
      </div>

      {/* ── Mobile filter bar (< md) ───────────────────────────── */}
      {viewTab === "leads" && (
        <div className="flex-shrink-0 md:hidden bg-white px-3 pt-2.5 pb-2 border-b border-gray-100 space-y-2.5">
          {/* Search pill */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              {isFetching && search ? (
                <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-500 animate-spin" />
              ) : (
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              )}
              <input
                type="text"
                placeholder="Search by name, company, email, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-[13px] rounded-full border border-gray-200 bg-gray-50 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400/30"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              )}
            </div>
            <button className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full border border-gray-200 bg-gray-50">
              <SlidersHorizontal className="w-4 h-4 text-gray-600" />
            </button>
          </div>

          {/* Filter chips — horizontally scrollable */}
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <button
              onClick={() => { setStatus("all"); setFilterIndustry(""); setFilterCountry(""); setFilterSource(""); setFilterIcp(""); }}
              className={cn(
                "flex-shrink-0 flex items-center gap-1 px-3 py-1.5 text-[12px] rounded-full border font-medium whitespace-nowrap",
                status === "all" && !filterIndustry && !filterCountry && !filterSource
                  ? "bg-violet-600 border-violet-600 text-white"
                  : "bg-white border-gray-200 text-gray-700"
              )}
            >
              All Leads <ChevronDown className="w-3 h-3" />
            </button>

            <div className="relative flex-shrink-0">
              <select
                value={filterIndustry}
                onChange={(e) => setFilterIndustry(e.target.value)}
                className={cn(
                  "appearance-none pl-3 pr-7 py-1.5 text-[12px] rounded-full border font-medium cursor-pointer focus:outline-none",
                  filterIndustry ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-gray-200 text-gray-700"
                )}
              >
                <option value="">Industry</option>
                {uniqueIndustries.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
              </select>
              <ChevronDown className={cn("absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none", filterIndustry ? "text-white" : "text-gray-500")} />
            </div>

            <div className="relative flex-shrink-0">
              <select
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value)}
                className={cn(
                  "appearance-none pl-3 pr-7 py-1.5 text-[12px] rounded-full border font-medium cursor-pointer focus:outline-none",
                  filterCountry ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-gray-200 text-gray-700"
                )}
              >
                <option value="">Country</option>
                {uniqueCountries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown className={cn("absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none", filterCountry ? "text-white" : "text-gray-500")} />
            </div>

            <div className="relative flex-shrink-0">
              <select
                value={status === "all" ? "" : status}
                onChange={(e) => { setStatus(e.target.value || "all"); setPage(1); }}
                className={cn(
                  "appearance-none pl-3 pr-7 py-1.5 text-[12px] rounded-full border font-medium cursor-pointer focus:outline-none",
                  status !== "all" ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-gray-200 text-gray-700"
                )}
              >
                <option value="">Stage</option>
                {STATUSES.filter((s) => s !== "all").map((s) => <option key={s} value={s}>{STATUS_DISPLAY[s]}</option>)}
              </select>
              <ChevronDown className={cn("absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none", status !== "all" ? "text-white" : "text-gray-500")} />
            </div>

            <div className="relative flex-shrink-0">
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className={cn(
                  "appearance-none pl-3 pr-7 py-1.5 text-[12px] rounded-full border font-medium cursor-pointer focus:outline-none",
                  filterSource ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-gray-200 text-gray-700"
                )}
              >
                <option value="">Source</option>
                {uniqueSources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className={cn("absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none", filterSource ? "text-white" : "text-gray-500")} />
            </div>
          </div>

          {/* Count row */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-gray-900">{filteredLeads.length.toLocaleString()} Leads</span>
            {[filterIndustry, filterCountry, filterSource, filterIcp, filterAssignedTo, status !== "all" ? status : ""].filter(Boolean).length > 0 && (
              <button
                onClick={() => { setFilterIndustry(""); setFilterCountry(""); setFilterSource(""); setFilterIcp(""); setFilterAssignedTo(""); setStatus("all"); }}
                className="flex items-center gap-1.5 px-3 py-1 text-[11px] rounded-full bg-violet-600 text-white font-semibold"
              >
                <SlidersHorizontal className="w-3 h-3" />
                More Filters
                <span className="bg-white/25 text-white rounded-full px-1.5 py-px text-[10px] font-bold">
                  {[filterIndustry, filterCountry, filterSource, filterIcp, filterAssignedTo, status !== "all" ? status : ""].filter(Boolean).length}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Filters row (desktop only) ─────────────────────────── */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-white hidden md:block" style={{ display: viewTab === "leads" ? undefined : "none" }}>
        {/* Row 1: search + filter dropdowns */}
        <div className="px-5 py-2.5 flex items-center gap-2 border-b border-gray-100">
          {/* Search */}
          <div className="relative w-64">
            {isFetching && search ? (
              <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-500 animate-spin" />
            ) : (
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            )}
            <input
              type="text"
              placeholder="Search name, company, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-7 py-1.5 text-[12px] rounded-md border border-gray-300 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition-all"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {/* Filter pills */}
          <div className="flex items-center gap-1.5 flex-1 flex-wrap">
            <select value={filterIndustry} onChange={(e) => setFilterIndustry(e.target.value)} className={cn("py-1.5 pl-2.5 pr-6 text-[12px] rounded-md border cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-400 appearance-none bg-no-repeat", filterIndustry ? "border-violet-300 bg-violet-50 text-violet-700 font-medium" : "border-gray-300 bg-white text-gray-600")} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%239CA3AF'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'/%3E%3C/svg%3E\")", backgroundPosition: "right 4px center", backgroundSize: "16px" }}>
              <option value="">Industry ▾</option>
              {uniqueIndustries.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
            </select>
            <select value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)} className={cn("py-1.5 pl-2.5 pr-6 text-[12px] rounded-md border cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-400 appearance-none bg-no-repeat", filterCountry ? "border-violet-300 bg-violet-50 text-violet-700 font-medium" : "border-gray-300 bg-white text-gray-600")} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%239CA3AF'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'/%3E%3C/svg%3E\")", backgroundPosition: "right 4px center", backgroundSize: "16px" }}>
              <option value="">Location ▾</option>
              {uniqueCountries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className={cn("py-1.5 pl-2.5 pr-6 text-[12px] rounded-md border cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-400 appearance-none bg-no-repeat", filterSource ? "border-violet-300 bg-violet-50 text-violet-700 font-medium" : "border-gray-300 bg-white text-gray-600")} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%239CA3AF'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'/%3E%3C/svg%3E\")", backgroundPosition: "right 4px center", backgroundSize: "16px" }}>
              <option value="">Source ▾</option>
              {uniqueSources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {icpsData && icpsData.length > 0 && (
              <select value={filterIcp} onChange={(e) => setFilterIcp(e.target.value)} className={cn("py-1.5 pl-2.5 pr-6 text-[12px] rounded-md border cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-400 appearance-none bg-no-repeat", filterIcp ? "border-violet-300 bg-violet-50 text-violet-700 font-medium" : "border-gray-300 bg-white text-gray-600")} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%239CA3AF'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'/%3E%3C/svg%3E\")", backgroundPosition: "right 4px center", backgroundSize: "16px" }}>
                <option value="">ICP ▾</option>
                {icpsData.map((icp) => <option key={icp.id} value={String(icp.id)}>{icp.name}</option>)}
              </select>
            )}
            <select value={filterAssignedTo} onChange={(e) => setFilterAssignedTo(e.target.value)} className={cn("py-1.5 pl-2.5 pr-6 text-[12px] rounded-md border cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-400 appearance-none bg-no-repeat", filterAssignedTo ? "border-violet-300 bg-violet-50 text-violet-700 font-medium" : "border-gray-300 bg-white text-gray-600")} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%239CA3AF'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'/%3E%3C/svg%3E\")", backgroundPosition: "right 4px center", backgroundSize: "16px" }}>
              <option value="">Contact Owner ▾</option>
              <option value="me">Assigned to me</option>
              {(teamMembers ?? []).map((m) => {
                const name = `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.email;
                const c = assigneeCounts != null ? (assigneeCounts[m.id] ?? 0) : null;
                return <option key={m.id} value={String(m.id)}>{c != null ? `${name} (${c})` : name}</option>;
              })}
            </select>
            {(filterIndustry || filterCountry || filterSource || filterIcp || filterAssignedTo) && (
              <button onClick={() => { setFilterIndustry(""); setFilterCountry(""); setFilterSource(""); setFilterIcp(""); setFilterAssignedTo(""); }} className="flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 border border-orange-200 bg-orange-50 hover:bg-orange-100 rounded-md px-2.5 py-1.5 transition-colors font-medium">
                <X className="w-3 h-3" /> Clear filters
              </button>
            )}
          </div>
          {/* Right: advanced filters */}
          <button className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-violet-700 border border-gray-200 hover:border-violet-300 rounded-md px-3 py-1.5 transition-colors whitespace-nowrap ml-auto">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Advanced filters
            {(filterIndustry || filterCountry || filterSource || filterIcp || filterAssignedTo || status !== "all") && (
              <span className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-violet-600 text-white text-[9px] font-bold">
                {[filterIndustry, filterCountry, filterSource, filterIcp, filterAssignedTo, status !== "all" ? "1" : ""].filter(Boolean).length}
              </span>
            )}
          </button>
        </div>
        {/* Row 2: status tabs */}
        <div className="px-5 py-2 flex gap-1.5 items-center overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={cn("flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-full border whitespace-nowrap transition-all font-medium", s === status ? "border-violet-500 text-violet-700 bg-violet-50 shadow-sm" : "border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 bg-white")}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[s] ?? "#9CA3AF" }} />
              {STATUS_DISPLAY[s] ?? s}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk actions */}
      {/* ── Bulk actions bar ─────────────────────────────────────── */}
      {selected.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2 border-b border-violet-200 bg-violet-50 flex-wrap">
          <span className="text-[12px] text-violet-700 font-semibold">{selected.length} selected</span>
          <div className="w-px h-4 bg-violet-200" />
          <button onClick={() => bulkUpdate.mutate({ data: { ids: selected, status: "enquiry_qualified" } })} className="text-[11px] text-violet-700 hover:text-violet-900 font-medium border border-violet-200 bg-white hover:bg-violet-50 px-2.5 py-1 rounded-md transition-colors">Mark Qualified</button>
          <button onClick={() => bulkUpdate.mutate({ data: { ids: selected, status: "discovery_call" } })} className="text-[11px] text-violet-700 hover:text-violet-900 font-medium border border-violet-200 bg-white hover:bg-violet-50 px-2.5 py-1 rounded-md transition-colors">Book Discovery Call</button>
          <button onClick={() => bulkUpdate.mutate({ data: { ids: selected, status: "follow_up" } })} className="text-[11px] text-orange-600 hover:text-orange-700 font-medium border border-orange-200 bg-white hover:bg-orange-50 px-2.5 py-1 rounded-md transition-colors">Move to Follow Up</button>
          <button
            onClick={async () => {
              if (!confirm(`Delete ${selected.length} lead(s)? This cannot be undone.`)) return;
              const base = "/api";
              await Promise.all(selected.map((id) => fetch(`${base}/leads/${id}`, { method: "DELETE", credentials: "include" })));
              qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
              qc.invalidateQueries({ queryKey: getLeadAssigneeCountsQueryKey() });
              setSelected([]);
            }}
            className="text-[11px] text-red-600 hover:text-red-700 underline"
          >
            Delete
          </button>
          <button onClick={() => setShowExportModal(true)} className="flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-800 underline">
            <Download className="w-3 h-3" /> Export
          </button>
          <button disabled={enrichingBulk} onClick={async () => {
            if (!confirm(`Enrich AI keywords for ${selected.length} lead(s)?`)) return;
            setEnrichingBulk(true);
            try {
              const base = "/api";
              const r = await fetch(`${base}/leads/enrich-keywords-bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selected }) });
              const result = await r.json();
              qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
              toast({ title: `Keywords enriched for ${result.enriched ?? selected.length} lead(s)` });
              setSelected([]);
            } catch { toast({ title: "Enrichment failed", variant: "destructive" }); } finally { setEnrichingBulk(false); }
          }} className="flex items-center gap-1 text-[11px] text-teal-700 hover:text-teal-800 underline disabled:opacity-50">
            {enrichingBulk ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Enrich
          </button>
          {sequences.length > 0 && (
            <div className="relative">
              <button onClick={() => setShowAssignSeq((p) => !p)} className="text-[11px] text-purple-700 hover:text-purple-800 underline">Assign Seq ▾</button>
              {showAssignSeq && (
                <div className="absolute top-6 left-0 z-20 rounded border border-gray-200 bg-white shadow-xl w-48 overflow-hidden">
                  {sequences.map((seq: OutreachSequence) => (
                    <button key={seq.id} onClick={async () => {
                      const base = "/api";
                      await Promise.all(selected.map((leadId) => fetch(`${base}/leads/${leadId}/assign-sequence`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ sequenceId: seq.id }) })));
                      qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
                      setShowAssignSeq(false); setSelected([]);
                    }} className="w-full text-left px-3 py-2 text-xs text-gray-800 hover:bg-gray-50 border-b border-gray-100 last:border-0">{seq.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button disabled={generatingReports} onClick={async () => {
            if (!confirm(`Generate brand reports for ${selected.length} lead(s)?`)) return;
            setGeneratingReports(true); setReportsMsg(null);
            try {
              const base = "/api";
              const r = await fetch(`${base}/audit/bulk-run`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ leadIds: selected }) });
              const result = await r.json();
              setReportsMsg(r.ok ? `✓ ${result.completed} reports generated` : "✕ Failed");
            } catch { setReportsMsg("✕ Network error"); } finally { setGeneratingReports(false); }
          }} className="flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-800 underline disabled:opacity-50">
            {generatingReports ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart2 className="w-3 h-3" />}
            {generatingReports ? "Generating…" : "Brand Reports"}
          </button>
          {reportsMsg && <span className="text-[11px] text-emerald-700 font-medium">{reportsMsg}</span>}
          <button disabled={waInitiating} onClick={() => {
            if (!confirm(`Send WhatsApp hook to ${selected.length} lead(s)?`)) return;
            setWaInitiating(true); setWaMsg(null);
            initiateWaBulk.mutate({ data: { leadIds: selected } }, {
              onSuccess: (res) => { const s = res.succeeded ?? selected.length; const f = res.failed ?? 0; setWaMsg(f > 0 ? `✓ ${s} sent, ${f} failed` : `✓ ${s} sent`); setSelected([]); },
              onError: () => setWaMsg("✕ Failed"),
              onSettled: () => setWaInitiating(false),
            });
          }} className="flex items-center gap-1 text-[11px] text-green-700 hover:text-green-800 underline disabled:opacity-50">
            {waInitiating ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
            {waInitiating ? "Sending…" : "WA Hook"}
          </button>
          {waMsg && <span className="text-[11px] text-green-700 font-medium">{waMsg}</span>}
          <button onClick={() => setShowListModal(true)} className="flex items-center gap-1 text-[11px] text-indigo-700 hover:text-indigo-800 underline">
            <ListPlus className="w-3 h-3" /> Save to List
          </button>
          <button onClick={() => setSelected([])} className="text-[11px] text-gray-400 hover:text-gray-700 underline ml-auto">Clear</button>
        </div>
      )}

      {/* ── "Select all X leads" banner (HubSpot-style) ──────────────── */}
      {(() => {
        const pageIds = pagedLeads.map((l) => l.id);
        const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
        const allFilteredSelected = selected.length === filteredLeads.length && filteredLeads.length > 0;
        if (!allPageSelected) return null;
        return (
          <div className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[11px]" style={{ display: viewTab === "leads" ? undefined : "none" }}>
            {allFilteredSelected ? (
              <>
                <span className="text-blue-700 font-medium">All {filteredLeads.length.toLocaleString()} leads are selected.</span>
                <button onClick={() => setSelected([])} className="text-blue-700 underline hover:text-blue-900 font-medium">Clear selection</button>
              </>
            ) : (
              <>
                <span className="text-blue-700">All {pageIds.length} leads on this page are selected.</span>
                <button onClick={selectAll} className="text-blue-700 underline hover:text-blue-900 font-semibold">
                  Select all {filteredLeads.length.toLocaleString()} leads
                </button>
                <span className="text-blue-400">·</span>
                <button onClick={() => setSelected([])} className="text-blue-700 underline hover:text-blue-900 font-medium">Clear selection</button>
              </>
            )}
          </div>
        );
      })()}

      {/* ── SCROLLABLE CONTENT AREA (fills remaining height) ───────── */}
      <div className="flex-1 min-h-0 overflow-auto bg-white" style={{ scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 #f1f5f9", display: viewTab === "leads" ? undefined : "none" }}>

        {/* ── Mobile cards (< md) ─────────────────────────────────── */}
        <div className="flex flex-col md:hidden bg-white">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-3.5 flex gap-3 border-b border-gray-100 animate-pulse">
                <div className="w-11 h-11 rounded-full bg-gray-200 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="flex gap-1.5">
                    <div className="h-5 bg-gray-200 rounded-md w-20" />
                    <div className="h-5 bg-gray-200 rounded-md w-16" />
                  </div>
                </div>
              </div>
            ))
          ) : pagedLeads.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No leads match your filters</div>
          ) : pagedLeads.map((lead) => {
            const l = lead as any;
            const phoneNum = l.whatsapp || lead.phone || null;
            const waNum = (phoneNum ?? "").replace(/[^0-9]/g, "");
            const initials = `${lead.firstName?.[0] ?? ""}${lead.lastName?.[0] ?? ""}`.toUpperCase();
            const avatarBg = MOBILE_AVATAR_COLORS[lead.id % MOBILE_AVATAR_COLORS.length];
            const statusDot = STATUS_DOT[lead.status] ?? "#9CA3AF";
            const createdDate = lead.createdAt
              ? new Date(lead.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
              : "";
            const websiteShort = lead.website
              ? lead.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]
              : null;
            return (
              <div
                key={lead.id}
                className="px-4 py-3.5 border-b border-gray-100 bg-white active:bg-gray-50 cursor-pointer"
                onClick={() => navigate(`/leads/${lead.id}`)}
              >
                <div className="flex gap-3">
                  {/* Avatar */}
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 mt-0.5"
                    style={{ background: avatarBg }}
                  >
                    {initials || "?"}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Row 1: Name + Date + Menu */}
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[15px] font-semibold text-gray-900 leading-tight truncate">{lead.firstName} {lead.lastName}</p>
                      <div className="flex items-center gap-1 flex-shrink-0 text-gray-400">
                        <span className="text-[11px] whitespace-nowrap">{createdDate}</span>
                        <MoreVertical className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    {/* Row 2: Company + status dot */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusDot }} />
                      <p className="text-xs text-gray-500 font-medium truncate">{lead.company}</p>
                    </div>

                    {/* Row 3: Badge chips */}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <StatusBadge status={lead.status} />
                      {lead.industry && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{lead.industry}</span>
                      )}
                      {l.annualRevenue && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{l.annualRevenue}</span>
                      )}
                    </div>

                    {/* Row 4: Details + Actions */}
                    <div className="flex items-end gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                      {/* Detail rows */}
                      <div className="flex-1 min-w-0 space-y-[3px]">
                        {(websiteShort || l.notes) && (
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
                            <Globe className="w-3 h-3 text-gray-400 flex-shrink-0" />
                            <span className="truncate">{websiteShort || l.notes}</span>
                          </div>
                        )}
                        {lead.email && (
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
                            <Mail className="w-3 h-3 text-gray-400 flex-shrink-0" />
                            <span className="truncate">{lead.email}</span>
                          </div>
                        )}
                        {phoneNum && (
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
                            <Phone className="w-3 h-3 text-gray-400 flex-shrink-0" />
                            <span className="truncate">{phoneNum}</span>
                          </div>
                        )}
                      </div>

                      {/* Action column */}
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <div className="flex items-center gap-1.5">
                          {phoneNum && (
                            <a
                              href={`tel:${phoneNum}`}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone className="w-3 h-3" /> Call
                            </a>
                          )}
                          {waNum && (
                            <a
                              href={`https://wa.me/${waNum}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MessageCircle className="w-3 h-3" /> WhatsApp
                            </a>
                          )}
                        </div>
                        {/* Stage dropdown */}
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={lead.status}
                            onChange={(e) => {
                              e.stopPropagation();
                              bulkUpdate.mutate({ data: { ids: [lead.id], status: e.target.value } });
                            }}
                            className="appearance-none text-[11px] pl-2.5 pr-6 py-1 rounded-lg border font-semibold cursor-pointer focus:outline-none"
                            style={{
                              borderColor: statusDot + "80",
                              color: statusDot,
                              background: statusDot + "15",
                              minWidth: "110px",
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {STATUSES.filter((s) => s !== "all").map((s) => (
                              <option key={s} value={s}>{STATUS_DISPLAY[s]}</option>
                            ))}
                          </select>
                          <ChevronDown
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                            style={{ color: statusDot }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* FAB — Add Lead */}
          <button
            className="fixed bottom-6 right-5 z-40 w-14 h-14 rounded-full bg-violet-600 shadow-xl flex flex-col items-center justify-center text-white"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="w-5 h-5" />
            <span className="text-[9px] leading-none mt-0.5 font-semibold">Add Lead</span>
          </button>
        </div>

        {/* ── Desktop table (≥ md) ───────────────────────────────── */}
        <div className="hidden md:block">
          <table className="w-full text-xs border-collapse" style={{ minWidth: "1200px" }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-white border-b border-gray-200">
                <th className="sticky left-0 z-20 bg-white w-8 px-2 py-3 text-center">
                  <input ref={headerCheckboxRef} type="checkbox" onChange={selectPage} className="w-3.5 h-3.5 accent-violet-500 cursor-pointer" title="Select all on this page" />
                </th>
                <th className="w-8 px-2 py-3 text-[10px] font-semibold text-gray-300 text-center">#</th>
                <th className="sticky left-8 z-20 bg-white min-w-[160px] px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Name</th>
                {([
                  ["Designation", null, "130px"],
                  ["Company", "company", "150px"],
                  ["Email ID", null, "175px"],
                  ["Phone No", null, "150px"],
                  ["Website URL", null, "140px"],
                  ["Industry", null, "120px"],
                  ["Location", null, "120px"],
                  ["Lead Status", null, "130px"],
                  ["Source", null, "100px"],
                  ["Brand Audit", null, "90px"],
                  ["Date Added", "createdAt", "100px"],
                ] as [string, string | null, string][]).map(([label, col, w]) => (
                  <th key={label} style={{ minWidth: w }} className={cn("px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap", col && "cursor-pointer hover:text-violet-600")} onClick={col ? () => handleSort(col as any) : undefined}>
                    {col ? <span className="flex items-center gap-1">{label} <SortIcon col={col as any} /></span> : label}
                  </th>
                ))}
                <th className="w-16 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100"><td colSpan={15} className="px-3 py-3"><div className="h-4 rounded bg-gray-100 animate-pulse" style={{ width: `${55 + i * 4}%` }} /></td></tr>
                ))
              ) : pagedLeads.length === 0 ? (
                <tr><td colSpan={15} className="text-center py-16 text-gray-400">No leads match your filters</td></tr>
              ) : pagedLeads.map((lead, idx) => {
                const l = lead as any;
                const phoneDisplay = [lead.phone, l.whatsapp].filter(Boolean).join(" / ") || null;
                const waNum = ((l.whatsapp || lead.phone) ?? "").replace(/[^0-9]/g, "");
                const rowNum = (page - 1) * PAGE_SIZE + idx + 1;
                const avatarColor = MOBILE_AVATAR_COLORS[lead.id % MOBILE_AVATAR_COLORS.length];
                return (
                  <tr key={lead.id} className="border-b border-gray-100 hover:bg-violet-50/30 transition-colors cursor-pointer group bg-white" onClick={() => navigate(`/leads/${lead.id}`)}>
                    <td className="sticky left-0 z-10 w-8 px-2 py-2.5 bg-white group-hover:bg-violet-50/30" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggleSelect(lead.id)} className="w-3.5 h-3.5 accent-violet-500" />
                    </td>
                    <td className="w-8 px-2 py-2.5 text-center text-[10px] text-gray-300 font-mono">{rowNum}</td>
                    <td className="sticky left-8 z-10 px-3 py-2.5 bg-white group-hover:bg-violet-50/30" style={{ minWidth: "160px" }}>
                      <div className="flex items-center gap-2">
                        {l.photoUrl ? <img src={l.photoUrl} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" /> : (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: avatarColor }}>
                            {(lead.firstName?.[0] ?? "").toUpperCase()}{(lead.lastName?.[0] ?? "").toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-violet-700 hover:text-violet-900 hover:underline truncate text-[12px]">{lead.firstName} {lead.lastName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-500 truncate" style={{ maxWidth: "130px" }}>{lead.designation ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2" style={{ maxWidth: "150px" }}>
                      <div className="flex items-center gap-1.5">
                        {l.companyLogo && <img src={l.companyLogo} alt="" className="w-4 h-4 rounded object-cover flex-shrink-0" />}
                        <span className="text-gray-700 font-medium truncate">{lead.company}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2" style={{ maxWidth: "175px" }}>
                      <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline truncate block text-[11px]" onClick={e => e.stopPropagation()}>{lead.email}</a>
                    </td>
                    <td className="px-3 py-2" style={{ maxWidth: "150px" }} onClick={e => e.stopPropagation()}>
                      {phoneDisplay ? (
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500 truncate text-[11px]" style={{ maxWidth: "80px" }}>{phoneDisplay}</span>
                          <a href={`tel:${lead.phone ?? l.whatsapp}`} className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-blue-100 text-[11px]" title="Call" onClick={e => e.stopPropagation()}>📞</a>
                          {waNum && <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-green-100 text-[11px]" title="WhatsApp" onClick={e => e.stopPropagation()}>💬</a>}
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ maxWidth: "130px" }} onClick={e => e.stopPropagation()}>
                      {lead.website ? (
                        <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate block" title={lead.website}>
                          {lead.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                        </a>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 truncate text-[11px]" style={{ maxWidth: "120px" }}>{lead.industry ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-500 truncate text-[11px]" style={{ maxWidth: "120px" }}>
                      {lead.country || l.city
                        ? <span>{[l.city, lead.country].filter(Boolean).join(", ")}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={lead.status} /></td>
                    <td className="px-3 py-2 text-gray-400 capitalize truncate text-[11px]" style={{ maxWidth: "100px" }}>{lead.source?.replace(/_/g, " ") ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2">
                      {l.brandAuditCompleted ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">✓ Done</span>
                      ) : <span className="text-gray-300 text-[10px]">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-[11px]">{formatDate(lead.createdAt)}</td>
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => navigate(`/leads/${lead.id}`)} title="Open"><ExternalLink className="w-3.5 h-3.5 text-gray-300 hover:text-gray-700" /></button>
                        <button title={lead.whatsapp || lead.phone ? "WA hook" : "No phone"} disabled={(!lead.whatsapp && !lead.phone) || loadingLeads.has(lead.id)} onClick={() => {
                          setLoadingLeads(prev => new Set([...prev, lead.id]));
                          initiateWa.mutate({ leadId: lead.id }, {
                            onSuccess: (d) => toast({ title: "WhatsApp hook sent", description: d.message ?? `Started with ${lead.firstName}` }),
                            onError: () => toast({ title: "WhatsApp failed", variant: "destructive" }),
                            onSettled: () => setLoadingLeads(prev => { const next = new Set(prev); next.delete(lead.id); return next; }),
                          });
                        }}>
                          {loadingLeads.has(lead.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin text-green-500" /> : <MessageCircle className={cn("w-3.5 h-3.5", (lead.whatsapp || lead.phone) ? "text-gray-300 hover:text-green-600" : "text-gray-200 cursor-not-allowed")} />}
                        </button>
                        <button onClick={() => { if (confirm("Delete this lead?")) deleteLead.mutate({ id: lead.id }); }}>
                          <Trash2 className="w-3.5 h-3.5 text-gray-300 hover:text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination footer ─────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2.5 border-t border-gray-200 bg-white">
        <span className="text-[12px] text-gray-500">
          {filteredLeads.length === 0 ? "No results" : `${((page - 1) * PAGE_SIZE) + 1}–${Math.min(page * PAGE_SIZE, filteredLeads.length)} of ${filteredLeads.length.toLocaleString()} leads`}
        </span>
        <div className="flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => setPage(1)} className="px-2.5 py-1.5 rounded-md border border-gray-200 text-[12px] text-gray-500 disabled:opacity-30 hover:bg-gray-50 hover:border-gray-300 transition-colors">Prev</button>
          {(() => {
            const win = Math.min(7, totalFilteredPages);
            let start = Math.max(1, page - Math.floor(win / 2));
            const end = Math.min(totalFilteredPages, start + win - 1);
            start = Math.max(1, end - win + 1);
            return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
              <button key={p} onClick={() => setPage(p)} className={cn("w-8 h-8 rounded-md border text-[12px] font-medium transition-colors", p === page ? "border-violet-500 bg-violet-600 text-white shadow-sm" : "border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-gray-600")}>{p}</button>
            ));
          })()}
          <button disabled={page >= totalFilteredPages} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1.5 rounded-md border border-gray-200 text-[12px] text-gray-500 disabled:opacity-30 hover:bg-gray-50 hover:border-gray-300 transition-colors">Next</button>
        </div>
        <span className="hidden md:inline text-[12px] text-gray-400">{PAGE_SIZE} per page · {totalFilteredPages} pages</span>
      </div>

      {/* ── Lists panel (shown instead of table when viewTab=lists) ── */}
      {viewTab === "lists" && (
        <LeadListsPanel BASE="" toast={toast} />
      )}

      {/* ── Not Qualified panel ──────────────────────────────────── */}
      {viewTab === "unqualified" && (
        <div className="flex-1 min-h-0 overflow-auto bg-white">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-orange-50 border-b border-orange-100 px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-semibold text-orange-700">Not Qualified</span>
              <span className="text-xs text-orange-600 bg-orange-100 rounded-full px-2 py-0.5">{unqualifiedTotal} leads</span>
            </div>
            <button
              onClick={loadUnqualifiedLeads}
              disabled={unqualifiedLoading}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border border-orange-200 text-orange-600 hover:bg-orange-100 transition-colors"
            >
              <RotateCcw className={cn("w-3 h-3", unqualifiedLoading && "animate-spin")} />
              Refresh
            </button>
          </div>

          {/* Description */}
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700 flex items-start gap-4 flex-wrap">
            <span><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1" />Email Failed — delivery bounced or address is invalid. Contact details may be incorrect.</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1" />Low BANT — scored below 45, not a good fit right now.</span>
          </div>

          {/* Loading */}
          {unqualifiedLoading && (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {/* Empty state */}
          {!unqualifiedLoading && unqualifiedLeads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-400 mb-3" />
              <p className="text-sm font-medium text-gray-700">All leads look good</p>
              <p className="text-xs text-gray-400 mt-1">No email failures or BANT-disqualified leads.</p>
            </div>
          )}

          {/* Table */}
          {!unqualifiedLoading && unqualifiedLeads.length > 0 && (
            <table className="w-full text-[12px]">
              <thead className="sticky top-[52px] bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Name</th>
                  <th className="text-left px-4 py-2 font-semibold">Reason</th>
                  <th className="text-left px-4 py-2 font-semibold">Email</th>
                  <th className="text-left px-4 py-2 font-semibold">Company</th>
                  <th className="text-left px-4 py-2 font-semibold">BANT</th>
                  <th className="text-left px-4 py-2 font-semibold">Stage</th>
                  <th className="text-right px-4 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {unqualifiedLeads.map(lead => {
                  const isEmailFailed = (lead as unknown as { isFake?: number }).isFake === 1;
                  const bantScore = lead.bantScore;
                  const isLowBant = bantScore != null && bantScore > 0 && bantScore < 45;
                  return (
                    <tr key={lead.id} className="hover:bg-orange-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center text-[10px] font-bold text-orange-500 flex-shrink-0">
                            {(lead.firstName?.[0] ?? "?").toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{lead.firstName} {lead.lastName}</div>
                            <div className="text-[10px] text-gray-400">{lead.designation}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-1">
                          {isEmailFailed && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
                              <AlertTriangle className="w-2.5 h-2.5" /> Email Failed
                            </span>
                          )}
                          {isLowBant && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700">
                              <ShieldAlert className="w-2.5 h-2.5" /> Low BANT
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn("font-mono text-[11px]", isEmailFailed ? "text-red-600" : "text-gray-600")}>
                          {lead.email}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{lead.company}</td>
                      <td className="px-4 py-2.5">
                        {bantScore != null && bantScore > 0 ? (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                            style={{ background: bandHexFromKey(scoreToBandKey(bantScore)) + "22", color: bandHexFromKey(scoreToBandKey(bantScore)) }}
                          >
                            {bantScore}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 capitalize">
                          {((lead as unknown as { pipelineStage?: string }).pipelineStage ?? "—").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isEmailFailed && (
                            <button
                              onClick={() => restoreUnqualifiedLead(lead.id)}
                              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
                              title="Contact details are correct — restore to main list"
                            >
                              <RotateCcw className="w-3 h-3" /> Restore
                            </button>
                          )}
                          <Link href={`/leads/${lead.id}`}>
                            <button className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 transition-colors">
                              <ExternalLink className="w-3 h-3" /> View
                            </button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {showListModal && (
        <SaveToListModal BASE="" selectedIds={selected} onClose={() => setShowListModal(false)} toast={toast} />
      )}

      {/* ── Export Modal ─────────────────────────────────────────── */}
      {showExportModal && (
        <ExportModal
          rowCount={selected.length > 0 ? selected.length : filteredLeads.length}
          defaultName={selected.length > 0 ? `${selected.length} leads selected` : "All leads"}
          onExport={(format, filename) => { exportLeads(format, filename); setShowExportModal(false); }}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* ── Status legend ────────────────────────────────────────── */}
      <div className="flex-shrink-0 hidden md:flex items-center gap-3 px-5 py-1.5 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-400" style={{ display: viewTab === "leads" ? undefined : "none" }}>
        <span className="font-semibold uppercase tracking-wider">Legend:</span>
        {([["#E8F1FF","New Enquiry"],["#F0ECFF","Enquiry Qualified"],["#E0F5F2","Discovery Call"],["#FFF3D4","Quote / Estimation Sent"],["#FFE8D6","Follow Up / Negotiation"],["#E4F0E8","Project Won"],["#FEDFDF","Project Lost"]] as [string,string][]).map(([c,l]) => (
          <span key={l} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded border border-gray-200 flex-shrink-0" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>

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
                  {[["paste", "Paste Text (AI)"], ["csv", "Upload File"], ["manual", "Manual Entry"], ["vibe", "Vibe Prospecting"]].map(([tab, label]) => (
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
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) parseCsvFile(f); }}
                      className="border-2 border-dashed border-gray-200 hover:border-teal-500/40 rounded-lg p-6 text-center cursor-pointer transition-colors mb-3"
                    >
                      <FileSpreadsheet className="w-9 h-9 text-teal-600 mx-auto mb-2" />
                      {csvRows.length > 0 ? (
                        <>
                          <div className="text-xs font-medium text-gray-800">{csvRows.length} rows loaded</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">Click to replace file</div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-medium text-gray-800">Drop your file here or click to browse</div>
                          <div className="text-[10px] text-muted-foreground mt-1">Supports <span className="font-semibold">.xlsx</span>, <span className="font-semibold">.xls</span> and <span className="font-semibold">.csv</span> — any column order, auto-mapped</div>
                        </>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files?.[0]) parseCsvFile(e.target.files[0]); e.target.value = ""; }} />

                    {csvHeaders.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[11px] font-medium text-gray-700">Map columns to lead fields</div>
                          <div className="text-[10px] text-muted-foreground">* = required</div>
                        </div>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                          {csvHeaders.map((header) => (
                            <div key={header} className="flex items-center gap-2">
                              <span className="text-[11px] text-gray-700 w-36 truncate font-mono bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">{header}</span>
                              <span className="text-muted-foreground text-[10px]">→</span>
                              <select
                                value={csvMapping[header] ?? ""}
                                onChange={(e) => setCsvMapping((prev) => ({ ...prev, [header]: e.target.value as CsvColumn | "" }))}
                                className="flex-1 text-[11px] rounded border border-gray-200 bg-white text-gray-900 px-2 py-1 focus:outline-none"
                              >
                                <option value="">— Skip —</option>
                                {CSV_COLUMNS.map((col) => <option key={col} value={col}>{CSV_COLUMN_LABELS[col]}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {importProgress && importProgress.total > 1 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                          <span>Uploading batch {importProgress.current} of {importProgress.total}…</span>
                          <span>{Math.round((importProgress.current / importProgress.total) * 100)}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-300" style={{ background: "#1A7A45", width: `${Math.round((importProgress.current / importProgress.total) * 100)}%` }} />
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button onClick={closeImport} disabled={importing} className="flex-1 px-3 py-1.5 rounded text-xs text-muted-foreground bg-gray-50 border border-gray-200 disabled:opacity-40">Cancel</button>
                      <button
                        onClick={handleCsvImport}
                        disabled={importing || csvRows.length === 0}
                        className="flex-1 px-3 py-1.5 rounded text-xs text-white font-medium disabled:opacity-50"
                        style={{ background: "#1A7A45" }}
                      >
                        {importing ? <span className="flex items-center gap-1.5 justify-center"><Loader2 className="w-3 h-3 animate-spin" />Importing…</span> : `Import ${csvRows.length} Rows`}
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

  // ── Dark theme tokens — violet / indigo palette ───────────────────────────
  const D = {
    panel:      "#0C0A1A",
    header:     "#09071A",
    card:       "#130F28",
    cardBorder: "#261B50",
    divider:    "#1C1540",
    textPrimary:"#EDE9FE",
    textMuted:  "#7C6DB0",
    textDim:    "#3E3168",
    accent:     "#A78BFA",
    accentDim:  "#1E1645",
    accentText: "#C4B5FD",
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
                  background: `linear-gradient(135deg, #2D1B6B 0%, #160E3A 100%)`,
                  boxShadow: `0 0 0 1px ${D.cardBorder}, 0 0 20px rgba(167,139,250,0.2)`,
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
                {/* Sequence progress */}
                {lead.sequenceDay > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: D.textDim }}>Sequence</span>
                    <div className="flex-1 h-1 rounded-full" style={{ background: D.cardBorder }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (lead.sequenceDay / 7) * 100)}%`, background: `linear-gradient(90deg, ${D.accent}, #818CF8)` }} />
                    </div>
                    <span className="text-[10px] font-bold tabular-nums" style={{ color: D.accentText }}>Day {lead.sequenceDay}</span>
                  </div>
                )}
              </DarkCard>

              {/* ── BANTB Score ── */}
              <DarkCard title="BANTB Score" d={D}>
                {(() => {
                  const lx = lead as typeof lead & { beliefScore?: number; beliefReason?: string; beliefEvidence?: string; beliefSignals?: Record<string, boolean>; bantbTotal?: number };
                  const beliefScore = lx.beliefScore ?? 0;
                  const bantbTotal = lx.bantbTotal ?? (lead.bantScore != null ? lead.bantScore + beliefScore : null);
                  const beliefColor = beliefScore >= 18 ? "#059669" : beliefScore >= 9 ? "#D97706" : "#DC2626";
                  return lead.bantScore != null || bantbTotal != null ? (
                    <>
                      {/* BANTB total + BANT + Belief breakdown */}
                      <div className="flex items-center gap-3 mb-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: D.textDim }}>BANTB Total</div>
                          <div className="text-4xl font-black leading-none" style={{ color: bantbTotal != null && bantbTotal >= 100 ? "#D97706" : bantbTotal != null && bantbTotal >= 80 ? "#0D9488" : bantbTotal != null && bantbTotal >= 50 ? "#3B82F6" : "#6B7280" }}>
                            {bantbTotal ?? "—"}
                          </div>
                          <div className="text-[10px]" style={{ color: D.textDim }}>out of 125</div>
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span style={{ color: D.textDim }}>BANT</span>
                            <span className="font-bold" style={{ color: bantBandDarkColor(lead.bantScore ?? 0, D.accent) }}>{lead.bantScore ?? 0}/100</span>
                          </div>
                          <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: D.cardBorder }}>
                            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${lead.bantScore ?? 0}%`, background: bantBandDarkGradient(lead.bantScore ?? 0, D.accent), transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                          </div>
                          <div className="flex items-center justify-between text-[10px]">
                            <span style={{ color: D.textDim }}>Belief</span>
                            <span className="font-bold" style={{ color: beliefColor }}>{beliefScore}/25</span>
                          </div>
                          <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: D.cardBorder }}>
                            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(beliefScore / 25) * 100}%`, background: `linear-gradient(90deg, ${beliefColor}, ${beliefColor}99)`, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                          </div>
                        </div>
                      </div>
                      {/* BANT sub-scores grid */}
                      {bantBreakdownEntries.length > 0 && (
                        <div className="grid grid-cols-2 gap-1.5 mb-3">
                          {bantBreakdownEntries.map(([k, v]) => (
                            <div key={k} className="rounded-xl px-3 py-2" style={{ background: D.accentDim, border: `1px solid ${D.cardBorder}` }}>
                              <div className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: D.textDim }}>{k}</div>
                              <div className="flex items-baseline gap-0.5">
                                <span className="text-lg font-black" style={{ color: D.accent }}>{v}</span>
                                <span className="text-[10px]" style={{ color: D.textDim }}>/25</span>
                              </div>
                            </div>
                          ))}
                          {/* Belief tile */}
                          <div className="rounded-xl px-3 py-2" style={{ background: "rgba(13,148,136,0.12)", border: "1px solid rgba(13,148,136,0.3)" }}>
                            <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "#0D9488" }}>
                              <Brain className="w-2.5 h-2.5" />Belief
                            </div>
                            <div className="flex items-baseline gap-0.5">
                              <span className="text-lg font-black" style={{ color: beliefColor }}>{beliefScore}</span>
                              <span className="text-[10px]" style={{ color: "#0D9488" }}>/25</span>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Belief reason */}
                      {lx.beliefReason && (
                        <div className="rounded-lg px-3 py-2 mt-2" style={{ background: "rgba(13,148,136,0.08)", border: "1px solid rgba(13,148,136,0.2)" }}>
                          <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: "#0D9488" }}>Belief Analysis</div>
                          <p className="text-[11px]" style={{ color: D.textPrimary }}>{lx.beliefReason}</p>
                          {lx.beliefEvidence && <p className="text-[10px] italic mt-1" style={{ color: D.textDim }}>"{lx.beliefEvidence}"</p>}
                          {lx.beliefSignals && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {Object.entries(lx.beliefSignals).map(([sig, val]) => {
                                const labels: Record<string, string> = { linkedin: "LinkedIn", aboutPage: "About Page", founderStory: "Founder Story", mission: "Mission" };
                                return val ? (
                                  <span key={sig} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(13,148,136,0.15)", color: "#059669" }}>✓ {labels[sig] ?? sig}</span>
                                ) : null;
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs py-2" style={{ color: D.textDim }}>Not scored yet — use the Qualify page to generate BANTB scores.</div>
                  );
                })()}
              </DarkCard>

              {/* ── Contact ── */}
              <DarkCard title="Contact" d={D}>
                <div className="space-y-2.5">
                  {lead.email       && <DarkInfoRow icon="✉️" label="Email"     value={lead.email}      href={`mailto:${lead.email}`}   d={D} />}
                  {lead.phone       && <DarkInfoRow icon="📞" label="Phone"     value={lead.phone}      href={`tel:${lead.phone}`}      d={D} />}
                  {lead.whatsapp    && <DarkInfoRow icon="💬" label="WhatsApp"  value={lead.whatsapp}   href={`https://wa.me/${lead.whatsapp.replace(/[^0-9]/g,"")}`} d={D} />}
                  {lead.website     && <DarkInfoRow icon="🌐" label="Website"   value={lead.website}    href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} d={D} />}
                  {lead.linkedInUrl && <DarkInfoRow icon="🔗" label="LinkedIn"  value="View Profile"   href={lead.linkedInUrl} d={D} />}
                </div>
              </DarkCard>

              {/* ── Company ── */}
              <DarkCard title="Company" d={D}>
                <div className="space-y-2.5">
                  {lead.company       && <DarkInfoRow icon="🏢" label="Company"   value={lead.company}         d={D} />}
                  {lead.designation   && <DarkInfoRow icon="👤" label="Title"     value={lead.designation}     d={D} />}
                  {lead.industry      && <DarkInfoRow icon="🏭" label="Industry"  value={lead.industry}        d={D} />}
                  {lead.country       && <DarkInfoRow icon="🌍" label="Location"  value={`${lead.city ? lead.city + ", " : ""}${lead.country}`} d={D} />}
                  {lead.companySize   && <DarkInfoRow icon="👥" label="Team Size" value={lead.companySize}     d={D} />}
                  {lead.annualRevenue && <DarkInfoRow icon="💰" label="Revenue"   value={lead.annualRevenue}   d={D} />}
                </div>
              </DarkCard>

              {/* ── Details & Tags ── */}
              <DarkCard title="Details" d={D}>
                <div className="space-y-2.5">
                  {lead.source          && <DarkInfoRow icon="📡" label="Source"     value={lead.source.replace(/_/g, " ")} d={D} />}
                  <DarkInfoRow            icon="🗓️" label="Added"      value={formatDate(lead.createdAt)}             d={D} />
                  {lead.lastContactedAt && <DarkInfoRow icon="📬" label="Contacted"  value={formatDate(lead.lastContactedAt)} d={D} />}
                  <DarkInfoRow            icon="🔄" label="Updated"    value={formatDate(lead.updatedAt)}             d={D} />
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

              {/* ── Keywords (search / ICP match) ── */}
              {lead.keywords?.length > 0 && (
                <DarkCard title="Keywords" d={D}>
                  <div className="flex flex-wrap gap-1.5">
                    {lead.keywords.map((k: string) => (
                      <span key={k} className="text-[10px] px-2.5 py-0.5 rounded-full font-medium"
                        style={{ background: "#1A1535", color: "#A5B4FC", border: "1px solid #2E2660" }}>
                        {k}
                      </span>
                    ))}
                  </div>
                </DarkCard>
              )}

              {/* ── AI Intelligence ── */}
              <DarkCard title="AI Intelligence" d={D}>
                <div className="space-y-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: D.textMuted }}>Intent</div>
                    <div className="flex flex-wrap gap-1">
                      {((lead as unknown as { intentKeywords?: string[] }).intentKeywords)?.length
                        ? ((lead as unknown as { intentKeywords: string[] }).intentKeywords).map((k: string) => (
                            <span key={k} className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "#1E1645", color: "#C4B5FD", border: "1px solid #3D2D6E" }}>{k}</span>
                          ))
                        : <span className="text-[11px]" style={{ color: D.textDim }}>None yet</span>
                      }
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: D.textMuted }}>Behavior</div>
                    <div className="flex flex-wrap gap-1">
                      {((lead as unknown as { behaviorKeywords?: string[] }).behaviorKeywords)?.length
                        ? ((lead as unknown as { behaviorKeywords: string[] }).behaviorKeywords).map((k: string) => (
                            <span key={k} className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "#1A1335", color: "#DDD6FE", border: "1px solid #3B2D6B" }}>{k}</span>
                          ))
                        : <span className="text-[11px]" style={{ color: D.textDim }}>None yet</span>
                      }
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: D.textMuted }}>Interests</div>
                    <div className="flex flex-wrap gap-1">
                      {((lead as unknown as { interestKeywords?: string[] }).interestKeywords)?.length
                        ? ((lead as unknown as { interestKeywords: string[] }).interestKeywords).map((k: string) => (
                            <span key={k} className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "#160F2B", color: "#A5B4FC", border: "1px solid #2E2660" }}>{k}</span>
                          ))
                        : <span className="text-[11px]" style={{ color: D.textDim }}>None yet</span>
                      }
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${D.divider}` }}>
                  <button
                    disabled={enrichingKeywords.has(lead.id)}
                    onClick={async () => {
                      setEnrichingKeywords((prev) => new Set(prev).add(lead.id));
                      try {
                        const base = "/api";
                        await fetch(`${base}/leads/${lead.id}/enrich-keywords`, { method: "POST", credentials: "include" });
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

/* ──────────────────────────────────────────────────────────
   LEAD LISTS PANEL
──────────────────────────────────────────────────────────── */
const LIST_COLORS = ["#6366F1","#8B5CF6","#EC4899","#F59E0B","#10B981","#3B82F6","#EF4444","#F97316","#06B6D4"];

function LeadListsPanel({ BASE, toast }: { BASE: string; toast: (t: { title: string }) => void }) {
  const [lists, setLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeList, setActiveList] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newColor, setNewColor] = useState(LIST_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/lead-lists`, { credentials: "include" });
      if (r.ok) setLists(await r.json());
    } finally { setLoading(false); }
  }, [BASE]);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  const openList = async (list: any) => {
    const r = await fetch(`${BASE}/api/lead-lists/${list.id}`, { credentials: "include" });
    if (r.ok) setActiveList(await r.json());
  };

  const createList = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const r = await fetch(`${BASE}/api/lead-lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined, color: newColor }),
      });
      if (r.ok) {
        setNewName(""); setNewDesc(""); setShowCreate(false);
        toast({ title: "List created" });
        await fetchLists();
      }
    } finally { setCreating(false); }
  };

  const deleteList = async (id: number) => {
    if (!confirm("Delete this list? Leads are not deleted.")) return;
    await fetch(`${BASE}/api/lead-lists/${id}`, { method: "DELETE", credentials: "include" });
    if (activeList?.id === id) setActiveList(null);
    await fetchLists();
  };

  const removeLead = async (leadId: number) => {
    if (!activeList) return;
    setRemoving(leadId);
    await fetch(`${BASE}/api/lead-lists/${activeList.id}/leads/${leadId}`, { method: "DELETE", credentials: "include" });
    setActiveList((prev: any) => prev ? { ...prev, leads: prev.leads.filter((l: any) => l.id !== leadId), count: prev.count - 1 } : null);
    setLists(prev => prev.map(l => l.id === activeList.id ? { ...l, count: l.count - 1 } : l));
    setRemoving(null);
  };

  if (activeList) {
    return (
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={() => setActiveList(null)} className="text-[11px] text-gray-500 hover:text-gray-700 underline">← All Lists</button>
          <span className="text-gray-300 text-xs">/</span>
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: activeList.color }} />
          <h2 className="text-sm font-semibold text-gray-800">{activeList.name}</h2>
          <span className="text-[11px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{activeList.count ?? 0} leads</span>
          <button onClick={() => deleteList(activeList.id)} className="ml-auto text-[11px] text-red-500 hover:text-red-600 underline">Delete List</button>
        </div>
        {activeList.description && <p className="text-xs text-gray-500 mb-4">{activeList.description}</p>}
        {(activeList.leads ?? []).length === 0 ? (
          <div className="text-center text-gray-400 py-12 text-sm">
            No leads in this list yet.<br />
            <span className="text-xs">Select leads in All Leads tab and use "Save to List".</span>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">Name</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium hidden md:table-cell">Company</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium hidden md:table-cell">Status</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium hidden md:table-cell">Added</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(activeList.leads ?? []).map((lead: any) => (
                  <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-gray-800">{lead.firstName} {lead.lastName}</div>
                      <div className="text-gray-400">{lead.email}</div>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell text-gray-600">{lead.company ?? "—"}</td>
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium capitalize", statusColor(lead.status))}>
                        {statusLabel(lead.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell text-gray-400">{formatDate(lead.addedAt)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => removeLead(lead.id)} disabled={removing === lead.id} className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Lead Lists</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Group leads into lists for targeted campaigns and outreach</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 px-3 py-1.5 rounded text-[11px] font-medium text-white" style={{ background: "#6366F1" }}>
          <Plus className="w-3.5 h-3.5" /> New List
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : lists.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ListPlus className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No lists yet</p>
          <p className="text-xs mt-1">Select leads from the All Leads tab and save them to a list</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 px-4 py-2 text-xs text-white rounded-lg font-medium" style={{ background: "#6366F1" }}>Create First List</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lists.map(list => (
            <div key={list.id} className="border border-gray-200 rounded-xl p-4 bg-white hover:border-indigo-200 hover:shadow-sm transition-all cursor-pointer group" onClick={() => openList(list)}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: list.color }} />
                  <span className="text-xs font-semibold text-gray-800 group-hover:text-indigo-700 transition-colors">{list.name}</span>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteList(list.id); }} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {list.description && <p className="text-[11px] text-gray-400 mb-2 line-clamp-1">{list.description}</p>}
              <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] font-bold text-gray-500">{list.count ?? 0} leads</span>
                <span className="text-[10px] text-gray-300">{formatDate(list.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 mb-4">Create New List</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-gray-600 mb-1 block">List Name *</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Hot Prospects Q2"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" autoFocus />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-600 mb-1 block">Description (optional)</label>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What's this list for?"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-600 mb-1 block">Colour</label>
                <div className="flex gap-2 flex-wrap">
                  {LIST_COLORS.map(c => (
                    <button key={c} onClick={() => setNewColor(c)} className="w-6 h-6 rounded-full transition-transform hover:scale-110 border-2" style={{ background: c, borderColor: newColor === c ? "#1f2937" : "transparent" }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 px-3 py-2 text-xs rounded-lg border border-gray-200 text-gray-600">Cancel</button>
              <button onClick={createList} disabled={!newName.trim() || creating} className="flex-1 px-3 py-2 text-xs font-medium text-white rounded-lg disabled:opacity-50" style={{ background: newColor }}>
                {creating ? "Creating…" : "Create List"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   EXPORT MODAL
──────────────────────────────────────────────────────────── */
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
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100" style={{ background: "#1A3D2B" }}>
          <h3 className="text-[15px] font-bold text-white">Export leads</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Row count info */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-[12px] text-gray-600">
            <Download className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span>Exporting <span className="font-semibold text-gray-900">{rowCount.toLocaleString()} leads</span> · 22 columns · 1 file</span>
          </div>

          {/* Export name */}
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1.5">Export name</label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1A3D2B]/20 focus:border-[#1A3D2B]"
            />
          </div>

          {/* File format */}
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

          {/* Data included */}
          <div className="px-3 py-3 rounded-lg bg-green-50 border border-green-100 text-[11px] text-green-800 space-y-1">
            <div className="font-semibold text-green-900 mb-1">Columns included in export</div>
            <div className="text-green-700 leading-relaxed">
              ID · First Name · Last Name · Email · Phone · WhatsApp · LinkedIn URL · Company · Designation · Industry · City · Country · Website · Company Size · Annual Revenue · Source · Status · BANT Score · Keywords · Notes · Assigned To · Created At
            </div>
          </div>
        </div>

        {/* Footer */}
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

/* ──────────────────────────────────────────────────────────
   SAVE TO LIST MODAL
──────────────────────────────────────────────────────────── */
function SaveToListModal({ BASE, selectedIds, onClose, toast }: { BASE: string; selectedIds: number[]; onClose: () => void; toast: (t: { title: string }) => void }) {
  const [lists, setLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(LIST_COLORS[0]);
  const [mode, setMode] = useState<"existing" | "new">("existing");

  useEffect(() => {
    fetch(`${BASE}/api/lead-lists`, { credentials: "include" }).then(r => r.ok ? r.json() : []).then(setLists).finally(() => setLoading(false));
  }, [BASE]);

  const addToList = async (listId: number) => {
    setSaving(true);
    const r = await fetch(`${BASE}/api/lead-lists/${listId}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ leadIds: selectedIds }),
    });
    if (r.ok) { toast({ title: `${selectedIds.length} lead(s) added to list` }); onClose(); return; }
    setSaving(false);
  };

  const createAndAdd = async () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/lead-lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (!r.ok) throw new Error("Failed to create list");
      const list = await r.json();
      await addToList(list.id);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-800">Save {selectedIds.length} lead(s) to list</h3>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-2 mb-4">
          {(["existing", "new"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={cn("flex-1 py-1.5 text-xs rounded-lg font-medium border", mode === m ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-600")}>
              {m === "existing" ? "Existing List" : "Create New"}
            </button>
          ))}
        </div>
        {mode === "existing" ? (
          loading ? (
            <div className="py-8 text-center text-xs text-gray-400">Loading lists…</div>
          ) : lists.length === 0 ? (
            <div className="py-8 text-center text-xs text-gray-400">No lists yet — create a new one</div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {lists.map(list => (
                <button key={list.id} disabled={saving} onClick={() => addToList(list.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all text-left disabled:opacity-50">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: list.color }} />
                  <span className="flex-1 text-xs font-medium text-gray-700">{list.name}</span>
                  <span className="text-[10px] text-gray-400">{list.count ?? 0} leads</span>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-3">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="List name…"
              className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" autoFocus />
            <div className="flex gap-1.5 flex-wrap">
              {LIST_COLORS.slice(0, 7).map(c => (
                <button key={c} onClick={() => setNewColor(c)} className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110" style={{ background: c, borderColor: newColor === c ? "#374151" : "transparent" }} />
              ))}
            </div>
            <button onClick={createAndAdd} disabled={!newName.trim() || saving}
              className="w-full py-2 text-xs font-medium text-white rounded-lg disabled:opacity-50" style={{ background: newColor }}>
              {saving ? "Creating…" : `Create & Add ${selectedIds.length} Lead(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, cn } from "@/lib/utils";
import { useIsAdmin } from "@/contexts/AuthContext";
import {
  Database, Search, Download, Globe, Building2, Zap,
  FileSpreadsheet, UserPlus, MapPin, Loader2,
  Upload, X, CheckCircle2, Lock, ArrowUpDown, ArrowUp, ArrowDown,
  ExternalLink, Trash2, Phone, MessageCircle, Link2,
} from "lucide-react";

const BASE = "/api";

// ─── Source metadata ─────────────────────────────────────────────────────────

const SOURCE_META: Record<string, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  manual:               { label: "Manual",          color: "#1A3D2B", bg: "#E6F4EC", Icon: UserPlus },
  csv_import:           { label: "CSV Import",       color: "#0369A1", bg: "#E0F2FE", Icon: FileSpreadsheet },
  paste_import:         { label: "AI Parse",         color: "#7C3AED", bg: "#F3E8FF", Icon: Zap },
  google_maps:          { label: "Google Maps",      color: "#DC2626", bg: "#FEE2E2", Icon: MapPin },
  apify:                { label: "Apify",            color: "#EA580C", bg: "#FFEDD5", Icon: Database },
  apollo:               { label: "Apollo.io",        color: "#0891B2", bg: "#CFFAFE", Icon: Globe },
  ai_sample:            { label: "AI Sample",        color: "#7C3AED", bg: "#F3E8FF", Icon: Zap },
  ai_generated:         { label: "AI Generated",     color: "#7C3AED", bg: "#F3E8FF", Icon: Zap },
  hubspot_import:       { label: "HubSpot",          color: "#FF7A59", bg: "#FFF0EB", Icon: Building2 },
  vibe_prospecting:     { label: "Vibe",             color: "#059669", bg: "#ECFDF5", Icon: Globe },
  lead_bank:            { label: "Lead Bank",        color: "#0F766E", bg: "#CCFBF1", Icon: Database },
  lead_hunter_agent:    { label: "Lead Hunter",      color: "#1D4ED8", bg: "#EFF6FF", Icon: Zap },
  platform:             { label: "Platform",         color: "#6B7280", bg: "#F3F4F6", Icon: Database },
};
const DEFAULT_META = { label: "Other", color: "#6B7280", bg: "#F3F4F6", Icon: Database };

function SourceBadge({ source }: { source: string }) {
  const m = SOURCE_META[source] ?? DEFAULT_META;
  const { Icon } = m;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ background: m.bg, color: m.color }}>
      <Icon className="w-2.5 h-2.5 flex-shrink-0" />
      {m.label}
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type BankLead = {
  id: number;
  orgId?: number | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  linkedInUrl?: string | null;
  company: string;
  designation: string;
  industry: string;
  city?: string | null;
  country: string;
  companySize?: string | null;
  website?: string | null;
  annualRevenue?: string | null;
  source: string;
  tags?: string[] | null;
  notes?: string | null;
  intentKeywords?: string[] | null;
  behaviorKeywords?: string[] | null;
  interestKeywords?: string[] | null;
  importedToLeadsAt?: string | null;
  importedLeadId?: number | null;
  createdAt: string;
};

type BankStats = {
  total: number;
  imported: number;
  fresh: number;
  sources: Record<string, number>;
};

type SortCol = "company" | "country" | "industry" | "createdAt" | null;

const PAGE_SIZE = 25;
const ALL_SOURCES = ["all", "manual", "google_maps", "apollo", "csv_import", "paste_import", "apify", "ai_sample", "hubspot_import", "vibe_prospecting", "lead_hunter_agent"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function LeadBank() {
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();

  // filters
  const [search, setSearch]                 = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [source, setSource]                 = useState("all");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterCountry, setFilterCountry]   = useState("");
  const [onlyFresh, setOnlyFresh]           = useState(false);
  const [sortCol, setSortCol]               = useState<SortCol>(null);
  const [sortDir, setSortDir]               = useState<"asc" | "desc">("asc");

  // pagination
  const [page, setPage]         = useState(1);
  const [allLeads, setAllLeads] = useState<BankLead[]>([]);

  // selection
  const [selected, setSelected]             = useState<number[]>([]);
  const headerCheckboxRef                   = useRef<HTMLInputElement>(null);

  // import modal
  const [showImport, setShowImport]         = useState(false);
  const [importText, setImportText]         = useState("");
  const [importing, setImporting]           = useState(false);
  const [importResult, setImportResult]     = useState<{ inserted: number; skipped: number } | null>(null);

  // export modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFilename, setExportFilename]   = useState("lead-bank");
  const [exportFormat, setExportFormat]       = useState<"csv" | "xlsx">("csv");

  // debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const params = new URLSearchParams();
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (source !== "all") params.set("source", source);
  if (onlyFresh) params.set("onlyFresh", "true");
  params.set("limit", "2000"); // load all, paginate client-side like B2C

  const { data, isLoading, isFetching } = useQuery<{ leads: BankLead[]; total: number; totalPages: number }>({
    queryKey: ["lead-bank", debouncedSearch, source, onlyFresh],
    queryFn: () => fetch(`${BASE}/lead-bank?${params.toString()}`, { credentials: "include" }).then(r => r.json()),
    enabled: isAdmin,
  });

  const { data: statsData } = useQuery<BankStats>({
    queryKey: ["lead-bank-stats"],
    queryFn: () => fetch(`${BASE}/lead-bank/stats`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
    enabled: isAdmin,
  });

  const total = data?.total ?? 0;

  // reset on filter change
  useEffect(() => {
    setAllLeads([]);
    setPage(1);
    setSelected([]);
  }, [debouncedSearch, source, onlyFresh]);

  useEffect(() => {
    if (data?.leads == null) return;
    const seen = new Set<number>();
    const deduped = data.leads.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
    setAllLeads(deduped);
  }, [data]);

  // Reset to page 1 when client-side filters/sort change
  useEffect(() => { setPage(1); }, [filterIndustry, filterCountry, sortCol, sortDir]);

  // ─── Client-side filter + sort ─────────────────────────────────────────────

  const filteredLeads = [...allLeads.filter(l => {
    if (filterIndustry && !(l.industry ?? "").toLowerCase().includes(filterIndustry.toLowerCase())) return false;
    if (filterCountry  && !(l.country  ?? "").toLowerCase().includes(filterCountry.toLowerCase()))  return false;
    return true;
  })].sort((a, b) => {
    if (!sortCol) return 0;
    const av = (a[sortCol] ?? "") as string;
    const bv = (b[sortCol] ?? "") as string;
    return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const totalPages   = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const pagedLeads   = filteredLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const uniqueIndustries = [...new Set(allLeads.map(l => l.industry).filter(Boolean))].sort();
  const uniqueCountries  = [...new Set(allLeads.map(l => l.country).filter(Boolean))].sort();

  // ─── Sort helper ────────────────────────────────────────────────────────────

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-2.5 h-2.5 ml-0.5 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-2.5 h-2.5 ml-0.5 text-teal-600" /> : <ArrowDown className="w-2.5 h-2.5 ml-0.5 text-teal-600" />;
  };

  // ─── Selection ──────────────────────────────────────────────────────────────

  const toggleSelect = (id: number) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const selectPage = () => {
    const pageIds = pagedLeads.map(l => l.id);
    const allSel = pageIds.every(id => selected.includes(id));
    if (allSel) setSelected(prev => prev.filter(id => !pageIds.includes(id)));
    else        setSelected(prev => [...new Set([...prev, ...pageIds])]);
  };

  const selectAll = () => setSelected(filteredLeads.map(l => l.id));

  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    const pageIds = pagedLeads.map(l => l.id);
    const selOnPage = pageIds.filter(id => selected.includes(id));
    if (selOnPage.length === 0) {
      headerCheckboxRef.current.checked = false;
      headerCheckboxRef.current.indeterminate = false;
    } else if (selOnPage.length === pageIds.length) {
      headerCheckboxRef.current.checked = true;
      headerCheckboxRef.current.indeterminate = false;
    } else {
      headerCheckboxRef.current.checked = false;
      headerCheckboxRef.current.indeterminate = true;
    }
  }, [selected, pagedLeads]);

  // ─── Export ─────────────────────────────────────────────────────────────────

  const doExport = (format: "csv" | "xlsx", filename: string) => {
    const rows = filteredLeads.filter(l => selected.length === 0 || selected.includes(l.id));
    const headers = ["ID","First Name","Last Name","Email","Phone","WhatsApp","LinkedIn","Company","Designation","Industry","City","Country","Company Size","Website","Annual Revenue","Source","Tags","Intent Keywords","Imported","Date Added"];
    const buildRow = (l: BankLead) => [
      l.id, l.firstName, l.lastName, l.email ?? "", l.phone ?? "", l.whatsapp ?? "", l.linkedInUrl ?? "",
      l.company, l.designation, l.industry, l.city ?? "", l.country, l.companySize ?? "", l.website ?? "",
      l.annualRevenue ?? "", l.source, (l.tags ?? []).join(", "), (l.intentKeywords ?? []).join(", "),
      l.importedToLeadsAt ? "Yes" : "No",
      l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
    ];
    const csvLines = [
      headers.map(h => `"${h}"`).join(","),
      ...rows.map(l => buildRow(l).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csvLines], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url; a.download = `${filename}.${format}`; a.click();
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  // ─── Delete ─────────────────────────────────────────────────────────────────

  const deleteFromBank = async (ids: number[]) => {
    if (!confirm(`Delete ${ids.length} lead(s) from the Lead Bank? This cannot be undone.`)) return;
    await Promise.all(ids.map(id =>
      fetch(`${BASE}/lead-bank/${id}`, { method: "DELETE", credentials: "include" })
    ));
    qc.invalidateQueries({ queryKey: ["lead-bank"] });
    qc.invalidateQueries({ queryKey: ["lead-bank-stats"] });
    setSelected([]);
  };

  // ─── Bulk Import ────────────────────────────────────────────────────────────

  const handleBulkImport = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const lines = importText.trim().split("\n").map(l => l.trim()).filter(Boolean);
      const records = lines.map(line => {
        const parts = line.split(/[,\t|]+/).map(p => p.trim());
        return { firstName: parts[0] ?? "", lastName: parts[1] ?? "", email: parts[2] ?? undefined, company: parts[3] ?? "", designation: parts[4] ?? "", industry: parts[5] ?? "", country: parts[6] ?? "", source: "paste_import" };
      });
      const r = await fetch(`${BASE}/lead-bank/bulk-import`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ records }),
      });
      const result = await r.json();
      setImportResult(result);
      qc.invalidateQueries({ queryKey: ["lead-bank"] });
      qc.invalidateQueries({ queryKey: ["lead-bank-stats"] });
      setImportText("");
    } catch {
      setImportResult({ inserted: 0, skipped: 0 });
    } finally {
      setImporting(false);
    }
  };

  // ─── Guard ──────────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-gray-100">
          <Lock className="w-7 h-7 text-gray-400" />
        </div>
        <div className="text-center">
          <h2 className="text-base font-bold text-gray-900 mb-1">Admin Access Only</h2>
          <p className="text-sm text-gray-500">The Lead Bank is a private feature reserved for platform administrators.</p>
        </div>
      </div>
    );
  }

  const pageIds          = pagedLeads.map(l => l.id);
  const allPageSelected  = pageIds.length > 0 && pageIds.every(id => selected.includes(id));
  const allSelCount      = selected.length;
  const allFilteredSel   = allSelCount === filteredLeads.length && filteredLeads.length > 0;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-3 md:px-5 pt-3 pb-2 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#0F766E" }}>
                <Database className="w-3.5 h-3.5 text-white" />
              </div>
              <h1 className="text-sm md:text-base font-bold text-gray-900 leading-tight">Lead Bank</h1>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: "#CCFBF1", color: "#0F766E" }}>Admin Only</span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5 ml-9">
              {filteredLeads.length.toLocaleString()} of {total.toLocaleString()} leads · page {page}/{totalPages}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowImport(p => !p)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold text-white transition-colors"
              style={{ background: showImport ? "#0D6B60" : "#0F766E" }}
            >
              <Upload className="w-3 h-3" /> <span className="hidden sm:inline">Import to Bank</span>
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded border border-gray-200 bg-white text-gray-500 hover:text-gray-800 transition-colors"
            >
              <Download className="w-3 h-3" /> <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats row ───────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-3 md:px-5 py-2 border-b border-gray-100 bg-gray-50">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {[
            { label: "Total in Bank",       value: statsData?.total    ?? 0, color: "#0F766E", bg: "#CCFBF1" },
            { label: "Fresh (not imported)", value: statsData?.fresh    ?? 0, color: "#1A3D2B", bg: "#D1FAE5" },
            { label: "Imported to Leads",   value: statsData?.imported ?? 0, color: "#7C3AED", bg: "#EDE9FE" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2 flex items-center gap-2 shadow-sm">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
              <div>
                <div className="text-base font-bold text-gray-900 leading-tight">{s.value.toLocaleString()}</div>
                <div className="text-[10px] text-gray-400">{s.label}</div>
              </div>
            </div>
          ))}
          {["google_maps", "apollo", "csv_import", "lead_hunter_agent"].map(src => {
            const m = SOURCE_META[src] ?? DEFAULT_META;
            const { Icon } = m;
            const count = statsData?.sources?.[src] ?? 0;
            return (
              <button key={src}
                onClick={() => setSource(source === src ? "all" : src)}
                className="rounded-lg border bg-white px-2 py-2 text-left transition-all hover:shadow-md shadow-sm"
                style={{ borderColor: source === src ? m.color : "#E5E7EB" }}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <Icon className="w-3 h-3" style={{ color: m.color }} />
                  <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: m.color }}>{m.label}</span>
                </div>
                <div className="text-sm font-bold text-gray-900">{count.toLocaleString()}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filters row ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-3 md:px-5 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            {isFetching && search
              ? <Loader2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-teal-500 animate-spin" />
              : <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
            }
            <input
              type="text"
              placeholder="Search name, company, email, phone, city…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-7 pr-6 py-1.5 text-[11px] rounded border border-gray-200 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>}
          </div>
          {/* Source */}
          <select value={source} onChange={e => setSource(e.target.value)} className="py-1.5 px-2 text-[11px] rounded border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-teal-400">
            {ALL_SOURCES.map(s => <option key={s} value={s}>{s === "all" ? "All Sources" : (SOURCE_META[s]?.label ?? s)}</option>)}
          </select>
          {/* Industry */}
          <select value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)} className="py-1.5 px-2 text-[11px] rounded border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-teal-400">
            <option value="">All Industries</option>
            {uniqueIndustries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
          </select>
          {/* Country */}
          <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)} className="py-1.5 px-2 text-[11px] rounded border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-teal-400">
            <option value="">All Countries</option>
            {uniqueCountries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {/* Fresh toggle */}
          <button
            onClick={() => setOnlyFresh(p => !p)}
            className={cn("flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded border font-medium transition-colors", onlyFresh ? "text-white border-transparent" : "text-gray-600 border-gray-200 bg-white hover:bg-gray-50")}
            style={onlyFresh ? { background: "#0F766E" } : {}}
          >
            <Zap className="w-3 h-3" /> Fresh only
          </button>
          {/* Clear */}
          {(source !== "all" || search || filterIndustry || filterCountry || onlyFresh) && (
            <button onClick={() => { setSource("all"); setSearch(""); setFilterIndustry(""); setFilterCountry(""); setOnlyFresh(false); }} className="text-[11px] text-gray-400 hover:text-gray-700 border border-gray-200 rounded px-2 py-1">✕ Clear</button>
          )}
          <span className="ml-auto text-[11px] text-gray-400 self-center tabular-nums">
            {filteredLeads.length.toLocaleString()} of {total.toLocaleString()} lead{total !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Import panel ────────────────────────────────────────────────────── */}
      {showImport && (
        <div className="flex-shrink-0 mx-3 md:mx-5 mt-2 rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-teal-900">Bulk Import to Lead Bank</div>
              <div className="text-[11px] text-teal-600 mt-0.5">Paste one lead per line: <code className="bg-teal-100 px-1 rounded">FirstName, LastName, Email, Company, Designation, Industry, Country</code></div>
            </div>
            <button onClick={() => { setShowImport(false); setImportResult(null); }}><X className="w-4 h-4 text-teal-600 hover:text-teal-800" /></button>
          </div>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={5}
            placeholder={"John, Doe, john@company.com, Acme Corp, CEO, SaaS, USA\nJane, Smith, jane@firm.com, Firm Ltd, CTO, FinTech, UK"}
            className="w-full px-3 py-2.5 text-xs rounded-lg border border-teal-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-400 font-mono resize-none"
          />
          <div className="flex items-center gap-3">
            <button onClick={handleBulkImport} disabled={importing || !importText.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: "#0F766E" }}>
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {importing ? "Importing…" : "Import Now"}
            </button>
            {importResult && (
              <div className="flex items-center gap-1.5 text-xs text-teal-800">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                <span><strong>{importResult.inserted}</strong> added · <strong>{importResult.skipped}</strong> skipped</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Bulk actions bar ────────────────────────────────────────────────── */}
      {selected.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-3 md:px-5 py-2 border-b border-amber-200 bg-amber-50 flex-wrap">
          <span className="text-[11px] text-amber-700 font-semibold">{selected.length} selected</span>
          <button onClick={() => setShowExportModal(true)} className="flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-800 underline">
            <Download className="w-3 h-3" /> Export
          </button>
          <button onClick={() => deleteFromBank(selected)} className="text-[11px] text-red-600 hover:text-red-700 underline">
            Delete from Bank
          </button>
          <button onClick={() => setSelected([])} className="text-[11px] text-gray-400 hover:text-gray-700 underline ml-auto">Clear</button>
        </div>
      )}

      {/* ── Select-all banner (HubSpot-style) ──────────────────────────────── */}
      {allPageSelected && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[11px]">
          {allFilteredSel ? (
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
      )}

      {/* ── Scrollable content ───────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto bg-white" style={{ scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 #f1f5f9" }}>

        {/* ── Mobile cards (< md) ──────────────────────────────────────────── */}
        <div className="flex flex-col md:hidden">
          {isLoading ? Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-3 animate-pulse flex gap-3 border-b border-gray-100">
              <div className="w-9 h-9 rounded-full bg-gray-100 flex-shrink-0" />
              <div className="flex-1 space-y-2 py-1"><div className="h-3.5 bg-gray-100 rounded w-3/4" /><div className="h-3 bg-gray-100 rounded w-1/2" /></div>
            </div>
          )) : pagedLeads.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">No leads match your filters</div>
          ) : pagedLeads.map(lead => {
            const fullName  = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—";
            const waNum     = ((lead.whatsapp || lead.phone) ?? "").replace(/[^0-9]/g, "");
            const isImported = !!lead.importedToLeadsAt;
            return (
              <div key={lead.id} className="p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-2.5">
                  <div className="flex-shrink-0 relative mt-0.5">
                    <input type="checkbox" checked={selected.includes(lead.id)} onChange={e => { e.stopPropagation(); toggleSelect(lead.id); }} className="absolute -top-1 -left-1 z-10 w-3.5 h-3.5 accent-teal-600" onClick={e => e.stopPropagation()} />
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#0F766E,#0369A1)" }}>
                      {lead.firstName?.[0]}{lead.lastName?.[0]}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-gray-900 truncate">{fullName}</p>
                        <p className="text-xs text-gray-500 truncate">{lead.designation}{lead.designation && lead.company ? " · " : ""}{lead.company}</p>
                      </div>
                      <SourceBadge source={lead.source} />
                    </div>
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {isImported
                        ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700"><CheckCircle2 className="w-2.5 h-2.5" /> Imported</span>
                        : <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "#CCFBF1", color: "#0F766E" }}><Zap className="w-2.5 h-2.5" /> Fresh</span>
                      }
                      {lead.industry && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{lead.industry}</span>}
                      {lead.country  && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{lead.country}</span>}
                    </div>
                    {lead.email && <p className="text-sm text-blue-600 mt-1 truncate"><a href={`mailto:${lead.email}`}>{lead.email}</a></p>}
                    <div className="flex items-center gap-2 mt-2">
                      {(lead.phone || lead.whatsapp) ? (
                        <>
                          <span className="text-sm text-gray-700 truncate max-w-[120px]">{lead.phone || lead.whatsapp}</span>
                          <a href={`tel:${lead.phone ?? lead.whatsapp}`} className="flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 flex-shrink-0">📞 Call</a>
                          {waNum && <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200 flex-shrink-0">💬 WA</a>}
                        </>
                      ) : <span className="text-xs text-gray-300">No phone</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Desktop table (≥ md) ─────────────────────────────────────────── */}
        <div className="hidden md:block">
          <table className="w-full text-xs border-collapse" style={{ minWidth: "1600px" }}>
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr className="bg-gray-50 border-b-2 border-gray-200">
                <th className="sticky left-0 z-20 bg-gray-50 w-8 px-2 py-2.5 text-center">
                  <input ref={headerCheckboxRef} type="checkbox" onChange={selectPage} className="w-3.5 h-3.5 accent-teal-600 cursor-pointer" title="Select page" />
                </th>
                <th className="w-8 px-2 py-2.5 text-[10px] font-semibold text-gray-300 text-center">#</th>
                <th className="sticky left-8 z-20 bg-gray-50 min-w-[160px] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">Name</th>
                {([
                  ["Job Title",     null,        "130px"],
                  ["Company",       "company",   "150px"],
                  ["Email",         null,        "175px"],
                  ["Phone / WA",    null,        "150px"],
                  ["Website",       null,        "130px"],
                  ["LinkedIn",      null,         "80px"],
                  ["Industry",      null,        "130px"],
                  ["Country",       "country",   "100px"],
                  ["Co. Size",      null,         "90px"],
                  ["Source",        null,        "120px"],
                  ["Intent",        null,        "160px"],
                  ["Tags",          null,        "120px"],
                  ["Status",        null,        "100px"],
                  ["Added",         "createdAt", "105px"],
                ] as [string, string | null, string][]).map(([label, col, w]) => (
                  <th key={label} style={{ minWidth: w }} className={cn("px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap", col && "cursor-pointer hover:text-gray-700")} onClick={col ? () => handleSort(col as SortCol) : undefined}>
                    {col ? <span className="flex items-center gap-1">{label} <SortIcon col={col as SortCol} /></span> : label}
                  </th>
                ))}
                <th className="w-16 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td colSpan={18} className="px-3 py-3"><div className="h-4 rounded bg-gray-100 animate-pulse" style={{ width: `${55 + i * 3}%` }} /></td>
                  </tr>
                ))
              ) : pagedLeads.length === 0 ? (
                <tr>
                  <td colSpan={18} className="text-center py-16">
                    <Database className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <div className="text-sm font-medium text-gray-400">No leads match your filters</div>
                    <div className="text-xs text-gray-300 mt-1">Try adjusting your search or filters</div>
                  </td>
                </tr>
              ) : pagedLeads.map((lead, idx) => {
                const isImported = !!lead.importedToLeadsAt;
                const waNum      = ((lead.whatsapp || lead.phone) ?? "").replace(/[^0-9]/g, "");
                const rowNum     = (page - 1) * PAGE_SIZE + idx + 1;
                const phoneDisplay = [lead.phone, lead.whatsapp].filter(Boolean).join(" / ") || null;
                return (
                  <tr key={lead.id} className="border-b border-gray-100/80 hover:bg-teal-50/30 transition-all" style={{ opacity: isImported ? 0.75 : 1 }}>
                    {/* Checkbox */}
                    <td className="sticky left-0 z-10 w-8 px-2 py-2 bg-white" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggleSelect(lead.id)} className="w-3.5 h-3.5 accent-teal-600" />
                    </td>
                    {/* Row # */}
                    <td className="w-8 px-2 py-2 text-center text-[10px] text-gray-300 font-mono">{rowNum}</td>
                    {/* Name */}
                    <td className="sticky left-8 z-10 px-3 py-2 bg-white" style={{ minWidth: "160px" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ background: "linear-gradient(135deg,#0F766E,#0369A1)" }}>
                          {lead.firstName?.[0]}{lead.lastName?.[0]}
                        </div>
                        <span className="font-semibold text-gray-800 truncate text-[12px]">{lead.firstName} {lead.lastName}</span>
                      </div>
                    </td>
                    {/* Designation */}
                    <td className="px-3 py-2 text-gray-500 truncate" style={{ maxWidth: "130px" }}>{lead.designation || <span className="text-gray-300">—</span>}</td>
                    {/* Company */}
                    <td className="px-3 py-2" style={{ maxWidth: "150px" }}>
                      <span className="text-gray-700 font-medium truncate block">{lead.company || <span className="text-gray-300">—</span>}</span>
                    </td>
                    {/* Email */}
                    <td className="px-3 py-2" style={{ maxWidth: "175px" }}>
                      {lead.email
                        ? <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline truncate block text-[11px]" onClick={e => e.stopPropagation()}>{lead.email}</a>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    {/* Phone / WA */}
                    <td className="px-3 py-2" style={{ maxWidth: "150px" }} onClick={e => e.stopPropagation()}>
                      {phoneDisplay ? (
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500 truncate text-[11px]" style={{ maxWidth: "80px" }}>{phoneDisplay}</span>
                          <a href={`tel:${lead.phone ?? lead.whatsapp}`} className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-blue-100" title="Call"><Phone className="w-3 h-3 text-blue-500" /></a>
                          {waNum && <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-green-100" title="WhatsApp"><MessageCircle className="w-3 h-3 text-green-600" /></a>}
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    {/* Website */}
                    <td className="px-3 py-2 text-[11px]" style={{ maxWidth: "130px" }} onClick={e => e.stopPropagation()}>
                      {lead.website
                        ? <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate block" title={lead.website}>{lead.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</a>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    {/* LinkedIn */}
                    <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                      {lead.linkedInUrl
                        ? <a href={lead.linkedInUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-blue-50" title="LinkedIn"><Link2 className="w-3.5 h-3.5 text-blue-600" /></a>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    {/* Industry */}
                    <td className="px-3 py-2 text-gray-500 truncate text-[11px]" style={{ maxWidth: "130px" }}>{lead.industry || <span className="text-gray-300">—</span>}</td>
                    {/* Country */}
                    <td className="px-3 py-2 text-gray-500 truncate text-[11px]" style={{ maxWidth: "100px" }}>{lead.country || <span className="text-gray-300">—</span>}</td>
                    {/* Company size */}
                    <td className="px-3 py-2 text-gray-400 text-[11px] text-center">{lead.companySize || <span className="text-gray-300">—</span>}</td>
                    {/* Source */}
                    <td className="px-3 py-2"><SourceBadge source={lead.source} /></td>
                    {/* Intent keywords */}
                    <td className="px-3 py-2" style={{ maxWidth: "160px" }}>
                      <div className="flex flex-wrap gap-0.5">
                        {(lead.intentKeywords ?? []).slice(0, 3).map(k => (
                          <span key={k} className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium whitespace-nowrap" style={{ background: "#F3F0FF", color: "#6D28D9" }}>{k}</span>
                        ))}
                        {!(lead.intentKeywords ?? []).length && <span className="text-gray-300 text-[11px]">—</span>}
                      </div>
                    </td>
                    {/* Tags */}
                    <td className="px-3 py-2" style={{ maxWidth: "120px" }}>
                      <div className="flex flex-wrap gap-0.5">
                        {(lead.tags ?? []).slice(0, 2).map(tag => (
                          <span key={tag} className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium whitespace-nowrap bg-gray-100 text-gray-600">{tag}</span>
                        ))}
                        {!(lead.tags ?? []).length && <span className="text-gray-300 text-[11px]">—</span>}
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-3 py-2">
                      {isImported
                        ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700"><CheckCircle2 className="w-2.5 h-2.5" /> Imported</span>
                        : <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "#CCFBF1", color: "#0F766E" }}><Zap className="w-2.5 h-2.5" /> Fresh</span>}
                    </td>
                    {/* Added date */}
                    <td className="px-3 py-2 text-gray-400 text-[11px] whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                    {/* Actions */}
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {lead.website && (
                          <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" title="Visit website"><ExternalLink className="w-3.5 h-3.5 text-gray-300 hover:text-gray-700" /></a>
                        )}
                        <button onClick={() => deleteFromBank([lead.id])} title="Delete from bank"><Trash2 className="w-3.5 h-3.5 text-gray-300 hover:text-red-500" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination footer ────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 md:px-5 py-2 border-t border-gray-200 bg-white text-[11px] text-gray-500">
        <span>
          {filteredLeads.length === 0 ? "No results" : `${((page - 1) * PAGE_SIZE) + 1}–${Math.min(page * PAGE_SIZE, filteredLeads.length)} of ${filteredLeads.length.toLocaleString()} leads`}
        </span>
        <div className="flex items-center gap-1">
          <button disabled={page <= 1}          onClick={() => setPage(1)}          className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">«</button>
          <button disabled={page <= 1}          onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹</button>
          {(() => {
            const win   = Math.min(5, totalPages);
            let   start = Math.max(1, page - Math.floor(win / 2));
            const end   = Math.min(totalPages, start + win - 1);
            start       = Math.max(1, end - win + 1);
            return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
              <button key={p} onClick={() => setPage(p)} className={cn("w-7 h-7 rounded border text-[11px] font-medium", p === page ? "border-teal-400 bg-teal-50 text-teal-700" : "border-gray-200 hover:bg-gray-50 text-gray-600")}>{p}</button>
            ));
          })()}
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">›</button>
          <button disabled={page >= totalPages} onClick={() => setPage(totalPages)}  className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">»</button>
        </div>
        <span className="hidden md:inline text-gray-400">{PAGE_SIZE} / page · {totalPages} pages total</span>
      </div>

      {/* ── Export modal ─────────────────────────────────────────────────────── */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowExportModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-80 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900">Export Lead Bank</h3>
              <button onClick={() => setShowExportModal(false)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">File name</label>
                <input value={exportFilename} onChange={e => setExportFilename(e.target.value)} className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Format</label>
                <div className="flex gap-2">
                  {(["csv", "xlsx"] as const).map(f => (
                    <button key={f} onClick={() => setExportFormat(f)} className={cn("flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors uppercase", exportFormat === f ? "border-teal-500 bg-teal-50 text-teal-700" : "border-gray-200 text-gray-600 hover:bg-gray-50")}>{f}</button>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-gray-400 bg-gray-50 rounded-lg p-2">
                Exporting <strong>{selected.length > 0 ? selected.length : filteredLeads.length}</strong> lead{(selected.length > 0 ? selected.length : filteredLeads.length) !== 1 ? "s" : ""}
                {selected.length > 0 ? " (selected)" : " (all filtered)"}
              </div>
              <button onClick={() => doExport(exportFormat, exportFilename)} className="w-full py-2 text-xs font-bold text-white rounded-lg" style={{ background: "#0F766E" }}>
                <Download className="w-3.5 h-3.5 inline mr-1" /> Download {exportFormat.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/utils";
import { useIsAdmin } from "@/contexts/AuthContext";
import {
  Database, Search, Download, Globe, Building2, Users, Zap,
  FileSpreadsheet, UserPlus, MapPin, RefreshCw, Loader2,
  Upload, X, CheckCircle2, Lock,
} from "lucide-react";

const BASE = "/api";

const SOURCE_META: Record<string, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  manual:       { label: "Manual",       color: "#1A3D2B", bg: "#E6F4EC", Icon: UserPlus },
  csv_import:   { label: "CSV Import",   color: "#0369A1", bg: "#E0F2FE", Icon: FileSpreadsheet },
  paste_import: { label: "AI Parse",     color: "#7C3AED", bg: "#F3E8FF", Icon: Zap },
  google_maps:  { label: "Google Maps",  color: "#DC2626", bg: "#FEE2E2", Icon: MapPin },
  apify:        { label: "Apify",        color: "#EA580C", bg: "#FFEDD5", Icon: RefreshCw },
  apollo:       { label: "Apollo.io",    color: "#0891B2", bg: "#CFFAFE", Icon: Globe },
  ai_generated: { label: "AI Generated", color: "#7C3AED", bg: "#F3E8FF", Icon: Zap },
  lead_bank:    { label: "Lead Bank",    color: "#0F766E", bg: "#CCFBF1", Icon: Database },
};
const defaultMeta = { label: "Other", color: "#6B7280", bg: "#F3F4F6", Icon: Database };

function SourceBadge({ source }: { source: string }) {
  const m = SOURCE_META[source] ?? defaultMeta;
  const { Icon } = m;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap" style={{ background: m.bg, color: m.color }}>
      <Icon className="w-2.5 h-2.5" />
      {m.label}
    </span>
  );
}

const ALL_SOURCES = ["all", "manual", "google_maps", "apollo", "csv_import", "paste_import", "apify", "ai_generated"];
const PAGE_SIZE = 50;

type BankLead = {
  id: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  company: string;
  designation: string;
  industry: string;
  city?: string | null;
  country: string;
  companySize?: string | null;
  source: string;
  intentKeywords?: string[] | null;
  importedToLeadsAt?: string | null;
  createdAt: string;
};

type BankStats = {
  total: number;
  imported: number;
  fresh: number;
  sources: Record<string, number>;
};

export default function LeadBank() {
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [source, setSource] = useState("all");
  const [filterIntent, setFilterIntent] = useState("");
  const [onlyFresh, setOnlyFresh] = useState(false);
  const [page, setPage] = useState(1);
  const [allLeads, setAllLeads] = useState<BankLead[]>([]);

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams();
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (source !== "all") params.set("source", source);
  if (onlyFresh) params.set("onlyFresh", "true");
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));

  const { data, isLoading, isFetching } = useQuery<{ leads: BankLead[]; total: number; totalPages: number }>({
    queryKey: ["lead-bank", debouncedSearch, source, onlyFresh, page],
    queryFn: () => fetch(`${BASE}/lead-bank?${params.toString()}`).then(r => r.json()),
    enabled: isAdmin,
  });

  const { data: statsData } = useQuery<BankStats>({
    queryKey: ["lead-bank-stats"],
    queryFn: () => fetch(`${BASE}/lead-bank/stats`).then(r => r.json()),
    refetchInterval: 30000,
    enabled: isAdmin,
  });

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const hasMore = page < totalPages;

  useEffect(() => {
    setAllLeads([]);
    setPage(1);
  }, [debouncedSearch, source, onlyFresh, filterIntent]);

  useEffect(() => {
    if (data?.leads == null) return;
    const incoming = data.leads;
    if (page === 1) {
      setAllLeads(incoming);
    } else {
      setAllLeads((prev) => {
        const existingIds = new Set(prev.map(l => l.id));
        return [...prev, ...incoming.filter(l => !existingIds.has(l.id))];
      });
    }
  }, [data, page]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;
      observerRef.current = new IntersectionObserver(
        (entries) => { if (entries[0].isIntersecting && hasMore && !isFetching) setPage(p => p + 1); },
        { threshold: 0.1 }
      );
      observerRef.current.observe(node);
    },
    [hasMore, isFetching]
  );

  const filteredLeads = filterIntent
    ? allLeads.filter(l => (l.intentKeywords ?? []).some(k => k.toLowerCase().includes(filterIntent.toLowerCase())))
    : allLeads;

  const handleExport = () => {
    const headers = ["ID", "First", "Last", "Email", "Company", "Designation", "Industry", "Country", "Source", "Imported", "Date Added"];
    const csv = [
      headers.join(","),
      ...filteredLeads.map(l => [
        l.id, l.firstName, l.lastName, l.email ?? "", l.company,
        l.designation, l.industry, l.country, l.source,
        l.importedToLeadsAt ? "Yes" : "No",
        l.createdAt ? new Date(l.createdAt).toISOString().split("T")[0] : "",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `lead-bank-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkImport = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const lines = importText.trim().split("\n").map(l => l.trim()).filter(Boolean);
      const records = lines.map(line => {
        const parts = line.split(/[,\t|]+/).map(p => p.trim());
        return {
          firstName: parts[0] ?? "",
          lastName: parts[1] ?? "",
          email: parts[2] ?? undefined,
          company: parts[3] ?? "",
          designation: parts[4] ?? "",
          industry: parts[5] ?? "",
          country: parts[6] ?? "",
          source: "paste_import",
        };
      });
      const r = await fetch(`${BASE}/lead-bank/bulk-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  const inputCls = "text-xs rounded-lg border border-gray-200 bg-white text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-colors";

  // Non-admin: show locked state
  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "#F3F4F6" }}>
          <Lock className="w-7 h-7 text-gray-400" />
        </div>
        <div className="text-center">
          <h2 className="text-base font-bold text-gray-900 mb-1">Admin Access Only</h2>
          <p className="text-sm text-gray-500">The Lead Bank is a private feature reserved for platform administrators.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "#0F766E" }}>
            <Database className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-gray-900">Lead Bank</h1>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: "#CCFBF1", color: "#0F766E" }}>Admin Only</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Private master database — Apollo-like lead repository for Dreamsdesign</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(p => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
            style={showImport ? { background: "#0F766E", color: "#fff", borderColor: "#0F766E" } : { background: "#fff", color: "#374151", borderColor: "#E5E7EB" }}
          >
            <Upload className="w-3.5 h-3.5" />
            Import to Bank
          </button>
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Import panel */}
      {showImport && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-teal-900">Bulk Import to Lead Bank</div>
              <div className="text-[11px] text-teal-600 mt-0.5">
                Paste one lead per line: <code className="bg-teal-100 px-1 rounded">FirstName, LastName, Email, Company, Designation, Industry, Country</code>
              </div>
            </div>
            <button onClick={() => { setShowImport(false); setImportResult(null); }}>
              <X className="w-4 h-4 text-teal-600" />
            </button>
          </div>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={6}
            placeholder={"John, Doe, john@company.com, Acme Corp, CEO, SaaS, USA\nJane, Smith, jane@firm.com, Firm Ltd, CTO, FinTech, UK"}
            className="w-full px-3 py-2.5 text-xs rounded-lg border border-teal-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-400 font-mono resize-none"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleBulkImport}
              disabled={importing || !importText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white transition-colors disabled:opacity-50"
              style={{ background: "#0F766E" }}
            >
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {importing ? "Importing…" : "Import Now"}
            </button>
            {importResult && (
              <div className="flex items-center gap-1.5 text-xs text-teal-800">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                <span><strong>{importResult.inserted}</strong> added · <strong>{importResult.skipped}</strong> skipped (duplicates)</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {[
          { label: "Total in Bank", value: statsData?.total ?? 0, icon: <Users className="w-4 h-4 text-white" />, bg: "#0F766E" },
          { label: "Fresh (not fetched)", value: statsData?.fresh ?? 0, icon: <Zap className="w-4 h-4 text-white" />, bg: "#1A3D2B" },
          { label: "Imported to Leads", value: statsData?.imported ?? 0, icon: <CheckCircle2 className="w-4 h-4 text-white" />, bg: "#7C3AED" },
        ].map(({ label, value, icon, bg }) => (
          <div key={label} className="col-span-1 rounded-xl border border-gray-200 bg-white shadow-sm px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
              {icon}
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{value.toLocaleString()}</div>
              <div className="text-[11px] text-gray-500">{label}</div>
            </div>
          </div>
        ))}
        {["manual", "google_maps", "apollo", "csv_import"].map(src => {
          const m = SOURCE_META[src] ?? defaultMeta;
          const { Icon } = m;
          const count = statsData?.sources?.[src] ?? 0;
          return (
            <button
              key={src}
              onClick={() => setSource(source === src ? "all" : src)}
              className="rounded-xl border bg-white shadow-sm px-3 py-3 text-left transition-all hover:shadow-md"
              style={{ borderColor: source === src ? m.color : "#E5E7EB" }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3.5 h-3.5" style={{ color: m.color }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: m.color }}>{m.label}</span>
              </div>
              <div className="text-lg font-bold text-gray-900">{count.toLocaleString()}</div>
              <div className="text-[10px] text-gray-400">{(statsData?.total ?? 0) > 0 ? Math.round((count / (statsData?.total ?? 1)) * 100) : 0}% of total</div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex items-center flex-1 min-w-[220px]">
          {isFetching && search ? (
            <Loader2 className="absolute left-2.5 w-3.5 h-3.5 text-indigo-500 animate-spin pointer-events-none" />
          ) : (
            <Search className="absolute left-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          )}
          <input
            type="text"
            placeholder="Search name, company, email, phone, city…"
            className={inputCls + " w-full pl-8 pr-7"}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select className={inputCls} value={source} onChange={e => setSource(e.target.value)}>
          {ALL_SOURCES.map(s => (
            <option key={s} value={s}>{s === "all" ? "All Sources" : (SOURCE_META[s]?.label ?? s)}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filter by intent…"
          className={inputCls + " w-40"}
          value={filterIntent}
          onChange={e => setFilterIntent(e.target.value)}
        />

        <button
          onClick={() => setOnlyFresh(p => !p)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors"
          style={onlyFresh ? { background: "#0F766E", color: "#fff", borderColor: "#0F766E" } : { background: "#fff", color: "#374151", borderColor: "#E5E7EB" }}
        >
          <Zap className="w-3 h-3" />
          Fresh only
        </button>

        {(source !== "all" || search || filterIntent || onlyFresh) && (
          <button
            onClick={() => { setSource("all"); setSearch(""); setFilterIntent(""); setOnlyFresh(false); }}
            className="px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors border border-gray-200"
          >
            Clear
          </button>
        )}

        <span className="ml-auto text-xs text-gray-500 self-center">
          {filteredLeads.length.toLocaleString()} of {total.toLocaleString()} lead{total !== 1 ? "s" : ""}
          {(source !== "all" || search || filterIntent || onlyFresh) ? " (filtered)" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100" style={{ background: "#FAFAFA" }}>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-8">#</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Name / Company</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Source</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Industry</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Intent Keywords</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Location</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && allLeads.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-gray-400 text-sm">Loading Lead Bank…</td></tr>
              )}
              {!isLoading && filteredLeads.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <Database className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <div className="text-sm font-medium text-gray-400">No leads in bank</div>
                    <div className="text-xs text-gray-300 mt-1">Import leads using the button above to populate the Lead Bank</div>
                  </td>
                </tr>
              )}
              {filteredLeads.map((lead, idx) => {
                const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—";
                const initials = [lead.firstName?.[0], lead.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?";
                const isImported = !!lead.importedToLeadsAt;
                return (
                  <tr key={lead.id} className="hover:bg-gray-50/70 transition-colors" style={{ opacity: isImported ? 0.65 : 1 }}>
                    <td className="px-4 py-2.5 text-gray-300 font-mono text-[10px]">{idx + 1}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: "#0F766E" }}>
                          {initials}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900 text-[12px]">{fullName}</div>
                          <div className="text-[11px] text-gray-400 flex items-center gap-1">
                            {lead.company && (<><Building2 className="w-2.5 h-2.5 flex-shrink-0" /><span className="truncate max-w-[150px]">{lead.company}</span></>)}
                            {lead.designation && lead.company && <span>·</span>}
                            {lead.designation && <span className="truncate max-w-[120px]">{lead.designation}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-[180px]">
                      <span className="truncate block">{lead.email ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5"><SourceBadge source={lead.source} /></td>
                    <td className="px-4 py-2.5 text-gray-500 max-w-[130px]">
                      <span className="truncate block">{lead.industry || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 max-w-[180px]">
                      <div className="flex flex-wrap gap-1">
                        {(lead.intentKeywords ?? []).slice(0, 3).map(k => (
                          <span key={k} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap" style={{ background: "#F3F0FF", color: "#6D28D9" }}>{k}</span>
                        ))}
                        {!(lead.intentKeywords ?? []).length && <span className="text-gray-300 text-[11px]">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {lead.city || lead.country ? [lead.city, lead.country].filter(Boolean).join(", ") : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {isImported ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "#F0FDF4", color: "#166534" }}>
                          <CheckCircle2 className="w-2.5 h-2.5" /> Imported
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "#CCFBF1", color: "#0F766E" }}>
                          <Zap className="w-2.5 h-2.5" /> Fresh
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">
                      {lead.createdAt ? formatDate(lead.createdAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div ref={sentinelCallback} className="h-1" />

        {isFetching && allLeads.length > 0 && (
          <div className="px-4 py-4 flex items-center justify-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading more leads…
          </div>
        )}

        {!hasMore && filteredLeads.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 text-center text-[11px] text-gray-400">
            All {filteredLeads.length.toLocaleString()} leads shown
          </div>
        )}
      </div>
    </div>
  );
}

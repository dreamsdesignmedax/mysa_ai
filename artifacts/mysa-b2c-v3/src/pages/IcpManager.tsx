import { useState } from "react";
import {
  useListIcps, useCreateIcp, useDeleteIcp, useUpdateIcp,
  useGenerateIcpSuggestions, getListIcpsQueryKey,
} from "@workspace/api-client-react";
import type { IcpSuggestion } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Edit2, Users, Globe, Briefcase, DollarSign,
  Monitor, CheckSquare, X, Power, Sparkles, Loader2,
} from "lucide-react";

function TargetIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

type QualFilters = {
  adSpendMin: string;
  adSpendMax: string;
  hasWebsite: boolean;
  hasLinkedIn: boolean;
  hasGMB: boolean;
  hiringMarketers: boolean;
  minBantScore: string;
  requiresAudit: boolean;
};

const DEFAULT_FILTERS: QualFilters = {
  adSpendMin: "",
  adSpendMax: "",
  hasWebsite: false,
  hasLinkedIn: false,
  hasGMB: false,
  hiringMarketers: false,
  minBantScore: "",
  requiresAudit: false,
};

function filtersToQualFilters(f: Record<string, unknown>): QualFilters {
  return {
    adSpendMin: f.adSpendMin != null ? String(f.adSpendMin) : "",
    adSpendMax: f.adSpendMax != null ? String(f.adSpendMax) : "",
    hasWebsite: Boolean(f.hasWebsite),
    hasLinkedIn: Boolean(f.hasLinkedIn),
    hasGMB: Boolean(f.hasGMB),
    hiringMarketers: Boolean(f.hiringMarketers),
    minBantScore: f.minBantScore != null ? String(f.minBantScore) : "",
    requiresAudit: Boolean(f.requiresAudit),
  };
}

function qualFiltersToRecord(qualFilters: QualFilters): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  if (qualFilters.adSpendMin) filters.adSpendMin = Number(qualFilters.adSpendMin);
  if (qualFilters.adSpendMax) filters.adSpendMax = Number(qualFilters.adSpendMax);
  if (qualFilters.hasWebsite) filters.hasWebsite = true;
  if (qualFilters.hasLinkedIn) filters.hasLinkedIn = true;
  if (qualFilters.hasGMB) filters.hasGMB = true;
  if (qualFilters.hiringMarketers) filters.hiringMarketers = true;
  if (qualFilters.minBantScore) filters.minBantScore = Number(qualFilters.minBantScore);
  if (qualFilters.requiresAudit) filters.requiresAudit = true;
  return filters;
}

function FiltersDisplay({ filters }: { filters: Record<string, unknown> }) {
  if (!filters || Object.keys(filters).length === 0) return null;
  const pills: string[] = [];
  if (filters.adSpendMin || filters.adSpendMax) {
    const min = filters.adSpendMin ? `$${filters.adSpendMin}` : "$0";
    const max = filters.adSpendMax ? `$${filters.adSpendMax}` : "∞";
    pills.push(`Ad Spend: ${min}–${max}/mo`);
  }
  if (filters.hasWebsite) pills.push("Has Website");
  if (filters.hasLinkedIn) pills.push("LinkedIn Active");
  if (filters.hasGMB) pills.push("GMB Listed");
  if (filters.hiringMarketers) pills.push("Hiring Marketers");
  if (filters.minBantScore) pills.push(`BANT ≥ ${filters.minBantScore}`);
  if (filters.requiresAudit) pills.push("Audit Required");
  if (pills.length === 0) return null;
  return (
    <div className="mt-2.5 pt-2.5 border-t border-gray-200">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Qualification Filters</div>
      <div className="flex flex-wrap gap-1">
        {pills.map((p) => (
          <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-500/20">{p}</span>
        ))}
      </div>
    </div>
  );
}

function IcpFormFields({
  form,
  setForm,
  qualFilters,
  setQualFilters,
}: {
  form: { name: string; markets: string; industries: string; roles: string; companySize: string };
  setForm: React.Dispatch<React.SetStateAction<typeof form>>;
  qualFilters: QualFilters;
  setQualFilters: React.Dispatch<React.SetStateAction<QualFilters>>;
}) {
  const toggle = (key: keyof QualFilters) => setQualFilters((f) => ({ ...f, [key]: !f[key] }));
  return (
    <>
      <div className="space-y-3">
        {([
          ["name", "ICP Name *", "e.g. Healthcare SMB UAE"],
          ["markets", "Target Markets (comma-separated)", "UAE, Saudi Arabia, Qatar"],
          ["industries", "Industries (comma-separated)", "Healthcare, Medical, Wellness"],
          ["roles", "Target Roles (comma-separated)", "CMO, Marketing Director, Founder"],
          ["companySize", "Company Size Range", "11-200 employees"],
        ] as [keyof typeof form, string, string][]).map(([key, label, placeholder]) => (
          <div key={key}>
            <label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
            <input
              required={key === "name"}
              placeholder={placeholder}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full px-2.5 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400/50 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
            />
          </div>
        ))}
      </div>

      <div className="rounded border border-amber-500/20 bg-amber-50 p-3 space-y-3">
        <div className="flex items-center gap-1.5 text-[11px] text-amber-600 font-semibold uppercase tracking-wider">
          <CheckSquare className="w-3.5 h-3.5" /> Qualification Filters
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
            <DollarSign className="w-3 h-3" /> Monthly Ad Spend Range (USD)
          </div>
          <div className="flex items-center gap-2">
            <input type="number" placeholder="Min" value={qualFilters.adSpendMin}
              onChange={(e) => setQualFilters((f) => ({ ...f, adSpendMin: e.target.value }))}
              className="flex-1 px-2.5 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
            <span className="text-muted-foreground text-xs">–</span>
            <input type="number" placeholder="Max" value={qualFilters.adSpendMax}
              onChange={(e) => setQualFilters((f) => ({ ...f, adSpendMax: e.target.value }))}
              className="flex-1 px-2.5 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
            <Monitor className="w-3 h-3" /> Minimum BANT Score
          </div>
          <input type="number" min="0" max="100" placeholder="e.g. 45 (leave blank for any)"
            value={qualFilters.minBantScore}
            onChange={(e) => setQualFilters((f) => ({ ...f, minBantScore: e.target.value }))}
            className="w-full px-2.5 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1.5">Required Signals</div>
          <div className="grid grid-cols-2 gap-2">
            {([
              ["hasWebsite", "Has Active Website"],
              ["hasLinkedIn", "LinkedIn Page Active"],
              ["hasGMB", "Google My Business Listed"],
              ["hiringMarketers", "Currently Hiring Marketers"],
              ["requiresAudit", "Must Have Brand Audit"],
            ] as [keyof QualFilters, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer group">
                <div
                  onClick={() => toggle(key)}
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${qualFilters[key] ? "bg-amber-500 border-amber-500" : "border-gray-200 bg-gray-50"}`}
                >
                  {qualFilters[key] && <CheckSquare className="w-3 h-3 text-white" />}
                </div>
                <span className="text-[11px] text-muted-foreground group-hover:text-gray-900">{label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function SuggestionCard({
  suggestion,
  index,
  selected,
  onToggle,
}: {
  suggestion: IcpSuggestion;
  index: number;
  selected: boolean;
  onToggle: (i: number) => void;
}) {
  const filters = (suggestion.filters ?? {}) as Record<string, unknown>;
  return (
    <div
      onClick={() => onToggle(index)}
      className={`rounded-lg border p-3 cursor-pointer transition-all ${selected ? "border-teal-400 bg-teal-50/60 ring-1 ring-teal-400/40" : "border-gray-200 bg-white hover:border-teal-200"}`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${selected ? "bg-teal-500 border-teal-500" : "border-gray-300 bg-white"}`}>
          {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" /></svg>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-gray-900 mb-1.5">{suggestion.name}</div>
          <div className="space-y-1.5">
            {suggestion.markets?.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <Globe className="w-3 h-3 text-blue-500 flex-shrink-0" />
                {suggestion.markets.map((m, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">{m}</span>
                ))}
              </div>
            )}
            {suggestion.industries?.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <Briefcase className="w-3 h-3 text-purple-500 flex-shrink-0" />
                {suggestion.industries.map((ind, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">{ind}</span>
                ))}
              </div>
            )}
            {suggestion.roles?.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <Users className="w-3 h-3 text-teal-500 flex-shrink-0" />
                {suggestion.roles.map((r, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">{r}</span>
                ))}
              </div>
            )}
            {suggestion.companySize && (
              <div className="text-[10px] text-muted-foreground">Company: {suggestion.companySize}</div>
            )}
            {Object.keys(filters).length > 0 && (
              <FiltersDisplay filters={filters} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IcpManager() {
  const qc = useQueryClient();
  const { data: icps = [], isLoading } = useListIcps({ query: { queryKey: getListIcpsQueryKey() } });
  const createIcp = useCreateIcp({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListIcpsQueryKey() }); setShowCreate(false); resetForm(); } } });
  const deleteIcp = useDeleteIcp({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListIcpsQueryKey() }) } });
  const updateIcp = useUpdateIcp({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListIcpsQueryKey() }); setEditingIcpId(null); } } });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", markets: "", industries: "", roles: "", companySize: "" });
  const [qualFilters, setQualFilters] = useState<QualFilters>(DEFAULT_FILTERS);

  const [editingIcpId, setEditingIcpId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", markets: "", industries: "", roles: "", companySize: "" });
  const [editQualFilters, setEditQualFilters] = useState<QualFilters>(DEFAULT_FILTERS);
  const [editActive, setEditActive] = useState(true);

  // ── Find ICP state ───────────────────────────────────────────────────────────
  const [showFindIcp, setShowFindIcp] = useState(false);
  const [findStep, setFindStep] = useState<"input" | "results">("input");
  const [findWebsite, setFindWebsite] = useState("");
  const [findDescription, setFindDescription] = useState("");
  const [suggestions, setSuggestions] = useState<IcpSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const generateMutation = useGenerateIcpSuggestions();
  const importIcp = useCreateIcp();

  const editingIcp = icps.find((i) => i.id === editingIcpId) ?? null;

  const resetForm = () => {
    setForm({ name: "", markets: "", industries: "", roles: "", companySize: "" });
    setQualFilters(DEFAULT_FILTERS);
  };

  const resetFindIcp = () => {
    setFindStep("input");
    setFindWebsite("");
    setFindDescription("");
    setSuggestions([]);
    setSelected(new Set());
    setImporting(false);
    setImportError(null);
    generateMutation.reset();
  };

  const closeFindIcp = () => {
    setShowFindIcp(false);
    resetFindIcp();
  };

  const openEdit = (icp: typeof icps[0]) => {
    setEditingIcpId(icp.id);
    setEditForm({
      name: icp.name ?? "",
      markets: (icp.markets ?? []).join(", "),
      industries: (icp.industries ?? []).join(", "),
      roles: (icp.roles ?? []).join(", "),
      companySize: icp.companySize ?? "",
    });
    setEditQualFilters(filtersToQualFilters((icp.filters as Record<string, unknown>) ?? {}));
    setEditActive(icp.active ?? true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createIcp.mutate({
      data: {
        name: form.name,
        markets: form.markets.split(",").map((s) => s.trim()).filter(Boolean),
        industries: form.industries.split(",").map((s) => s.trim()).filter(Boolean),
        roles: form.roles.split(",").map((s) => s.trim()).filter(Boolean),
        companySize: form.companySize,
        filters: qualFiltersToRecord(qualFilters),
        active: true,
      },
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIcpId) return;
    updateIcp.mutate({
      id: editingIcpId,
      data: {
        name: editForm.name,
        markets: editForm.markets.split(",").map((s) => s.trim()).filter(Boolean),
        industries: editForm.industries.split(",").map((s) => s.trim()).filter(Boolean),
        roles: editForm.roles.split(",").map((s) => s.trim()).filter(Boolean),
        companySize: editForm.companySize,
        filters: qualFiltersToRecord(editQualFilters),
        active: editActive,
      },
    });
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    generateMutation.mutate(
      { data: { website: findWebsite, description: findDescription } },
      {
        onSuccess: (data) => {
          setSuggestions(data);
          setSelected(new Set(data.map((_, i) => i)));
          setFindStep("results");
        },
      }
    );
  };

  const toggleSuggestion = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleImport = async () => {
    const toImport = suggestions.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      for (const s of toImport) {
        await importIcp.mutateAsync({
          data: {
            name: s.name,
            markets: s.markets ?? [],
            industries: s.industries ?? [],
            roles: s.roles ?? [],
            companySize: s.companySize ?? "",
            filters: (s.filters ?? {}) as Record<string, unknown>,
            active: true,
          },
        });
      }
      await qc.invalidateQueries({ queryKey: getListIcpsQueryKey() });
      closeFindIcp();
    } catch (err) {
      setImportError(`Import failed: ${String(err)}`);
      setImporting(false);
    }
  };

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">ICP Manager</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Define your Ideal Customer Profiles to filter and score leads</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFindIcp(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Find ICP
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white" style={{ background: "#1A7A45" }}>
            <Plus className="w-3.5 h-3.5" /> New ICP
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4 animate-pulse bg-white shadow-sm" style={{ height: "180px" }} />
          ))}
        </div>
      ) : icps.length === 0 ? (
        <div className="rounded-xl border border-gray-200 p-12 text-center bg-white shadow-sm">
          <TargetIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <div className="text-sm text-muted-foreground">No ICPs defined yet</div>
          <div className="flex items-center justify-center gap-3 mt-3">
            <button onClick={() => setShowFindIcp(true)} className="text-xs text-purple-600 hover:text-purple-700 underline flex items-center gap-1"><Sparkles className="w-3 h-3" /> Find ICP with AI</button>
            <span className="text-muted-foreground text-xs">or</span>
            <button onClick={() => setShowCreate(true)} className="text-xs text-teal-600 hover:text-teal-700 underline">Create manually</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {icps.map((icp) => (
            <div key={icp.id} className="rounded-xl border border-gray-200 p-4 hover:border-teal-200 transition-colors bg-white shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{icp.name}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`w-2 h-2 rounded-full ${icp.active ? "bg-teal-400" : "bg-gray-400"}`} />
                    <span className="text-[11px] text-muted-foreground">{icp.active ? "Active" : "Inactive"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => openEdit(icp)}
                    title="Edit ICP"
                    className="p-1 text-muted-foreground hover:text-teal-700 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => updateIcp.mutate({ id: icp.id, data: { active: !icp.active } })}
                    title={icp.active ? "Deactivate" : "Activate"}
                    className={`p-1 transition-colors ${icp.active ? "text-teal-600 hover:text-gray-400" : "text-gray-400 hover:text-teal-600"}`}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { if (confirm("Delete this ICP?")) deleteIcp.mutate({ id: icp.id }); }} className="p-1 text-muted-foreground hover:text-red-600 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                {icp.markets?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                      <Globe className="w-3 h-3" /> Markets
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {icp.markets.map((m, mi) => (
                        <span key={`${mi}-${m}`} className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 border border-blue-500/20">{m}</span>
                      ))}
                    </div>
                  </div>
                )}
                {icp.industries?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                      <Briefcase className="w-3 h-3" /> Industries
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {icp.industries.map((ind, ii) => (
                        <span key={`${ii}-${ind}`} className="text-[11px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-700 border border-purple-500/20">{ind}</span>
                      ))}
                    </div>
                  </div>
                )}
                {icp.roles?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                      <Users className="w-3 h-3" /> Target Roles
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {icp.roles.map((r, ri) => (
                        <span key={`${ri}-${r}`} className="text-[11px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">{r}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Company Size</span>
                <span className="text-foreground">{icp.companySize || "—"}</span>
              </div>

              <FiltersDisplay filters={(icp.filters as Record<string, unknown>) ?? {}} />

              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Matched Leads</span>
                <span className="font-bold" style={{ color: "#1A7A45" }}>{icp.leadCount}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Find ICP Modal ──────────────────────────────────────────────────── */}
      {showFindIcp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-6" onClick={closeFindIcp}>
          <div className="rounded-xl border border-gray-200 w-full max-w-2xl bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-gray-900">Find ICP with AI</h2>
                  <p className="text-[11px] text-muted-foreground">Describe your business and get 10 tailored ICP suggestions</p>
                </div>
              </div>
              <button onClick={closeFindIcp} className="text-muted-foreground hover:text-gray-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {findStep === "input" ? (
              <form onSubmit={handleGenerate} className="p-6 space-y-4">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Your Website URL <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="url"
                    placeholder="https://yourcompany.com"
                    value={findWebsite}
                    onChange={(e) => setFindWebsite(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-400/60 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">What do you do? What are your products or services? <span className="text-red-500">*</span></label>
                  <textarea
                    required
                    rows={5}
                    placeholder="e.g. We are a digital marketing agency specializing in performance marketing, SEO, and social media management for e-commerce brands in the MENA region. Our key services are paid ads (Meta, Google), influencer marketing, and conversion rate optimization..."
                    value={findDescription}
                    onChange={(e) => setFindDescription(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-400/60 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 resize-none"
                  />
                </div>
                {generateMutation.isError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {String((generateMutation.error as Error)?.message ?? "Generation failed")}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={closeFindIcp} className="flex-1 px-3 py-2 rounded-lg text-xs text-muted-foreground bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={generateMutation.isPending || !findDescription.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs text-white font-medium transition-colors disabled:opacity-60"
                    style={{ background: "#7C3AED" }}
                  >
                    {generateMutation.isPending ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing with AI…</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" /> Generate 10 ICPs</>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    AI found <span className="font-semibold text-gray-900">{suggestions.length}</span> ICPs · <span className="font-semibold text-purple-700">{selected.size} selected</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelected(new Set(suggestions.map((_, i) => i)))}
                      className="text-[11px] text-teal-600 hover:underline"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      className="text-[11px] text-muted-foreground hover:underline"
                    >
                      Deselect all
                    </button>
                    <button
                      type="button"
                      onClick={() => { setFindStep("input"); generateMutation.reset(); }}
                      className="text-[11px] text-purple-600 hover:underline"
                    >
                      ← Edit prompt
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {suggestions.map((s, i) => (
                    <SuggestionCard
                      key={i}
                      suggestion={s}
                      index={i}
                      selected={selected.has(i)}
                      onToggle={toggleSuggestion}
                    />
                  ))}
                </div>

                {importError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {importError}
                  </div>
                )}

                <div className="flex gap-2 pt-1 border-t border-gray-100">
                  <button type="button" onClick={closeFindIcp} className="flex-1 px-3 py-2 rounded-lg text-xs text-muted-foreground bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={selected.size === 0 || importing}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs text-white font-medium transition-colors disabled:opacity-60"
                    style={{ background: "#1A7A45" }}
                  >
                    {importing ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</>
                    ) : (
                      <><Plus className="w-3.5 h-3.5" /> Import {selected.size} ICP{selected.size !== 1 ? "s" : ""}</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create ICP Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-6" onClick={() => { setShowCreate(false); resetForm(); }}>
          <div className="rounded-xl border border-gray-200 p-6 w-full max-w-lg bg-white shadow-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-foreground">Create New ICP</h2>
              <button onClick={() => { setShowCreate(false); resetForm(); }} className="text-muted-foreground hover:text-gray-900">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <IcpFormFields form={form} setForm={setForm} qualFilters={qualFilters} setQualFilters={setQualFilters} />
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setShowCreate(false); resetForm(); }} className="flex-1 px-3 py-1.5 rounded text-xs text-muted-foreground bg-gray-50 border border-gray-200">Cancel</button>
                <button type="submit" disabled={createIcp.isPending} className="flex-1 px-3 py-1.5 rounded text-xs text-white font-medium" style={{ background: "#1A7A45" }}>
                  {createIcp.isPending ? "Creating..." : "Create ICP"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit ICP Modal */}
      {editingIcpId !== null && editingIcp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-6" onClick={() => setEditingIcpId(null)}>
          <div className="rounded-xl border border-gray-200 p-6 w-full max-w-lg bg-white shadow-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-foreground">Edit ICP — {editingIcp.name}</h2>
              <button onClick={() => setEditingIcpId(null)} className="text-muted-foreground hover:text-gray-900">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdate} className="space-y-4">
              <IcpFormFields form={editForm} setForm={setEditForm} qualFilters={editQualFilters} setQualFilters={setEditQualFilters} />

              {/* Active toggle */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <div
                  onClick={() => setEditActive((a) => !a)}
                  className={`w-10 h-5 rounded-full relative transition-colors ${editActive ? "bg-teal-500" : "bg-gray-300"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${editActive ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
                <span className="text-xs text-muted-foreground">{editActive ? "Active" : "Inactive"}</span>
              </label>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setEditingIcpId(null)} className="flex-1 px-3 py-1.5 rounded text-xs text-muted-foreground bg-gray-50 border border-gray-200">Cancel</button>
                <button type="submit" disabled={updateIcp.isPending} className="flex-1 px-3 py-1.5 rounded text-xs text-white font-medium" style={{ background: "#1A7A45" }}>
                  {updateIcp.isPending ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

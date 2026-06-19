import { useState } from "react";
import { useListIcps, useCreateIcp, useDeleteIcp, useUpdateIcp } from "@workspace/api-client-react";
import { getListIcpsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Edit2, Users, Globe, Briefcase, DollarSign, Monitor, CheckSquare, X, Power } from "lucide-react";

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

  const editingIcp = icps.find((i) => i.id === editingIcpId) ?? null;

  const resetForm = () => {
    setForm({ name: "", markets: "", industries: "", roles: "", companySize: "" });
    setQualFilters(DEFAULT_FILTERS);
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

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">ICP Manager</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Define your Ideal Customer Profiles to filter and score leads</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white" style={{ background: "#1A7A45" }}>
          <Plus className="w-3.5 h-3.5" /> New ICP
        </button>
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
          <button onClick={() => setShowCreate(true)} className="mt-3 text-xs text-teal-600 hover:text-teal-700 underline">Create your first ICP</button>
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

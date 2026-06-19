import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Users, Download, ArrowUpRight, Check,
  Loader2, RefreshCw, Zap,
} from "lucide-react";

const HUBSPOT_ORANGE = "#FF7A59";
const API_BASE = "/api";

// ─── helpers ────────────────────────────────────────────────────────────────

function hsFetch(path: string, opts?: RequestInit) {
  return fetch(`${API_BASE}/hubspot${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  }).then(async r => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "HubSpot error");
    return data;
  });
}

// ─── types ──────────────────────────────────────────────────────────────────

interface HsContact {
  id: string;
  properties: Record<string, string | null>;
}

interface Pipeline {
  id: string;
  label: string;
  stages: { id: string; label: string }[];
}

// ─── main page ──────────────────────────────────────────────────────────────

export default function HubSpot() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"contacts" | "push">("contacts");
  const [pushModal, setPushModal] = useState<{ leadId?: number; bulk?: number[] } | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: HUBSPOT_ORANGE }}>
            <img src="https://cdn.worldvectorlogo.com/logos/hubspot.svg" alt="HubSpot" className="w-6 h-6 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">HubSpot CRM</h1>
            <p className="text-sm text-gray-500">Import contacts · push hot leads as deals</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "#E8F5E9", color: "#1A3D2B" }}>
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Connected
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: "#F3F4F6" }}>
        {(["contacts", "push"] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className="px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={activeTab === t
              ? { background: "#fff", color: "#1A3D2B", boxShadow: "0 1px 3px rgba(0,0,0,.1)" }
              : { color: "#6B7280" }}
          >
            {t === "contacts" ? "Import Contacts" : "Push Hot Deals"}
          </button>
        ))}
      </div>

      {activeTab === "contacts" && <ContactsTab />}
      {activeTab === "push" && <PushDealsTab />}
    </div>
  );
}

// ─── contacts tab ────────────────────────────────────────────────────────────

function ContactsTab() {
  const qc = useQueryClient();
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["hs-contacts"],
    queryFn: () => hsFetch("/contacts"),
    staleTime: 60_000,
  });

  const importMut = useMutation({
    mutationFn: () => hsFetch("/import", { method: "POST" }),
    onSuccess: (res) => {
      setImportResult(res);
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  const contacts: HsContact[] = data?.contacts ?? [];

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: "#E5E7EB", background: "#FAFAFA" }}>
        <div className="flex items-center gap-6">
          <Stat label="Total contacts" value={data?.total ?? "—"} icon={<Users className="w-4 h-4" />} />
          <Stat label="With email" value={contacts.filter(c => c.properties.email).length || (isLoading ? "—" : "0")} icon={<Check className="w-4 h-4" />} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all"
            style={{ borderColor: "#E5E7EB", color: "#374151" }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => importMut.mutate()}
            disabled={importMut.isPending || isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all"
            style={{ background: importMut.isPending ? "#9CA3AF" : "#1A3D2B" }}
          >
            {importMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Import to Leads
          </button>
        </div>
      </div>

      {/* Import result */}
      {importResult && (
        <div className="p-4 rounded-xl border flex items-start gap-3" style={{ background: "#F0FDF4", borderColor: "#BBF7D0" }}>
          <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">Import complete</p>
            <p className="text-sm text-green-700 mt-0.5">
              {importResult.imported} imported · {importResult.skipped} skipped (already existed)
            </p>
            {importResult.errors.length > 0 && (
              <p className="text-xs text-red-600 mt-1">{importResult.errors.length} errors: {importResult.errors[0]}</p>
            )}
          </div>
        </div>
      )}

      {/* Contact list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading HubSpot contacts...
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No contacts found in HubSpot</p>
          <p className="text-sm mt-1">Add contacts in HubSpot and refresh</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Company</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Job Title</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">City</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => {
                const p = c.properties;
                const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || "—";
                return (
                  <tr key={c.id} style={{ borderBottom: i < contacts.length - 1 ? "1px solid #F3F4F6" : "none" }}
                    className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{name}</td>
                    <td className="px-4 py-3 text-gray-600">{p.email ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{p.company ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{p.jobtitle ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{p.city ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── push deals tab ──────────────────────────────────────────────────────────

function PushDealsTab() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pipeline, setPipeline] = useState("");
  const [dealstage, setDealstage] = useState("");
  const [pushResult, setPushResult] = useState<{ pushed: number; failed: number } | null>(null);

  const { data: pipelineData, isLoading: plLoading } = useQuery({
    queryKey: ["hs-pipelines"],
    queryFn: () => hsFetch("/pipelines"),
  });

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ["hs-hot-leads"],
    queryFn: () => fetch(`${API_BASE}/leads?status=qualified&limit=200`).then(r => r.json()),
  });

  const { data: prospectsData } = useQuery({
    queryKey: ["hs-prospect-leads"],
    queryFn: () => fetch(`${API_BASE}/leads?status=meeting_booked&limit=200`).then(r => r.json()),
  });

  const pipelines: Pipeline[] = (pipelineData?.pipelines ?? []).map((p: any) => ({
    id: p.id,
    label: p.label,
    stages: (p.stages ?? []).map((s: any) => ({ id: s.id, label: s.label })),
  }));

  const selectedPipeline = pipelines.find(p => p.id === pipeline);

  const hotLeads = [...(leadsData?.leads ?? []), ...(prospectsData?.leads ?? [])];

  const pushMut = useMutation({
    mutationFn: () => hsFetch("/push-deals-bulk", {
      method: "POST",
      body: JSON.stringify({ leadIds: Array.from(selectedIds), pipeline, dealstage }),
    }),
    onSuccess: (res) => {
      setPushResult({ pushed: res.pushed, failed: res.failed });
      setSelectedIds(new Set());
    },
  });

  function toggle(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === hotLeads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(hotLeads.map((l: any) => l.id)));
  }

  const canPush = selectedIds.size > 0 && pipeline && dealstage;

  return (
    <div className="space-y-4">
      {/* Pipeline selector */}
      <div className="p-4 rounded-xl border space-y-3" style={{ borderColor: "#E5E7EB" }}>
        <p className="text-sm font-semibold text-gray-700">Select HubSpot pipeline &amp; deal stage</p>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Pipeline</label>
            {plLoading ? (
              <div className="h-9 rounded-lg border animate-pulse" style={{ background: "#F3F4F6", borderColor: "#E5E7EB" }} />
            ) : (
              <select
                value={pipeline}
                onChange={e => { setPipeline(e.target.value); setDealstage(""); }}
                className="w-full h-9 px-3 rounded-lg border text-sm outline-none"
                style={{ borderColor: "#D1D5DB" }}
              >
                <option value="">— Choose pipeline —</option>
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Deal stage</label>
            <select
              value={dealstage}
              onChange={e => setDealstage(e.target.value)}
              disabled={!selectedPipeline}
              className="w-full h-9 px-3 rounded-lg border text-sm outline-none disabled:opacity-50"
              style={{ borderColor: "#D1D5DB" }}
            >
              <option value="">— Choose stage —</option>
              {(selectedPipeline?.stages ?? []).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Push result */}
      {pushResult && (
        <div className="p-4 rounded-xl border flex items-start gap-3" style={{ background: "#FFF7ED", borderColor: "#FED7AA" }}>
          <Zap className="w-5 h-5 text-orange-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-orange-800">Deals pushed to HubSpot</p>
            <p className="text-sm text-orange-700 mt-0.5">
              {pushResult.pushed} deals created{pushResult.failed > 0 ? ` · ${pushResult.failed} failed` : ""}
            </p>
          </div>
        </div>
      )}

      {/* Lead selection table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
          <div className="flex items-center gap-3">
            <input type="checkbox"
              checked={selectedIds.size === hotLeads.length && hotLeads.length > 0}
              onChange={toggleAll}
              className="w-4 h-4 rounded accent-green-700" />
            <span className="text-sm font-semibold text-gray-700">
              Qualified &amp; Meeting Booked leads ({hotLeads.length})
            </span>
          </div>
          {selectedIds.size > 0 && (
            <button
              onClick={() => pushMut.mutate()}
              disabled={!canPush || pushMut.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all"
              style={{ background: canPush && !pushMut.isPending ? HUBSPOT_ORANGE : "#9CA3AF" }}
            >
              {pushMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
              Push {selectedIds.size} as deals
            </button>
          )}
        </div>

        {leadsLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading leads…
          </div>
        ) : hotLeads.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Zap className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No qualified or meeting-booked leads yet</p>
            <p className="text-sm mt-1">Qualify leads via BANT and they'll appear here</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid #F3F4F6" }}>
                <th className="w-10 px-4 py-3" />
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Company</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">BANT</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Tags</th>
              </tr>
            </thead>
            <tbody>
              {hotLeads.map((l: any, i: number) => {
                const alreadyPushed = (l.tags ?? []).includes("hubspot_deal");
                return (
                  <tr key={l.id}
                    style={{ borderBottom: i < hotLeads.length - 1 ? "1px solid #F3F4F6" : "none", opacity: alreadyPushed ? 0.6 : 1 }}
                    className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <input type="checkbox"
                        checked={selectedIds.has(l.id)}
                        onChange={() => toggle(l.id)}
                        className="w-4 h-4 rounded accent-green-700" />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {l.firstName} {l.lastName}
                      {alreadyPushed && (
                        <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#FFF7ED", color: HUBSPOT_ORANGE }}>
                          In HubSpot
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{l.company}</td>
                    <td className="px-4 py-3 text-gray-500">{l.email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize"
                        style={{ background: l.status === "qualified" ? "#DCFCE7" : "#DBEAFE", color: l.status === "qualified" ? "#166534" : "#1D4ED8" }}>
                        {l.status?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-semibold">{l.bantScore ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(l.tags ?? []).slice(0, 2).map((t: string) => (
                          <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: "#F3F4F6", color: "#6B7280" }}>{t}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Leads tagged "hubspot_deal" have already been pushed. Pushing again creates a duplicate deal in HubSpot.
      </p>
    </div>
  );
}

// ─── small stat card ─────────────────────────────────────────────────────────

function Stat({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: HUBSPOT_ORANGE }}>
        {icon}
      </div>
      <div>
        <div className="text-lg font-bold text-gray-900 leading-none">{value}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

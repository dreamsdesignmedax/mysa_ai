import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Users, CheckCircle2, Clock, Trash2, Mail, Building2, Briefcase, Calendar, RefreshCw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface WaitlistEntry {
  id: number;
  name: string;
  email: string;
  company: string | null;
  role: string | null;
  message: string | null;
  approved: boolean;
  createdAt: string;
}

function useWaitlist() {
  const [data, setData] = useState<WaitlistEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/waitlist`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      setData(await res.json());
    } catch {
      setError("Failed to load registrations");
    } finally {
      setLoading(false);
    }
  }

  return { data, loading, error, load };
}

export default function Registrations() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "pending" | "approved">("all");
  const { data, loading, error, load } = useWaitlist();
  const [approving, setApproving] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<Set<number>>(new Set());

  useState(() => { load(); });

  const filtered = (data ?? []).filter(r => {
    if (filter === "pending") return !r.approved;
    if (filter === "approved") return r.approved;
    return true;
  });

  async function approve(id: number) {
    setApproving(s => new Set(s).add(id));
    try {
      const res = await fetch(`/api/waitlist/${id}/approve`, { method: "PATCH", credentials: "include" });
      if (!res.ok) throw new Error();
      await load();
      toast({ title: "Approved", description: "User has been approved." });
    } catch {
      toast({ title: "Error", description: "Failed to approve user.", variant: "destructive" });
    } finally {
      setApproving(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function remove(id: number) {
    if (!confirm("Remove this registration?")) return;
    setDeleting(s => new Set(s).add(id));
    try {
      const res = await fetch(`/api/waitlist/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error();
      await load();
      toast({ title: "Removed" });
    } catch {
      toast({ title: "Error", description: "Failed to remove.", variant: "destructive" });
    } finally {
      setDeleting(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  const total = data?.length ?? 0;
  const approved = data?.filter(r => r.approved).length ?? 0;
  const pending = total - approved;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Registrations</h1>
          <p className="text-sm text-gray-500 mt-1">Waitlist signups from the public landing page</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Signups", value: total, icon: Users, color: "#4F35A8" },
          { label: "Pending Review", value: pending, icon: Clock, color: "#F59E0B" },
          { label: "Approved", value: approved, icon: CheckCircle2, color: "#10B981" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{value}</div>
              <div className="text-xs text-gray-500">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {(["all", "pending", "approved"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-all"
            style={filter === f
              ? { background: "#4F35A8", color: "#fff" }
              : { background: "#F3F4F6", color: "#6B7280" }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      {error && (
        <div className="text-center py-12 text-red-500 text-sm">{error}</div>
      )}

      {!error && loading && !data && (
        <div className="text-center py-12 text-gray-400 text-sm">Loading registrations…</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <Users className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 font-medium">No registrations yet</p>
          <p className="text-sm text-gray-400 mt-1">New signups from the landing page will appear here</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Company / Role</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Message</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Signed Up</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: "#4F35A8" }}>
                        {r.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{r.name}</div>
                        <a href={`mailto:${r.email}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                          <Mail className="w-3 h-3" />{r.email}
                        </a>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="text-gray-700 flex items-center gap-1.5">
                      {r.company && <><Building2 className="w-3.5 h-3.5 text-gray-400" />{r.company}</>}
                    </div>
                    <div className="text-gray-400 text-xs flex items-center gap-1.5 mt-0.5">
                      {r.role && <><Briefcase className="w-3 h-3" />{r.role}</>}
                    </div>
                  </td>
                  <td className="px-5 py-4 max-w-[200px]">
                    <p className="text-gray-500 text-xs truncate">{r.message ?? "—"}</p>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5 text-gray-500 text-xs">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    {r.approved ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
                        <CheckCircle2 className="w-3 h-3" /> Approved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2 justify-end">
                      {!r.approved && (
                        <button
                          onClick={() => approve(r.id)}
                          disabled={approving.has(r.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
                          style={{ background: "#10B981" }}
                        >
                          {approving.has(r.id) ? "…" : "Approve"}
                        </button>
                      )}
                      <button
                        onClick={() => remove(r.id)}
                        disabled={deleting.has(r.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Loader2, Mail, Phone, Building2, Calendar,
  Download, Search, CheckCircle2, XCircle, RefreshCw,
  Globe, Filter, TrendingUp, UserCheck, ListChecks, Tag,
} from "lucide-react";

/* ─── API types ───────────────────────────────────────────────── */
type SaasUser = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  phone: string | null;
  phoneVerified: boolean | null;
  createdAt: string;
  orgName: string | null;
  orgWebsite: string | null;
  orgPlan: string | null;
  orgSubscriptionStatus: string | null;
};

type WaitlistEntry = {
  id: number;
  name: string;
  email: string;
  company: string | null;
  role: string | null;
  message: string | null;
  approved: boolean;
  createdAt: string;
};

/* ─── Unified row ─────────────────────────────────────────────── */
type Row = {
  key: string;
  source: "member" | "waitlist";
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  company: string | null;
  website: string | null;
  plan: string | null;
  joinedAt: string;
  isActive: boolean;
};

/* ─── Helpers ─────────────────────────────────────────────────── */
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function isThisWeek(iso: string) {
  return Date.now() - new Date(iso).getTime() < 7 * 86400 * 1000;
}

const PLAN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  trial:   { bg: "#F3F4F6", text: "#6B7280", border: "#E5E7EB" },
  starter: { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" },
  growth:  { bg: "#F5F3FF", text: "#6D28D9", border: "#DDD6FE" },
  pro:     { bg: "#FFFBEB", text: "#92400E", border: "#FDE68A" },
};

function safeArray<T>(json: unknown): T[] {
  return Array.isArray(json) ? json : [];
}

function exportCSV(rows: Row[]) {
  const headers = ["#", "Source", "Name", "Email", "Email Verified", "Phone", "Phone Verified", "Company", "Plan", "Joined"];
  const esc = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((r, i) => [
      i + 1,
      esc(r.source === "member" ? "App Signup" : "Waitlist"),
      esc(r.name),
      esc(r.email),
      esc(r.emailVerified ? "Yes" : "No"),
      esc(r.phone),
      esc(r.phone ? (r.phoneVerified ? "Yes" : "No") : "—"),
      esc(r.company),
      esc(r.plan),
      esc(fmtDate(r.joinedAt)),
    ].join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mysa-all-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/* ─── Sub-components ──────────────────────────────────────────── */
function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: number | string; sub?: string; color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-white px-5 py-4 shadow-sm flex-1 min-w-[140px]"
      style={{ borderColor: "#E5E7EB" }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: color + "18" }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <div className="text-2xl font-bold text-gray-900 leading-none">{value}</div>
        <div className="text-[11px] font-semibold text-gray-500 mt-0.5">{label}</div>
        {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function VerifiedBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
      <CheckCircle2 className="w-3 h-3" /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
      <XCircle className="w-3 h-3" /> Unverified
    </span>
  );
}

function SourceBadge({ source }: { source: "member" | "waitlist" }) {
  return source === "member" ? (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: "#EDE9FE", color: "#6D28D9", border: "1px solid #DDD6FE" }}>
      App
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: "#ECFDF5", color: "#065F46", border: "1px solid #A7F3D0" }}>
      Waitlist
    </span>
  );
}

/* ─── Page ────────────────────────────────────────────────────── */
export default function UsersPage() {
  const [search,      setSearch]      = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [emailFilter,  setEmailFilter]  = useState("all");

  /* Fetch both sources in parallel */
  const { data: membersRaw, isLoading: loadingMembers, refetch: refetchMembers, isFetching: fetchingMembers } =
    useQuery<SaasUser[]>({
      queryKey: ["saas-users"],
      queryFn: async () => {
        const res = await fetch("/api/saas/users", { credentials: "include" });
        if (!res.ok) return [];
        return safeArray<SaasUser>(await res.json());
      },
      refetchInterval: 60_000,
    });

  const { data: waitlistRaw, isLoading: loadingWaitlist, refetch: refetchWaitlist, isFetching: fetchingWaitlist } =
    useQuery<WaitlistEntry[]>({
      queryKey: ["saas-waitlist"],
      queryFn: async () => {
        const res = await fetch("/api/saas/waitlist", { credentials: "include" });
        if (!res.ok) return [];
        return safeArray<WaitlistEntry>(await res.json());
      },
      refetchInterval: 60_000,
    });

  /* Merge into unified rows */
  const allRows = useMemo<Row[]>(() => {
    const memberRows: Row[] = (membersRaw ?? []).map(u => ({
      key:           `m-${u.id}`,
      source:        "member",
      name:          `${u.firstName} ${u.lastName}`.trim(),
      firstName:     u.firstName,
      lastName:      u.lastName,
      email:         u.email,
      phone:         u.phone,
      phoneVerified: !!u.phoneVerified,
      emailVerified: u.isVerified,
      company:       u.orgName,
      website:       u.orgWebsite,
      plan:          u.orgPlan,
      joinedAt:      u.createdAt,
      isActive:      u.isActive,
    }));

    /* De-dupe: if a waitlist email already has a member account, skip the waitlist row */
    const memberEmails = new Set(memberRows.map(r => r.email.toLowerCase()));

    const waitlistRows: Row[] = (waitlistRaw ?? [])
      .filter(w => !memberEmails.has(w.email.toLowerCase()))
      .map(w => {
        const parts = w.name.trim().split(" ");
        return {
          key:           `w-${w.id}`,
          source:        "waitlist",
          name:          w.name,
          firstName:     parts[0] ?? w.name,
          lastName:      parts.slice(1).join(" "),
          email:         w.email,
          phone:         null,
          phoneVerified: false,
          emailVerified: false,
          company:       w.company,
          website:       null,
          plan:          null,
          joinedAt:      w.createdAt,
          isActive:      false,
        };
      });

    /* Merge and sort newest first */
    return [...memberRows, ...waitlistRows].sort(
      (a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime(),
    );
  }, [membersRaw, waitlistRaw]);

  /* Stats */
  const stats = useMemo(() => ({
    total:       allRows.length,
    members:     allRows.filter(r => r.source === "member").length,
    waitlist:    allRows.filter(r => r.source === "waitlist").length,
    newWeek:     allRows.filter(r => isThisWeek(r.joinedAt)).length,
    emailOk:     allRows.filter(r => r.emailVerified).length,
  }), [allRows]);

  /* Filter */
  const filtered = useMemo(() => {
    return allRows.filter(r => {
      if (sourceFilter !== "all"         && r.source !== sourceFilter)  return false;
      if (emailFilter  === "verified"    && !r.emailVerified)           return false;
      if (emailFilter  === "unverified"  &&  r.emailVerified)           return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.name.toLowerCase().includes(q)    ||
        r.email.toLowerCase().includes(q)   ||
        (r.phone  ?? "").includes(q)        ||
        (r.company ?? "").toLowerCase().includes(q)
      );
    });
  }, [allRows, search, sourceFilter, emailFilter]);

  const isFiltering = search || sourceFilter !== "all" || emailFilter !== "all";
  const isLoading   = loadingMembers || loadingWaitlist;
  const isFetching  = fetchingMembers || fetchingWaitlist;

  function handleRefresh() { refetchMembers(); refetchWaitlist(); }

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}>
              <Users className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Users</h1>
          </div>
          <p className="text-sm text-gray-500 ml-11">
            Everyone who has ever registered or signed up — {stats.total} total across all sources.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border bg-white hover:bg-gray-50 transition"
            style={{ borderColor: "#E5E7EB" }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => exportCSV(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-sm transition disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV ({isFiltering ? filtered.length : stats.total})
          </button>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────── */}
      {!isLoading && (
        <div className="flex flex-wrap gap-3">
          <StatCard icon={<Users className="w-5 h-5" />}
            label="All Users" value={stats.total}
            sub={`${stats.members} app · ${stats.waitlist} waitlist`} color="#4F35A8" />
          <StatCard icon={<TrendingUp className="w-5 h-5" />}
            label="Joined This Week" value={stats.newWeek}
            sub="new registrations" color="#0891B2" />
          <StatCard icon={<UserCheck className="w-5 h-5" />}
            label="Email Verified" value={stats.emailOk}
            sub={`${stats.total ? Math.round(stats.emailOk / stats.total * 100) : 0}% of users`}
            color="#16A34A" />
          <StatCard icon={<ListChecks className="w-5 h-5" />}
            label="App Members" value={stats.members}
            sub="full account holders" color="#D97706" />
        </div>
      )}

      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search name, email, phone, company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border rounded-xl pl-8 pr-4 py-2 text-xs w-64 focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
            style={{ borderColor: "#E5E7EB" }}
          />
        </div>

        <Filter className="w-3.5 h-3.5 text-gray-400" />

        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          className="border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
          style={{ borderColor: "#E5E7EB" }}>
          <option value="all">All Sources</option>
          <option value="member">App Signups only</option>
          <option value="waitlist">Waitlist only</option>
        </select>

        <select value={emailFilter} onChange={e => setEmailFilter(e.target.value)}
          className="border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
          style={{ borderColor: "#E5E7EB" }}>
          <option value="all">All Email Status</option>
          <option value="verified">✓ Email Verified</option>
          <option value="unverified">✗ Not Verified</option>
        </select>

        {isFiltering && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 font-medium">
              {filtered.length} of {allRows.length} users
            </span>
            <button
              onClick={() => { setSearch(""); setSourceFilter("all"); setEmailFilter("all"); }}
              className="text-[11px] text-violet-600 hover:underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border overflow-hidden bg-white shadow-sm" style={{ borderColor: "#E5E7EB" }}>
        {isLoading ? (
          <div className="p-20 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
            <p className="text-sm text-gray-400">Loading all users…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-20 text-center">
            <Users className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-500">
              {isFiltering ? "No users match your filters" : "No users registered yet"}
            </p>
            {isFiltering && (
              <button onClick={() => { setSearch(""); setSourceFilter("all"); setEmailFilter("all"); }}
                className="mt-2 text-xs text-violet-600 hover:underline">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: "#F8F9FA", borderBottom: "1px solid #E5E7EB" }}>
                  {["#", "Name", "Email", "Phone", "Company", "Plan", "Type", "Joined"].map(h => (
                    <th key={h}
                      className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => {
                  const planStyle = PLAN_COLORS[r.plan ?? ""] ?? PLAN_COLORS.trial!;
                  return (
                    <tr key={r.key}
                      className="border-t hover:bg-violet-50/30 transition-colors"
                      style={{ borderColor: "#F0F0F4" }}>

                      {/* # */}
                      <td className="px-4 py-3.5 text-[11px] text-gray-400 font-mono w-10">{idx + 1}</td>

                      {/* Name */}
                      <td className="px-4 py-3.5 min-w-[160px]">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                            style={{ background: r.source === "member"
                              ? "linear-gradient(135deg,#4F35A8,#7C3AED)"
                              : "linear-gradient(135deg,#059669,#10B981)" }}>
                            {(r.firstName?.[0] ?? "?").toUpperCase()}{(r.lastName?.[0] ?? "").toUpperCase()}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-gray-900 whitespace-nowrap">{r.name}</div>
                            {r.source === "member" && !r.isActive && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-100">Inactive</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3.5 min-w-[200px]">
                        <div className="text-[11px] text-gray-800 font-medium truncate max-w-[190px]" title={r.email}>
                          {r.email}
                        </div>
                        <div className="mt-1"><VerifiedBadge ok={r.emailVerified} /></div>
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3.5 min-w-[150px]">
                        {r.phone ? (
                          <div>
                            <div className="text-[11px] font-mono text-gray-800">{r.phone}</div>
                            <div className="mt-1"><VerifiedBadge ok={r.phoneVerified} /></div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-300 italic">—</span>
                        )}
                      </td>

                      {/* Company */}
                      <td className="px-4 py-3.5 min-w-[150px]">
                        {r.company ? (
                          <div>
                            <div className="flex items-center gap-1.5">
                              <Building2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
                              <span className="text-xs font-semibold text-gray-800 whitespace-nowrap">{r.company}</span>
                            </div>
                            {r.website && (
                              <a href={r.website} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[10px] text-violet-500 hover:underline mt-0.5">
                                <Globe className="w-3 h-3" />
                                {r.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-300 italic">—</span>
                        )}
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3.5 w-24">
                        {r.plan ? (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full capitalize border"
                            style={{ background: planStyle.bg, color: planStyle.text, borderColor: planStyle.border }}>
                            {r.plan}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-300 italic">—</span>
                        )}
                      </td>

                      {/* Type / Source */}
                      <td className="px-4 py-3.5 w-20">
                        <SourceBadge source={r.source} />
                      </td>

                      {/* Joined */}
                      <td className="px-4 py-3.5 w-28">
                        <div className="flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
                          <Calendar className="w-3 h-3 flex-shrink-0" />
                          {fmtDate(r.joinedAt)}
                        </div>
                        {isThisWeek(r.joinedAt) && (
                          <span className="text-[9px] font-bold text-violet-500 mt-0.5 block">New this week</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t text-[11px] text-gray-400 flex items-center justify-between flex-wrap gap-2"
              style={{ borderColor: "#F0F0F4", background: "#FAFAFA" }}>
              <span>
                Showing <strong className="text-gray-600">{filtered.length}</strong> users
                {isFiltering && <> (filtered from {allRows.length})</>}
              </span>
              <span>
                {stats.members} app members
                &nbsp;·&nbsp;
                {stats.waitlist} waitlist
                &nbsp;·&nbsp;
                {stats.emailOk} email verified
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

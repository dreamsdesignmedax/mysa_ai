import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Loader2, ShieldCheck, ShieldAlert, Globe,
  Search, Building2, Phone, Calendar, Download,
  Mail, CheckCircle2, XCircle, Filter,
} from "lucide-react";

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
  orgId: number | null;
  orgName: string | null;
  orgEmail: string | null;
  orgPhone: string | null;
  orgWebsite: string | null;
  orgPlan: string | null;
  orgSubscriptionStatus: string | null;
  orgIsActive: boolean | null;
  orgIsSuspended: boolean | null;
  orgTrialEndsAt: string | null;
  orgCreatedAt: string | null;
};

const PLAN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  trial:   { bg: "#F3F4F6", text: "#6B7280", border: "#E5E7EB" },
  starter: { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" },
  growth:  { bg: "#F5F3FF", text: "#6D28D9", border: "#DDD6FE" },
  pro:     { bg: "#FFFBEB", text: "#92400E", border: "#FDE68A" },
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Avatar({ firstName, lastName, size = 8 }: { firstName: string; lastName: string; size?: number }) {
  const s = `w-${size} h-${size}`;
  return (
    <div
      className={`${s} rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0`}
      style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}
    >
      {(firstName?.[0] ?? "?").toUpperCase()}{(lastName?.[0] ?? "").toUpperCase()}
    </div>
  );
}

function VerifiedBadge({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
      <CheckCircle2 className="w-3 h-3" /> {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
      <XCircle className="w-3 h-3" /> Unverified
    </span>
  );
}

function StatCard({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode; label: string; value: number | string;
  sub?: string; color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm min-w-[150px]"
      style={{ borderColor: "#E5E7EB" }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: color + "18" }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <div className="text-xl font-bold text-gray-900 leading-none">{value}</div>
        <div className="text-[11px] font-medium text-gray-500 mt-0.5">{label}</div>
        {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
      </div>
    </div>
  );
}

function exportCSV(rows: SaasUser[]) {
  const headers = [
    "Name", "Email", "Email Verified",
    "Phone", "Phone Verified",
    "Company", "Company Website", "Company Phone",
    "Plan", "Subscription Status", "Joined",
  ];
  const escape = (v: string | null | undefined) => {
    const s = (v ?? "").toString().replace(/"/g, '""');
    return `"${s}"`;
  };
  const lines = [
    headers.join(","),
    ...rows.map(u => [
      escape(`${u.firstName} ${u.lastName}`),
      escape(u.email),
      escape(u.isVerified ? "Yes" : "No"),
      escape(u.phone),
      escape(u.phone ? (u.phoneVerified ? "Yes" : "No") : "—"),
      escape(u.orgName),
      escape(u.orgWebsite),
      escape(u.orgPhone),
      escape(u.orgPlan),
      escape(u.orgSubscriptionStatus),
      escape(fmtDate(u.createdAt)),
    ].join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `mysa-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

export default function UsersAdmin() {
  const [search,      setSearch]      = useState("");
  const [planFilter,  setPlanFilter]  = useState("all");
  const [emailFilter, setEmailFilter] = useState("all");
  const [phoneFilter, setPhoneFilter] = useState("all");

  const { data: users, isLoading } = useQuery<SaasUser[]>({
    queryKey: ["saas-users"],
    queryFn: () => fetch(`/api/saas/users`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60_000,
  });

  const stats = useMemo(() => {
    const all = users ?? [];
    return {
      total:        all.length,
      emailOk:      all.filter(u => u.isVerified).length,
      phoneOk:      all.filter(u => u.phone && u.phoneVerified).length,
      bothOk:       all.filter(u => u.isVerified && u.phone && u.phoneVerified).length,
    };
  }, [users]);

  const plans = useMemo(
    () => [...new Set((users ?? []).map(u => u.orgPlan).filter(Boolean))] as string[],
    [users],
  );

  const filtered = useMemo(() => {
    return (users ?? []).filter(u => {
      if (planFilter  !== "all") {
        if (u.orgPlan !== planFilter) return false;
      }
      if (emailFilter === "verified"   && !u.isVerified) return false;
      if (emailFilter === "unverified" &&  u.isVerified) return false;
      if (phoneFilter === "verified"   && !(u.phone && u.phoneVerified)) return false;
      if (phoneFilter === "has_phone"  && !u.phone) return false;
      if (phoneFilter === "no_phone"   &&  u.phone) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone ?? "").includes(q) ||
        (u.orgName ?? "").toLowerCase().includes(q) ||
        (u.orgWebsite ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, search, planFilter, emailFilter, phoneFilter]);

  const isFiltering = search || planFilter !== "all" || emailFilter !== "all" || phoneFilter !== "all";

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Contact Database</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            All registered users with verified contact details for marketing outreach.
          </p>
        </div>
        <button
          onClick={() => exportCSV(filtered)}
          disabled={filtered.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-sm transition-all disabled:opacity-40"
          style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV {isFiltering ? `(${filtered.length})` : `(${users?.length ?? 0})`}
        </button>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      {!isLoading && users && (
        <div className="flex flex-wrap gap-3">
          <StatCard
            icon={<Users className="w-4.5 h-4.5" />}
            label="Total Users" value={stats.total}
            color="#4F35A8"
          />
          <StatCard
            icon={<Mail className="w-4.5 h-4.5" />}
            label="Email Verified" value={stats.emailOk}
            sub={`${stats.total ? Math.round(stats.emailOk / stats.total * 100) : 0}% of users`}
            color="#16A34A"
          />
          <StatCard
            icon={<Phone className="w-4.5 h-4.5" />}
            label="Phone Verified" value={stats.phoneOk}
            sub={`${stats.total ? Math.round(stats.phoneOk / stats.total * 100) : 0}% of users`}
            color="#0891B2"
          />
          <StatCard
            icon={<ShieldCheck className="w-4.5 h-4.5" />}
            label="Both Verified" value={stats.bothOk}
            sub="Ready for outreach"
            color="#D97706"
          />
        </div>
      )}

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search name, email, phone, company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border rounded-xl pl-8 pr-4 py-2 text-xs w-64 focus:outline-none focus:ring-2 focus:ring-violet-400"
            style={{ borderColor: "#E5E7EB" }}
          />
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <Filter className="w-3.5 h-3.5" />
        </div>

        <select value={emailFilter} onChange={e => setEmailFilter(e.target.value)}
          className="border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
          style={{ borderColor: "#E5E7EB" }}>
          <option value="all">All Emails</option>
          <option value="verified">✓ Email Verified</option>
          <option value="unverified">✗ Email Unverified</option>
        </select>

        <select value={phoneFilter} onChange={e => setPhoneFilter(e.target.value)}
          className="border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
          style={{ borderColor: "#E5E7EB" }}>
          <option value="all">All Phones</option>
          <option value="verified">✓ Phone Verified</option>
          <option value="has_phone">Has Phone</option>
          <option value="no_phone">No Phone</option>
        </select>

        <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
          className="border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
          style={{ borderColor: "#E5E7EB" }}>
          <option value="all">All Plans</option>
          {plans.map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>

        {isFiltering && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 font-medium">
              {filtered.length} of {users?.length ?? 0} users
            </span>
            <button
              onClick={() => { setSearch(""); setPlanFilter("all"); setEmailFilter("all"); setPhoneFilter("all"); }}
              className="text-[11px] text-violet-600 hover:underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border overflow-hidden bg-white shadow-sm" style={{ borderColor: "#E5E7EB" }}>
        {isLoading ? (
          <div className="p-20 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
            <p className="text-sm text-gray-400">Loading users…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-20 text-center">
            <Users className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-500">No users match your filters</p>
            {isFiltering && (
              <button onClick={() => { setSearch(""); setPlanFilter("all"); setEmailFilter("all"); setPhoneFilter("all"); }}
                className="mt-2 text-xs text-violet-600 hover:underline">
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: "#F8F9FA", borderBottom: "1px solid #E5E7EB" }}>
                  {[
                    { label: "#",       w: "w-10" },
                    { label: "Name",    w: "min-w-[160px]" },
                    { label: "Email",   w: "min-w-[220px]" },
                    { label: "Phone",   w: "min-w-[180px]" },
                    { label: "Company", w: "min-w-[180px]" },
                    { label: "Plan",    w: "w-24" },
                    { label: "Joined",  w: "w-28" },
                  ].map(({ label, w }) => (
                    <th key={label}
                      className={`text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400 whitespace-nowrap ${w}`}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, idx) => {
                  const planStyle = PLAN_COLORS[u.orgPlan ?? ""] ?? PLAN_COLORS.trial!;
                  const hasVerifiedPhone = u.phone && u.phoneVerified;

                  return (
                    <tr key={u.id}
                      className="border-t hover:bg-violet-50/30 transition-colors"
                      style={{ borderColor: "#F0F0F4" }}>

                      {/* # */}
                      <td className="px-4 py-3.5 text-[11px] text-gray-400 font-mono">
                        {idx + 1}
                      </td>

                      {/* Name */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar firstName={u.firstName} lastName={u.lastName} size={8} />
                          <div>
                            <div className="text-xs font-bold text-gray-900 whitespace-nowrap">
                              {u.firstName} {u.lastName}
                            </div>
                            {!u.isActive && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-100">
                                Inactive
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3.5">
                        <div className="text-[11px] text-gray-800 font-medium truncate max-w-[200px]" title={u.email}>
                          {u.email}
                        </div>
                        <div className="mt-1">
                          <VerifiedBadge ok={u.isVerified} label="Verified" />
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3.5">
                        {u.phone ? (
                          <div>
                            <div className="text-[11px] text-gray-800 font-mono font-medium">
                              {u.phone}
                            </div>
                            <div className="mt-1">
                              <VerifiedBadge ok={!!u.phoneVerified} label="Verified" />
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-300 italic">No phone</span>
                        )}
                      </td>

                      {/* Company */}
                      <td className="px-4 py-3.5">
                        {u.orgName ? (
                          <div>
                            <div className="flex items-center gap-1.5">
                              <Building2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
                              <span className="text-xs font-semibold text-gray-800 whitespace-nowrap">
                                {u.orgName}
                              </span>
                            </div>
                            {u.orgWebsite ? (
                              <a href={u.orgWebsite} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[10px] text-violet-500 hover:underline mt-0.5">
                                <Globe className="w-3 h-3" />
                                {u.orgWebsite.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                              </a>
                            ) : (
                              u.orgPhone && (
                                <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5">
                                  <Phone className="w-3 h-3" /> {u.orgPhone}
                                </div>
                              )
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-300 italic">—</span>
                        )}
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3.5">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full capitalize border"
                          style={{ background: planStyle.bg, color: planStyle.text, borderColor: planStyle.border }}>
                          {u.orgPlan ?? "—"}
                        </span>
                      </td>

                      {/* Joined */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
                          <Calendar className="w-3 h-3 flex-shrink-0" />
                          {fmtDate(u.createdAt)}
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Footer summary */}
            <div className="px-4 py-2.5 border-t text-[11px] text-gray-400 flex items-center justify-between"
              style={{ borderColor: "#F0F0F4", background: "#FAFAFA" }}>
              <span>
                Showing <strong className="text-gray-600">{filtered.length}</strong> users
                {isFiltering && <> (filtered from {users?.length ?? 0})</>}
              </span>
              <span>
                {filtered.filter(u => u.isVerified).length} verified email
                &nbsp;·&nbsp;
                {filtered.filter(u => u.phone && u.phoneVerified).length} verified phone
                &nbsp;·&nbsp;
                {filtered.filter(u => u.isVerified && u.phone && u.phoneVerified).length} both verified
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

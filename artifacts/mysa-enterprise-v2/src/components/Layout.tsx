import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect, useCallback } from "react";
import { useIsAdmin } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Users,
  Target,
  Search,
  CheckSquare,
  Mail,
  Calendar,
  FileText,
  MessageSquare,
  MessageCircle,
  Megaphone,
  GitBranch,
  Zap,
  Bell,
  Settings,
  Database,
  KanbanSquare,
  X,
  Building2,
  Link2,
  Check as CheckIcon,
  LogOut,
  Menu,
  Plug,
  Bot,
  Crosshair,
  ClipboardList,
  Crown,
  CreditCard,
  MessageSquarePlus,
  AlertCircle,
  Loader2,
  Clock,
  ArrowRight,
  Lock,
} from "lucide-react";
import { usePlan, planLabel, planBadgeStyle } from "@/hooks/usePlan";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type NavItem = { href: string; label: string; icon: React.ElementType; accent?: string };
type NavGroup = { group: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { href: "/",          label: "Command Center", icon: LayoutDashboard },
      { href: "/pipeline",  label: "Pipeline",        icon: KanbanSquare },
      { href: "/meetings",  label: "Meetings",         icon: Calendar },
    ],
  },
  {
    group: "Leads & CRM",
    items: [
      { href: "/leads",     label: "Leads",           icon: Users },
      { href: "/lead-bank", label: "Lead Bank",       icon: Database },
      { href: "/icp",       label: "ICP Manager",     icon: Target },
      { href: "/qualify",   label: "BANT Qualifier",  icon: CheckSquare },
      { href: "/hubspot",   label: "HubSpot CRM",     icon: Building2,     accent: "#FF7A59" },
    ],
  },
  {
    group: "Outreach & AI",
    items: [
      { href: "/outreach",    label: "Outreach Engine", icon: Mail },
      { href: "/ai-composer", label: "AI Composer",     icon: MessageSquare },
      { href: "/proposals",   label: "Proposals",       icon: FileText },
      { href: "/sales-brain", label: "Sales Brain",     icon: MessageCircle, accent: "#25D366" },
    ],
  },
  {
    group: "Automation",
    items: [
      { href: "/campaigns",   label: "Campaigns",      icon: Megaphone,  accent: "#4F35A8" },
      { href: "/automations", label: "Automations",    icon: GitBranch,  accent: "#6D28D9" },
    ],
  },
  {
    group: "Agents",
    items: [
      { href: "/agents",              label: "Agents Hub",   icon: Bot,       accent: "#7C3AED" },
      { href: "/agents/lead-hunter",  label: "Lead Hunter",  icon: Crosshair, accent: "#7C3AED" },
      { href: "/agents/control",      label: "Agent Control", icon: Zap,      accent: "#7C3AED" },
    ],
  },
  {
    group: "Marketing",
    items: [
      { href: "/audit",    label: "Brand Audit",    icon: Search },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/billing",       label: "Billing",       icon: CreditCard,    accent: "#4F35A8" },
      { href: "/registrations", label: "Registrations", icon: ClipboardList, accent: "#10B981" },
      { href: "/integrations",  label: "Integrations",  icon: Plug,          accent: "#0EA5E9" },
      { href: "/settings",      label: "Settings",      icon: Settings },
      { href: "/super-admin",   label: "Super Admin",   icon: Crown,         accent: "#C9A84C" },
    ],
  },
];

const nav: NavItem[] = navGroups.flatMap(g => g.items);

const LOCKED_PAID_HREFS = new Set(["/hubspot", "/sales-brain", "/agent-hub", "/fetch-leads"]);
function LockedFeatureNavBadge({ href }: { href: string }) {
  const { data } = usePlan();
  if (!LOCKED_PAID_HREFS.has(href)) return null;
  const plan = data?.plan ?? "trial";
  if (plan === "growth" || plan === "agency") return null;
  return <Lock className="w-3 h-3 flex-shrink-0 opacity-40 ml-auto" />;
}

const mobileBottomNav = [
  { href: "/",        label: "Home",    icon: LayoutDashboard },
  { href: "/leads",   label: "Leads",   icon: Users },
  { href: "/audit",   label: "Audit",   icon: Search },
  { href: "/pipeline",label: "Pipeline",icon: KanbanSquare },
];

interface SearchResult {
  leads:     { id: number; firstName: string; lastName: string; email: string; company: string; designation: string }[];
  proposals: { id: number; title: string; company: string; status: string }[];
  meetings:  { id: number; title: string; scheduledAt: string; status: string }[];
}

async function doLogout() {
  await fetch(`/api/auth/logout`, { method: "POST", credentials: "include" });
  window.location.reload();
}

const FEEDBACK_CATEGORIES = [
  { value: "bug", label: "🐛 Bug Report", color: "#EF4444" },
  { value: "feature", label: "✨ Feature Request", color: "#7C3AED" },
  { value: "general", label: "💬 General Feedback", color: "#3B82F6" },
  { value: "complaint", label: "⚠️ Complaint", color: "#F59E0B" },
];

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState("general");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [page, setPage] = useState(window.location.pathname.split("/").slice(-1)[0] || "dashboard");
  const [priority, setPriority] = useState("medium");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !message.trim()) { setError("Please fill title and message."); return; }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, title, message, email, page, priority }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      setDone(true);
      setTimeout(onClose, 2000);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}>
          <div className="flex items-center gap-2.5">
            <MessageSquarePlus className="w-5 h-5 text-white" />
            <div>
              <div className="text-sm font-bold text-white">Send Feedback</div>
              <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.7)" }}>Help us improve Mysa AI</div>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
            <X className="w-3.5 h-3.5 text-white" />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <CheckIcon className="w-6 h-6 text-green-600" />
            </div>
            <div className="font-bold text-gray-900 mb-1">Thank you!</div>
            <div className="text-sm text-gray-500">Your feedback has been submitted.</div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            {/* Category */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-2">Category</label>
              <div className="grid grid-cols-2 gap-2">
                {FEEDBACK_CATEGORIES.map(c => (
                  <button key={c.value} type="button" onClick={() => setCategory(c.value)}
                    className="px-3 py-2 rounded-xl text-[12px] font-semibold border-2 transition-all text-left"
                    style={{
                      borderColor: category === c.value ? c.color : "hsl(220 13% 91%)",
                      background: category === c.value ? `${c.color}15` : "#fff",
                      color: category === c.value ? c.color : "#6B7280",
                    }}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Priority */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Priority</label>
              <div className="flex gap-2">
                {["low", "medium", "high"].map(p => (
                  <button key={p} type="button" onClick={() => setPriority(p)}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-bold capitalize transition-all border"
                    style={{
                      background: priority === p ? (p === "high" ? "#FEE2E2" : p === "medium" ? "#FEF3C7" : "#F0FDF4") : "#fff",
                      color: priority === p ? (p === "high" ? "#991B1B" : p === "medium" ? "#92400E" : "#166534") : "#9CA3AF",
                      borderColor: priority === p ? (p === "high" ? "#FCA5A5" : p === "medium" ? "#FCD34D" : "#86EFAC") : "hsl(220 13% 91%)",
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Title *</label>
              <input
                value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Short, clear summary of the issue"
                className="w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
                style={{ borderColor: "hsl(220 13% 88%)" }}
              />
            </div>

            {/* Message */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Details *</label>
              <textarea
                value={message} onChange={e => setMessage(e.target.value)}
                rows={4}
                placeholder="Describe the bug or feature in detail. Steps to reproduce (if a bug)?"
                className="w-full text-sm border rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
                style={{ borderColor: "hsl(220 13% 88%)" }}
              />
            </div>

            {/* Email + Page */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Your Email</label>
                <input
                  value={email} onChange={e => setEmail(e.target.value)}
                  type="email" placeholder="optional"
                  className="w-full text-xs border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  style={{ borderColor: "hsl(220 13% 88%)" }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Page / Feature</label>
                <input
                  value={page} onChange={e => setPage(e.target.value)}
                  placeholder="e.g. Leads"
                  className="w-full text-xs border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  style={{ borderColor: "hsl(220 13% 88%)" }}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}
            >
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <><MessageSquarePlus className="w-4 h-4" /> Submit Feedback</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[12px] font-bold transition-all hover:opacity-90"
        style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)", color: "#fff" }}
      >
        <MessageSquarePlus className="w-4 h-4 flex-shrink-0" />
        <span>Send Feedback</span>
        <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }}>NEW</span>
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

function BookingLinkButton() {
  const [copied, setCopied] = useState(false);
  const bookingUrl = typeof window !== "undefined"
    ? `${window.location.origin}${BASE}/book`
    : `${BASE}/book`;

  function copy() {
    navigator.clipboard.writeText(bookingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "linear-gradient(135deg, #1A3D2B, #5C1A8C)" }}>
      <div className="px-3 py-2.5">
        <div className="text-[10px] font-semibold mb-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>Booking Page</div>
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-medium truncate" style={{ color: "#fff" }}>Share your booking link</span>
          <button
            onClick={copy}
            title={bookingUrl}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-all"
            style={{ background: copied ? "#16a34a" : "rgba(255,255,255,0.2)", color: "#fff" }}
          >
            {copied ? <CheckIcon className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GlobalSearch({ iconOnly = false }: { iconOnly?: boolean }) {
  const [, navigate] = useLocation();
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef  = useRef<HTMLInputElement>(null);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      setResults(await res.json());
    } catch { setResults(null); }
    setLoading(false);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 280);
  }

  function openSearch() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function closeSearch() {
    setOpen(false);
    setQuery("");
    setResults(null);
  }

  function go(path: string) {
    navigate(path);
    closeSearch();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openSearch(); }
      if (e.key === "Escape") closeSearch();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasResults = results && (results.leads.length + results.proposals.length + results.meetings.length) > 0;

  return (
    <>
      {iconOnly ? (
        <button
          onClick={openSearch}
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ background: "hsl(220 13% 95%)", color: "#6B7280" }}
          aria-label="Search"
        >
          <Search className="w-4 h-4" />
        </button>
      ) : (
        <button
          onClick={openSearch}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors"
          style={{ background: "hsl(220 13% 95%)", color: "#9CA3AF", width: 220 }}
        >
          <Search className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-[10px] px-1 py-0.5 rounded" style={{ background: "#E5E7EB", color: "#6B7280" }}>⌘K</kbd>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={e => { if (e.target === e.currentTarget) closeSearch(); }}
        >
          <div
            className="w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "#fff", border: "1px solid hsl(220 13% 91%)" }}
          >
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid hsl(220 13% 91%)" }}>
              <Search className="w-4 h-4 flex-shrink-0" style={{ color: "#6B7280" }} />
              <input
                ref={inputRef}
                value={query}
                onChange={handleChange}
                placeholder="Search leads, proposals, meetings…"
                className="flex-1 text-[14px] outline-none bg-transparent"
                style={{ color: "#111827" }}
              />
              {loading && (
                <div className="w-4 h-4 border-2 border-[#1A3D2B] border-t-transparent rounded-full animate-spin" />
              )}
              <button onClick={closeSearch}>
                <X className="w-4 h-4" style={{ color: "#9CA3AF" }} />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto py-2">
              {!query && (
                <div className="px-4 py-8 text-center text-[13px]" style={{ color: "#9CA3AF" }}>
                  Start typing to search across leads, proposals and meetings
                </div>
              )}
              {query.length >= 2 && !loading && !hasResults && (
                <div className="px-4 py-8 text-center text-[13px]" style={{ color: "#9CA3AF" }}>
                  No results for "{query}"
                </div>
              )}
              {results && results.leads.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#9CA3AF" }}>Leads</div>
                  {results.leads.map(l => (
                    <button key={l.id} onClick={() => go(`/leads/${l.id}`)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors" style={{ color: "#111827" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#F3F4F6")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: "#1A3D2B" }}>
                        {l.firstName?.[0] ?? ""}{l.lastName?.[0] ?? ""}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{l.firstName} {l.lastName}</div>
                        <div className="text-[11px] truncate" style={{ color: "#6B7280" }}>{l.designation} · {l.company}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {results && results.proposals.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#9CA3AF" }}>Proposals</div>
                  {results.proposals.map(p => (
                    <button key={p.id} onClick={() => go(`/proposals`)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors" style={{ color: "#111827" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#F3F4F6")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <FileText className="w-4 h-4 flex-shrink-0" style={{ color: "#6B7280" }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{p.title}</div>
                        <div className="text-[11px] truncate" style={{ color: "#6B7280" }}>{p.company} · {p.status}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {results && results.meetings.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#9CA3AF" }}>Meetings</div>
                  {results.meetings.map(m => (
                    <button key={m.id} onClick={() => go(`/meetings`)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors" style={{ color: "#111827" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#F3F4F6")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: "#6B7280" }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{m.title}</div>
                        <div className="text-[11px]" style={{ color: "#6B7280" }}>
                          {m.scheduledAt ? new Date(m.scheduledAt).toLocaleDateString() : ""} · {m.status}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TrialBanner() {
  const { data, isLoading } = usePlan();
  const [location] = useLocation();

  if (isLoading || !data) return null;
  const { plan, trialDaysLeft, trialExpired } = data;
  if (plan !== "trial") return null;
  if (location === "/billing") return null;

  if (trialExpired) {
    return (
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 text-sm flex-wrap"
        style={{ background: "linear-gradient(90deg,#FEE2E2 0%,#FFF5F5 100%)", borderBottom: "1px solid #FECACA" }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
          <span className="text-[12px] font-medium truncate" style={{ color: "#991B1B" }}>
            Your free trial has <strong className="font-bold">expired</strong> — upgrade now to keep using MysaAI
          </span>
        </div>
        <Link href="/billing">
          <button
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#DC2626,#EF4444)" }}
          >
            <Zap className="w-3 h-3" /> Choose a Plan <ArrowRight className="w-3 h-3" />
          </button>
        </Link>
      </div>
    );
  }

  const isUrgent = trialDaysLeft <= 3;
  const color   = trialDaysLeft <= 1 ? "#B91C1C" : trialDaysLeft <= 2 ? "#C2410C" : trialDaysLeft <= 3 ? "#B45309" : "#5B21B6";
  const bgColor = trialDaysLeft <= 1 ? "#FEE2E2" : trialDaysLeft <= 2 ? "#FFF7ED" : trialDaysLeft <= 3 ? "#FEF3C7" : "#EDE9FE";
  const border  = trialDaysLeft <= 1 ? "#FECACA" : trialDaysLeft <= 2 ? "#FED7AA" : trialDaysLeft <= 3 ? "#FDE68A" : "#C4B5FD";
  const dayStr  = trialDaysLeft === 0 ? "ends today" : trialDaysLeft === 1 ? "1 day left" : `${trialDaysLeft} days left`;
  const leadsRem  = data.usage.leads.max  === -1 ? null : Math.max(0, data.usage.leads.max  - data.usage.leads.used);
  const auditsRem = data.usage.audits.max === -1 ? null : Math.max(0, data.usage.audits.max - data.usage.audits.used);

  return (
    <div
      className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 text-sm flex-wrap"
      style={{ background: `linear-gradient(90deg,${bgColor} 0%,${bgColor}99 100%)`, borderBottom: `1px solid ${border}` }}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
        <Clock className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
        <span className="text-[12px] font-medium" style={{ color }}>
          {isUrgent
            ? <><strong className="font-bold">{dayStr}</strong> in your free trial — upgrade to keep all your data</>
            : <>Free trial — <strong className="font-bold">{dayStr}</strong></>
          }
        </span>
        <div className="flex items-center gap-1.5">
          {leadsRem !== null && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>
              {leadsRem} leads left
            </span>
          )}
          {auditsRem !== null && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>
              {auditsRem} audits left
            </span>
          )}
        </div>
      </div>
      <Link href="/billing">
        <button
          className="text-[11px] font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
          style={{ background: color, color: "#fff" }}
        >
          {isUrgent ? "Upgrade now" : "View plans"}
        </button>
      </Link>
    </div>
  );
}

function UpgradeWall() {
  const { data, isLoading } = usePlan();
  const [location] = useLocation();

  if (isLoading || !data?.trialExpired) return null;
  if (location === "/billing") return null;

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center p-8 text-center"
      style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: "linear-gradient(135deg,#EF4444,#DC2626)" }}
      >
        <AlertCircle className="w-8 h-8 text-white" />
      </div>
      <h2 className="text-xl font-black text-gray-900 mb-1">Your free trial has ended</h2>
      <p className="text-sm text-gray-500 max-w-xs mb-5 leading-relaxed">
        Choose a plan to restore full access — all your leads, audits, and data are safe.
      </p>
      <div className="grid grid-cols-3 gap-3 w-full max-w-lg mb-5">
        {([
          { key: "solo",   name: "Solo",   price: "₹2,499",  desc: "1 user · 300 leads · 30 audits", highlight: false },
          { key: "growth", name: "Growth", price: "₹5,999",  desc: "5 users · 2,000 leads · 150 audits", highlight: true },
          { key: "agency", name: "Agency", price: "₹12,999", desc: "Unlimited users & features", highlight: false },
        ] as const).map(plan => (
          <Link key={plan.key} href="/billing">
            <div
              className="p-3 rounded-xl border-2 cursor-pointer transition-all text-left hover:shadow-md"
              style={{ borderColor: plan.highlight ? "#7C3AED" : "#E5E7EB", background: plan.highlight ? "#F5F3FF" : "#fff" }}
            >
              <div className="text-[11px] font-bold" style={{ color: plan.highlight ? "#7C3AED" : "#374151" }}>{plan.name}</div>
              <div className="mt-0.5">
                <span className="text-[14px] font-black" style={{ color: plan.highlight ? "#7C3AED" : "#111827" }}>{plan.price}</span>
                <span className="text-[9px] text-gray-400">/mo</span>
              </div>
              <div className="text-[9px] text-gray-500 mt-0.5 leading-tight">{plan.desc}</div>
              {plan.highlight && <div className="mt-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full text-center" style={{ background: "#7C3AED", color: "#fff" }}>Most Popular</div>}
            </div>
          </Link>
        ))}
      </div>
      <Link href="/billing">
        <button
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-white text-sm"
          style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}
        >
          <Zap className="w-4 h-4" /> Choose a Plan <ArrowRight className="w-4 h-4" />
        </button>
      </Link>
      <p className="text-[11px] text-gray-400 mt-3">All data preserved · Cancel anytime</p>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const isAdmin = useIsAdmin();
  const { data: planInfo } = usePlan();

  const currentPage = nav.find(n =>
    n.href === "/" ? location === "/" : location.startsWith(n.href)
  )?.label ?? "Dashboard";

  function navIsActive(href: string) {
    return href === "/" ? location === "/" : location.startsWith(href);
  }

  return (
    <>
      <div className="flex h-screen overflow-hidden" style={{ background: "hsl(138 25% 96%)" }}>

        {/* ── Desktop Sidebar (hidden on mobile) ──────────────────────── */}
        <aside
          className="hidden md:flex w-56 flex-shrink-0 flex-col"
          style={{
            background: "#ffffff",
            borderRight: "1px solid hsl(220 13% 91%)",
          }}
        >
          {/* Logo */}
          <div className="px-4 py-4" style={{ borderBottom: "1px solid hsl(220 13% 91%)" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#1A3D2B" }}>
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-[13px] font-bold leading-tight" style={{ color: "#111827" }}>Mysa AI</div>
                <div className="text-[10px] font-medium leading-tight" style={{ color: "#9CA3AF" }}>Sales Automation</div>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-2 overflow-y-auto px-2">
            {navGroups.map(({ group, items }) => {
              const visibleItems = items.filter(item =>
                item.href === "/lead-bank" ? isAdmin : true
              );
              if (!visibleItems.length) return null;
              return (
              <div key={group} className="mb-1">
                <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#C4C9D4" }}>
                  {group}
                </div>
                {visibleItems.map(({ href, label, icon: Icon, accent }) => {
                  const active = navIsActive(href);
                  const activeBg = accent ?? "#1A3D2B";
                  const isPaidLocked = LOCKED_PAID_HREFS.has(href) && !["growth","agency"].includes(planInfo?.plan ?? "trial");
                  return (
                    <Link key={href} href={isPaidLocked ? "/billing" : href}>
                      <div
                        className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-150 mb-0.5")}
                        style={active ? { background: activeBg, color: "#ffffff" } : { color: "#6B7280" }}
                        onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = accent ? `${accent}18` : "#F3F4F6"; (e.currentTarget as HTMLElement).style.color = accent ?? "#111827"; } }}
                        onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "#6B7280"; } }}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate flex-1">{label}</span>
                        <LockedFeatureNavBadge href={href} />
                      </div>
                    </Link>
                  );
                })}
              </div>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="px-3 py-3 space-y-2" style={{ borderTop: "1px solid hsl(220 13% 91%)" }}>
            <FeedbackButton />
            <BookingLinkButton />
            {planInfo && (
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: planBadgeStyle(planInfo.plan).bg, color: planBadgeStyle(planInfo.plan).text, border: `1px solid ${planBadgeStyle(planInfo.plan).border}` }}>
                  {planLabel(planInfo.plan)}
                </span>
                <Link href="/billing"><span className="text-[10px] text-violet-500 font-medium hover:underline cursor-pointer">Upgrade</span></Link>
              </div>
            )}
            <div className="text-[11px] px-1" style={{ color: "#9CA3AF" }}>v1.0 — Apr 2026</div>
          </div>
        </aside>

        {/* ── Main area ───────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Mobile top header */}
          <header
            className="flex md:hidden flex-shrink-0 items-center justify-between px-4"
            style={{ height: 56, background: "#ffffff", borderBottom: "1px solid hsl(220 13% 91%)" }}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#1A3D2B" }}>
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-[15px] font-bold" style={{ color: "#111827" }}>Mysa AI</span>
            </div>
            <div className="flex items-center gap-2">
              <GlobalSearch iconOnly />
              <button
                onClick={doLogout}
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "hsl(220 13% 95%)", color: "#6B7280" }}
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: "#1A3D2B" }}>
                MA
              </div>
            </div>
          </header>

          {/* Desktop top header */}
          <header
            className="hidden md:flex flex-shrink-0 items-center justify-between px-6 py-3"
            style={{ background: "#ffffff", borderBottom: "1px solid hsl(220 13% 91%)" }}
          >
            <div className="text-[15px] font-semibold" style={{ color: "#111827" }}>{currentPage}</div>
            <div className="flex items-center gap-3">
              <GlobalSearch />
              <button className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: "hsl(220 13% 95%)", color: "#6B7280" }}>
                <Bell className="w-4 h-4" />
              </button>
              <Link href="/settings">
                <button className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: "hsl(220 13% 95%)", color: "#6B7280" }} title="Settings">
                  <Settings className="w-4 h-4" />
                </button>
              </Link>
              <button onClick={doLogout} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: "hsl(220 13% 95%)", color: "#6B7280" }} title="Sign out">
                <LogOut className="w-4 h-4" />
              </button>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white flex-shrink-0" style={{ background: "#1A3D2B" }}>
                MA
              </div>
            </div>
          </header>

          {/* Trial banner — only shows for trial users near expiry or expired */}
          <TrialBanner />

          {/* Page content — padded bottom on mobile so content clears the fixed nav */}
          <main className="flex-1 overflow-y-auto pb-[60px] md:pb-0 relative">
            {children}
            <UpgradeWall />
          </main>
        </div>
      </div>

      {/* ── Mobile bottom nav — fixed floating bar above all content ─── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden items-stretch"
        style={{ background: "#ffffff", borderTop: "1px solid hsl(220 13% 91%)", height: 60, paddingBottom: "env(safe-area-inset-bottom, 0px)", boxShadow: "0 -4px 24px rgba(0,0,0,0.08)" }}
      >
            {mobileBottomNav.map(({ href, label, icon: Icon }) => {
              const active = navIsActive(href);
              return (
                <Link key={href} href={href} className="flex-1">
                  <div
                    className="flex flex-col items-center justify-center gap-0.5 h-full transition-colors cursor-pointer"
                    style={{ color: active ? "#1A3D2B" : "#9CA3AF" }}
                  >
                    <Icon className="w-5 h-5" style={{ strokeWidth: active ? 2.2 : 1.8 }} />
                    <span className="text-[10px] font-semibold" style={{ fontWeight: active ? 700 : 500 }}>{label}</span>
                  </div>
                </Link>
              );
            })}
            {/* More button */}
            <button
              className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full transition-colors cursor-pointer"
              style={{ color: "#9CA3AF" }}
              onClick={() => setMoreOpen(true)}
            >
              <Menu className="w-5 h-5" style={{ strokeWidth: 1.8 }} />
              <span className="text-[10px] font-medium">More</span>
            </button>
      </nav>

      {/* ── Mobile "More" slide-up drawer ───────────────────────────── */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end md:hidden"
          onClick={e => { if (e.target === e.currentTarget) setMoreOpen(false); }}
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          <div
            className="rounded-t-2xl overflow-hidden"
            style={{ background: "#ffffff", paddingBottom: "env(safe-area-inset-bottom, 16px)" }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "#E5E7EB" }} />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-2.5">
              <span className="text-[13px] font-bold" style={{ color: "#111827" }}>All Sections</span>
              <button onClick={() => setMoreOpen(false)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#F3F4F6" }}>
                <X className="w-3.5 h-3.5" style={{ color: "#6B7280" }} />
              </button>
            </div>
            {/* Nav grid */}
            <div className="grid grid-cols-4 gap-1 px-3 pb-2">
              {nav.filter(item => item.href === "/lead-bank" ? isAdmin : true).map(({ href, label, icon: Icon, accent }: any) => {
                const active = navIsActive(href);
                return (
                  <Link key={href} href={href} onClick={() => setMoreOpen(false)}>
                    <div
                      className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl cursor-pointer transition-all active:scale-95"
                      style={{
                        background: active ? (accent ?? "#1A3D2B") + "18" : "transparent",
                        color: active ? (accent ?? "#1A3D2B") : "#6B7280",
                      }}
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{
                          background: active ? (accent ?? "#1A3D2B") : "#F3F4F6",
                          color: active ? "#ffffff" : "#6B7280",
                        }}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-semibold text-center leading-tight" style={{ color: active ? (accent ?? "#1A3D2B") : "#6B7280" }}>
                        {label.replace("Command Center", "Home").replace("Outreach Engine", "Outreach").replace("AI Composer", "AI Composer").replace("BANT Qualifier", "BANT").replace("Brand Audit", "Audit").replace("ICP Manager", "ICP").replace("HubSpot CRM", "HubSpot").replace("Lead Bank", "Lead Bank")}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
            {/* Logout row */}
            <div className="mx-3 mb-2 mt-1" style={{ borderTop: "1px solid #F3F4F6", paddingTop: 8 }}>
              <button
                onClick={() => { setMoreOpen(false); doLogout(); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                style={{ color: "#DC2626" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#FEF2F2")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <LogOut className="w-4 h-4" />
                <span className="text-[13px] font-semibold">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

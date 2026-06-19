import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Radar, Zap, RefreshCw, TrendingUp,
  XCircle, ExternalLink, Building2, ArrowRight, Loader2,
  Target, Users, Globe, Brain, Search, Eye, EyeOff, MapPin,
} from "lucide-react";
import { usePlan } from "@/hooks/usePlan";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SignalPost {
  id: number;
  post_url: string | null;
  platform: string;
  title: string | null;
  body: string | null;
  author: string | null;
  subreddit: string | null;
  intent_type: string | null;
  confidence: number | null;
  is_buying_signal: boolean;
  company_mentioned: string | null;
  industry_hint: string | null;
  budget_hint: string | null;
  classifier_notes: string | null;
  dismissed_at: string | null;
  crawled_at: string | null;
  classified_at: string | null;
  entity_status: string | null;
  entity_email: string | null;
  entity_role: string | null;
  entity_location: string | null;
  entity_website: string | null;
  entity_name: string | null;
}

interface SignalStats {
  totalCrawled: number;
  totalSignals: number;
  dismissed: number;
  pendingClassification: number;
  byIntentType: { intent_type: string; count: number }[];
  byPlatform: { platform: string; count: number }[];
  entityQueue: { pending: number; done: number; failed: number };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const masked = local.slice(0, 1) + local.slice(1, 3).replace(/./g, "*") + "***";
  const [domainName] = domain.split(".");
  return `${masked}@${domainName ?? ""}`;
}

function EntityBlock({ signal }: { signal: SignalPost }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2.5 flex flex-col gap-1.5">
      <div className="text-[10px] font-bold text-violet-700 uppercase tracking-wider mb-0.5">Resolved Entity</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {(signal.entity_name || signal.company_mentioned) && (
          <span className="flex items-center gap-1 text-gray-700">
            <Building2 className="w-3 h-3 text-violet-400" />
            <strong>{signal.entity_name ?? signal.company_mentioned}</strong>
          </span>
        )}
        {signal.entity_role && (
          <span className="flex items-center gap-1 text-gray-600">
            <Users className="w-3 h-3 text-violet-400" /> {signal.entity_role}
          </span>
        )}
        {signal.entity_location && (
          <span className="flex items-center gap-1 text-gray-600">
            <MapPin className="w-3 h-3 text-violet-400" /> {signal.entity_location}
          </span>
        )}
        {signal.industry_hint && (
          <span className="flex items-center gap-1 text-gray-600">
            <Target className="w-3 h-3 text-violet-400" /> {signal.industry_hint}
          </span>
        )}
        {signal.entity_email && (
          <span className="flex items-center gap-1 text-gray-600">
            <span className="font-mono text-[10px]">
              {revealed ? signal.entity_email : maskEmail(signal.entity_email)}
            </span>
            <button
              onClick={() => setRevealed((v) => !v)}
              className="flex items-center gap-0.5 text-[10px] text-violet-600 hover:text-violet-700 font-semibold ml-0.5"
            >
              {revealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {revealed ? "Hide" : "Reveal"}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function platformColor(platform: string): { bg: string; text: string; border: string; label: string } {
  switch (platform) {
    case "reddit":        return { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE", label: "Reddit" };
    case "linkedin":      return { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", label: "LinkedIn" };
    case "indeed":        return { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", label: "Indeed" };
    case "naukri":        return { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", label: "Naukri" };
    case "google_maps":   return { bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0", label: "Google Maps" };
    case "twitter":       return { bg: "#F0F9FF", text: "#0369A1", border: "#BAE6FD", label: "Twitter/X" };
    case "job_board":     return { bg: "#FDF4FF", text: "#9333EA", border: "#E9D5FF", label: "Job Board" };
    default:              return { bg: "#F9FAFB", text: "#4B5563", border: "#E5E7EB", label: platform };
  }
}

function intentColor(intent: string | null): { bg: string; text: string; border: string; label: string } {
  switch (intent) {
    case "buying_intent":         return { bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0", label: "Buying Intent" };
    case "pain_point":            return { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", label: "Pain Point" };
    case "evaluation":            return { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE", label: "Evaluation" };
    case "competitor_complaint":  return { bg: "#FFF1F2", text: "#BE123C", border: "#FECDD3", label: "Competitor" };
    case "hiring_signal":         return { bg: "#FAF5FF", text: "#7E22CE", border: "#E9D5FF", label: "Hiring Signal" };
    case "funding_signal":        return { bg: "#F0FDFA", text: "#0F766E", border: "#99F6E4", label: "Funding Signal" };
    default:                      return { bg: "#F9FAFB", text: "#4B5563", border: "#E5E7EB", label: intent ?? "Signal" };
  }
}

function strengthPill(conf: number | null): { label: string; bg: string; text: string } {
  if (conf == null) return { label: "UNKNOWN", bg: "#F3F4F6", text: "#6B7280" };
  if (conf >= 0.80) return { label: "HIGH",   bg: "#D1FAE5", text: "#065F46" };
  if (conf >= 0.65) return { label: "MED",    bg: "#FEF3C7", text: "#92400E" };
  return               { label: "LOW",    bg: "#FEE2E2", text: "#991B1B" };
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type CardState = "idle" | "adding" | "added" | "dismissing";

function SignalCard({
  signal,
  onAddToPipeline,
  onDismiss,
}: {
  signal: SignalPost;
  onAddToPipeline: (id: number) => Promise<void>;
  onDismiss: (id: number) => void;
}) {
  const [, navigate] = useLocation();
  const [cardState, setCardState] = useState<CardState>("idle");
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(true);
  const [opacity, setOpacity] = useState(1);

  const plat = platformColor(signal.platform);
  const intent = intentColor(signal.intent_type);
  const strength = strengthPill(signal.confidence);

  const handleAdd = async () => {
    if (cardState !== "idle") return;
    setCardState("added");
    try {
      await onAddToPipeline(signal.id);
    } catch {
      setCardState("idle");
    }
  };

  const handleDismiss = () => {
    if (cardState === "dismissing" || cardState === "added") return;
    setCardState("dismissing");
    setOpacity(0);
    setTimeout(() => {
      setVisible(false);
      onDismiss(signal.id);
    }, 300);
  };

  const [auditTooltip, setAuditTooltip] = useState(false);

  const handleRunAudit = () => {
    const hasWebsite = !!signal.entity_website;
    if (hasWebsite) {
      const params = new URLSearchParams();
      if (signal.entity_website) params.set("url", signal.entity_website);
      if (signal.company_mentioned) params.set("company", signal.company_mentioned);
      navigate(`/audit?${params.toString()}`);
    } else {
      setAuditTooltip(true);
      setTimeout(() => setAuditTooltip(false), 2500);
    }
  };

  if (!visible) return null;

  const entityResolved = signal.entity_status === "done";

  const bodyPreview = (signal.body ?? "").length > 180 ? signal.body!.slice(0, 180) + "…" : signal.body;

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col gap-3 overflow-hidden"
      style={{ opacity, transition: "opacity 0.3s ease" }}
    >
      <div className="p-4 flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
              style={{ background: plat.bg, color: plat.text, borderColor: plat.border }}
            >
              {plat.label}
            </span>
            {signal.intent_type && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                style={{ background: intent.bg, color: intent.text, borderColor: intent.border }}
              >
                {intent.label}
              </span>
            )}
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: strength.bg, color: strength.text }}
            >
              {strength.label}
            </span>
          </div>
          <span className="text-[10px] text-gray-400 flex-shrink-0">{formatRelative(signal.crawled_at)}</span>
        </div>

        {/* Title */}
        {signal.title && (
          <div className="text-sm font-semibold text-gray-900 leading-snug">{signal.title}</div>
        )}

        {/* Body */}
        {signal.body && (
          <div className="text-xs text-gray-600 leading-relaxed">
            {expanded ? signal.body : bodyPreview}
            {(signal.body?.length ?? 0) > 180 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="ml-1 text-violet-600 hover:text-violet-700 font-semibold text-[11px]"
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
          {signal.company_mentioned && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" /> {signal.company_mentioned}
            </span>
          )}
          {signal.industry_hint && (
            <span className="flex items-center gap-1">
              <Target className="w-3 h-3" /> {signal.industry_hint}
            </span>
          )}
          {signal.budget_hint && (
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> {signal.budget_hint}
            </span>
          )}
          {signal.subreddit && (
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3" /> r/{signal.subreddit}
            </span>
          )}
          {signal.author && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" /> u/{signal.author}
            </span>
          )}
        </div>

        {/* Entity block — shown only when entity_status = 'done' (resolution complete) */}
        {entityResolved && (
          <EntityBlock signal={signal} />
        )}

        {/* AI notes */}
        {signal.classifier_notes && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
            <Brain className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 leading-snug">{signal.classifier_notes}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1">
          {cardState === "added" ? (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold"
              style={{ background: "#D1FAE5", color: "#065F46", border: "1px solid #BBF7D0" }}
            >
              ✓ In Pipeline
            </div>
          ) : (
            <button
              onClick={handleAdd}
              disabled={cardState !== "idle"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white disabled:opacity-60 transition-opacity"
              style={{ background: "#1A3D2B" }}
            >
              {cardState === "adding" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              {cardState === "adding" ? "Adding…" : "Add to Pipeline"}
            </button>
          )}

          <div className="relative">
            <button
              onClick={handleRunAudit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-violet-700 border border-violet-200 hover:bg-violet-50 transition-colors"
            >
              <Search className="w-3 h-3" /> Run Audit
            </button>
            {auditTooltip && (
              <div className="absolute bottom-full left-0 mb-1.5 z-20 bg-gray-800 text-white text-[10px] rounded-lg px-3 py-1.5 whitespace-nowrap shadow-lg">
                No company detected — can't run audit
              </div>
            )}
          </div>

          <button
            onClick={handleDismiss}
            disabled={cardState === "dismissing" || cardState === "added"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-gray-500 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {cardState === "dismissing" ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
            Dismiss
          </button>

          {signal.post_url && (
            <a
              href={signal.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 ml-auto transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> View post
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanGate({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="blur-sm pointer-events-none select-none">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/80 backdrop-blur-[2px] border border-violet-100 z-10">
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #7C3AED, #5C1A8C)" }}
          >
            <Radar className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900 mb-1">Signal Intelligence</div>
            <div className="text-xs text-gray-500 max-w-xs leading-relaxed">
              Signal Intelligence detects real-time B2B buyers from Reddit, LinkedIn, and job boards.
              Available on Growth plan.
            </div>
          </div>
          <Link href="/billing">
            <button
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white mt-1"
              style={{ background: "linear-gradient(135deg, #7C3AED, #5C1A8C)" }}
            >
              <Zap className="w-3.5 h-3.5" /> Upgrade to Growth <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

const INTENT_CHIPS = [
  { value: "",                    label: "All" },
  { value: "buying_intent",       label: "Buying Intent" },
  { value: "pain_point",          label: "Pain Points" },
  { value: "evaluation",          label: "Evaluating" },
  { value: "hiring_signal",       label: "Hiring" },
  { value: "funding_signal",      label: "Funding" },
  { value: "competitor_complaint",label: "Competitor" },
];

const LIMIT = 20;

export default function SignalFeed() {
  const { data: planData } = usePlan();
  const { toast } = useToast();

  const [signals, setSignals] = useState<SignalPost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [intentFilter, setIntentFilter] = useState("");

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const plan = planData?.plan ?? "";
  const isLocked = plan === "trial" || plan === "solo";

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/signal-feed/stats`, { credentials: "include" });
      if (res.ok) setStats(await res.json() as SignalStats);
    } catch { /* ignore */ }
  }, []);

  const fetchPage = useCallback(async (pageNum: number, replace: boolean, silent = false) => {
    if (!replace && !silent) setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), page: String(pageNum) });
      if (intentFilter) params.set("intent_type", intentFilter);
      const res = await fetch(`${BASE}/api/signal-feed?${params}`, { credentials: "include" });
      if (!res.ok) return;
      const d = await res.json() as { data: SignalPost[]; total: number; totalPages: number };
      const rows = d.data ?? [];
      if (replace) {
        setSignals(rows);
      } else {
        setSignals((prev) => {
          const ids = new Set(prev.map((s) => s.id));
          return [...prev, ...rows.filter((s) => !ids.has(s.id))];
        });
      }
      setTotal(d.total ?? 0);
      setHasMore(pageNum < (d.totalPages ?? 1));
    } finally {
      if (!replace && !silent) setLoadingMore(false);
    }
  }, [intentFilter]);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    setPage(1);
    await Promise.all([fetchPage(1, true), fetchStats()]);
    setLoading(false);
  }, [fetchPage, fetchStats]);

  const silentRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchPage(1, true, true), fetchStats()]);
    setPage(1);
    setRefreshing(false);
  }, [fetchPage, fetchStats]);

  useEffect(() => {
    void initialLoad();
    const id = setInterval(() => { void silentRefresh(); }, 60_000);
    return () => clearInterval(id);
  }, [intentFilter]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll sentinel
  const setSentinel = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect();
    sentinelRef.current = node;
    if (!node) return;
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingMore) {
        const nextPage = page + 1;
        setPage(nextPage);
        void fetchPage(nextPage, false);
      }
    }, { threshold: 0.1 });
    observerRef.current.observe(node);
  }, [hasMore, loadingMore, page, fetchPage]);

  const handleAddToPipeline = async (id: number): Promise<void> => {
    const res = await fetch(`${BASE}/api/signal-feed/${id}/add-to-pipeline`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      toast({ title: "Added to pipeline", description: "Signal converted to a new lead." });
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string };
      toast({ title: "Failed", description: d.error ?? "Could not add to pipeline", variant: "destructive" });
      throw new Error(d.error ?? "Could not add to pipeline");
    }
  };

  const handleDismiss = (id: number) => {
    fetch(`${BASE}/api/signal-feed/${id}/dismiss`, { method: "POST", credentials: "include" }).catch(() => {});
    setSignals((prev) => prev.filter((s) => s.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  };

  const statsCards = [
    { label: "Live Signals",   value: stats?.totalSignals         ?? 0, color: "#7C3AED" },
    { label: "Crawled Posts",  value: stats?.totalCrawled         ?? 0, color: "#0D9488" },
    { label: "Dismissed",      value: stats?.dismissed            ?? 0, color: "#6B7280" },
    { label: "In Enrichment",  value: stats?.entityQueue?.pending ?? 0, color: "#D97706" },
  ];

  const feedContent = (
    <>
      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {INTENT_CHIPS.map((chip) => {
          const ic = chip.value ? intentColor(chip.value) : null;
          const active = intentFilter === chip.value;
          const count = chip.value
            ? (stats?.byIntentType.find((x) => x.intent_type === chip.value)?.count ?? 0)
            : (stats?.totalSignals ?? 0);
          return (
            <button
              key={chip.value}
              onClick={() => { setIntentFilter(chip.value); }}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap flex-shrink-0 transition-all"
              style={{
                background: active ? (ic?.bg ?? "#EDE9FE") : "#fff",
                color: active ? (ic?.text ?? "#6D28D9") : "#4B5563",
                borderColor: active ? (ic?.border ?? "#C4B5FD") : "#E5E7EB",
              }}
            >
              {chip.label}
              {count > 0 && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: active ? (ic?.text ?? "#6D28D9") : "#F3F4F6",
                    color: active ? (ic?.bg ?? "#EDE9FE") : "#6B7280",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <span className="text-[11px] text-gray-400 self-center ml-auto flex-shrink-0">{total} signals</span>
      </div>

      {/* Signal list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : signals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center py-16 gap-3">
          <style>{`
            @keyframes radar-pulse { 0%{transform:scale(0.4);opacity:0.7} 100%{transform:scale(1.9);opacity:0} }
            .rp1{animation:radar-pulse 2s ease-out infinite}
            .rp2{animation:radar-pulse 2s ease-out 0.7s infinite}
          `}</style>
          <div className="relative">
            <div className="rp1 absolute rounded-full border border-violet-300 w-14 h-14 -top-3 -left-3" />
            <div className="rp2 absolute rounded-full border border-violet-200 w-14 h-14 -top-3 -left-3" />
            <Radar className="w-8 h-8 text-violet-400 relative z-10" />
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-gray-700">Signal monitoring is active</div>
            <div className="text-xs text-gray-400 mt-1">First signals will appear within 15 minutes.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {signals.map((s) => (
              <SignalCard
                key={s.id}
                signal={s}
                onAddToPipeline={handleAddToPipeline}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
          {/* Infinite scroll sentinel */}
          <div ref={setSentinel} className="h-4" />
          {loadingMore && (
            <div className="flex justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          )}
          {!hasMore && signals.length > 0 && (
            <div className="text-center text-[11px] text-gray-400 py-2">All {total} signals loaded</div>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Radar className="w-5 h-5 text-violet-500" />
            <h1 className="text-base md:text-lg font-bold text-foreground">Signal Feed</h1>
            {!isLocked && (
              <span
                className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "#F0FDF4", color: "#15803D", border: "1px solid #BBF7D0" }}
              >
                LIVE
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time buying signals from Reddit, LinkedIn, job boards &amp; Google Maps
          </p>
        </div>
        <button
          onClick={() => void silentRefresh()}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {statsCards.map((c) => (
          <div key={c.label} className="rounded-xl border border-gray-200 bg-white shadow-sm p-3.5 flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{c.label}</span>
            <span className="text-xl font-bold" style={{ color: c.color }}>{c.value}</span>
          </div>
        ))}
      </div>

      {/* Feed — plan-gated or open */}
      <div className="space-y-3">
        {isLocked ? (
          <PlanGate>
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="rounded-xl border border-gray-200 bg-white p-4 h-32 opacity-60" />
              ))}
            </div>
          </PlanGate>
        ) : feedContent}
      </div>

      {/* Settings shortcut */}
      <Link href="/settings?tab=signal">
        <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 hover:border-gray-200 cursor-pointer transition-colors">
          <span className="text-[11px] text-gray-500 font-medium">Configure Signal Intelligence settings</span>
          <ArrowRight className="w-4 h-4 text-gray-400" />
        </div>
      </Link>
    </div>
  );
}

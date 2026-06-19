import { useState } from "react";
import { useGetQualifyQueue, useSaveBantScore, useAiScoreLead, useExplainBantScores } from "@workspace/api-client-react";
import { getGetQualifyQueueQueryKey } from "@workspace/api-client-react";
import type { Lead, AiBantScore } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { bandColorFromKey, bandLabelFromKey, scoreToBandKey, bantBandMeta, auditScoreTextClass } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Zap, CheckSquare, ChevronRight, Mail, Clock, X, UserCheck, Layers, Sparkles, Brain, Star } from "lucide-react";

const API_BASE = "/api";

const BANT_DIMS = [
  { key: "budget" as const, label: "Budget", desc: "Does the prospect have budget allocated?" },
  { key: "authority" as const, label: "Authority", desc: "Is this the decision maker?" },
  { key: "need" as const, label: "Need", desc: "How strong is their need for design?" },
  { key: "timeline" as const, label: "Timeline", desc: "How urgent is their timeline?" },
];

type BantScores = { budget: number; authority: number; need: number; timeline: number };

const INITIAL_SCORES: BantScores = { budget: 12, authority: 12, need: 12, timeline: 12 };

type BeliefSignals = { linkedin: boolean; aboutPage: boolean; founderStory: boolean; mission: boolean };
type BeliefData = { score: number; reason: string; evidence: string; signals: BeliefSignals };
const INITIAL_BELIEF: BeliefData = {
  score: 0, reason: "", evidence: "",
  signals: { linkedin: false, aboutPage: false, founderStory: false, mission: false },
};

type RoutingResult = { action: string; message: string; nextStatus: string; leadName: string; total: number; bantbTotal: number; color: string; bg: string };

const ROUTING_ACTIONS: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; description: string }> = {
  priority_believer: {
    label: "Assign to Krishna",
    icon: <Star className="w-4 h-4" />,
    color: "#D97706",
    bg: "rgba(217,119,6,0.12)",
    description: "PRIORITY BELIEVER — assign directly and book discovery call",
  },
  qualified_believer: {
    label: "WHY-First Email",
    icon: <Brain className="w-4 h-4" />,
    color: "#0D9488",
    bg: "rgba(13,148,136,0.12)",
    description: "QUALIFIED BELIEVER — send belief-aligned outreach email",
  },
  qualified_standard: {
    label: "Standard Outreach",
    icon: <Mail className="w-4 h-4" />,
    color: "#3B82F6",
    bg: "rgba(59,130,246,0.12)",
    description: "QUALIFIED STANDARD — send standard booking email",
  },
  nurture_belief: {
    label: "Belief-Building Content",
    icon: <Clock className="w-4 h-4" />,
    color: "#F59E0B",
    bg: "rgba(245,158,11,0.12)",
    description: "NURTURE — send belief-building content over 30 days",
  },
  cold: {
    label: "Newsletter Only",
    icon: <Mail className="w-4 h-4" />,
    color: "#6B7280",
    bg: "rgba(107,114,128,0.12)",
    description: "COLD — add to newsletter list only",
  },
  // legacy keys kept for backward compat
  assign_to_krishna: {
    label: "Assign to Krishna",
    icon: <UserCheck className="w-4 h-4" />,
    color: "#22C55E",
    bg: "rgba(34,197,94,0.1)",
    description: "Assign to Krishna and book discovery call immediately",
  },
  send_booking_email: {
    label: "Send Booking Email",
    icon: <Mail className="w-4 h-4" />,
    color: "#F59E0B",
    bg: "rgba(245,158,11,0.1)",
    description: "Send a meeting booking email to this qualified lead",
  },
  add_to_nurture: {
    label: "Add to 30-Day Nurture",
    icon: <Clock className="w-4 h-4" />,
    color: "#3B82F6",
    bg: "rgba(59,130,246,0.1)",
    description: "Enrol in the warm lead nurture sequence for 30 days",
  },
  add_to_newsletter: {
    label: "Add to Newsletter",
    icon: <Mail className="w-4 h-4" />,
    color: "#6B7280",
    bg: "rgba(107,114,128,0.1)",
    description: "Move to newsletter list — not ready for pipeline",
  },
};

function beliefBadgeColor(score: number) {
  if (score >= 18) return { text: "#059669", bg: "#ECFDF5", border: "#6EE7B7" };
  if (score >= 9) return { text: "#D97706", bg: "#FFFBEB", border: "#FCD34D" };
  return { text: "#DC2626", bg: "#FEF2F2", border: "#FCA5A5" };
}

function beliefLabel(score: number) {
  if (score >= 18) return "HIGH BELIEF";
  if (score >= 9) return "MEDIUM BELIEF";
  return "LOW BELIEF";
}

export default function Qualify() {
  const qc = useQueryClient();
  const { data: queue = [], isLoading } = useGetQualifyQueue({ query: { queryKey: getGetQualifyQueueQueryKey() } });
  const [active, setActive] = useState<number | null>(null);
  const [scores, setScores] = useState<BantScores>(INITIAL_SCORES);
  const [belief, setBelief] = useState<BeliefData>(INITIAL_BELIEF);
  const [aiReasons, setAiReasons] = useState<AiBantScore | null>(null);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [routingResult, setRoutingResult] = useState<RoutingResult | null>(null);
  const [bulkResult, setBulkResult] = useState<{ scored: number } | null>(null);
  const [hasScoresNoReasoning, setHasScoresNoReasoning] = useState(false);
  const [beliefLoading, setBeliefLoading] = useState(false);

  const bulkScore = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/qualify/bulk-score`, { method: "POST", headers: { "Content-Type": "application/json" } });
      return res.json() as Promise<{ scored: number }>;
    },
    onSuccess: (data) => {
      setBulkResult(data);
      qc.invalidateQueries({ queryKey: getGetQualifyQueueQueryKey() });
    },
  });

  const saveScore = useSaveBantScore({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getGetQualifyQueueQueryKey() });
        const d = data as Lead & { routing?: { action: string; message: string; nextStatus: string; color?: string; bg?: string } };
        if (d.routing) {
          const bantTotal = scores.budget + scores.authority + scores.need + scores.timeline;
          const bantbTotal = bantTotal + belief.score;
          setRoutingResult({
            action: d.routing.action,
            message: d.routing.message,
            nextStatus: d.routing.nextStatus,
            leadName: `${d.firstName} ${d.lastName}`,
            total: d.bantScore ?? bantTotal,
            bantbTotal,
            color: d.routing.color ?? "#22C55E",
            bg: d.routing.bg ?? "rgba(34,197,94,0.1)",
          });
        }
        setScores(INITIAL_SCORES);
        setBelief(INITIAL_BELIEF);
        setAiReasons(null);
        setAiReasoning(null);
        setHasScoresNoReasoning(false);
      },
    },
  });

  const aiScore = useAiScoreLead({
    mutation: {
      onSuccess: (data: AiBantScore) => {
        setScores({
          budget: Math.min(25, Math.round(data.budget?.score ?? 12)),
          authority: Math.min(25, Math.round(data.authority?.score ?? 12)),
          need: Math.min(25, Math.round(data.need?.score ?? 12)),
          timeline: Math.min(25, Math.round(data.timeline?.score ?? 12)),
        });
        setAiReasons(data);
        setAiReasoning(data.reasoning ?? null);
        setHasScoresNoReasoning(false);
        qc.invalidateQueries({ queryKey: getGetQualifyQueueQueryKey() });
      },
    },
  });

  const explainScores = useExplainBantScores({
    mutation: {
      onSuccess: (data: AiBantScore) => {
        setScores({
          budget: Math.min(25, Math.round(data.budget?.score ?? 12)),
          authority: Math.min(25, Math.round(data.authority?.score ?? 12)),
          need: Math.min(25, Math.round(data.need?.score ?? 12)),
          timeline: Math.min(25, Math.round(data.timeline?.score ?? 12)),
        });
        setAiReasons(data);
        setAiReasoning(data.reasoning ?? null);
        setHasScoresNoReasoning(false);
        qc.invalidateQueries({ queryKey: getGetQualifyQueueQueryKey() });
      },
    },
  });

  async function aiScoreBelief(leadId: number) {
    setBeliefLoading(true);
    try {
      const res = await fetch(`${API_BASE}/qualify/${leadId}/belief`, { method: "POST", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setBelief({
          score: data.beliefScore ?? 0,
          reason: data.beliefReason ?? "",
          evidence: data.beliefEvidence ?? "",
          signals: data.beliefSignals ?? INITIAL_BELIEF.signals,
        });
        qc.invalidateQueries({ queryKey: getGetQualifyQueueQueryKey() });
      }
    } finally {
      setBeliefLoading(false);
    }
  }

  const activeLead: Lead | undefined = queue.find((l) => l.id === active);
  const bantTotal = scores.budget + scores.authority + scores.need + scores.timeline;
  const bantbTotal = bantTotal + belief.score;
  const routing = bantBandMeta(bantTotal);

  function selectLead(lead: Lead) {
    setActive(lead.id);
    setRoutingResult(null);
    const l = lead as Lead & { beliefScore?: number; beliefReason?: string; beliefEvidence?: string; beliefSignals?: BeliefSignals; bantbTotal?: number };
    const bd = lead.bantBreakdown as Record<string, unknown> | null | undefined;
    if (bd && typeof bd === "object" && typeof bd.budget === "number") {
      const budgetScore = bd.budget as number;
      const authorityScore = typeof bd.authority === "number" ? bd.authority : INITIAL_SCORES.authority;
      const needScore = typeof bd.need === "number" ? bd.need : INITIAL_SCORES.need;
      const timelineScore = typeof bd.timeline === "number" ? bd.timeline : INITIAL_SCORES.timeline;
      setScores({ budget: budgetScore, authority: authorityScore, need: needScore, timeline: timelineScore });
      const reasoning = bd.reasoning as Record<string, string> | undefined;
      if (reasoning && typeof reasoning === "object") {
        const combinedReasoning = `Budget: ${reasoning.budget ?? ""} Authority: ${reasoning.authority ?? ""} Need: ${reasoning.need ?? ""} Timeline: ${reasoning.timeline ?? ""}`;
        setAiReasons({
          budget: { score: budgetScore, reason: reasoning.budget ?? "" },
          authority: { score: authorityScore, reason: reasoning.authority ?? "" },
          need: { score: needScore, reason: reasoning.need ?? "" },
          timeline: { score: timelineScore, reason: reasoning.timeline ?? "" },
          totalScore: budgetScore + authorityScore + needScore + timelineScore,
          reasoning: combinedReasoning,
        });
        setAiReasoning(combinedReasoning);
        setHasScoresNoReasoning(false);
      } else {
        setAiReasons(null); setAiReasoning(null); setHasScoresNoReasoning(true);
      }
    } else {
      setScores(INITIAL_SCORES); setAiReasons(null); setAiReasoning(null); setHasScoresNoReasoning(false);
    }
    // Restore belief data if previously scored
    setBelief({
      score: l.beliefScore ?? 0,
      reason: l.beliefReason ?? "",
      evidence: l.beliefEvidence ?? "",
      signals: (l.beliefSignals as BeliefSignals | null) ?? INITIAL_BELIEF.signals,
    });
  }

  const dismissRouting = () => { setRoutingResult(null); setActive(null); };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">BANTB Qualifier</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{queue.length} leads in qualification queue — BANT + Belief Alignment (max 125)</p>
        </div>
        <div className="flex items-center gap-2">
          {bulkResult && (
            <span className="text-[11px] text-teal-600 bg-teal-50 border border-teal-200 px-2 py-1 rounded">{bulkResult.scored} leads scored</span>
          )}
          <button
            onClick={() => bulkScore.mutate()}
            disabled={bulkScore.isPending || queue.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
            style={{ background: "#1A7A45", color: "white" }}
          >
            <Layers className="w-3.5 h-3.5" />
            {bulkScore.isPending ? "Scoring..." : `Bulk AI Score All (${queue.length})`}
          </button>
        </div>
      </div>

      {routingResult && (
        <div className="rounded-lg border p-4 flex items-start gap-4" style={{ borderColor: routingResult.color + "40", background: routingResult.bg }}>
          <div className="flex-1">
            <div className="text-xs text-muted-foreground mb-1">
              Lead scored — <span className="text-foreground font-medium">{routingResult.leadName}</span>
              <span className="ml-2 text-[11px]">BANT: <b>{routingResult.total}</b>/100 · Belief: <b>{routingResult.bantbTotal - routingResult.total}</b>/25 · BANTB: <b>{routingResult.bantbTotal}</b>/125</span>
            </div>
            <div className="text-sm font-semibold mb-3" style={{ color: routingResult.color }}>{routingResult.message}</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(ROUTING_ACTIONS).filter(([key]) => ["priority_believer","qualified_believer","qualified_standard","nurture_belief","cold"].includes(key)).map(([key, ra]) => (
                <button
                  key={key}
                  onClick={dismissRouting}
                  className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium border transition-colors", routingResult.action === key ? "opacity-100" : "opacity-35 hover:opacity-60")}
                  style={{ color: ra.color, background: routingResult.action === key ? ra.bg : "transparent", borderColor: ra.color + "40" }}
                  title={ra.description}
                >
                  {ra.icon}{ra.label}
                  {routingResult.action === key && <span className="ml-1 text-[10px] font-bold">← Recommended</span>}
                </button>
              ))}
            </div>
          </div>
          <button onClick={dismissRouting} className="text-muted-foreground hover:text-gray-900 flex-shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-5 gap-4" style={{ height: "calc(100vh - 200px)" }}>
        {/* ── Lead queue ── */}
        <div className="col-span-2 rounded-lg border border-gray-200 overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-gray-200 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Qualification Queue</div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">{[1,2,3].map((i) => <div key={i} className="h-12 rounded animate-pulse" />)}</div>
            ) : queue.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />Queue is empty — all leads scored
              </div>
            ) : queue.map((lead) => {
              const lExt = lead as Lead & { auditHealthScore?: number; beliefScore?: number; bantbTotal?: number };
              const bs = lExt.beliefScore ?? 0;
              const bc = beliefBadgeColor(bs);
              return (
                <button
                  key={lead.id}
                  onClick={() => selectLead(lead)}
                  className={cn("w-full text-left px-3 py-2.5 border-b border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-between", active === lead.id && "bg-teal-50 border-l-2 border-teal-500")}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground">{lead.firstName} {lead.lastName}</div>
                    <div className="text-[11px] text-muted-foreground">{lead.company} · {lead.designation}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-gray-400">{lead.industry} · {lead.country}</span>
                      {lExt.auditHealthScore != null && (
                        <span className={cn("text-[10px] font-semibold", auditScoreTextClass(lExt.auditHealthScore))}>◆ {lExt.auditHealthScore}</span>
                      )}
                      {bs > 0 && (
                        <span className="text-[9px] font-bold px-1 rounded" style={{ color: bc.text, background: bc.bg, border: `1px solid ${bc.border}` }}>B:{bs}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Scoring panel ── */}
        <div className="col-span-3 rounded-lg border border-gray-200 flex flex-col">
          {!activeLead ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              <div className="text-center">
                <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />Select a lead to score
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-foreground">{activeLead.firstName} {activeLead.lastName}</div>
                  <div className="text-xs text-muted-foreground">{activeLead.designation} at {activeLead.company}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => activeLead && aiScoreBelief(activeLead.id)}
                    disabled={beliefLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                    style={{ background: "#0F766E", color: "white" }}
                  >
                    <Brain className="w-3.5 h-3.5" />
                    {beliefLoading ? "Scoring..." : "AI Score Belief"}
                  </button>
                  <button
                    onClick={() => aiScore.mutate({ leadId: activeLead.id })}
                    disabled={aiScore.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                    style={{ background: "#F59E0B", color: "#1E293B" }}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {aiScore.isPending ? "Scoring..." : "AI Auto-Score"}
                  </button>
                </div>
              </div>

              <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                {/* ── 4 BANT dimensions ── */}
                {BANT_DIMS.map(({ key, label, desc }) => {
                  const score = scores[key];
                  const reason = aiReasons?.[key]?.reason;
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <span className="text-xs font-semibold text-foreground">{label}</span>
                          <span className="text-[11px] text-muted-foreground ml-2">{desc}</span>
                        </div>
                        <span className={cn("text-sm font-bold", bandColorFromKey(scoreToBandKey(score * 4)))}>{score}<span className="text-[10px] text-muted-foreground">/25</span></span>
                      </div>
                      <input
                        type="range" min={0} max={25} step={1} value={score}
                        onChange={(e) => setScores((s) => ({ ...s, [key]: Number(e.target.value) }))}
                        className="w-full h-1.5 rounded appearance-none cursor-pointer"
                        style={{ accentColor: "#1A7A45" }}
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0 — None</span><span>25 — Confirmed</span></div>
                      {reason && (
                        <div className="mt-1 text-[11px] text-amber-600/80 bg-amber-50 border border-amber-500/20 rounded px-2 py-1">{reason}</div>
                      )}
                    </div>
                  );
                })}

                {/* ── 5th card: Belief Alignment ── */}
                <div className="rounded-lg border-2 p-3 space-y-3" style={{ borderColor: "#0D9488", background: "#F0FDFA" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="w-4 h-4" style={{ color: "#0D9488" }} />
                      <span className="text-xs font-bold" style={{ color: "#0F766E" }}>Belief Alignment</span>
                      <span className="text-[11px] text-teal-600/70">Does their WHY match ours?</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {belief.score > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{
                          color: beliefBadgeColor(belief.score).text,
                          background: beliefBadgeColor(belief.score).bg,
                          border: `1px solid ${beliefBadgeColor(belief.score).border}`,
                        }}>{beliefLabel(belief.score)}</span>
                      )}
                      <span className="text-sm font-bold" style={{ color: "#0D9488" }}>{belief.score}<span className="text-[10px] text-teal-500/60">/25</span></span>
                    </div>
                  </div>

                  <input
                    type="range" min={0} max={25} step={1} value={belief.score}
                    onChange={(e) => setBelief((b) => ({ ...b, score: Number(e.target.value) }))}
                    className="w-full h-1.5 rounded appearance-none cursor-pointer"
                    style={{ accentColor: "#0D9488" }}
                  />
                  <div className="flex justify-between text-[10px] text-teal-500/60">
                    <span>0 — Purely transactional</span>
                    <span>25 — Clear mission, clear WHY</span>
                  </div>

                  {/* Signal chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {(["linkedin", "aboutPage", "founderStory", "mission"] as const).map((sig) => {
                      const labels: Record<string, string> = { linkedin: "LinkedIn Active", aboutPage: "About Page Story", founderStory: "Founder Mission", mission: "Mission Statement" };
                      const active = belief.signals[sig];
                      return (
                        <button
                          key={sig}
                          onClick={() => setBelief((b) => ({ ...b, signals: { ...b.signals, [sig]: !b.signals[sig] } }))}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all"
                          style={active
                            ? { color: "#059669", background: "#ECFDF5", borderColor: "#6EE7B7" }
                            : { color: "#9CA3AF", background: "#F9FAFB", borderColor: "#E5E7EB" }
                          }
                        >
                          <span>{active ? "✓" : "✗"}</span>
                          {labels[sig]}
                        </button>
                      );
                    })}
                  </div>

                  {belief.reason && (
                    <div className="text-[11px] rounded px-2 py-1.5" style={{ background: "#CCFBF1", color: "#0F766E", border: "1px solid #99F6E4" }}>
                      <span className="font-semibold">Reason: </span>{belief.reason}
                    </div>
                  )}
                  {belief.evidence && (
                    <div className="text-[11px] rounded px-2 py-1.5 italic" style={{ background: "white", color: "#0F766E", border: "1px solid #99F6E4" }}>
                      <span className="font-semibold not-italic">Evidence: </span>"{belief.evidence}"
                    </div>
                  )}
                  {!belief.reason && (
                    <p className="text-[11px] text-teal-600/60">Click "AI Score Belief" to analyse this lead's WHY alignment, or adjust the slider manually.</p>
                  )}
                </div>

                {hasScoresNoReasoning && !aiReasoning && (
                  <div className="rounded-lg border border-blue-300/40 bg-blue-50/60 p-3 flex items-start gap-3">
                    <Sparkles className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold text-blue-700 mb-0.5">No AI reasoning on file</div>
                      <p className="text-[11px] text-blue-600/80 leading-relaxed mb-2">This lead was scored before AI reasoning was added. Click below to generate explanations — scores won't change.</p>
                      <button
                        onClick={() => activeLead && explainScores.mutate({ leadId: activeLead.id })}
                        disabled={explainScores.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium disabled:opacity-50 border border-blue-400/40"
                        style={{ background: "rgba(59,130,246,0.12)", color: "#2563EB" }}
                      >
                        <Sparkles className="w-3 h-3" />
                        {explainScores.isPending ? "Generating..." : "Explain Scores"}
                      </button>
                    </div>
                  </div>
                )}

                {aiReasoning && (
                  <div className="rounded-lg border border-amber-300/40 bg-amber-50/60 p-3">
                    <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Zap className="w-3 h-3" /> AI Analysis Summary
                    </div>
                    <p className="text-[11px] text-amber-800/90 leading-relaxed">{aiReasoning}</p>
                  </div>
                )}
              </div>

              {/* ── Footer: totals + save ── */}
              <div className="px-4 py-3 border-t border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-xs text-muted-foreground">BANT: </span>
                      <span className={cn("text-base font-black ml-0.5", bandColorFromKey(scoreToBandKey(bantTotal)))}>{bantTotal}</span>
                      <span className="text-[10px] text-muted-foreground">/100</span>
                    </div>
                    <span className="text-gray-300">+</span>
                    <div>
                      <span className="text-xs text-muted-foreground">Belief: </span>
                      <span className="text-base font-black ml-0.5" style={{ color: "#0D9488" }}>{belief.score}</span>
                      <span className="text-[10px] text-muted-foreground">/25</span>
                    </div>
                    <span className="text-gray-300">=</span>
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground">BANTB: </span>
                      <span className="text-xl font-black ml-0.5" style={{ color: bantbTotal >= 100 ? "#D97706" : bantbTotal >= 80 ? "#0D9488" : bantbTotal >= 50 ? "#3B82F6" : "#6B7280" }}>{bantbTotal}</span>
                      <span className="text-[10px] text-muted-foreground">/125</span>
                    </div>
                  </div>
                  <div className="text-xs font-medium px-2 py-1 rounded" style={{ color: routing.color, background: `${routing.color}20`, border: `1px solid ${routing.color}40` }}>
                    {routing.label}
                  </div>
                </div>
                <button
                  onClick={() => saveScore.mutate({
                    leadId: activeLead.id,
                    data: {
                      budget: scores.budget,
                      authority: scores.authority,
                      need: scores.need,
                      timeline: scores.timeline,
                      beliefScore: belief.score,
                      beliefReason: belief.reason || undefined,
                      beliefEvidence: belief.evidence || undefined,
                      beliefSignals: belief.signals,
                      ...(aiReasons ? {
                        reasoning: {
                          budget: aiReasons.budget?.reason,
                          authority: aiReasons.authority?.reason,
                          need: aiReasons.need?.reason,
                          timeline: aiReasons.timeline?.reason,
                        },
                      } : {}),
                    } as Parameters<typeof saveScore.mutate>[0]["data"],
                  })}
                  disabled={saveScore.isPending}
                  className="w-full py-2 rounded text-xs text-white font-semibold disabled:opacity-50"
                  style={{ background: "#1A7A45" }}
                >
                  {saveScore.isPending ? "Saving..." : "Save BANTB Score & Route Lead"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

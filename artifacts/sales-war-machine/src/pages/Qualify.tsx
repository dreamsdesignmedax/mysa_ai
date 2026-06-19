import { useState } from "react";
import { useGetQualifyQueue, useSaveBantScore, useAiScoreLead, useExplainBantScores } from "@workspace/api-client-react";
import { getGetQualifyQueueQueryKey } from "@workspace/api-client-react";
import type { Lead, AiBantScore } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { scoreToBandKey, bandColorFromKey, bandLabelFromKey, bantBandMeta, auditScoreTextClass } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Zap, CheckSquare, ChevronRight, Mail, Clock, X, UserCheck, Layers, Sparkles } from "lucide-react";

const API_BASE = "/api";

const BANT_DIMS = [
  { key: "budget" as const, label: "Budget", desc: "Does the prospect have budget allocated?" },
  { key: "authority" as const, label: "Authority", desc: "Is this the decision maker?" },
  { key: "need" as const, label: "Need", desc: "How strong is their need for design?" },
  { key: "timeline" as const, label: "Timeline", desc: "How urgent is their timeline?" },
];

type BantScores = { budget: number; authority: number; need: number; timeline: number };

const INITIAL_SCORES: BantScores = { budget: 12, authority: 12, need: 12, timeline: 12 };

type RoutingResult = { action: string; message: string; nextStatus: string; leadName: string; total: number };

const ROUTING_ACTIONS: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; description: string }> = {
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

function getLocalRouting(total: number): { label: string; color: string } {
  return bantBandMeta(total);
}

export default function Qualify() {
  const qc = useQueryClient();
  const { data: queue = [], isLoading } = useGetQualifyQueue({ query: { queryKey: getGetQualifyQueueQueryKey() } });
  const [active, setActive] = useState<number | null>(null);
  const [scores, setScores] = useState<BantScores>(INITIAL_SCORES);
  const [aiReasons, setAiReasons] = useState<AiBantScore | null>(null);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [routingResult, setRoutingResult] = useState<RoutingResult | null>(null);
  const [bulkResult, setBulkResult] = useState<{ scored: number } | null>(null);
  const [hasScoresNoReasoning, setHasScoresNoReasoning] = useState(false);

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
        const d = data as Lead & { routing?: { action: string; message: string; nextStatus: string } };
        if (d.routing) {
          setRoutingResult({
            action: d.routing.action,
            message: d.routing.message,
            nextStatus: d.routing.nextStatus,
            leadName: `${d.firstName} ${d.lastName}`,
            total: d.bantScore ?? 0,
          });
        }
        setScores(INITIAL_SCORES);
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

  const activeLead: Lead | undefined = queue.find((l) => l.id === active);
  const total = scores.budget + scores.authority + scores.need + scores.timeline;
  const routing = getLocalRouting(total);

  function selectLead(lead: Lead) {
    setActive(lead.id);
    setRoutingResult(null);
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
        setAiReasons(null);
        setAiReasoning(null);
        setHasScoresNoReasoning(true);
      }
    } else {
      setScores(INITIAL_SCORES);
      setAiReasons(null);
      setAiReasoning(null);
      setHasScoresNoReasoning(false);
    }
  }

  const dismissRouting = () => {
    setRoutingResult(null);
    setActive(null);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">BANT Qualifier</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{queue.length} leads in qualification queue — sorted by audit health score</p>
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
        <div className="rounded-lg border p-4 flex items-start gap-4" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <div className="flex-1">
            <div className="text-xs text-muted-foreground mb-1">Lead scored — recommended action for <span className="text-foreground font-medium">{routingResult.leadName}</span> (score: {routingResult.total})</div>
            <div className="text-sm font-semibold text-foreground mb-3">{routingResult.message}</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(ROUTING_ACTIONS).map(([key, ra]) => (
                <button
                  key={key}
                  onClick={dismissRouting}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium border transition-colors",
                    routingResult.action === key
                      ? "opacity-100 scale-105"
                      : "opacity-40 hover:opacity-70",
                  )}
                  style={{
                    color: ra.color,
                    background: routingResult.action === key ? ra.bg : "transparent",
                    borderColor: ra.color + "40",
                  }}
                  title={ra.description}
                >
                  {ra.icon}
                  {ra.label}
                  {routingResult.action === key && <span className="ml-1 text-[10px] font-bold">← Recommended</span>}
                </button>
              ))}
            </div>
          </div>
          <button onClick={dismissRouting} className="text-muted-foreground hover:text-gray-900 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-5 gap-4" style={{ height: "calc(100vh - 200px)" }}>
        <div className="col-span-2 rounded-lg border border-gray-200 overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-gray-200 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Qualification Queue</div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded animate-pulse" />)}
              </div>
            ) : queue.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Queue is empty — all leads scored
              </div>
            ) : (
              queue.map((lead) => {
                const lWithAudit = lead as Lead & { auditHealthScore?: number };
                return (
                  <button
                    key={lead.id}
                    onClick={() => selectLead(lead)}
                    className={cn("w-full text-left px-3 py-2.5 border-b border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-between", active === lead.id && "bg-teal-50 border-l-2 border-teal-500")}
                  >
                    <div>
                      <div className="text-xs font-medium text-foreground">{lead.firstName} {lead.lastName}</div>
                      <div className="text-[11px] text-muted-foreground">{lead.company} · {lead.designation}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-400">{lead.industry} · {lead.country}</span>
                        {lWithAudit.auditHealthScore != null && (
                          <span className={cn("text-[10px] font-semibold", auditScoreTextClass(lWithAudit.auditHealthScore))}>
                            ◆ {lWithAudit.auditHealthScore}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="col-span-3 rounded-lg border border-gray-200 flex flex-col">
          {!activeLead ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              <div className="text-center">
                <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Select a lead to score
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-foreground">{activeLead.firstName} {activeLead.lastName}</div>
                  <div className="text-xs text-muted-foreground">{activeLead.designation} at {activeLead.company}</div>
                </div>
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

              <div className="flex-1 p-4 space-y-5 overflow-y-auto">
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
                        type="range"
                        min={0}
                        max={25}
                        step={1}
                        value={score}
                        onChange={(e) => setScores((s) => ({ ...s, [key]: Number(e.target.value) }))}
                        className="w-full h-1.5 rounded appearance-none cursor-pointer"
                        style={{ accentColor: "#1A7A45" }}
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                        <span>0 — None</span><span>25 — Confirmed</span>
                      </div>
                      {reason && (
                        <div className="mt-1 text-[11px] text-amber-600/80 bg-amber-50 border border-amber-500/20 rounded px-2 py-1">{reason}</div>
                      )}
                    </div>
                  );
                })}

                {hasScoresNoReasoning && !aiReasoning && (
                  <div className="rounded-lg border border-blue-300/40 bg-blue-50/60 p-3 flex items-start gap-3">
                    <Sparkles className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold text-blue-700 mb-0.5">No AI reasoning on file</div>
                      <p className="text-[11px] text-blue-600/80 leading-relaxed mb-2">
                        This lead was scored before AI reasoning was added. Click below to generate explanations for the existing scores — scores won't change.
                      </p>
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

              <div className="px-4 py-3 border-t border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs text-muted-foreground">Total BANT Score: </span>
                    <span className={cn("text-lg font-black ml-1", bandColorFromKey(scoreToBandKey(total)))}>{total}</span>
                    <span className={cn("text-xs ml-2 font-medium", bandColorFromKey(scoreToBandKey(total)))}>{bandLabelFromKey(scoreToBandKey(total))}</span>
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
                      ...(aiReasons ? {
                        reasoning: {
                          budget: aiReasons.budget?.reason,
                          authority: aiReasons.authority?.reason,
                          need: aiReasons.need?.reason,
                          timeline: aiReasons.timeline?.reason,
                        },
                      } : {}),
                    },
                  })}
                  disabled={saveScore.isPending}
                  className="w-full py-2 rounded text-xs text-white font-semibold disabled:opacity-50"
                  style={{ background: "#1A7A45" }}
                >
                  {saveScore.isPending ? "Saving..." : "Save BANT Score & Route Lead"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

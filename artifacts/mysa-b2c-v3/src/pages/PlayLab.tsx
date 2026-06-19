import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Sparkles, MoreHorizontal, Edit2, Archive, Trash2,
  Users, Zap, PlayCircle, FileText, Loader2, X, ChevronDown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type PlayStatus = "draft" | "active" | "paused" | "archived";

interface Play {
  id:                number;
  name:              string;
  description:       string | null;
  status:            PlayStatus;
  qualificationMode: string;
  intentKeywords:    string[];
  icpIds:            number[];
  scoutDailyBudget:  number;
  collectPhone:      boolean;
  createdAt:         string;
  updatedAt:         string;
}

interface PlayDraft {
  name:               string;
  description:        string;
  intent_keywords:    string[];
  qualification_mode: "manual" | "scout_agent";
  scout_daily_budget: number;
  collect_phone:      boolean;
  min_score:          number;
  suggested_icp_ids:  number[];
  suggested_new_icp:  {
    name: string; markets: string[]; industries: string[]; roles: string[]; companySize: string;
  } | null;
  problem_signals:    string[];
  buying_signals:     string[];
  competitor_signals: string[];
  industry_keywords:  string[];
  target_subreddits:  string[];
}

interface IcpOption {
  id: number; name: string; markets: string[]; industries: string[];
}

type TabKey = "all" | "active" | "draft" | "archived";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all",      label: "All Plays" },
  { key: "active",   label: "Launched" },
  { key: "draft",    label: "Drafts" },
  { key: "archived", label: "Archived" },
];

const STATUS_BADGE: Record<PlayStatus, { label: string; cls: string }> = {
  draft:    { label: "Draft",    cls: "bg-gray-100 text-gray-600 border-gray-200" },
  active:   { label: "Live",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  paused:   { label: "Paused",   cls: "bg-amber-50 text-amber-700 border-amber-200" },
  archived: { label: "Archived", cls: "bg-red-50 text-red-600 border-red-200" },
};

const SUGGESTION_CHIPS = [
  "Find companies hiring marketing leaders",
  "Track competitor churn signals",
  "Spot post-funding expansion plays",
  "Reddit buyers discussing alternatives",
];

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const json = await res.json() as { success?: boolean; data?: T; error?: string };
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed");
  return json.data as T;
}

// ── React Query hooks ──────────────────────────────────────────────────────────

function usePlays(status: TabKey) {
  const qs = status !== "all" ? `?status=${status}` : "";
  return useQuery<Play[]>({
    queryKey: ["plays", status],
    queryFn: () => apiFetch<Play[]>(`/api/plays${qs}`),
    staleTime: 30_000,
  });
}

function useCreatePlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      apiFetch<Play>("/api/plays", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plays"] }); },
  });
}

function useUpdatePlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name: string; description: string }) =>
      apiFetch<Play>(`/api/plays/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plays"] }); },
  });
}

function useArchivePlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<Play>(`/api/plays/${id}/archive`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plays"] }); },
  });
}

function useDeletePlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/plays/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plays"] }); },
  });
}

// ── Hero Chat Box ──────────────────────────────────────────────────────────────

function HeroChatBox({ orgName, onDraft }: { orgName: string; onDraft: (draft: PlayDraft) => void }) {
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSend(message: string) {
    const msg = message.trim();
    if (!msg || loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/plays/draft", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ intent: msg }),
      });
      const json = await res.json() as { draft?: PlayDraft; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Draft failed");
      if (!json.draft) throw new Error("No draft returned");
      onDraft(json.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft that — try rephrasing");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div
        className="px-5 py-4"
        style={{ background: "linear-gradient(135deg, #1A3D2B 0%, #0D9488 100%)" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-white" />
          <span className="text-white font-bold text-sm">
            Set up GTM plays for {orgName || "your workspace"}
          </span>
        </div>
        <p className="text-white/70 text-xs leading-relaxed">
          Describe your go-to-market intent in one sentence. Mysa AI will draft a complete play for you.
        </p>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSend(input); }}
            placeholder="e.g. Find UAE healthcare companies looking to improve their digital marketing"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <button
            onClick={() => handleSend(input)}
            disabled={!input.trim() || loading}
            className="px-4 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90 flex items-center gap-1.5 flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />}
            {loading ? "Drafting your Play…" : "Draft"}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTION_CHIPS.map(chip => (
            <button
              key={chip}
              onClick={() => { setInput(chip); handleSend(chip); }}
              disabled={loading}
              className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 bg-gray-50 text-gray-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 transition-colors disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>
    </div>
  );
}

// ── Review Modal ───────────────────────────────────────────────────────────────

function ReviewModal({
  draft,
  onClose,
  onCreated,
}: {
  draft:     PlayDraft;
  onClose:   () => void;
  onCreated: (playId: number) => void;
}) {
  const [name,         setName]         = useState(draft.name);
  const [desc,         setDesc]         = useState(draft.description);
  const [keywords,     setKeywords]     = useState<string[]>(draft.intent_keywords);
  const [kwInput,      setKwInput]      = useState("");
  const [icpIds,       setIcpIds]       = useState<number[]>(draft.suggested_icp_ids);
  const [createNewIcp, setCreateNewIcp] = useState(false);
  const [qualMode,     setQualMode]     = useState<"manual" | "scout_agent">(draft.qualification_mode);
  const [budget,       setBudget]       = useState(draft.scout_daily_budget);
  const [phone,        setPhone]        = useState(draft.collect_phone);
  const [minScore,     setMinScore]     = useState(draft.min_score);
  const [signalsOpen,  setSignalsOpen]  = useState(false);
  const [icps,         setIcps]         = useState<IcpOption[]>([]);
  const [isCreating,   setIsCreating]   = useState(false);
  const [createError,  setCreateError]  = useState("");

  useEffect(() => {
    fetch("/api/icp", { credentials: "include" })
      .then(r => r.json())
      .then((json: unknown) => {
        const j = json as { data?: IcpOption[]; icps?: IcpOption[] };
        if (Array.isArray(j)) setIcps(j as IcpOption[]);
        else if (Array.isArray(j.data)) setIcps(j.data);
        else if (Array.isArray(j.icps)) setIcps(j.icps);
      })
      .catch(() => {});
  }, []);

  function addKeyword(raw: string) {
    const kw = raw.trim().replace(/,$/, "").trim();
    if (kw && !keywords.includes(kw)) setKeywords(prev => [...prev, kw]);
    setKwInput("");
  }

  function toggleIcp(id: number) {
    setIcpIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }

  async function handleCreate() {
    if (!name.trim()) { setCreateError("Play name is required"); return; }
    setIsCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/plays/draft/create", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name:              name.trim(),
          description:       desc,
          intentKeywords:    keywords,
          icpIds,
          qualificationMode: qualMode,
          scoutDailyBudget:  budget,
          collectPhone:      phone,
          minScore,
          problemSignals:    draft.problem_signals,
          buyingSignals:     draft.buying_signals,
          competitorSignals: draft.competitor_signals,
          industryKeywords:  draft.industry_keywords,
          targetSubreddits:  draft.target_subreddits,
          createNewIcp:      createNewIcp && draft.suggested_new_icp != null,
          suggestedNewIcp:   draft.suggested_new_icp,
        }),
      });
      const json = await res.json() as { data?: { playId: number }; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Create failed");
      onCreated(json.data!.playId);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create play");
      setIsCreating(false);
    }
  }

  const checkIcon = (
    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
    </svg>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col">
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #1A3D2B 0%, #0D9488 100%)" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-sm">Review Your AI-Drafted Play</div>
              <div className="text-white/60 text-[11px]">Edit any field before creating</div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Name & Description */}
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Play Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Description</label>
              <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              />
            </div>
          </div>

          {/* Intent Keywords */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Intent Keywords</label>
            <div
              className="min-h-[38px] px-3 py-2 rounded-lg border border-gray-200 bg-white flex flex-wrap gap-1.5 cursor-text focus-within:ring-2 focus-within:ring-teal-500/40"
              onClick={e => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
            >
              {keywords.map(kw => (
                <span key={kw} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                  {kw}
                  <button onClick={() => setKeywords(k => k.filter(t => t !== kw))} className="hover:text-teal-900">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                value={kwInput}
                onChange={e => setKwInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKeyword(kwInput); }
                  else if (e.key === "Backspace" && !kwInput) setKeywords(k => k.slice(0, -1));
                }}
                onBlur={() => { if (kwInput.trim()) addKeyword(kwInput); }}
                placeholder={keywords.length === 0 ? "Add keywords…" : ""}
                className="flex-1 min-w-[100px] text-sm outline-none bg-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>

          {/* ICP Selection */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Target Personas</label>
            {icps.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No existing ICPs — you can set targeting in the Play Builder.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {icps.map(icp => (
                  <div
                    key={icp.id}
                    onClick={() => toggleIcp(icp.id)}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-100 hover:border-teal-200 cursor-pointer transition-colors"
                  >
                    <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${icpIds.includes(icp.id) ? "bg-teal-500 border-teal-500" : "border-gray-300 bg-white"}`}>
                      {icpIds.includes(icp.id) && checkIcon}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-900">{icp.name}</div>
                      <div className="text-[10px] text-gray-400">
                        {[...(icp.markets ?? []).slice(0, 2), ...(icp.industries ?? []).slice(0, 2)].join(" · ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {draft.suggested_new_icp && (
              <div
                onClick={() => setCreateNewIcp(v => !v)}
                className="flex items-start gap-2.5 p-2.5 rounded-lg border border-dashed border-purple-300 bg-purple-50/50 hover:border-purple-400 cursor-pointer transition-colors mt-2"
              >
                <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${createNewIcp ? "bg-purple-500 border-purple-500" : "border-purple-300 bg-white"}`}>
                  {createNewIcp && checkIcon}
                </div>
                <div>
                  <div className="text-xs font-semibold text-purple-700">+ Create new ICP: {draft.suggested_new_icp.name}</div>
                  <div className="text-[10px] text-purple-500">
                    {[...draft.suggested_new_icp.markets.slice(0, 2), ...draft.suggested_new_icp.industries.slice(0, 2)].join(" · ")}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Qualification mode */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Qualification Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "manual",      label: "Manual Review",   desc: "You approve leads",    pro: false },
                { key: "scout_agent", label: "Scout AI Agent",  desc: "Auto-qualifies 24/7",  pro: true  },
              ].map(opt => (
                <div
                  key={opt.key}
                  onClick={() => setQualMode(opt.key as "manual" | "scout_agent")}
                  className={`rounded-xl border p-3 cursor-pointer transition-all ${qualMode === opt.key ? "border-teal-400 bg-teal-50/60 ring-1 ring-teal-400/30" : "border-gray-200 bg-white hover:border-teal-200"}`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-colors ${qualMode === opt.key ? "bg-teal-500 border-teal-500" : "border-gray-300"}`}>
                      {qualMode === opt.key && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="text-xs font-bold text-gray-900">{opt.label}</span>
                    {opt.pro && <span className="text-[9px] font-bold px-1 rounded bg-purple-100 text-purple-700">PRO</span>}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5 ml-5">{opt.desc}</p>
                </div>
              ))}
            </div>
            {qualMode === "scout_agent" && (
              <div className="mt-2 flex items-center gap-2">
                <input type="range" min={0} max={50} step={1} value={budget} onChange={e => setBudget(Number(e.target.value))} className="flex-1" />
                <span className="text-xs font-bold text-gray-700 w-24 text-right whitespace-nowrap">{budget} credits / day</span>
              </div>
            )}
          </div>

          {/* Phone toggle */}
          <div
            onClick={() => setPhone(v => !v)}
            className="flex items-center justify-between p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div>
              <div className="text-xs font-semibold text-gray-900">Collect Phone Numbers</div>
              <div className="text-[10px] text-gray-400">+1 credit per successful match</div>
            </div>
            <div className={`rounded-full transition-colors relative flex-shrink-0 ${phone ? "bg-teal-500" : "bg-gray-200"}`} style={{ width: 32, height: 18 }}>
              <div className={`absolute top-[1px] left-[1px] w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${phone ? "translate-x-[14px]" : ""}`} />
            </div>
          </div>

          {/* Min score */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Min Lead Score: {minScore} / 100</label>
            <input type="range" min={0} max={100} step={5} value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="w-full" />
          </div>

          {/* Signals preview collapsible */}
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => setSignalsOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <span>Detected signals preview (read-only)</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${signalsOpen ? "rotate-180" : ""}`} />
            </button>
            {signalsOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                {([
                  { label: "Problem Signals",    items: draft.problem_signals,    color: "bg-red-50 text-red-700 border-red-200" },
                  { label: "Buying Signals",     items: draft.buying_signals,     color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                  { label: "Competitor Signals", items: draft.competitor_signals, color: "bg-amber-50 text-amber-700 border-amber-200" },
                  { label: "Target Subreddits",  items: draft.target_subreddits,  color: "bg-purple-50 text-purple-700 border-purple-200" },
                ] as { label: string; items: string[]; color: string }[]).map(section =>
                  section.items.length > 0 ? (
                    <div key={section.label}>
                      <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{section.label}</div>
                      <div className="flex flex-wrap gap-1">
                        {section.items.map(item => (
                          <span key={item} className={`text-[10px] px-2 py-0.5 rounded-full border ${section.color}`}>{item}</span>
                        ))}
                      </div>
                    </div>
                  ) : null
                )}
              </div>
            )}
          </div>

          {createError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 p-5 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={() => handleCreate()}
            disabled={isCreating}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            Edit in Builder
          </button>
          <button
            onClick={() => handleCreate()}
            disabled={isCreating}
            className="flex-1 px-4 py-2.5 text-sm font-bold text-white rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
          >
            {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Create Play
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create-Play Modal (manual) ─────────────────────────────────────────────────

function PlayModal({
  open,
  initial,
  onClose,
}: {
  open:     boolean;
  initial?: Play | null;
  onClose:  () => void;
}) {
  const [name, setName]     = useState(initial?.name        ?? "");
  const [desc, setDesc]     = useState(initial?.description ?? "");
  const [err,  setErr]      = useState("");
  const createPlay  = useCreatePlay();
  const updatePlay  = useUpdatePlay();
  const isPending   = createPlay.isPending || updatePlay.isPending;

  useEffect(() => {
    if (open) {
      setName(initial?.name        ?? "");
      setDesc(initial?.description ?? "");
      setErr("");
    }
  }, [open, initial]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Play name is required"); return; }
    setErr("");
    try {
      if (initial) {
        await updatePlay.mutateAsync({ id: initial.id, name: name.trim(), description: desc });
      } else {
        await createPlay.mutateAsync({ name: name.trim(), description: desc });
      }
      onClose();
    } catch (ex) {
      setErr(String(ex));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div
          className="px-6 py-5 flex items-center justify-between"
          style={{ background: "linear-gradient(135deg, #1A3D2B 0%, #0D9488 100%)" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-sm">
              {initial ? "Edit Play" : "Create New Play"}
            </span>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Play Name *
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. UAE SMB Cold Outreach"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Description
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What's this play about? Who are you targeting and why?"
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-none"
            />
          </div>

          {err && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>
          )}

          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 px-4 py-2.5 text-sm font-bold text-white rounded-xl flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {initial ? "Save Changes" : "Create Play"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Card Menu ──────────────────────────────────────────────────────────────────

function CardMenu({
  play,
  onEdit,
  onArchive,
  onDelete,
}: {
  play:      Play;
  onEdit:    () => void;
  onArchive: () => void;
  onDelete:  () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="p-1 text-gray-400 hover:text-gray-700 transition-colors rounded"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-40 text-sm">
          <button
            onClick={() => { setOpen(false); onEdit(); }}
            className="flex items-center gap-2 px-3 py-1.5 w-full text-left text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5 text-gray-400" /> Edit
          </button>
          {play.status !== "archived" && (
            <button
              onClick={() => { setOpen(false); onArchive(); }}
              className="flex items-center gap-2 px-3 py-1.5 w-full text-left text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Archive className="w-3.5 h-3.5 text-gray-400" /> Archive
            </button>
          )}
          <div className="my-1 border-t border-gray-100" />
          <button
            onClick={() => { setOpen(false); onDelete(); }}
            className="flex items-center gap-2 px-3 py-1.5 w-full text-left text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Play Card ──────────────────────────────────────────────────────────────────

function PlayCard({
  play,
  onEdit,
  onArchive,
  onDelete,
}: {
  play:      Play;
  onEdit:    () => void;
  onArchive: () => void;
  onDelete:  () => void;
}) {
  const [, navigate] = useLocation();
  const badge = STATUS_BADGE[play.status] ?? STATUS_BADGE.draft;

  return (
    <div
      onClick={() => navigate(`/play-lab/${play.id}`)}
      className="rounded-xl border border-gray-200 bg-white shadow-sm hover:border-teal-300 hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge.cls}`}>
                {badge.label}
              </span>
              {play.qualificationMode === "scout_agent" && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
                  Scout
                </span>
              )}
            </div>
            <h3 className="text-sm font-bold text-gray-900 leading-snug group-hover:text-teal-700 transition-colors line-clamp-1">
              {play.name}
            </h3>
          </div>
          <div onClick={e => e.stopPropagation()}>
            <CardMenu
              play={play}
              onEdit={onEdit}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          </div>
        </div>

        {play.description && (
          <p className="text-[12px] text-gray-500 leading-relaxed mb-3 line-clamp-2">
            {play.description}
          </p>
        )}

        <div className="flex items-center gap-4 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1 text-[11px] text-gray-500">
            <Users className="w-3 h-3 text-teal-500" />
            <span>0 leads</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-gray-500">
            <Zap className="w-3 h-3 text-amber-500" />
            <span>{play.qualificationMode === "scout_agent" ? "Auto" : "Manual"}</span>
          </div>
          {play.intentKeywords && play.intentKeywords.length > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-gray-500">
              <FileText className="w-3 h-3 text-purple-400" />
              <span>{play.intentKeywords.length} signals</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: "linear-gradient(135deg, #F0FDF4, #CCFBF1)" }}
      >
        <PlayCircle className="w-8 h-8 text-teal-600" />
      </div>
      <h2 className="text-base font-bold text-gray-900 mb-2">No plays yet</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-xs leading-relaxed">
        Use the AI drafter above to generate your first play instantly, or create one manually.
      </p>
      <button
        onClick={onCreate}
        className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-xl transition-opacity hover:opacity-90"
        style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
      >
        <Plus className="w-4 h-4" /> Create manually
      </button>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PlayLab() {
  const [, navigate]     = useLocation();
  const qc               = useQueryClient();
  const [tab,         setTab]         = useState<TabKey>("all");
  const [modalOpen,   setModalOpen]   = useState(false);
  const [editingPlay, setEditingPlay] = useState<Play | null>(null);
  const [draft,       setDraft]       = useState<PlayDraft | null>(null);
  const [showReview,  setShowReview]  = useState(false);

  const { data: plays = [], isLoading } = usePlays(tab);
  const archivePlay = useArchivePlay();
  const deletePlay  = useDeletePlay();

  const { data: orgInfo } = useQuery<{ id: number; name: string }>({
    queryKey: ["org-me"],
    queryFn: async () => {
      const res = await fetch("/api/organizations/me", { credentials: "include" });
      if (!res.ok) return { id: 0, name: "" };
      return res.json() as Promise<{ id: number; name: string }>;
    },
    staleTime: 300_000,
  });
  const orgName = orgInfo?.name ?? "";

  function openCreate() { setEditingPlay(null); setModalOpen(true); }
  function openEdit(p: Play) { setEditingPlay(p); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditingPlay(null); }

  function handleDelete(play: Play) {
    if (!confirm(`Delete "${play.name}"? This cannot be undone.`)) return;
    deletePlay.mutate(play.id);
  }

  function handleDraftReceived(d: PlayDraft) {
    setDraft(d);
    setShowReview(true);
  }

  function handlePlayCreated(playId: number) {
    setShowReview(false);
    setDraft(null);
    void qc.invalidateQueries({ queryKey: ["plays"] });
    navigate(`/play-lab/${playId}`);
  }

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-teal-600" />
            Play Lab
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Build go-to-market plays — define who to target, what signals to detect, and how to engage
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded-lg hover:opacity-90 transition-opacity"
          style={{ background: "#1A3D2B" }}
        >
          <Plus className="w-3.5 h-3.5" /> New Play
        </button>
      </div>

      {/* Hero AI Chat Box */}
      <HeroChatBox orgName={orgName} onDraft={handleDraftReceived} />

      {/* Tab filter */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              tab === t.key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Play grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white shadow-sm animate-pulse h-44" />
          ))}
        </div>
      ) : plays.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plays.map(play => (
            <PlayCard
              key={play.id}
              play={play}
              onEdit={() => openEdit(play)}
              onArchive={() => archivePlay.mutate(play.id)}
              onDelete={() => handleDelete(play)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <PlayModal
        open={modalOpen}
        initial={editingPlay}
        onClose={closeModal}
      />

      {showReview && draft && (
        <ReviewModal
          draft={draft}
          onClose={() => { setShowReview(false); setDraft(null); }}
          onCreated={handlePlayCreated}
        />
      )}
    </div>
  );
}

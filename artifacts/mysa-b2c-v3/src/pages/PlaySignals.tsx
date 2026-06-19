import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Sparkles, Loader2, X, Check, Save,
  AlertTriangle, Zap, Building2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SignalState {
  problemSignals:    string[];
  buyingSignals:     string[];
  competitorSignals: string[];
  industryKeywords:  string[];
  targetSubreddits:  string[];
  targetCompanies:   string[];
  minScore:          number;
}

type BucketKey = "problem" | "buying" | "competitor" | "keyword" | "subreddit";

const DEFAULT_STATE: SignalState = {
  problemSignals:    [],
  buyingSignals:     [],
  competitorSignals: [],
  industryKeywords:  [],
  targetSubreddits:  [],
  targetCompanies:   [],
  minScore:          50,
};

// ── Bucket config ──────────────────────────────────────────────────────────────

const BUCKETS: {
  key:         BucketKey;
  field:       keyof Omit<SignalState, "minScore">;
  title:       string;
  subtitle:    string;
  placeholder: string;
  accent:      string;
  badgeCls:    string;
}[] = [
  {
    key:         "problem",
    field:       "problemSignals",
    title:       "Expressing Problems or Needs",
    subtitle:    "Phrases buyers post when they have a challenge you solve.",
    placeholder: "our website traffic dropped",
    accent:      "from-rose-50 to-red-50 border-red-200",
    badgeCls:    "bg-red-100 text-red-700",
  },
  {
    key:         "buying",
    field:       "buyingSignals",
    title:       "Asking for Your Solution",
    subtitle:    "Active buying-intent phrases — they're looking to purchase.",
    placeholder: "looking for a digital marketing agency",
    accent:      "from-emerald-50 to-teal-50 border-emerald-200",
    badgeCls:    "bg-emerald-100 text-emerald-700",
  },
  {
    key:         "competitor",
    field:       "competitorSignals",
    title:       "Competitor Dissatisfaction",
    subtitle:    "Signals they want to switch vendors.",
    placeholder: "frustrated with [agency name]",
    accent:      "from-orange-50 to-amber-50 border-orange-200",
    badgeCls:    "bg-orange-100 text-orange-700",
  },
  {
    key:         "keyword",
    field:       "industryKeywords",
    title:       "Industry & Domain Keywords",
    subtitle:    "Domain keywords to refine targeting.",
    placeholder: "SaaS, fintech, healthcare",
    accent:      "from-blue-50 to-indigo-50 border-blue-200",
    badgeCls:    "bg-blue-100 text-blue-700",
  },
];

const STATIC_SUBREDDITS = [
  "indiastartups", "india", "entrepreneur", "startups", "SaaS",
  "marketing", "smallbusiness", "b2bsales", "sales", "digitalmarketing",
];

// ── Tag Input ──────────────────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
  onBlur,
  placeholder,
  transformTag,
}: {
  tags:         string[];
  onChange:     (tags: string[]) => void;
  onBlur?:      () => void;
  placeholder:  string;
  transformTag?: (raw: string) => string;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag(raw: string) {
    let tag = raw.trim().replace(/,$/, "").trim();
    if (transformTag) tag = transformTag(tag);
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div
      className="min-h-[42px] px-3 py-2 rounded-lg border border-gray-200 bg-white flex flex-wrap gap-1.5 cursor-text focus-within:ring-2 focus-within:ring-teal-500/40"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-teal-50 text-teal-700 border border-teal-200">
          {tag}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onChange(tags.filter(t => t !== tag)); }}
            className="hover:text-teal-900 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => {
          if (input.trim()) addTag(input);
          onBlur?.();
        }}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] text-sm outline-none bg-transparent text-gray-900 placeholder-gray-400"
      />
    </div>
  );
}

// ── Suggestion Chips ───────────────────────────────────────────────────────────

function SuggestionChips({
  chips,
  added,
  onAdd,
  onDismiss,
}: {
  chips:     string[];
  added:     Set<string>;
  onAdd:     (chip: string) => void;
  onDismiss: (chip: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {chips.map(chip => {
        const isAdded = added.has(chip);
        return (
          <button
            key={chip}
            onClick={() => isAdded ? onDismiss(chip) : onAdd(chip)}
            className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-all ${
              isAdded
                ? "bg-teal-500 text-white border-teal-500"
                : "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
            }`}
          >
            {isAdded ? <Check className="w-2.5 h-2.5" /> : <span>+</span>}
            {chip}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PlaySignals() {
  const params   = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const playId   = Number(params.id);

  const [playName, setPlayName] = useState("");
  const [signals,  setSignals]  = useState<SignalState>(DEFAULT_STATE);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [saving,   setSaving]   = useState(false);
  const [savedAt,  setSavedAt]  = useState<number | null>(null);

  const [suggestions,  setSuggestions]  = useState<Partial<Record<BucketKey, string[]>>>({});
  const [suggesting,   setSuggesting]   = useState<Partial<Record<BucketKey, boolean>>>({});
  const [addedChips,   setAddedChips]   = useState<Partial<Record<BucketKey, Set<string>>>>({});

  const stateRef = useRef(signals);
  useEffect(() => { stateRef.current = signals; }, [signals]);

  // ── Load ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playId || isNaN(playId)) { setError("Invalid play ID"); setLoading(false); return; }
    Promise.all([
      fetch(`/api/plays/${playId}`,         { credentials: "include" }).then(r => r.json()),
      fetch(`/api/plays/${playId}/signals`, { credentials: "include" }).then(r => r.json()),
    ]).then(([playJson, sigJson]: [
      { success?: boolean; data?: { name: string } },
      { success?: boolean; data?: Partial<SignalState> },
    ]) => {
      if (playJson.success && playJson.data) setPlayName(playJson.data.name ?? "");
      if (sigJson.success && sigJson.data) {
        const d = sigJson.data;
        setSignals({
          problemSignals:    d.problemSignals    ?? [],
          buyingSignals:     d.buyingSignals     ?? [],
          competitorSignals: d.competitorSignals ?? [],
          industryKeywords:  d.industryKeywords  ?? [],
          targetSubreddits:  d.targetSubreddits  ?? [],
          targetCompanies:   d.targetCompanies   ?? [],
          minScore:          d.minScore          ?? 50,
        });
      } else if (!sigJson.success) {
        setError("Failed to load signal config");
      }
    }).catch(() => setError("Failed to load signals"))
      .finally(() => setLoading(false));
  }, [playId]);

  // ── Save ───────────────────────────────────────────────────────────────────
  async function save(patch?: Partial<SignalState>) {
    const payload = { ...stateRef.current, ...patch };
    setSaving(true);
    try {
      const res = await fetch(`/api/plays/${playId}/signals`, {
        method:      "PUT",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify(payload),
      });
      if (res.ok) setSavedAt(Date.now());
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  // ── Update a signal array ─────────────────────────────────────────────────
  function setField(field: keyof Omit<SignalState, "minScore">, value: string[]) {
    setSignals(prev => ({ ...prev, [field]: value }));
  }

  // ── AI Suggest ────────────────────────────────────────────────────────────
  async function handleSuggest(bucket: BucketKey) {
    setSuggesting(prev => ({ ...prev, [bucket]: true }));
    try {
      const res = await fetch(`/api/plays/${playId}/signals/suggest`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ bucket }),
      });
      const json = await res.json() as { data?: string[]; error?: string };
      if (res.ok && json.data) {
        setSuggestions(prev => ({ ...prev, [bucket]: json.data! }));
      }
    } catch { /* silent */ }
    finally { setSuggesting(prev => ({ ...prev, [bucket]: false })); }
  }

  // ── Add chip to bucket ────────────────────────────────────────────────────
  function addChip(bucket: BucketKey, chip: string, field: keyof Omit<SignalState, "minScore">) {
    setSignals(prev => {
      const current = prev[field] as string[];
      if (current.includes(chip)) return prev;
      const next = [...current, chip];
      void save({ [field]: next });
      return { ...prev, [field]: next };
    });
    setAddedChips(prev => {
      const s = new Set(prev[bucket] ?? []);
      s.add(chip);
      return { ...prev, [bucket]: s };
    });
  }

  function dismissChip(bucket: BucketKey, chip: string) {
    setSuggestions(prev => ({ ...prev, [bucket]: (prev[bucket] ?? []).filter(c => c !== chip) }));
    setAddedChips(prev => {
      const s = new Set(prev[bucket] ?? []);
      s.delete(chip);
      return { ...prev, [bucket]: s };
    });
  }

  const savedVisible = savedAt !== null && Date.now() - savedAt < 3000;

  // ── Subreddits: strip r/ prefix ───────────────────────────────────────────
  function normaliseSubreddit(raw: string) {
    return raw.replace(/^r\//i, "").trim();
  }

  // ── Total signal count (for header badge) ─────────────────────────────────
  const totalCount = signals.problemSignals.length + signals.buyingSignals.length +
    signals.competitorSignals.length + signals.industryKeywords.length +
    signals.targetSubreddits.length + signals.targetCompanies.length;

  // ── Loading / error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <button onClick={() => navigate(`/play-lab/${playId}`)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Play Builder
        </button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-3 md:p-6 max-w-4xl">
      {/* Back nav */}
      <button
        onClick={() => navigate(`/play-lab/${playId}`)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Play Builder
      </button>

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
          >
            <Zap className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-tight">Signal Setup</h1>
            <p className="text-[11px] text-gray-400">
              {playName && <span className="font-medium text-gray-600">{playName}</span>}
              {playName && " · "}
              {totalCount} signal{totalCount !== 1 ? "s" : ""} configured
            </p>
          </div>
        </div>

        {/* Save button + indicator */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {savedVisible && (
            <span className="flex items-center gap-1 text-xs text-teal-600 font-semibold">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          <button
            onClick={() => save()}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white rounded-lg disabled:opacity-60 hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      {/* Detection signal warning */}
      {signals.problemSignals.length + signals.buyingSignals.length === 0 && (
        <div className="mb-4 flex items-start gap-2.5 p-3 rounded-xl border border-amber-200 bg-amber-50">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            Add at least one <strong>Problem</strong> or <strong>Buying intent</strong> signal before you can launch this play.
          </p>
        </div>
      )}

      {/* 4 Bucket Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {BUCKETS.map(b => {
          const tags   = signals[b.field] as string[];
          const suggs  = suggestions[b.key] ?? [];
          const added  = addedChips[b.key] ?? new Set<string>();
          const isSugg = suggesting[b.key] ?? false;

          return (
            <div key={b.key} className={`rounded-2xl border bg-gradient-to-br ${b.accent} overflow-hidden`}>
              {/* Card header */}
              <div className="px-4 py-3 border-b border-gray-100 bg-white/60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-gray-900 leading-snug">{b.title}</span>
                  <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${b.badgeCls}`}>
                    {tags.length} signal{tags.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{b.subtitle}</p>
              </div>

              {/* Card body */}
              <div className="p-3 space-y-2 bg-white/40">
                <TagInput
                  tags={tags}
                  onChange={next => setField(b.field, next)}
                  onBlur={() => save()}
                  placeholder={b.placeholder}
                />

                {/* Suggestions */}
                {suggs.length > 0 && (
                  <SuggestionChips
                    chips={suggs}
                    added={added}
                    onAdd={chip => addChip(b.key, chip, b.field)}
                    onDismiss={chip => dismissChip(b.key, chip)}
                  />
                )}

                {/* Suggest button */}
                <button
                  onClick={() => handleSuggest(b.key)}
                  disabled={isSugg}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600 hover:text-purple-700 disabled:opacity-50 transition-colors"
                >
                  {isSugg
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Sparkles className="w-3 h-3" />}
                  {isSugg ? "Thinking…" : "✨ Suggest with AI"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Communities to Monitor */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-gray-900">Communities to Monitor</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Subreddit names where your buyers are active. Strip r/ prefix — e.g. type <em>saas</em> not r/saas.
              </p>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
              {signals.targetSubreddits.length} added
            </span>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <TagInput
            tags={signals.targetSubreddits}
            onChange={next => setField("targetSubreddits", next)}
            onBlur={() => save()}
            placeholder="indiastartups, saas, marketing…"
            transformTag={normaliseSubreddit}
          />

          {/* Static suggestions */}
          <div>
            <p className="text-[10px] text-gray-400 mb-1.5 font-semibold uppercase tracking-wide">Suggested communities</p>
            <div className="flex flex-wrap gap-1.5">
              {STATIC_SUBREDDITS.filter(s => !signals.targetSubreddits.includes(s)).map(s => (
                <button
                  key={s}
                  onClick={() => {
                    const next = [...signals.targetSubreddits, s];
                    setField("targetSubreddits", next);
                    void save({ targetSubreddits: next });
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 bg-gray-50 text-gray-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 transition-colors"
                >
                  r/{s}
                </button>
              ))}
            </div>
          </div>

          {/* AI suggest for subreddits */}
          <div>
            {(suggestions["subreddit"] ?? []).length > 0 && (
              <SuggestionChips
                chips={suggestions["subreddit"] ?? []}
                added={addedChips["subreddit"] ?? new Set()}
                onAdd={chip => addChip("subreddit", chip, "targetSubreddits")}
                onDismiss={chip => dismissChip("subreddit", chip)}
              />
            )}
            <button
              onClick={() => handleSuggest("subreddit")}
              disabled={suggesting["subreddit"] ?? false}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600 hover:text-purple-700 disabled:opacity-50 transition-colors mt-2"
            >
              {(suggesting["subreddit"] ?? false)
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Sparkles className="w-3 h-3" />}
              {(suggesting["subreddit"] ?? false) ? "Thinking…" : "✨ Suggest more with AI"}
            </button>
          </div>
        </div>
      </div>

      {/* Companies to Watch */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" />
            <div>
              <h3 className="text-xs font-bold text-gray-900">Companies to Watch</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Get alerted when anyone from these companies posts a matching signal.
              </p>
            </div>
          </div>
        </div>
        <div className="p-4">
          <TagInput
            tags={signals.targetCompanies}
            onChange={next => setField("targetCompanies", next)}
            onBlur={() => save()}
            placeholder="Acme Corp, TechCorp India…"
          />
        </div>
      </div>

      {/* Minimum Lead Score */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-bold text-gray-900">Minimum Lead Score</h3>
          <p className="text-[10px] text-gray-500 mt-0.5">Only surface leads scoring at or above this threshold.</p>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={signals.minScore}
              onChange={e => setSignals(prev => ({ ...prev, minScore: Number(e.target.value) }))}
              onMouseUp={() => save()}
              onTouchEnd={() => save()}
              className="flex-1"
            />
            <span className="text-sm font-bold text-gray-900 w-16 text-right tabular-nums">
              {signals.minScore} / 100
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, useRef, KeyboardEvent, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft, Sparkles, Loader2, X, Check, ChevronRight,
  Globe, Briefcase, Users, Zap, Phone, Mail, Bot, Target,
  Rocket, Database, Filter, ArrowDown, Activity, Play as PlayIcon, RefreshCw,
  TrendingUp, Star, ChevronDown, ChevronUp, ExternalLink,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Play {
  id:                number;
  name:              string;
  description:       string | null;
  status:            string;
  intentKeywords:    string[];
  icpIds:            number[];
  qualificationMode: string;
  scoutDailyBudget:  number;
  collectPhone:      boolean;
  createdAt:         string;
}

interface SignalConfig {
  id:                number;
  playId:            number;
  orgId:             number;
  minScore:          number;
  problemSignals:    string[];
  buyingSignals:     string[];
  competitorSignals: string[];
  industryKeywords:  string[];
  targetSubreddits:  string[];
  targetCompanies:   string[];
}

interface Icp {
  id:          number;
  name:        string;
  markets:     string[];
  industries:  string[];
  roles:       string[];
  companySize: string;
  active:      boolean;
}

interface FormData {
  name:              string;
  description:       string;
  intentKeywords:    string[];
  icpIds:            number[];
  qualificationMode: "manual" | "scout_agent";
  scoutDailyBudget:  number;
  collectPhone:      boolean;
  minScore:          number;
}

const DEFAULT_FORM: FormData = {
  name:              "",
  description:       "",
  intentKeywords:    [],
  icpIds:            [],
  qualificationMode: "manual",
  scoutDailyBudget:  10,
  collectPhone:      false,
  minScore:          50,
};

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const json = await res.json() as { success?: boolean; data?: T; error?: string; missing?: string[] };
  if (!res.ok) {
    const err = new Error((json.error ?? "Request failed")) as Error & { missing?: string[] };
    err.missing = (json as { missing?: string[] }).missing;
    throw err;
  }
  return json.data as T;
}

// ── Tag Input ──────────────────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags:        string[];
  onChange:    (tags: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag(raw: string) {
    const tag = raw.trim().replace(/,$/, "").trim();
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
          <button type="button" onClick={e => { e.stopPropagation(); onChange(tags.filter(t => t !== tag)); }} className="hover:text-teal-900 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] text-sm outline-none bg-transparent text-gray-900 placeholder-gray-400"
      />
    </div>
  );
}

// ── Step Indicator ─────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Configuration" },
    { n: 2, label: "Target Market" },
    { n: 3, label: "Data & Pipeline" },
  ];

  return (
    <div className="mb-6">
      <div className="flex items-center gap-0">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step > s.n
                    ? "bg-teal-600 text-white"
                    : step === s.n
                    ? "text-white"
                    : "bg-gray-200 text-gray-500"
                }`}
                style={step === s.n ? { background: "linear-gradient(135deg, #1A3D2B, #0D9488)" } : undefined}
              >
                {step > s.n ? <Check className="w-3.5 h-3.5" /> : s.n}
              </div>
              <span className={`text-[10px] font-semibold mt-1 ${step === s.n ? "text-teal-700" : "text-gray-400"}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mb-4 transition-colors ${step > s.n ? "bg-teal-600" : "bg-gray-200"}`} />
            )}
          </div>
        ))}
      </div>
      {/* Progress bar */}
      <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${((step - 1) / 2) * 100}%`,
            background: "linear-gradient(90deg, #1A3D2B, #0D9488)",
          }}
        />
      </div>
    </div>
  );
}

// ── Step 1 — Configuration ─────────────────────────────────────────────────────

function Step1({
  form,
  onChange,
}: {
  form:     FormData;
  onChange: (patch: Partial<FormData>) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-0.5">Configuration</h2>
        <p className="text-xs text-gray-500">Give your play a name and define what it's about.</p>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Play Name *
        </label>
        <input
          autoFocus
          value={form.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="e.g. UAE SMB Cold Outreach"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Description
        </label>
        <textarea
          value={form.description}
          onChange={e => onChange({ description: e.target.value })}
          placeholder="What's this play about? Who are you targeting and why?"
          rows={3}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-none"
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Intent Keywords *
        </label>
        <TagInput
          tags={form.intentKeywords}
          onChange={intentKeywords => onChange({ intentKeywords })}
          placeholder="Type a keyword and press Enter — e.g. patient acquisition, digital marketing"
        />
        <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
          These describe what this Play is about. You'll define exact detection signals in the Signal Setup step.
        </p>
        {form.intentKeywords.length === 0 && (
          <p className="text-[11px] text-amber-600 mt-1">Add at least one keyword to continue.</p>
        )}
      </div>
    </div>
  );
}

// ── Step 2 — Target Market ─────────────────────────────────────────────────────

function Step2({
  form,
  icps,
  icpLoading,
  onChange,
}: {
  form:       FormData;
  icps:       Icp[];
  icpLoading: boolean;
  onChange:   (patch: Partial<FormData>) => void;
}) {
  const [, navigate] = useLocation();

  function toggleIcp(id: number) {
    const next = form.icpIds.includes(id)
      ? form.icpIds.filter(i => i !== id)
      : [...form.icpIds, id];
    onChange({ icpIds: next });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-0.5">Target Market</h2>
        <p className="text-xs text-gray-500">Select one or more ICP profiles to target with this play.</p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-teal-700">
          {form.icpIds.length > 0 ? `${form.icpIds.length} persona${form.icpIds.length > 1 ? "s" : ""} selected` : "None selected yet"}
        </span>
        <button
          onClick={() => navigate("/icp")}
          className="text-xs text-purple-600 hover:text-purple-700 underline flex items-center gap-1 transition-colors"
        >
          <Sparkles className="w-3 h-3" /> Need a new ICP? →
        </button>
      </div>

      {icpLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-xl border border-gray-200 bg-gray-50 animate-pulse" />
          ))}
        </div>
      ) : icps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center">
          <Target className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500 mb-3">No ICPs defined yet</p>
          <button
            onClick={() => navigate("/icp")}
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 underline"
          >
            Create your first ICP →
          </button>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {icps.map(icp => {
            const isSelected = form.icpIds.includes(icp.id);
            return (
              <div
                key={icp.id}
                onClick={() => toggleIcp(icp.id)}
                className={`rounded-xl border p-3 cursor-pointer transition-all ${
                  isSelected
                    ? "border-teal-400 bg-teal-50/60 ring-1 ring-teal-400/30"
                    : "border-gray-200 bg-white hover:border-teal-200"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${isSelected ? "bg-teal-500 border-teal-500" : "border-gray-300 bg-white"}`}>
                    {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-gray-900 mb-1.5">{icp.name}</div>
                    <div className="flex flex-wrap gap-1">
                      {icp.markets?.slice(0, 3).map(m => (
                        <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-0.5">
                          <Globe className="w-2.5 h-2.5" /> {m}
                        </span>
                      ))}
                      {icp.industries?.slice(0, 2).map(ind => (
                        <span key={ind} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-0.5">
                          <Briefcase className="w-2.5 h-2.5" /> {ind}
                        </span>
                      ))}
                      {icp.roles?.slice(0, 2).map(r => (
                        <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 flex items-center gap-0.5">
                          <Users className="w-2.5 h-2.5" /> {r}
                        </span>
                      ))}
                    </div>
                    {icp.companySize && (
                      <div className="text-[10px] text-gray-400 mt-1">Company size: {icp.companySize}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form.icpIds.length === 0 && !icpLoading && icps.length > 0 && (
        <p className="text-[11px] text-amber-600">Select at least one ICP to continue.</p>
      )}
    </div>
  );
}

// ── Step 3 — Data & Pipeline ───────────────────────────────────────────────────

function Step3({
  form,
  onChange,
}: {
  form:     FormData;
  onChange: (patch: Partial<FormData>) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-0.5">Data & Pipeline</h2>
        <p className="text-xs text-gray-500">Choose how leads are qualified and what data to collect.</p>
      </div>

      {/* Qualification Mode */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Lead Qualification
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            {
              key: "manual",
              title: "Manual Review",
              desc: "You review and approve leads before outreach",
              icon: <Target className="w-5 h-5 text-gray-500" />,
              pro: false,
            },
            {
              key: "scout_agent",
              title: "Scout AI Agent",
              desc: "Qualifies leads 24/7 automatically",
              icon: <Bot className="w-5 h-5 text-purple-500" />,
              pro: true,
            },
          ].map(opt => {
            const selected = form.qualificationMode === opt.key;
            return (
              <div
                key={opt.key}
                onClick={() => onChange({ qualificationMode: opt.key as "manual" | "scout_agent" })}
                className={`rounded-xl border p-3.5 cursor-pointer transition-all ${
                  selected
                    ? "border-teal-400 bg-teal-50/60 ring-1 ring-teal-400/30"
                    : "border-gray-200 bg-white hover:border-teal-200"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`w-4 h-4 rounded-full border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${selected ? "bg-teal-500 border-teal-500" : "border-gray-300 bg-white"}`}>
                    {selected && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {opt.icon}
                      <span className="text-sm font-bold text-gray-900">{opt.title}</span>
                      {opt.pro && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">PRO</span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 leading-relaxed">{opt.desc}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scout budget (only when scout_agent selected) */}
      {form.qualificationMode === "scout_agent" && (
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Scout Daily Budget
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={form.scoutDailyBudget}
              onChange={e => onChange({ scoutDailyBudget: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="text-sm font-bold text-gray-900 w-24 text-right whitespace-nowrap">
              {form.scoutDailyBudget} credits / day
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Set to 0 to manually control lead additions.</p>
        </div>
      )}

      {/* Contact data */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Contact Data to Collect
        </label>
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Mail className="w-4 h-4 text-teal-500" />
              <div>
                <div className="text-sm font-semibold text-gray-900">Email & LinkedIn</div>
                <div className="text-[10px] text-gray-400">Always collected</div>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">INCLUDED</span>
          </div>
          <div
            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => onChange({ collectPhone: !form.collectPhone })}
          >
            <div className="flex items-center gap-2.5">
              <Phone className="w-4 h-4 text-gray-400" />
              <div>
                <div className="text-sm font-semibold text-gray-900">Phone Numbers</div>
                <div className="text-[10px] text-gray-400">+1 credit per successful phone match</div>
              </div>
            </div>
            <div className={`w-8 h-4.5 rounded-full transition-colors relative flex-shrink-0 ${form.collectPhone ? "bg-teal-500" : "bg-gray-200"}`}
              style={{ height: "18px", width: "32px" }}>
              <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${form.collectPhone ? "translate-x-3.5" : "translate-x-0.5"}`} style={{ left: "1px" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Min score */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Minimum Lead Score
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={form.minScore}
            onChange={e => onChange({ minScore: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="text-sm font-bold text-gray-900 w-16 text-right">{form.minScore} / 100</span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Leads scoring below this threshold are hidden from this play.</p>
      </div>
    </div>
  );
}

// ── Preview Panel ──────────────────────────────────────────────────────────────

function ReviewTab({
  step,
  form,
  signalCount,
}: {
  step:        1 | 2 | 3;
  form:        FormData;
  signalCount: number;
}) {
  const configComplete = (form.name.trim().length > 0 && form.intentKeywords.length > 0);
  const icpComplete    = form.icpIds.length > 0;
  const pipelineActive = step === 3;

  const rows: { label: string; value?: string; state: "pending" | "in_progress" | "completed" }[] = [
    {
      label: "Configuration",
      state: (step > 1 || configComplete) ? "completed" : step === 1 ? "in_progress" : "pending",
    },
    {
      label: "Target Market",
      state: icpComplete ? "completed" : step === 2 ? "in_progress" : "pending",
    },
    {
      label: "Signal Setup",
      value: signalCount > 0 ? `${signalCount} signal${signalCount !== 1 ? "s" : ""}` : undefined,
      state: signalCount > 0 ? "completed" : "pending",
    },
    {
      label: "Data & Pipeline",
      state: pipelineActive ? "in_progress" : "pending",
    },
  ];

  const STATE_STYLE = {
    pending:     "bg-gray-100 text-gray-500 border-gray-200",
    in_progress: "bg-amber-50 text-amber-700 border-amber-200",
    completed:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  const STATE_LABEL = { pending: "Pending", in_progress: "In Progress", completed: "Completed" };

  return (
    <div className="space-y-2">
      {rows.map(row => (
        <div key={row.label} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
          <span className="text-xs font-semibold text-gray-700">{row.label}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATE_STYLE[row.state]}`}>
            {row.value ?? STATE_LABEL[row.state]}
          </span>
        </div>
      ))}

      {form.icpIds.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Selected Personas</div>
          <div className="text-sm font-bold text-teal-700">{form.icpIds.length} ICP{form.icpIds.length > 1 ? "s" : ""} selected</div>
        </div>
      )}

      {form.intentKeywords.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Intent Keywords</div>
          <div className="flex flex-wrap gap-1">
            {form.intentKeywords.map(kw => (
              <span key={kw} className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">{kw}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StrategyTab({ icpCount }: { icpCount: number }) {
  const nodes = [
    { icon: <Database className="w-3.5 h-3.5 text-blue-500" />, label: "Sources", sub: "Firmographic / Technographic / Industry", color: "border-blue-200 bg-blue-50/50" },
    { icon: <Sparkles className="w-3.5 h-3.5 text-purple-500" />, label: "AI Agent", sub: "Mysa Signal Engine", color: "border-purple-200 bg-purple-50/50" },
    { icon: <Zap className="w-3.5 h-3.5 text-amber-500" />, label: "Intent", sub: "Custom Play", color: "border-amber-200 bg-amber-50/50" },
    { icon: <Filter className="w-3.5 h-3.5 text-teal-500" />, label: "Filter", sub: `ICP Match — ${icpCount} persona${icpCount !== 1 ? "s" : ""} selected`, color: "border-teal-200 bg-teal-50/50" },
    { icon: <Rocket className="w-3.5 h-3.5 text-emerald-600" />, label: "Output", sub: "Leads → CRM", color: "border-emerald-200 bg-emerald-50/50" },
  ];

  return (
    <div className="flex flex-col items-center gap-0 py-1">
      {nodes.map((node, i) => (
        <div key={node.label} className="w-full flex flex-col items-center">
          <div className={`w-full rounded-lg border px-3 py-2.5 ${node.color}`}>
            <div className="flex items-center gap-2">
              {node.icon}
              <div>
                <div className="text-xs font-bold text-gray-800">{node.label}</div>
                <div className="text-[10px] text-gray-500">{node.sub}</div>
              </div>
            </div>
          </div>
          {i < nodes.length - 1 && (
            <div className="flex flex-col items-center py-0.5">
              <div className="w-px h-3 bg-gray-300" />
              <ArrowDown className="w-3 h-3 text-gray-400" />
              <div className="w-px h-2 bg-gray-300" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PreviewPanel({
  step,
  form,
  signalCount,
}: {
  step:        1 | 2 | 3;
  form:        FormData;
  signalCount: number;
}) {
  const [tab, setTab] = useState<"review" | "strategy">("review");

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
          {(["review", "strategy"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all capitalize ${
                tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {tab === "review" ? (
          <ReviewTab step={step} form={form} signalCount={signalCount} />
        ) : (
          <StrategyTab icpCount={form.icpIds.length} />
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PlayDetail() {
  const params       = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const playId       = Number(params.id);

  const [step,         setStep]         = useState<1 | 2 | 3>(1);
  const [formData,     setFormData]     = useState<FormData>(DEFAULT_FORM);
  const [icps,         setIcps]         = useState<Icp[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [icpLoading,   setIcpLoading]   = useState(true);
  const [error,        setError]        = useState("");
  const [isSaving,     setIsSaving]     = useState(false);
  const [isLaunching,  setIsLaunching]  = useState(false);
  const [launchErrors, setLaunchErrors] = useState<string[]>([]);
  const [stepError,    setStepError]    = useState("");
  const [signalCount,  setSignalCount]  = useState(0);
  const [playStatus,   setPlayStatus]   = useState<string>("draft");

  // Signal Activity panel state
  interface SignalStats {
    total:       number;
    last24h:     number;
    bySource:    { reddit: number; linkedin: number; jobs: number };
    processed:   number;
    unprocessed: number;
    lastCrawledAt: string | null;
  }
  const [signalStats,   setSignalStats]   = useState<SignalStats | null>(null);
  const [statsLoading,  setStatsLoading]  = useState(false);
  const [crawlMsg,      setCrawlMsg]      = useState<string | null>(null);
  const [isCrawling,    setIsCrawling]    = useState(false);

  // Qualification Funnel panel state
  interface FunnelStage { stage: string; passed: number; failed: number; total: number; conversionPct: number; }
  interface FunnelStats {
    stages:       FunnelStage[];
    totalLeads:   number;
    newLeads:     number;
    contacted:    number;
    enriched:     number;
    avgScore:     number;
    lastCreatedAt: string | null;
  }
  interface PlayLead {
    id:             number;
    company_name:   string;
    intent_summary: string | null;
    lead_score:     number;
    score_breakdown: {
      icp_score?:          number;
      matched_icp?:        number | null;
      urgency?:            string;
      signal_type?:        string;
      confidence?:         number;
      signal_score?:       number;
      why_this_lead?:      string;
      recommended_angle?:  string;
      summary_confidence?: number;
      low_confidence?:     boolean;
      [key: string]: unknown;
    } | null;
    key_contacts:   { name: string; title?: string; email?: string; linkedInUrl?: string }[];
    enriched:       boolean;
    status:         string;
    created_at:     string;
    post_url:       string | null;
    platform:       string | null;
    key_phrase:     string | null;
    lead_id:        number | null;
    website:        string | null;
  }
  const [funnelStats,   setFunnelStats]   = useState<FunnelStats | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [playLeads,     setPlayLeads]     = useState<PlayLead[]>([]);
  const [leadsLoading,  setLeadsLoading]  = useState(false);
  const [funnelMsg,     setFunnelMsg]     = useState<string | null>(null);
  const [isRunningFunnel, setIsRunningFunnel] = useState(false);
  const [expandedLead,  setExpandedLead]  = useState<number | null>(null);

  const patch = (p: Partial<FormData>) => setFormData(prev => ({ ...prev, ...p }));

  // ── Fetch signal stats ─────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!playId || isNaN(playId)) return;
    setStatsLoading(true);
    try {
      const res  = await fetch(`/api/plays/${playId}/signals/stats`, { credentials: "include" });
      const json = await res.json() as { success?: boolean; data?: SignalStats };
      if (json.success && json.data) setSignalStats(json.data);
    } catch { /* non-fatal */ } finally {
      setStatsLoading(false);
    }
  }, [playId]);

  // ── Fetch funnel stats ─────────────────────────────────────────────────────
  const fetchFunnelStats = useCallback(async () => {
    if (!playId || isNaN(playId)) return;
    setFunnelLoading(true);
    try {
      const res  = await fetch(`/api/plays/${playId}/funnel/stats`, { credentials: "include" });
      const json = await res.json() as { success?: boolean; data?: FunnelStats };
      if (json.success && json.data) setFunnelStats(json.data);
    } catch { /* non-fatal */ } finally {
      setFunnelLoading(false);
    }
  }, [playId]);

  // ── Fetch play leads ───────────────────────────────────────────────────────
  const fetchPlayLeads = useCallback(async () => {
    if (!playId || isNaN(playId)) return;
    setLeadsLoading(true);
    try {
      const res  = await fetch(`/api/plays/${playId}/leads?limit=20`, { credentials: "include" });
      const json = await res.json() as { success?: boolean; data?: PlayLead[] };
      if (json.success && Array.isArray(json.data)) setPlayLeads(json.data);
    } catch { /* non-fatal */ } finally {
      setLeadsLoading(false);
    }
  }, [playId]);

  // ── Load play + ICPs on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!playId || isNaN(playId)) {
      setError("Invalid play ID");
      setLoading(false);
      return;
    }

    // Parallel fetch
    Promise.all([
      fetch(`/api/plays/${playId}/full`, { credentials: "include" }).then(r => r.json()),
      fetch(`/api/icp`, { credentials: "include" }).then(r => r.json()),
    ]).then(([fullJson, icpJson]) => {
      if (fullJson.success && fullJson.data) {
        const { play, signalConfig } = fullJson.data as { play: Play; signalConfig: SignalConfig };
        setPlayStatus(play.status ?? "draft");
        setFormData({
          name:              play.name ?? "",
          description:       play.description ?? "",
          intentKeywords:    play.intentKeywords ?? [],
          icpIds:            play.icpIds ?? [],
          qualificationMode: (play.qualificationMode as "manual" | "scout_agent") ?? "manual",
          scoutDailyBudget:  play.scoutDailyBudget ?? 10,
          collectPhone:      play.collectPhone ?? false,
          minScore:          signalConfig?.minScore ?? 50,
        });
        if (signalConfig) {
          const count = [
            signalConfig.problemSignals, signalConfig.buyingSignals,
            signalConfig.competitorSignals, signalConfig.industryKeywords,
            signalConfig.targetSubreddits, signalConfig.targetCompanies,
          ].reduce((s, arr) => s + (arr?.length ?? 0), 0);
          setSignalCount(count);
        }
      } else {
        setError(fullJson.error ?? "Play not found");
      }

      if (icpJson.icps || Array.isArray(icpJson)) {
        setIcps(Array.isArray(icpJson) ? icpJson : icpJson.icps ?? []);
      } else if (Array.isArray(icpJson.data)) {
        setIcps(icpJson.data as Icp[]);
      }
    }).catch(() => {
      setError("Failed to load play");
    }).finally(() => {
      setLoading(false);
      setIcpLoading(false);
    });
  }, [playId]);

  // Fetch signal stats + funnel stats + leads after play loads
  useEffect(() => {
    if (!loading) {
      void fetchStats();
      void fetchFunnelStats();
      void fetchPlayLeads();
    }
  }, [loading, fetchStats, fetchFunnelStats, fetchPlayLeads]);

  // ── Save config ────────────────────────────────────────────────────────────
  async function saveConfig(data: FormData) {
    await apiFetch(`/api/plays/${playId}/config`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        name:              data.name,
        description:       data.description,
        intentKeywords:    data.intentKeywords,
        icpIds:            data.icpIds,
        qualificationMode: data.qualificationMode,
        scoutDailyBudget:  data.scoutDailyBudget,
        collectPhone:      data.collectPhone,
        minScore:          data.minScore,
      }),
    });
  }

  // ── Step navigation ────────────────────────────────────────────────────────
  async function handleNext() {
    setStepError("");

    if (step === 1) {
      if (!formData.name.trim()) { setStepError("Play name is required."); return; }
      if (formData.intentKeywords.length === 0) { setStepError("Add at least one intent keyword."); return; }
    }
    if (step === 2) {
      if (formData.icpIds.length === 0) { setStepError("Select at least one ICP."); return; }
    }

    setIsSaving(true);
    try {
      await saveConfig(formData);
      setStep(s => (s < 3 ? (s + 1) as 1 | 2 | 3 : s));
    } catch {
      setStepError("Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  // ── Run funnel now ─────────────────────────────────────────────────────────
  async function handleRunFunnel() {
    setIsRunningFunnel(true);
    setFunnelMsg(null);
    try {
      const res  = await fetch(`/api/plays/${playId}/funnel/process`, {
        method: "POST", credentials: "include",
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (json.success) {
        setFunnelMsg("Funnel processing started — qualified leads will appear below shortly.");
        setTimeout(() => { void fetchFunnelStats(); void fetchPlayLeads(); }, 8000);
      } else {
        setFunnelMsg(json.error ?? "Failed to start funnel");
      }
    } catch {
      setFunnelMsg("Failed to start funnel");
    } finally {
      setIsRunningFunnel(false);
      setTimeout(() => setFunnelMsg(null), 10000);
    }
  }

  // ── Run crawl now ──────────────────────────────────────────────────────────
  async function handleRunCrawl() {
    setIsCrawling(true);
    setCrawlMsg(null);
    try {
      const res  = await fetch(`/api/plays/${playId}/crawl/run`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (json.success) {
        setCrawlMsg("Crawl started — results will appear in a few minutes.");
        setTimeout(() => void fetchStats(), 5000);
      } else {
        setCrawlMsg(json.error ?? "Failed to start crawl");
      }
    } catch {
      setCrawlMsg("Failed to start crawl");
    } finally {
      setIsCrawling(false);
      setTimeout(() => setCrawlMsg(null), 8000);
    }
  }

  // ── Launch ────────────────────────────────────────────────────────────────
  async function handleLaunch() {
    setLaunchErrors([]);
    setIsLaunching(true);
    try {
      await saveConfig(formData);
      await apiFetch(`/api/plays/${playId}/launch`, { method: "POST" });
      navigate("/play-lab");
    } catch (err) {
      const missing = (err as Error & { missing?: string[] }).missing;
      if (missing && missing.length > 0) {
        setLaunchErrors(missing.map(m =>
          m === "name"          ? "Play name is required"              :
          m === "icp"           ? "Select at least one ICP"            :
          m === "qualification" ? "Choose a qualification mode"        :
          m === "signals"       ? "Add at least one detection signal." : m
        ));
      } else {
        setLaunchErrors([String(err)]);
      }
    } finally {
      setIsLaunching(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────
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
        <button
          onClick={() => navigate("/play-lab")}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 mb-4 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Play Lab
        </button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="p-3 md:p-6">
      {/* Back nav */}
      <button
        onClick={() => navigate("/play-lab")}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Play Lab
      </button>

      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
          >
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-tight">{formData.name || "Untitled Play"}</h1>
            <p className="text-[11px] text-gray-400">Play Builder · Step {step} of 3</p>
          </div>
        </div>
        <button
          onClick={() => navigate(`/play-lab/${playId}/signals`)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-700 border border-teal-200 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors flex-shrink-0"
        >
          <Zap className="w-3 h-3" />
          Configure Signals
          {signalCount > 0 && (
            <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">
              {signalCount}
            </span>
          )}
        </button>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col md:flex-row gap-5">

        {/* LEFT — Form */}
        <div className="flex-1 md:w-[60%]">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 md:p-6">
            <StepIndicator step={step} />

            {step === 1 && <Step1 form={formData} onChange={patch} />}
            {step === 2 && <Step2 form={formData} icps={icps} icpLoading={icpLoading} onChange={patch} />}
            {step === 3 && <Step3 form={formData} onChange={patch} />}

            {/* Error */}
            {stepError && (
              <div className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {stepError}
              </div>
            )}
            {launchErrors.length > 0 && (
              <div className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <div className="font-semibold mb-1">Cannot launch — please fix:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {launchErrors.map(e => <li key={e}>{e}</li>)}
                </ul>
              </div>
            )}

            {/* Navigation */}
            <div className={`flex gap-2.5 mt-6 ${step === 1 ? "justify-end" : "justify-between"}`}>
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => { setStepError(""); setStep(s => (s > 1 ? (s - 1) as 1 | 2 | 3 : s)); }}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
              )}

              {step < 3 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-xl disabled:opacity-60 hover:opacity-90 transition-opacity"
                  style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLaunch}
                  disabled={isLaunching}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-xl disabled:opacity-60 hover:opacity-90 transition-opacity"
                  style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
                >
                  {isLaunching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
                  Launch Play
                </button>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — Preview Panel */}
        <div className="md:w-[40%] md:sticky md:top-4 md:self-start">
          <PreviewPanel step={step} form={formData} signalCount={signalCount} />
        </div>

      </div>

      {/* ── Signal Activity Panel ──────────────────────────────────────────────── */}
      <div className="mt-5 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1A3D2B22, #0D948822)" }}>
              <Activity className="w-3.5 h-3.5 text-teal-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Signal Activity</h3>
              <p className="text-[10px] text-gray-400">Raw signals captured for this play</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchStats()}
              disabled={statsLoading}
              className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors disabled:opacity-40"
              title="Refresh stats"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${statsLoading ? "animate-spin" : ""}`} />
            </button>
            {playStatus === "active" ? (
              <button
                onClick={() => void handleRunCrawl()}
                disabled={isCrawling}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-60 hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
              >
                {isCrawling
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <PlayIcon className="w-3 h-3" />}
                {isCrawling ? "Starting…" : "Run crawl now"}
              </button>
            ) : (
              <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                Launch play to enable crawling
              </span>
            )}
          </div>
        </div>

        {/* Toast */}
        {crawlMsg && (
          <div className={`px-5 py-2.5 text-xs font-medium border-b ${
            crawlMsg.includes("started") || crawlMsg.includes("appear")
              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
              : "bg-red-50 text-red-600 border-red-100"
          }`}>
            {crawlMsg}
          </div>
        )}

        {/* Stats */}
        <div className="p-5">
          {statsLoading && !signalStats ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : signalStats ? (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Total Signals", value: signalStats.total,   color: "text-teal-700",  bg: "bg-teal-50"   },
                  { label: "Last 24 h",     value: signalStats.last24h, color: "text-blue-700",  bg: "bg-blue-50"   },
                  { label: "Unprocessed",   value: signalStats.unprocessed, color: "text-amber-700", bg: "bg-amber-50" },
                  { label: "Processed",     value: signalStats.processed,   color: "text-emerald-700", bg: "bg-emerald-50" },
                ].map(s => (
                  <div key={s.label} className={`rounded-xl border border-gray-200 ${s.bg} px-4 py-3 text-center`}>
                    <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
                    <div className="text-[10px] font-semibold text-gray-500 mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Source breakdown */}
              <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden mb-4">
                {[
                  { label: "Reddit",   value: signalStats.bySource.reddit,   icon: "🔴" },
                  { label: "LinkedIn", value: signalStats.bySource.linkedin, icon: "🔵" },
                  { label: "Job Boards", value: signalStats.bySource.jobs,   icon: "💼" },
                ].map(src => (
                  <div key={src.label} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                      <span>{src.icon}</span> {src.label}
                    </div>
                    <span className="text-xs font-bold text-gray-900">{src.value}</span>
                  </div>
                ))}
              </div>

              {/* Last crawl time */}
              {signalStats.lastCrawledAt && (
                <p className="text-[10px] text-gray-400 mb-3">
                  Last crawl: {new Date(signalStats.lastCrawledAt).toLocaleString()}
                </p>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <Activity className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-xs text-gray-400">No signals captured yet</p>
            </div>
          )}

          {/* Informational note */}
          <div className="rounded-lg border border-teal-100 bg-teal-50/60 px-4 py-3 flex items-start gap-2.5">
            <Zap className="w-3.5 h-3.5 text-teal-600 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-teal-800 leading-relaxed">
              Signals flow into the 6-stage qualification funnel below. Run the funnel to turn raw signals into scored leads.
            </p>
          </div>
        </div>
      </div>

      {/* ── Qualification Funnel Panel ─────────────────────────────────────────── */}
      <div className="mt-5 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1A3D2B22, #0D948822)" }}>
              <TrendingUp className="w-3.5 h-3.5 text-teal-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Qualification Funnel</h3>
              <p className="text-[10px] text-gray-400">6-stage signal-to-lead pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void fetchFunnelStats(); void fetchPlayLeads(); }}
              disabled={funnelLoading || leadsLoading}
              className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors disabled:opacity-40"
              title="Refresh funnel"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${funnelLoading ? "animate-spin" : ""}`} />
            </button>
            {playStatus === "active" ? (
              <button
                onClick={() => void handleRunFunnel()}
                disabled={isRunningFunnel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-60 hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg, #1A3D2B, #0D9488)" }}
              >
                {isRunningFunnel
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Filter className="w-3 h-3" />}
                {isRunningFunnel ? "Running…" : "Run funnel now"}
              </button>
            ) : (
              <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                Launch play to enable
              </span>
            )}
          </div>
        </div>

        {/* Toast */}
        {funnelMsg && (
          <div className={`px-5 py-2.5 text-xs font-medium border-b ${
            funnelMsg.includes("started") || funnelMsg.includes("appear")
              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
              : "bg-red-50 text-red-600 border-red-100"
          }`}>
            {funnelMsg}
          </div>
        )}

        <div className="p-5">
          {/* ── Summary cards ── */}
          {funnelStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: "Qualified Leads",  value: funnelStats.totalLeads, color: "text-teal-700",    bg: "bg-teal-50"   },
                { label: "Avg Score",        value: funnelStats.avgScore ? `${funnelStats.avgScore}/100` : "—", color: "text-purple-700",  bg: "bg-purple-50" },
                { label: "With Contacts",    value: funnelStats.enriched,   color: "text-blue-700",    bg: "bg-blue-50"   },
                { label: "New / Uncontacted", value: funnelStats.newLeads,  color: "text-emerald-700", bg: "bg-emerald-50" },
              ].map(s => (
                <div key={s.label} className={`rounded-xl border border-gray-200 ${s.bg} px-4 py-3 text-center`}>
                  <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
                  <div className="text-[10px] font-semibold text-gray-500 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Stage breakdown ── */}
          {funnelStats && funnelStats.stages.length > 0 && (
            <div className="mb-5">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Stage Funnel</div>
              <div className="space-y-1.5">
                {[
                  { key: "qualified_intent", label: "1 · Buyer Intent",      icon: "🎯" },
                  { key: "org_identified",   label: "2 · Org Identified",    icon: "🏢" },
                  { key: "org_found",        label: "3 · Org Verified",      icon: "🔎" },
                  { key: "non_competitor",   label: "4 · Not Competitor",    icon: "✅" },
                  { key: "icp_matched",      label: "5 · ICP Match",         icon: "🎯" },
                  { key: "lead_created",     label: "6 · Lead Created",      icon: "⭐" },
                ].map(({ key, label, icon }) => {
                  const s = funnelStats.stages.find(st => st.stage === key);
                  const passed  = s?.passed  ?? 0;
                  const total   = s?.total   ?? 0;
                  const convPct = s?.conversionPct ?? 0;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-sm w-5 text-center">{icon}</span>
                      <span className="text-[11px] text-gray-600 w-36 flex-shrink-0">{label}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${convPct}%`,
                            background: convPct > 60
                              ? "linear-gradient(90deg, #1A3D2B, #0D9488)"
                              : convPct > 30
                              ? "#f59e0b"
                              : "#ef4444",
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-gray-500 w-20 text-right">
                        {passed}/{total} ({convPct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Qualified leads list ── */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Qualified Leads {playLeads.length > 0 && `(${playLeads.length})`}
            </div>

            {leadsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}
              </div>
            ) : playLeads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center">
                <TrendingUp className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-xs text-gray-400 mb-1">No qualified leads yet</p>
                <p className="text-[11px] text-gray-300">
                  {playStatus === "active"
                    ? "Run the funnel to process unqualified signals"
                    : "Launch this play first to start collecting signals"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {playLeads.map(lead => {
                  const isExpanded = expandedLead === lead.id;
                  const contacts   = (lead.key_contacts ?? []) as { name: string; title?: string; email?: string; linkedInUrl?: string }[];
                  const scoreColor = lead.lead_score >= 75 ? "text-emerald-700" : lead.lead_score >= 50 ? "text-amber-700" : "text-gray-500";
                  const scoreBg    = lead.lead_score >= 75 ? "bg-emerald-50 border-emerald-200" : lead.lead_score >= 50 ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200";

                  return (
                    <div key={lead.id} className="rounded-xl border border-gray-200 overflow-hidden">
                      <div
                        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => setExpandedLead(isExpanded ? null : lead.id)}
                      >
                        {/* Score badge */}
                        <div className={`flex-shrink-0 w-10 h-10 rounded-lg border flex items-center justify-center ${scoreBg}`}>
                          <div>
                            <div className={`text-sm font-black leading-none ${scoreColor}`}>{lead.lead_score}</div>
                            <div className="text-[8px] text-gray-400 text-center">pts</div>
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <div className="text-sm font-bold text-gray-900 truncate">{lead.company_name}</div>
                                {lead.score_breakdown?.low_confidence && (
                                  <span className="flex-shrink-0 text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded">
                                    ⚠ Low confidence
                                  </span>
                                )}
                              </div>
                              {lead.key_phrase && (
                                <div className="text-[10px] text-teal-700 font-medium italic truncate mt-0.5">"{lead.key_phrase}"</div>
                              )}
                              {lead.intent_summary ? (
                                <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{lead.intent_summary}</div>
                              ) : (
                                <div className="text-[10px] text-gray-300 mt-0.5 italic">Generating summary…</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {lead.enriched && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                  <Users className="w-2.5 h-2.5 inline mr-0.5" />contacts
                                </span>
                              )}
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                                lead.status === "contacted" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                              }`}>
                                {lead.status}
                              </span>
                              {isExpanded
                                ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                                : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                            </div>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50 space-y-3">
                          {/* Why this lead + recommended angle */}
                          {(lead.score_breakdown?.why_this_lead || lead.score_breakdown?.recommended_angle) && (
                            <div className="space-y-1.5">
                              {lead.score_breakdown.why_this_lead && (
                                <div className="text-[11px] text-gray-700 italic border-l-2 border-teal-400 pl-2">
                                  {lead.score_breakdown.why_this_lead}
                                </div>
                              )}
                              {lead.score_breakdown.recommended_angle && (
                                <div className="flex items-start gap-1.5">
                                  <span className="text-[9px] font-semibold text-teal-600 uppercase tracking-wider flex-shrink-0 mt-0.5">Angle</span>
                                  <span className="text-[10px] text-gray-600">{lead.score_breakdown.recommended_angle}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Score breakdown */}
                          {lead.score_breakdown && (
                            <div>
                              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Score Breakdown</div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                {Object.entries(lead.score_breakdown)
                                  .filter(([k]) => !["why_this_lead", "recommended_angle", "matched_icp", "signal_type", "urgency"].includes(k))
                                  .map(([k, v]) => {
                                    if (typeof v !== "number") return null;
                                    const isConfidence = k.includes("confidence");
                                    const displayVal   = isConfidence ? Math.round((v as number) * 100) : Math.round(v as number);
                                    const pct          = isConfidence
                                      ? Math.min(100, displayVal)
                                      : Math.min(100, (v as number / 100) * 100);
                                    return (
                                      <div key={k} className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-500 capitalize w-24">{k.replace(/_/g, " ")}</span>
                                        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                          <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                                        </div>
                                        <span className="text-[10px] font-bold text-gray-700 w-6 text-right">{displayVal}</span>
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          )}

                          {/* Key contacts */}
                          {contacts.length > 0 && (
                            <div>
                              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Key Contacts</div>
                              <div className="space-y-1.5">
                                {contacts.slice(0, 3).map((c, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                                      <span className="text-[10px] font-bold text-teal-700">{c.name[0] ?? "?"}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[11px] font-semibold text-gray-800 truncate">{c.name}</div>
                                      {c.title && <div className="text-[10px] text-gray-500 truncate">{c.title}</div>}
                                    </div>
                                    {c.email && (
                                      <a
                                        href={`mailto:${c.email}`}
                                        onClick={e => e.stopPropagation()}
                                        className="text-[10px] text-teal-600 hover:text-teal-800 flex items-center gap-0.5"
                                      >
                                        <Mail className="w-3 h-3" />
                                      </a>
                                    )}
                                    {c.linkedInUrl && (
                                      <a
                                        href={c.linkedInUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Source + actions */}
                          <div className="flex items-center justify-between pt-1">
                            <div className="text-[10px] text-gray-400 flex items-center gap-1">
                              {lead.platform && <span className="capitalize">{lead.platform}</span>}
                              {lead.post_url && (
                                <a href={lead.post_url} target="_blank" rel="noreferrer" className="text-teal-600 hover:text-teal-800 ml-1">
                                  <ExternalLink className="w-3 h-3 inline" /> source
                                </a>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-gray-400">{new Date(lead.created_at).toLocaleDateString()}</span>
                              {lead.lead_id && (
                                <a
                                  href={`/leads/${lead.lead_id}`}
                                  className="flex items-center gap-1 text-[10px] font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-lg transition-colors"
                                >
                                  <Star className="w-2.5 h-2.5" /> View Lead
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

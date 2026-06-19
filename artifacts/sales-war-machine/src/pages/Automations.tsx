import { useState, useEffect, useCallback, useRef } from "react";
import {
  Zap,
  Plus,
  Play,
  Pause,
  ChevronRight,
  ChevronDown,
  X,
  MessageCircle,
  Clock,
  Filter,
  Calendar,
  Tag,
  GitBranch,
  Send,
  Bell,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  Star,
  Loader2,
  Activity,
  UserCheck,
  CalendarCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

type TriggerType = "new_lead_meta_ad" | "missed_booking" | "no_response" | "call_booked" | "proposal_sent" | "lead_lost";
type StepType = "trigger" | "condition" | "action" | "delay";

// Icon map — DB stores icon as a string key, we resolve to React component here
const ICON_MAP: Record<string, React.ElementType> = {
  Tag, Clock, MessageCircle, GitBranch, Zap, Filter, Calendar, Send, Bell, AlertCircle, ArrowRight, CheckCircle2, RotateCcw, Star, Play, Pause, Users: Zap,
};

function resolveIcon(iconKey: string): React.ElementType {
  return ICON_MAP[iconKey] ?? Zap;
}

interface RawStep {
  id: string;
  type: StepType;
  label: string;
  detail: string;
  icon: string;
  color: string;
}

interface AutomationStep {
  id: string;
  type: StepType;
  label: string;
  detail: string;
  icon: React.ElementType;
  color: string;
}

interface AutomationRaw {
  id: number;
  name: string;
  trigger: TriggerType;
  description: string;
  active: boolean;
  runs: number;
  conversions: number;
  steps: RawStep[];
  createdAt: string;
}

interface Automation extends Omit<AutomationRaw, "steps"> {
  steps: AutomationStep[];
}

function hydrateAutomation(raw: AutomationRaw): Automation {
  return {
    ...raw,
    steps: (raw.steps ?? []).map(s => ({ ...s, icon: resolveIcon(s.icon) })),
  };
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  new_lead_meta_ad: "New Meta Ad Lead",
  missed_booking: "Missed Booking",
  no_response: "No Response",
  call_booked: "Discovery Call Booked",
  proposal_sent: "Proposal Sent",
  lead_lost: "Lead Lost / Cold",
};

const TRIGGER_ICONS: Record<TriggerType, React.ElementType> = {
  new_lead_meta_ad: Tag,
  missed_booking: AlertCircle,
  no_response: RotateCcw,
  call_booked: Calendar,
  proposal_sent: Send,
  lead_lost: Star,
};

const TRIGGER_COLORS: Record<TriggerType, string> = {
  new_lead_meta_ad: "#4F35A8",
  missed_booking: "#EF4444",
  no_response: "#F59E0B",
  call_booked: "#3B82F6",
  proposal_sent: "#8B5CF6",
  lead_lost: "#6B7280",
};

const STEP_BG: Record<StepType, string> = {
  trigger: "#EDE9FE",
  condition: "#FEF3C7",
  action: "#ECFDF5",
  delay: "#F3F4F6",
};

const STEP_LABEL_COLORS: Record<StepType, string> = {
  trigger: "#6D28D9",
  condition: "#D97706",
  action: "#059669",
  delay: "#6B7280",
};

function StepNode({ step, isLast }: { step: AutomationStep; isLast: boolean }) {
  const Icon = step.icon;
  return (
    <div className="flex flex-col items-center">
      <div className="w-full rounded-xl border p-3 flex items-start gap-3" style={{ background: "#ffffff", borderColor: "hsl(220 13% 91%)", borderLeft: `3px solid ${step.color}` }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: STEP_BG[step.type] }}>
          <Icon className="w-4 h-4" style={{ color: step.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: STEP_BG[step.type], color: STEP_LABEL_COLORS[step.type] }}>{step.type}</span>
          </div>
          <div className="text-[12px] font-semibold" style={{ color: "#111827" }}>{step.label}</div>
          <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "#6B7280" }}>{step.detail}</div>
        </div>
      </div>
      {!isLast && (
        <div className="flex flex-col items-center my-1">
          <div className="w-0.5 h-4" style={{ background: "#E5E7EB" }} />
          <ArrowRight className="w-3 h-3 rotate-90" style={{ color: "#D1D5DB" }} />
        </div>
      )}
    </div>
  );
}

function AutomationCard({ automation, onToggle, onExpand, expanded, toggling }: {
  automation: Automation;
  onToggle: (id: number) => void;
  onExpand: (id: number) => void;
  expanded: boolean;
  toggling: boolean;
}) {
  const TriggerIcon = TRIGGER_ICONS[automation.trigger];
  const triggerColor = TRIGGER_COLORS[automation.trigger];
  const convRate = automation.runs ? Math.round((automation.conversions / automation.runs) * 100) : 0;

  return (
    <div className="rounded-xl border overflow-hidden transition-all duration-200" style={{ background: "#ffffff", borderColor: expanded ? "#4F35A8" : "hsl(220 13% 91%)" }}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${triggerColor}18` }}>
            <TriggerIcon className="w-5 h-5" style={{ color: triggerColor }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold mb-0.5" style={{ color: "#111827" }}>{automation.name}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${triggerColor}18`, color: triggerColor }}>{TRIGGER_LABELS[automation.trigger]}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={automation.active ? { background: "#D1FAE5", color: "#059669" } : { background: "#F3F4F6", color: "#6B7280" }}>
                    {automation.active ? "Active" : "Paused"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onToggle(automation.id)}
                  disabled={toggling}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-60"
                  style={automation.active ? { background: "#FEF3C7", color: "#D97706" } : { background: "#D1FAE5", color: "#059669" }}
                  title={automation.active ? "Pause automation" : "Activate automation"}
                >
                  {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : automation.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => onExpand(automation.id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                  style={{ background: "#F3F4F6", color: "#6B7280" }}
                >
                  {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <p className="text-[12px] mt-1.5" style={{ color: "#6B7280" }}>{automation.description}</p>

            <div className="grid grid-cols-3 gap-3 mt-3">
              {[{ label: "Total Runs", value: automation.runs }, { label: "Conversions", value: automation.conversions }, { label: "Conv. Rate", value: `${convRate}%` }].map(({ label, value }) => (
                <div key={label}>
                  <div className="text-[15px] font-bold" style={{ color: "#111827" }}>{value}</div>
                  <div className="text-[10px]" style={{ color: "#9CA3AF" }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1.5 mt-3">
              <div className="flex -space-x-1">
                {automation.steps.slice(0, 5).map(step => {
                  const StepIcon = step.icon;
                  return (
                    <div key={step.id} className="w-5 h-5 rounded-full border-2 border-white flex items-center justify-center" style={{ background: `${step.color}22` }} title={step.label}>
                      <StepIcon className="w-2.5 h-2.5" style={{ color: step.color }} />
                    </div>
                  );
                })}
              </div>
              <span className="text-[11px]" style={{ color: "#9CA3AF" }}>{automation.steps.length} steps</span>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0" style={{ borderTop: "1px solid hsl(220 13% 91%)" }}>
          <div className="pt-3 text-[12px] font-semibold mb-3 flex items-center gap-2" style={{ color: "#374151" }}>
            <Zap className="w-3.5 h-3.5" style={{ color: "#4F35A8" }} />
            Automation Flow
          </div>
          <div className="space-y-0">
            {automation.steps.map((step, i) => (
              <StepNode key={step.id} step={step} isLast={i === automation.steps.length - 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewAutomationModal({ onClose, onCreate }: { onClose: () => void; onCreate: (a: Automation) => void }) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<TriggerType>("new_lead_meta_ad");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const initialSteps: RawStep[] = [
      { id: "s1", type: "trigger", label: `Trigger: ${TRIGGER_LABELS[trigger]}`, detail: "Configure this trigger in settings", icon: trigger === "new_lead_meta_ad" ? "Tag" : trigger === "missed_booking" ? "AlertCircle" : trigger === "no_response" ? "RotateCcw" : trigger === "call_booked" ? "Calendar" : trigger === "proposal_sent" ? "Send" : "Star", color: TRIGGER_COLORS[trigger] },
      { id: "s2", type: "action", label: "Send WhatsApp Message", detail: "Add your message content here", icon: "MessageCircle", color: "#25D366" },
    ];
    try {
      const res = await fetch(`${API_BASE}/automations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), trigger, description: `Automation triggered by: ${TRIGGER_LABELS[trigger]}`, steps: initialSteps }),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create");
      const { automation } = await res.json();
      onCreate(hydrateAutomation(automation));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" style={{ background: "#ffffff" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid hsl(220 13% 91%)" }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#4F35A8" }}>
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-[15px] font-bold" style={{ color: "#111827" }}>New Automation</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#F3F4F6" }}>
            <X className="w-3.5 h-3.5" style={{ color: "#6B7280" }} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#374151" }}>Automation Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. WhatsApp Lead Nurture Sequence"
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none border transition-colors"
              style={{ borderColor: "hsl(220 13% 88%)", color: "#111827" }} />
          </div>

          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#374151" }}>Select Trigger</label>
            <div className="space-y-1.5">
              {(Object.entries(TRIGGER_LABELS) as [TriggerType, string][]).map(([k, v]) => {
                const Icon = TRIGGER_ICONS[k];
                const color = TRIGGER_COLORS[k];
                const selected = trigger === k;
                return (
                  <button key={k} onClick={() => setTrigger(k)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all"
                    style={{ borderColor: selected ? "#4F35A8" : "hsl(220 13% 91%)", background: selected ? "#EDE9FE" : "#ffffff" }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}22` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color }} />
                    </div>
                    <span className="text-[12px] font-medium" style={{ color: selected ? "#4F35A8" : "#374151" }}>{v}</span>
                    {selected && <CheckCircle2 className="w-4 h-4 ml-auto" style={{ color: "#4F35A8" }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors" style={{ borderColor: "hsl(220 13% 88%)", color: "#6B7280" }}>Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim() || saving}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all flex items-center justify-center gap-1.5"
            style={{ background: name.trim() && !saving ? "#4F35A8" : "#D1D5DB", cursor: name.trim() && !saving ? "pointer" : "not-allowed" }}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "Creating…" : "Create Automation"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Live Activity Feed ────────────────────────────────────────────────────

const LIVE_EVENTS = [
  { icon: Tag, color: "#4F35A8", msg: "New Meta Ad lead → WA sent to Riya Mehta (Techflow.io)", time: "2m ago" },
  { icon: CalendarCheck, color: "#25D366", msg: "Arjun Shah booked discovery call via booking link", time: "8m ago" },
  { icon: RotateCcw, color: "#F59E0B", msg: "No-Response Drip: Day-3 follow-up sent to 4 leads", time: "14m ago" },
  { icon: Send, color: "#8B5CF6", msg: "Proposal Follow-Up sequence triggered for Priya Nair", time: "31m ago" },
  { icon: AlertCircle, color: "#EF4444", msg: "Missed Booking Recovery sent to Dev Kapoor", time: "47m ago" },
  { icon: Calendar, color: "#3B82F6", msg: "Discovery Call reminder sent 24h before: Kavya Shah", time: "1h ago" },
];

function LiveActivityFeed() {
  const [visible, setVisible] = useState(3);
  return (
    <div className="rounded-xl border" style={{ background: "#ffffff", borderColor: "hsl(220 13% 91%)" }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid hsl(220 13% 93%)" }}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "#EDE9FE" }}>
            <Activity className="w-3.5 h-3.5" style={{ color: "#4F35A8" }} />
          </div>
          <span className="text-[13px] font-bold" style={{ color: "#111827" }}>Live Automation Activity</span>
          <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "#ECFDF5", color: "#059669" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" style={{ animation: "pulse 1.5s infinite" }} />
            Live
          </span>
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: "hsl(220 13% 95%)" }}>
        {LIVE_EVENTS.slice(0, visible).map((ev, i) => {
          const Icon = ev.icon;
          return (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${ev.color}15` }}>
                <Icon className="w-3.5 h-3.5" style={{ color: ev.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] leading-snug" style={{ color: "#374151" }}>{ev.msg}</p>
              </div>
              <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: "#9CA3AF" }}>{ev.time}</span>
            </div>
          );
        })}
      </div>
      {visible < LIVE_EVENTS.length && (
        <div className="px-4 py-2.5" style={{ borderTop: "1px solid hsl(220 13% 93%)" }}>
          <button onClick={() => setVisible(LIVE_EVENTS.length)} className="text-[11px] font-semibold" style={{ color: "#4F35A8" }}>
            Show {LIVE_EVENTS.length - visible} more events →
          </button>
        </div>
      )}
    </div>
  );
}

export default function Automations() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const fetchAutomations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/automations`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load automations");
      const data = await res.json();
      setAutomations((data.automations ?? []).map(hydrateAutomation));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAutomations(); }, [fetchAutomations]);

  async function toggleAutomation(id: number) {
    if (togglingId) return;
    const a = automations.find(x => x.id === id);
    if (!a) return;
    const nextActive = !a.active;
    setTogglingId(id);
    setAutomations(prev => prev.map(x => x.id === id ? { ...x, active: nextActive } : x));
    try {
      const res = await fetch(`${API_BASE}/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
        credentials: "include",
      });
      if (!res.ok) throw new Error();
    } catch {
      setAutomations(prev => prev.map(x => x.id === id ? { ...x, active: a.active } : x));
    } finally {
      setTogglingId(null);
    }
  }

  function toggleExpand(id: number) {
    setExpandedId(prev => prev === id ? null : id);
  }

  const filtered = filter === "all" ? automations : automations.filter(a => filter === "active" ? a.active : !a.active);
  const activeCount = automations.filter(a => a.active).length;
  const totalRuns = automations.reduce((s, a) => s + a.runs, 0);
  const totalConversions = automations.reduce((s, a) => s + a.conversions, 0);

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-5">
      {showNew && (
        <NewAutomationModal
          onClose={() => setShowNew(false)}
          onCreate={a => setAutomations(prev => [a, ...prev])}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Automation Builder</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Trigger-based WhatsApp sequences that run automatically</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
          style={{ background: "#4F35A8" }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Automation
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active Automations", value: activeCount, color: "#059669" },
          { label: "Total Runs", value: totalRuns.toLocaleString(), color: "#4F35A8" },
          { label: "Conversions", value: totalConversions, color: "#D97706" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border p-3 text-center" style={{ background: "#ffffff", borderColor: "hsl(220 13% 91%)" }}>
            <div className="text-[20px] font-black" style={{ color }}>{value}</div>
            <div className="text-[11px] font-medium mt-0.5" style={{ color: "#9CA3AF" }}>{label}</div>
          </div>
        ))}
      </div>

      <LiveActivityFeed />

      <div className="flex items-center gap-2">
        {(["all", "active", "paused"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors capitalize"
            style={{ background: filter === f ? "#4F35A8" : "#ffffff", color: filter === f ? "#ffffff" : "#6B7280", borderColor: filter === f ? "#4F35A8" : "hsl(220 13% 88%)" }}>
            {f === "all" ? "All" : f === "active" ? "Active" : "Paused"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-14">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#4F35A8" }} />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Failed to load automations</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
          </div>
          <button onClick={fetchAutomations} className="ml-auto text-xs font-semibold text-red-700 hover:text-red-900">Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center" style={{ borderColor: "hsl(220 13% 88%)" }}>
          <Zap className="w-8 h-8 mx-auto mb-3" style={{ color: "#D1D5DB" }} />
          <p className="text-sm font-semibold" style={{ color: "#374151" }}>No automations yet</p>
          <p className="text-xs mt-1" style={{ color: "#9CA3AF" }}>Create your first automation to start closing leads on autopilot</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(a => (
            <AutomationCard
              key={a.id}
              automation={a}
              onToggle={toggleAutomation}
              onExpand={toggleExpand}
              expanded={expandedId === a.id}
              toggling={togglingId === a.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

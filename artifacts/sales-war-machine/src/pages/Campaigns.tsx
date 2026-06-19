import { useState, useEffect, useCallback } from "react";
import {
  Megaphone,
  Plus,
  Send,
  CheckCircle2,
  MessageCircle,
  CalendarCheck,
  BarChart3,
  Play,
  Pause,
  X,
  Clock,
  TrendingUp,
  Repeat,
  Star,
  ThumbsUp,
  RotateCcw,
  Loader2,
  AlertCircle,
  Eye,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

type CampaignStatus = "draft" | "active" | "paused" | "completed";
type CampaignSegment = "new_leads" | "no_response" | "proposal_sent" | "won_customers" | "old_leads";

interface Campaign {
  id: number;
  name: string;
  segment: CampaignSegment;
  status: CampaignStatus;
  template: string;
  scheduledAt: string | null;
  sent: number;
  delivered: number;
  replied: number;
  booked: number;
  total: number;
  createdAt: string;
}

interface Template {
  id: number;
  name: string;
  category: "reminder" | "offer" | "reactivation" | "testimonial" | "review";
  preview: string;
  variables: string[];
}

const SEGMENT_LABELS: Record<CampaignSegment, string> = {
  new_leads: "New Leads",
  no_response: "No Response",
  proposal_sent: "Proposal Sent",
  won_customers: "Won Customers",
  old_leads: "Old Leads",
};

const SEGMENT_COLORS: Record<CampaignSegment, string> = {
  new_leads: "#4F35A8",
  no_response: "#F59E0B",
  proposal_sent: "#3B82F6",
  won_customers: "#10B981",
  old_leads: "#8B5CF6",
};

const STATUS_CONFIG: Record<CampaignStatus, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: "#6B7280", bg: "#F3F4F6" },
  active: { label: "Active", color: "#059669", bg: "#D1FAE5" },
  paused: { label: "Paused", color: "#D97706", bg: "#FEF3C7" },
  completed: { label: "Completed", color: "#6B7280", bg: "#F3F4F6" },
};

const TEMPLATES: Template[] = [
  { id: 1, name: "WhatsApp Welcome + Audit Offer", category: "reminder", preview: "Hi {{firstName}}, I noticed you're running {{company}} and wanted to share a free brand audit. Want to see your score?", variables: ["firstName", "company"] },
  { id: 2, name: "Gentle Follow-Up Offer", category: "offer", preview: "Hey {{firstName}}, just checking in. We're running a limited offer for {{industry}} businesses this month!", variables: ["firstName", "industry"] },
  { id: 3, name: "Reactivation — 30-Day No Response", category: "reactivation", preview: "Hi {{firstName}}, it's been a while! We've helped 3 businesses in {{city}} grow their revenue by 40% last quarter.", variables: ["firstName", "city"] },
  { id: 4, name: "Testimonial Request", category: "testimonial", preview: "{{firstName}}, working with you on {{project}} was amazing! Would you mind sharing a 2-line testimonial?", variables: ["firstName", "project"] },
  { id: 5, name: "Google Review Request", category: "review", preview: "Hi {{firstName}}, we loved working with {{company}}! A Google review would mean the world to us.", variables: ["firstName", "company", "reviewLink"] },
  { id: 6, name: "Proposal Reminder — Day 3", category: "reminder", preview: "Hi {{firstName}}, just following up on the proposal for {{service}}. Any questions?", variables: ["firstName", "service"] },
];

const TEMPLATE_ICONS: Record<Template["category"], React.ElementType> = {
  reminder: Clock, offer: TrendingUp, reactivation: RotateCcw, testimonial: Star, review: ThumbsUp,
};

const TEMPLATE_COLORS: Record<Template["category"], string> = {
  reminder: "#4F35A8", offer: "#10B981", reactivation: "#8B5CF6", testimonial: "#F59E0B", review: "#3B82F6",
};

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function FunnelBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const p = pct(value, total);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] font-medium" style={{ color: "#6B7280" }}>{label}</span>
        <span className="text-[12px] font-bold" style={{ color: "#111827" }}>
          {value} <span style={{ color: "#9CA3AF", fontWeight: 400 }}>({p}%)</span>
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "#F3F4F6" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${p}%`, background: color }} />
      </div>
    </div>
  );
}

// Get template content for a campaign
function getTemplateForCampaign(templateName: string): Template | null {
  return TEMPLATES.find(t => t.name === templateName) ?? null;
}

function WhatsAppPreview({ template, segment }: { template: Template; segment: CampaignSegment }) {
  const sampleVars: Record<string, string> = {
    firstName: "Riya",
    company: "Techflow.io",
    industry: "SaaS",
    city: "Mumbai",
    project: "brand redesign",
    service: "digital marketing",
    reviewLink: "g.page/r/dreamsdesign",
  };
  const message = template.preview.replace(/\{\{(\w+)\}\}/g, (_, k) => sampleVars[k] ?? `{${k}}`);
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid hsl(220 13% 91%)" }}>
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="w-3 h-3" style={{ color: "#4F35A8" }} />
        <span className="text-[11px] font-semibold" style={{ color: "#374151" }}>Template Preview — "{template.name}"</span>
      </div>
      <div className="rounded-xl p-3" style={{ background: "#E5DDD5", maxWidth: 340 }}>
        {/* WA Header */}
        <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: "1px solid rgba(0,0,0,.08)" }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold" style={{ background: "#25D366" }}>DD</div>
          <div>
            <div className="text-[12px] font-semibold" style={{ color: "#111827" }}>Dreamsdesign</div>
            <div className="text-[10px]" style={{ color: "#6B7280" }}>Business Account · online</div>
          </div>
        </div>
        {/* Message bubble */}
        <div className="relative ml-auto" style={{ maxWidth: 280 }}>
          <div className="rounded-lg px-3 py-2 text-[13px] leading-relaxed shadow-sm" style={{ background: "#DCF8C6", color: "#111827", borderBottomRightRadius: 4 }}>
            {message}
            <div className="flex items-center justify-end gap-1 mt-1">
              <span className="text-[10px]" style={{ color: "#6B7280" }}>{timeStr}</span>
              <CheckCircle2 className="w-3 h-3" style={{ color: "#25D366" }} />
            </div>
          </div>
        </div>
        {/* Variables */}
        {template.variables.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {template.variables.map(v => (
              <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(79,53,168,.12)", color: "#4F35A8" }}>{`{{${v}}}`}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ campaign, onToggle, toggling }: { campaign: Campaign; onToggle: (id: number) => void; toggling: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const statusCfg = STATUS_CONFIG[campaign.status];
  const segColor = SEGMENT_COLORS[campaign.segment];
  const template = getTemplateForCampaign(campaign.template);
  const bookingRate = campaign.total ? Math.round((campaign.booked / campaign.total) * 100) : 0;

  return (
    <div className="rounded-xl border transition-all duration-150" style={{ background: "#ffffff", borderColor: expanded ? "#4F35A8" : "hsl(220 13% 91%)", boxShadow: expanded ? "0 0 0 1px #4F35A840" : "none" }}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[14px] font-semibold truncate" style={{ color: "#111827" }}>{campaign.name}</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: statusCfg.bg, color: statusCfg.color }}>{statusCfg.label}</span>
              {bookingRate > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#ECFDF5", color: "#059669" }}>
                  {bookingRate}% booking rate
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${segColor}18`, color: segColor }}>{SEGMENT_LABELS[campaign.segment]}</span>
              <span className="text-[11px]" style={{ color: "#9CA3AF" }}>{campaign.template}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {campaign.scheduledAt && (
              <span className="text-[11px]" style={{ color: "#6B7280" }}>
                {new Date(campaign.scheduledAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </span>
            )}
            {template && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                style={{ background: expanded ? "#EDE9FE" : "#F3F4F6", color: expanded ? "#4F35A8" : "#6B7280" }}
                title="Preview message"
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            )}
            {(campaign.status === "active" || campaign.status === "paused") && (
              <button
                onClick={() => onToggle(campaign.id)}
                disabled={toggling}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-60"
                style={{ background: campaign.status === "active" ? "#FEF3C7" : "#D1FAE5", color: campaign.status === "active" ? "#D97706" : "#059669" }}
                title={campaign.status === "active" ? "Pause campaign" : "Resume campaign"}
              >
                {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : campaign.status === "active" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { label: "Sent", value: campaign.sent ?? campaign.total, icon: Send, color: "#6B7280" },
            { label: "Delivered", value: campaign.delivered, icon: CheckCircle2, color: "#3B82F6" },
            { label: "Replied", value: campaign.replied, icon: MessageCircle, color: "#4F35A8" },
            { label: "Booked", value: campaign.booked, icon: CalendarCheck, color: "#059669" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="text-center">
              <div className="text-[15px] font-bold" style={{ color: "#111827" }}>{value}</div>
              <div className="flex items-center justify-center gap-0.5">
                <Icon className="w-3 h-3" style={{ color }} />
                <span className="text-[10px] font-medium" style={{ color: "#9CA3AF" }}>{label}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <FunnelBar label="Delivered" value={campaign.delivered} total={campaign.total} color="#3B82F6" />
          <FunnelBar label="Replied" value={campaign.replied} total={campaign.total} color="#4F35A8" />
          <FunnelBar label="Booked" value={campaign.booked} total={campaign.total} color="#059669" />
        </div>

        {expanded && template && (
          <WhatsAppPreview template={template} segment={campaign.segment} />
        )}
      </div>
    </div>
  );
}

function CreateCampaignModal({ onClose, onCreate }: { onClose: () => void; onCreate: (c: Campaign) => void }) {
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<CampaignSegment>("new_leads");
  const [template, setTemplate] = useState(TEMPLATES[0].name);
  const [schedDate, setSchedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), segment, template, scheduledAt: new Date(schedDate).toISOString(), total: 0 }),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create");
      const { campaign } = await res.json();
      onCreate(campaign);
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
              <Megaphone className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-[15px] font-bold" style={{ color: "#111827" }}>New Campaign</span>
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
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#374151" }}>Campaign Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. May Reactivation Push"
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none border transition-colors"
              style={{ borderColor: "hsl(220 13% 88%)", color: "#111827" }} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#374151" }}>Segment</label>
            <select value={segment} onChange={e => setSegment(e.target.value as CampaignSegment)}
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none border" style={{ borderColor: "hsl(220 13% 88%)", color: "#111827" }}>
              {(Object.entries(SEGMENT_LABELS) as [CampaignSegment, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#374151" }}>Template</label>
            <select value={template} onChange={e => setTemplate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none border" style={{ borderColor: "hsl(220 13% 88%)", color: "#111827" }}>
              {TEMPLATES.map(t => (<option key={t.id} value={t.name}>{t.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#374151" }}>Schedule</label>
            <input type="datetime-local" value={schedDate} onChange={e => setSchedDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none border" style={{ borderColor: "hsl(220 13% 88%)", color: "#111827" }} />
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors" style={{ borderColor: "hsl(220 13% 88%)", color: "#6B7280" }}>Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim() || saving}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all flex items-center justify-center gap-1.5"
            style={{ background: name.trim() && !saving ? "#4F35A8" : "#D1D5DB", cursor: name.trim() && !saving ? "pointer" : "not-allowed" }}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "Creating…" : "Create Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const Icon = TEMPLATE_ICONS[template.category];
  const color = TEMPLATE_COLORS[template.category];
  return (
    <div className="rounded-xl border p-4 transition-all duration-150 hover:shadow-md" style={{ background: "#ffffff", borderColor: "hsl(220 13% 91%)" }}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}18` }}>
          <Icon style={{ color, width: 18, height: 18 }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold mb-0.5" style={{ color: "#111827" }}>{template.name}</div>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize" style={{ background: `${color}18`, color }}>{template.category}</span>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed mb-3" style={{ color: "#6B7280" }}>{template.preview}</p>
      <div className="flex flex-wrap gap-1">
        {template.variables.map(v => (
          <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "#F3F4F6", color: "#6B7280" }}>{`{{${v}}}`}</span>
        ))}
      </div>
    </div>
  );
}

function AnalyticsTab({ campaigns }: { campaigns: Campaign[] }) {
  const totals = campaigns.reduce((acc, c) => ({ sent: acc.sent + c.total, delivered: acc.delivered + c.delivered, replied: acc.replied + c.replied, booked: acc.booked + c.booked }), { sent: 0, delivered: 0, replied: 0, booked: 0 });
  const funnel = [
    { label: "Total Sent", value: totals.sent, icon: Send, color: "#6B7280" },
    { label: "Delivered", value: totals.delivered, icon: CheckCircle2, color: "#3B82F6" },
    { label: "Replied", value: totals.replied, icon: MessageCircle, color: "#4F35A8" },
    { label: "Meetings Booked", value: totals.booked, icon: CalendarCheck, color: "#059669" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {funnel.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border p-4" style={{ background: "#ffffff", borderColor: "hsl(220 13% 91%)" }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
                <Icon className="w-3.5 h-3.5" style={{ color }} />
              </div>
              <span className="text-[11px] font-medium" style={{ color: "#6B7280" }}>{label}</span>
            </div>
            <div className="text-[24px] font-bold" style={{ color: "#111827" }}>{value.toLocaleString()}</div>
            <div className="text-[11px] mt-0.5" style={{ color: "#9CA3AF" }}>{pct(value, totals.sent)}% of sent</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border p-5" style={{ background: "#ffffff", borderColor: "hsl(220 13% 91%)" }}>
        <div className="text-[14px] font-semibold mb-4" style={{ color: "#111827" }}>Overall Funnel</div>
        <div className="space-y-3">
          <FunnelBar label="Delivered" value={totals.delivered} total={totals.sent} color="#3B82F6" />
          <FunnelBar label="Replied" value={totals.replied} total={totals.sent} color="#4F35A8" />
          <FunnelBar label="Meetings Booked" value={totals.booked} total={totals.sent} color="#059669" />
        </div>
      </div>

      <div className="rounded-xl border p-5" style={{ background: "#ffffff", borderColor: "hsl(220 13% 91%)" }}>
        <div className="text-[14px] font-semibold mb-4" style={{ color: "#111827" }}>Campaign Performance</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ borderBottom: "1px solid hsl(220 13% 91%)" }}>
                {["Campaign", "Segment", "Status", "Sent", "Delivered", "Replied", "Booked", "Booking Rate"].map(h => (
                  <th key={h} className="pb-2 text-left font-semibold pr-4 whitespace-nowrap" style={{ color: "#9CA3AF" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} style={{ borderBottom: "1px solid hsl(220 13% 95%)" }}>
                  <td className="py-2.5 pr-4 font-medium whitespace-nowrap" style={{ color: "#111827" }}>{c.name}</td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${SEGMENT_COLORS[c.segment]}18`, color: SEGMENT_COLORS[c.segment] }}>{SEGMENT_LABELS[c.segment]}</span>
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: STATUS_CONFIG[c.status].bg, color: STATUS_CONFIG[c.status].color }}>{STATUS_CONFIG[c.status].label}</span>
                  </td>
                  <td className="py-2.5 pr-4" style={{ color: "#374151" }}>{c.total}</td>
                  <td className="py-2.5 pr-4" style={{ color: "#374151" }}>{c.delivered}</td>
                  <td className="py-2.5 pr-4" style={{ color: "#374151" }}>{c.replied}</td>
                  <td className="py-2.5 pr-4" style={{ color: "#374151" }}>{c.booked}</td>
                  <td className="py-2.5 font-bold" style={{ color: "#059669" }}>{c.total ? `${pct(c.booked, c.total)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Campaigns() {
  const [tab, setTab] = useState<"campaigns" | "templates" | "analytics">("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">("all");
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/campaigns`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load campaigns");
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  async function toggleCampaign(id: number) {
    if (togglingId) return;
    const c = campaigns.find(x => x.id === id);
    if (!c) return;
    const nextStatus = c.status === "active" ? "paused" : "active";
    setTogglingId(id);
    setCampaigns(prev => prev.map(x => x.id === id ? { ...x, status: nextStatus } : x));
    try {
      const res = await fetch(`${API_BASE}/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
        credentials: "include",
      });
      if (!res.ok) throw new Error();
    } catch {
      setCampaigns(prev => prev.map(x => x.id === id ? { ...x, status: c.status } : x));
    } finally {
      setTogglingId(null);
    }
  }

  const filtered = statusFilter === "all" ? campaigns : campaigns.filter(c => c.status === statusFilter);
  const activeCampaigns = campaigns.filter(c => c.status === "active").length;
  const totalSent = campaigns.reduce((s, c) => s + c.total, 0);
  const totalBooked = campaigns.reduce((s, c) => s + c.booked, 0);

  const TABS = [
    { id: "campaigns" as const, label: "Campaigns", icon: Megaphone },
    { id: "templates" as const, label: "Templates", icon: BarChart3 },
    { id: "analytics" as const, label: "Analytics", icon: BarChart3 },
  ];

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-5">
      {showCreate && (
        <CreateCampaignModal
          onClose={() => setShowCreate(false)}
          onCreate={c => setCampaigns(prev => [c, ...prev])}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Campaigns & Broadcast</h1>
          <p className="text-xs text-muted-foreground mt-0.5">WhatsApp broadcast campaigns by lead segment</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
          style={{ background: "#4F35A8" }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Campaign
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active Campaigns", value: activeCampaigns, color: "#059669" },
          { label: "Total Sent", value: totalSent.toLocaleString(), color: "#4F35A8" },
          { label: "Meetings Booked", value: totalBooked, color: "#D97706" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border p-3 text-center" style={{ background: "#ffffff", borderColor: "hsl(220 13% 91%)" }}>
            <div className="text-[20px] font-black" style={{ color }}>{value}</div>
            <div className="text-[11px] font-medium mt-0.5" style={{ color: "#9CA3AF" }}>{label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "hsl(220 13% 95%)" }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all"
            style={{ background: tab === id ? "#ffffff" : "transparent", color: tab === id ? "#4F35A8" : "#6B7280", boxShadow: tab === id ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "campaigns" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "active", "paused", "draft", "completed"] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors capitalize"
                style={{
                  background: statusFilter === s ? "#4F35A8" : "#ffffff",
                  color: statusFilter === s ? "#ffffff" : "#6B7280",
                  borderColor: statusFilter === s ? "#4F35A8" : "hsl(220 13% 88%)",
                }}
              >
                {s === "all" ? "All" : STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#4F35A8" }} />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800">Failed to load campaigns</p>
                <p className="text-xs text-red-600 mt-0.5">{error}</p>
              </div>
              <button onClick={fetchCampaigns} className="ml-auto text-xs font-semibold text-red-700 hover:text-red-900">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center" style={{ borderColor: "hsl(220 13% 88%)" }}>
              <Megaphone className="w-8 h-8 mx-auto mb-3" style={{ color: "#D1D5DB" }} />
              <p className="text-sm font-semibold" style={{ color: "#374151" }}>No campaigns yet</p>
              <p className="text-xs mt-1" style={{ color: "#9CA3AF" }}>Create your first broadcast campaign to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(c => (
                <CampaignRow key={c.id} campaign={c} onToggle={toggleCampaign} toggling={togglingId === c.id} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "templates" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TEMPLATES.map(t => <TemplateCard key={t.id} template={t} />)}
        </div>
      )}

      {tab === "analytics" && <AnalyticsTab campaigns={campaigns} />}
    </div>
  );
}

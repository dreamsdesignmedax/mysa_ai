import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  MessageCircle, BarChart2, Settings, ChevronRight, RefreshCw,
  CheckCircle2, AlertTriangle, Loader2, ArrowLeft,
  Save, Plus, X, ExternalLink, Brain, Search, Zap, Clock,
  Mail, Phone, Globe, Building2, User, Target, Send,
  FileText, Sparkles, BookOpen, MessageSquare, Wifi, WifiOff, Check,
} from "lucide-react";
import { cn, scoreToBandKey, bandHexFromKey } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  useGetWhatsAppConversations,
  useGetWhatsAppMessages,
  useGetWhatsAppAnalytics,
  useGetWhatsAppSettings,
  useUpdateWhatsAppSettings,
  useTestWhatsAppConnection,
} from "@workspace/api-client-react";
import type {
  WhatsAppConversation,
  WhatsAppSettings,
  WhatsAppSettingsInput,
} from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type MainTab = "brain" | "conversations" | "analytics" | "settings";
type BrainSubTab = "overview" | "timeline" | "chat";

// ─── WhatsApp state config ────────────────────────────────────────────────────
type WaState = "hook_sent" | "awaiting_yes" | "report_sent" | "qualifying" | "appointment_pitched" | "appointment_booked" | "opted_out";

const STATE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  hook_sent:           { label: "Hook Sent",       bg: "#F3F4F6", color: "#6B7280" },
  awaiting_yes:        { label: "Awaiting YES",    bg: "#FEF3C7", color: "#D97706" },
  report_sent:         { label: "Report Sent",     bg: "#EFF6FF", color: "#2563EB" },
  qualifying:          { label: "Qualifying",      bg: "#F5F3FF", color: "#7C3AED" },
  appointment_pitched: { label: "Appt. Pitched",   bg: "#FFF7ED", color: "#EA580C" },
  appointment_booked:  { label: "Appt. Booked",    bg: "#F0FDF4", color: "#16A34A" },
  opted_out:           { label: "Opted Out",       bg: "#FEF2F2", color: "#DC2626" },
};

function StateBadge({ state }: { state: string }) {
  const cfg = STATE_CONFIG[state] ?? { label: state, bg: "#F3F4F6", color: "#6B7280" };
  return <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>;
}

function leadName(lead: WhatsAppConversation["lead"]): string {
  if (!lead) return "Unknown";
  return `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || "Unknown";
}
function initials(lead: WhatsAppConversation["lead"]): string {
  if (!lead) return "?";
  return `${lead.firstName?.[0] ?? ""}${lead.lastName?.[0] ?? ""}`.toUpperCase() || "?";
}
function timeAgo(ts: string | Date | null | undefined) {
  if (!ts) return "";
  try { return formatDistanceToNow(new Date(ts as string), { addSuffix: true }); } catch { return ""; }
}
function bantFromMeta(metadata: Record<string, unknown>) {
  const bant = metadata?.bant as Record<string, string> | undefined;
  if (!bant || (!bant.budget && !bant.authority && !bant.need && !bant.timeline)) return null;
  return bant;
}

// ─── Shared API helper ────────────────────────────────────────────────────────
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

// ─── Types for Lead Brain ─────────────────────────────────────────────────────
interface BrainLead {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  company: string;
  designation: string;
  industry: string;
  country: string;
  city: string | null;
  website: string | null;
  bantScore: number | null;
  status: string;
  photoUrl: string | null;
  companyLogo: string | null;
  linkedInUrl: string | null;
  tags: string[];
  notes: string | null;
  lastContactedAt: string | null;
  updatedAt: string;
  hasBrain: boolean;
  brain: BrainMemory | null;
}

interface BrainMemory {
  id: number;
  leadId: number;
  aiSummary: string | null;
  dealInsights: string | null;
  nextBestAction: string | null;
  personalityProfile: string | null;
  manualNotes: string | null;
  lastSyncAt: string | null;
}

interface LeadContext {
  lead: BrainLead;
  memory: BrainMemory | null;
  context: {
    touchpoints: Array<{ id: number; subject: string | null; body: string; status: string; sentAt: string | null; createdAt: string; channel: string }>;
    sentEmails: Array<{ id: number; subject: string | null; body: string; sentAt: string | null; createdAt: string }>;
    meetings: Array<{ id: number; type: string | null; status: string; scheduledAt: string; meetingUrl: string | null }>;
    appointments: Array<{ id: number; name: string; scheduledDate: string; scheduledTime: string; status: string | null; meetingLink: string | null; createdAt: string }>;
    waConversations: Array<{ id: number; state: string; waPhoneNumber: string }>;
    waMessages: Array<{ id: number; direction: string; content: string; sentAt: string | null }>;
    transcripts: Array<{ id: number; rawTranscript: string | null; summary: string | null; actionItems: string | null; fetchedAt: string | null }>;
  };
}

interface ChatMessage { role: "user" | "assistant"; content: string }

// ─── LEAD BRAIN TAB ───────────────────────────────────────────────────────────
function LeadBrainTab() {
  const [leads, setLeads] = useState<BrainLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [context, setContext] = useState<LeadContext | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [subTab, setSubTab] = useState<BrainSubTab>("overview");
  const [memLoading, setMemLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    apiFetch<BrainLead[]>("/brain/leads").then(data => { setLeads(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setCtxLoading(true);
    setContext(null);
    setChatHistory([]);
    apiFetch<LeadContext>(`/brain/leads/${selectedId}/context`)
      .then(data => { setContext(data); setNotes(data.memory?.manualNotes ?? ""); })
      .catch(() => toast({ title: "Failed to load lead context", variant: "destructive" }))
      .finally(() => setCtxLoading(false));
  }, [selectedId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    return !q || `${l.firstName} ${l.lastName} ${l.company} ${l.email}`.toLowerCase().includes(q);
  });

  const sel = selectedId ? leads.find(l => l.id === selectedId) ?? null : null;

  async function refreshMemory() {
    if (!selectedId) return;
    setMemLoading(true);
    try {
      const data = await apiFetch<{ memory: BrainMemory }>(`/brain/leads/${selectedId}/memory`, { method: "POST" });
      setContext(prev => prev ? { ...prev, memory: data.memory } : prev);
      setLeads(prev => prev.map(l => l.id === selectedId ? { ...l, brain: data.memory, hasBrain: true } : l));
      toast({ title: "Memory updated", description: "AI has analysed all interactions." });
    } catch {
      toast({ title: "Memory sync failed", variant: "destructive" });
    }
    setMemLoading(false);
  }

  async function saveNotes() {
    if (!selectedId) return;
    setSavingNotes(true);
    try {
      const data = await apiFetch<{ memory: BrainMemory }>(`/brain/leads/${selectedId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualNotes: notes }),
      });
      setContext(prev => prev ? { ...prev, memory: data.memory } : prev);
      toast({ title: "Notes saved" });
    } catch {
      toast({ title: "Failed to save notes", variant: "destructive" });
    }
    setSavingNotes(false);
  }

  async function sendChat() {
    if (!chatInput.trim() || !selectedId || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput.trim() };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    try {
      const data = await apiFetch<{ reply: string }>(`/brain/leads/${selectedId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content, history: chatHistory }),
      });
      setChatHistory(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setChatHistory(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't respond right now. Try again." }]);
    }
    setChatLoading(false);
  }

  const statusColor = (s: string) => {
    const map: Record<string, string> = { new: "#6B7280", contacted: "#2563EB", qualified: "#7C3AED", proposal: "#EA580C", won: "#16A34A", lost: "#DC2626", nurture: "#D97706" };
    return map[s] ?? "#6B7280";
  };

  return (
    <div className="flex flex-1 overflow-hidden" style={{ height: "100%" }}>
      {/* ── Left: Lead list ───────────────────────────────────────── */}
      <div className={cn("flex-col border-r border-gray-200 bg-white flex-shrink-0 md:flex md:w-72", selectedId ? "hidden md:flex" : "flex w-full")}>
        <div className="px-3 py-2.5 border-b border-gray-100 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search leads…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-gray-200 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
            />
          </div>
          <div className="mt-1.5 text-[10px] text-gray-400">{filtered.length} leads · {filtered.filter(l => l.hasBrain).length} with memory</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-2.5 px-3 py-3 border-b border-gray-100 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-gray-200 flex-shrink-0" />
                <div className="flex-1 space-y-1.5 py-1">
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                  <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <Brain className="w-8 h-8 text-gray-300 mb-3" />
              <p className="text-xs text-gray-400">No leads yet</p>
            </div>
          ) : (
            filtered.map(lead => {
              const isSelected = selectedId === lead.id;
              const ini = `${lead.firstName?.[0] ?? ""}${lead.lastName?.[0] ?? ""}`.toUpperCase();
              return (
                <button
                  key={lead.id}
                  onClick={() => { setSelectedId(lead.id); setSubTab("overview"); }}
                  className={cn("w-full text-left px-3 py-3 border-b border-gray-100 flex gap-2.5 transition-colors", isSelected ? "bg-indigo-50" : "hover:bg-gray-50")}
                >
                  <div className="relative flex-shrink-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: "#4F35A8" }}>
                      {ini}
                    </div>
                    {lead.hasBrain && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: "#22c55e" }}>
                        <Zap className="w-2 h-2 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-900 truncate">{lead.firstName} {lead.lastName}</span>
                      {lead.bantScore !== null && (
                        <span className="text-[10px] font-bold ml-1 flex-shrink-0" style={{ color: bandHexFromKey(scoreToBandKey(lead.bantScore)) ?? "#6B7280" }}>{lead.bantScore}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">{lead.company}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${statusColor(lead.status)}18`, color: statusColor(lead.status) }}>
                        {lead.status}
                      </span>
                      {lead.hasBrain && <span className="text-[9px] text-green-600 font-medium">● Memory active</span>}
                    </div>
                  </div>
                  {isSelected && <ChevronRight className="w-3.5 h-3.5 text-indigo-400 self-center flex-shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: Lead detail ────────────────────────────────────── */}
      <div className={cn("flex-1 flex flex-col overflow-hidden", !sel && "hidden md:flex")}>
        {/* Mobile back */}
        {sel && (
          <button className="md:hidden flex items-center gap-1 px-3 py-2 text-xs text-gray-500 border-b border-gray-200 bg-white flex-shrink-0" onClick={() => setSelectedId(null)}>
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}

        {!sel ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5" style={{ background: "linear-gradient(135deg,#4F35A818,#C9A84C18)" }}>
              <Brain className="w-10 h-10" style={{ color: "#4F35A8" }} />
            </div>
            <p className="text-base font-bold text-gray-800 mb-2">Select a lead to activate Sales Brain</p>
            <p className="text-xs text-gray-400 max-w-xs leading-relaxed">Sales Brain remembers every email, WhatsApp message, meeting, and transcript for each lead. Ask it anything to close your next deal.</p>
          </div>
        ) : (
          <>
            {/* Lead header */}
            <div className="px-5 py-3 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0" style={{ background: "#4F35A8" }}>
                  {`${sel.firstName?.[0] ?? ""}${sel.lastName?.[0] ?? ""}`.toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{sel.firstName} {sel.lastName}</span>
                    {sel.bantScore !== null && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: bandHexFromKey(scoreToBandKey(sel.bantScore)) ?? "#6B7280" }}>
                        BANT {sel.bantScore}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500">{sel.designation} · {sel.company} · {sel.industry}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={refreshMemory}
                  disabled={memLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg,#4F35A8,#6D28D9)" }}
                >
                  {memLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {memLoading ? "Syncing…" : "Sync Memory"}
                </button>
                <Link href={`/leads/${sel.id}`}>
                  <button className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded border border-gray-200 text-gray-600 hover:bg-gray-50">
                    <ExternalLink className="w-3 h-3" /> Lead Profile
                  </button>
                </Link>
              </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-0 border-b border-gray-200 bg-white flex-shrink-0 px-4">
              {([
                { id: "overview", label: "Overview", icon: User },
                { id: "timeline", label: "Timeline", icon: Clock },
                { id: "chat",     label: "AI Chat",  icon: MessageCircle },
              ] as Array<{ id: BrainSubTab; label: string; icon: React.ElementType }>).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setSubTab(id)}
                  className={cn("flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors", subTab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800")}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>

            {/* Sub-tab content */}
            <div className="flex-1 overflow-y-auto bg-gray-50">
              {ctxLoading ? (
                <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>
              ) : context ? (
                <>
                  {/* ── OVERVIEW ── */}
                  {subTab === "overview" && (
                    <div className="p-5 space-y-4 max-w-2xl">
                      {/* Profile card */}
                      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
                        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Contact</div>
                        <div className="grid grid-cols-2 gap-2">
                          {sel.email && <div className="flex items-center gap-2 text-xs text-gray-700"><Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /><span className="truncate">{sel.email}</span></div>}
                          {sel.phone && <div className="flex items-center gap-2 text-xs text-gray-700"><Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /><span>{sel.phone}</span></div>}
                          {sel.whatsapp && <div className="flex items-center gap-2 text-xs text-gray-700"><MessageCircle className="w-3.5 h-3.5 text-[#25D366] flex-shrink-0" /><span>{sel.whatsapp}</span></div>}
                          {sel.website && <div className="flex items-center gap-2 text-xs text-gray-700"><Globe className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /><a href={sel.website} target="_blank" rel="noopener" className="truncate text-indigo-600 hover:underline">{sel.website}</a></div>}
                          {sel.linkedInUrl && <div className="flex items-center gap-2 text-xs text-gray-700"><ExternalLink className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" /><a href={sel.linkedInUrl} target="_blank" rel="noopener" className="truncate text-blue-600 hover:underline">LinkedIn</a></div>}
                          <div className="flex items-center gap-2 text-xs text-gray-700"><Building2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /><span>{sel.city ? `${sel.city}, ` : ""}{sel.country}</span></div>
                        </div>
                        {(sel.tags ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {(sel.tags ?? []).map(t => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">{t}</span>)}
                          </div>
                        )}
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: "Emails Sent", value: (context.context.touchpoints.filter(t => t.status === "sent").length + context.context.sentEmails.length) },
                          { label: "WA Messages", value: context.context.waMessages.length },
                          { label: "Meetings", value: context.context.meetings.length + context.context.appointments.length },
                          { label: "Transcripts", value: context.context.transcripts.length },
                        ].map(s => (
                          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                            <div className="text-lg font-bold text-gray-900">{s.value}</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {context.memory ? (
                        <>
                          {/* AI Summary */}
                          {context.memory.aiSummary && (
                            <div className="bg-white rounded-2xl border border-indigo-100 p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <Brain className="w-4 h-4 text-indigo-600" />
                                <span className="text-xs font-bold text-indigo-700">AI Memory Summary</span>
                                {context.memory.lastSyncAt && <span className="text-[10px] text-gray-400 ml-auto">Synced {timeAgo(context.memory.lastSyncAt)}</span>}
                              </div>
                              <p className="text-xs text-gray-700 leading-relaxed">{context.memory.aiSummary}</p>
                            </div>
                          )}

                          {/* Deal insights */}
                          {context.memory.dealInsights && (
                            <div className="bg-white rounded-2xl border border-amber-100 p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <Target className="w-4 h-4 text-amber-600" />
                                <span className="text-xs font-bold text-amber-700">Deal Intelligence</span>
                              </div>
                              <p className="text-xs text-gray-700 leading-relaxed">{context.memory.dealInsights}</p>
                            </div>
                          )}

                          {/* Next best action */}
                          {context.memory.nextBestAction && (
                            <div className="bg-white rounded-2xl border border-green-100 p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <Zap className="w-4 h-4 text-green-600" />
                                <span className="text-xs font-bold text-green-700">Next Best Action</span>
                              </div>
                              <p className="text-sm font-semibold text-gray-800">{context.memory.nextBestAction}</p>
                            </div>
                          )}

                          {/* Personality */}
                          {context.memory.personalityProfile && (
                            <div className="bg-white rounded-2xl border border-purple-100 p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <User className="w-4 h-4 text-purple-600" />
                                <span className="text-xs font-bold text-purple-700">Communication Profile</span>
                              </div>
                              <p className="text-xs text-gray-700 leading-relaxed">{context.memory.personalityProfile}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="bg-white rounded-2xl border border-dashed border-indigo-200 p-6 text-center">
                          <Brain className="w-8 h-8 text-indigo-300 mx-auto mb-2" />
                          <p className="text-sm font-semibold text-indigo-700 mb-1">No memory yet</p>
                          <p className="text-xs text-gray-400 mb-3">Click "Sync Memory" to have AI read all interactions and build a complete deal profile.</p>
                          <button
                            onClick={refreshMemory}
                            disabled={memLoading}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white"
                            style={{ background: "linear-gradient(135deg,#4F35A8,#6D28D9)" }}
                          >
                            {memLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {memLoading ? "Analysing…" : "Generate Memory Now"}
                          </button>
                        </div>
                      )}

                      {/* Manual notes */}
                      <div className="bg-white rounded-2xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-gray-500" />
                            <span className="text-xs font-bold text-gray-700">Your Notes</span>
                          </div>
                          <button
                            onClick={saveNotes}
                            disabled={savingNotes}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white rounded-lg transition-colors disabled:opacity-60"
                            style={{ background: "#1A3D2B" }}
                          >
                            {savingNotes ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            Save
                          </button>
                        </div>
                        <textarea
                          value={notes}
                          onChange={e => setNotes(e.target.value)}
                          placeholder="Add private notes about this lead — call tone, objections, personal details, deal context. These become part of the AI's memory."
                          rows={4}
                          className="w-full text-xs text-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 border border-gray-200 rounded-lg px-3 py-2 leading-relaxed"
                        />
                      </div>
                    </div>
                  )}

                  {/* ── TIMELINE ── */}
                  {subTab === "timeline" && (() => {
                    type TItem = { date: Date; type: string; icon: React.ElementType; color: string; title: string; body: string };
                    const items: TItem[] = [];

                    context.context.waMessages.forEach(m => {
                      items.push({
                        date: new Date(m.sentAt ?? Date.now()),
                        type: "whatsapp",
                        icon: MessageCircle,
                        color: "#25D366",
                        title: m.direction === "outbound" ? "You → WhatsApp" : `${sel.firstName} → WhatsApp`,
                        body: m.content.substring(0, 200),
                      });
                    });

                    [...context.context.touchpoints.filter(t => t.status === "sent"), ...context.context.sentEmails].forEach(e => {
                      items.push({
                        date: new Date((e as any).sentAt ?? e.createdAt),
                        type: "email",
                        icon: Mail,
                        color: "#2563EB",
                        title: `Email: ${(e as any).subject ?? "(no subject)"}`,
                        body: (e as any).body?.substring(0, 200) ?? "",
                      });
                    });

                    context.context.meetings.forEach(m => {
                      items.push({
                        date: new Date(m.scheduledAt),
                        type: "meeting",
                        icon: MessageSquare,
                        color: "#7C3AED",
                        title: `Meeting: ${m.type?.replace(/_/g, " ") ?? "Meeting"} (${m.status})`,
                        body: m.meetingUrl ?? "",
                      });
                    });

                    context.context.appointments.forEach(a => {
                      items.push({
                        date: new Date(`${a.scheduledDate}T${a.scheduledTime}`),
                        type: "appointment",
                        icon: MessageSquare,
                        color: "#EA580C",
                        title: `Discovery Call — ${a.status ?? "scheduled"}`,
                        body: a.meetingLink ?? "",
                      });
                    });

                    context.context.transcripts.forEach(t => {
                      items.push({
                        date: new Date(t.fetchedAt ?? Date.now()),
                        type: "transcript",
                        icon: FileText,
                        color: "#16A34A",
                        title: "Meeting Transcript",
                        body: t.summary ?? t.rawTranscript?.substring(0, 200) ?? "(empty)",
                      });
                    });

                    items.sort((a, b) => b.date.getTime() - a.date.getTime());

                    return (
                      <div className="p-5">
                        {items.length === 0 ? (
                          <div className="text-center py-16 text-gray-400">
                            <Clock className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                            <p className="text-sm">No interactions yet</p>
                          </div>
                        ) : (
                          <div className="space-y-0 relative">
                            <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-gray-200" />
                            {items.map((item, i) => {
                              const Icon = item.icon;
                              return (
                                <div key={i} className="relative flex gap-4 pb-4">
                                  <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border-2 border-white shadow-sm z-10" style={{ background: `${item.color}15` }}>
                                    <Icon className="w-4 h-4" style={{ color: item.color }} />
                                  </div>
                                  <div className="flex-1 bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs font-semibold text-gray-800">{item.title}</span>
                                      <span className="text-[10px] text-gray-400">{timeAgo(item.date)}</span>
                                    </div>
                                    {item.body && <p className="text-[11px] text-gray-500 leading-relaxed">{item.body}</p>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── AI CHAT ── */}
                  {subTab === "chat" && (
                    <div className="flex flex-col h-full" style={{ height: "100%" }}>
                      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                        {chatHistory.length === 0 && (
                          <div className="text-center py-8">
                            <Brain className="w-10 h-10 mx-auto mb-3" style={{ color: "#4F35A8" }} />
                            <p className="text-sm font-semibold text-gray-700 mb-1">Sales Brain is ready</p>
                            <p className="text-xs text-gray-400 mb-4 max-w-xs mx-auto">I know everything about {sel.firstName}. Ask me anything — what they said, how to close, what to write next.</p>
                            <div className="flex flex-wrap justify-center gap-2">
                              {[
                                `What's blocking this deal?`,
                                `Draft a follow-up WhatsApp for ${sel.firstName}`,
                                `What did ${sel.firstName} say about their budget?`,
                                `Best closing email for ${sel.firstName}`,
                              ].map(s => (
                                <button key={s} onClick={() => { setChatInput(s); }} className="text-[11px] px-3 py-1.5 rounded-full border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors">
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {chatHistory.map((msg, i) => (
                          <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                            {msg.role === "assistant" && (
                              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mr-2 self-end" style={{ background: "#4F35A818" }}>
                                <Brain className="w-3.5 h-3.5" style={{ color: "#4F35A8" }} />
                              </div>
                            )}
                            <div
                              className="max-w-[78%] rounded-2xl px-4 py-2.5 shadow-sm"
                              style={{
                                background: msg.role === "user" ? "#4F35A8" : "#ffffff",
                                color: msg.role === "user" ? "#ffffff" : "#111827",
                                borderBottomRightRadius: msg.role === "user" ? 4 : 16,
                                borderBottomLeftRadius: msg.role === "user" ? 16 : 4,
                                border: msg.role === "assistant" ? "1px solid #E5E7EB" : "none",
                              }}
                            >
                              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                            </div>
                          </div>
                        ))}

                        {chatLoading && (
                          <div className="flex justify-start">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center mr-2" style={{ background: "#4F35A818" }}>
                              <Brain className="w-3.5 h-3.5" style={{ color: "#4F35A8" }} />
                            </div>
                            <div className="bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm">
                              <div className="flex gap-1.5">
                                {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full animate-bounce bg-indigo-400" style={{ animationDelay: `${i * 0.15}s` }} />)}
                              </div>
                            </div>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>

                      <div className="px-5 py-4 border-t border-gray-200 bg-white flex-shrink-0">
                        <div className="flex gap-2 items-end">
                          <textarea
                            value={chatInput}
                            onChange={e => setChatInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                            placeholder={`Ask Sales Brain about ${sel.firstName}…`}
                            rows={2}
                            className="flex-1 text-sm resize-none border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                          />
                          <button
                            onClick={sendChat}
                            disabled={chatLoading || !chatInput.trim()}
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-white transition-all disabled:opacity-40 flex-shrink-0"
                            style={{ background: "#4F35A8" }}
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1.5">Shift+Enter for new line · Enter to send</p>
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── CONVERSATIONS TAB ────────────────────────────────────────────────────────
function ConversationsTab() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filterState, setFilterState] = useState<WaState | "all">("all");
  const [search, setSearch] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [], isLoading: loading, refetch: refetchConvs } = useGetWhatsAppConversations();
  const { data: msgData, isLoading: msgLoading } = useGetWhatsAppMessages(selectedId!, { query: { enabled: !!selectedId, queryKey: ["getWhatsAppMessages", selectedId] } });

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [msgData]);

  const filtered = (conversations as WhatsAppConversation[]).filter(c => {
    if (filterState !== "all" && c.state !== filterState) return false;
    const name = leadName(c.lead).toLowerCase();
    const company = (c.lead?.company ?? "").toLowerCase();
    if (search && !name.includes(search.toLowerCase()) && !company.includes(search.toLowerCase())) return false;
    return true;
  });

  const selectedConv = selectedId ? (conversations as WhatsAppConversation[]).find(c => c.id === selectedId) ?? null : null;

  const stateFilters: Array<{ val: WaState | "all"; label: string }> = [
    { val: "all", label: "All" }, { val: "hook_sent", label: "Hook Sent" }, { val: "awaiting_yes", label: "Awaiting YES" },
    { val: "report_sent", label: "Report Sent" }, { val: "qualifying", label: "Qualifying" },
    { val: "appointment_pitched", label: "Pitched" }, { val: "appointment_booked", label: "Booked" }, { val: "opted_out", label: "Opted Out" },
  ];

  return (
    <div className="flex flex-1 overflow-hidden" style={{ height: "100%" }}>
      <div className={cn("flex-col border-r border-gray-200 bg-white flex-shrink-0 md:flex md:w-80", selectedId ? "hidden md:flex" : "flex w-full")}>
        <div className="px-3 py-2.5 border-b border-gray-100 space-y-2 flex-shrink-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…" className="w-full px-3 py-1.5 text-xs rounded border border-gray-200 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-green-500/40" />
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {stateFilters.map(f => (
              <button key={f.val} onClick={() => setFilterState(f.val)} className={cn("flex-shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors whitespace-nowrap", filterState === f.val ? "border-green-600 text-green-700 bg-green-50" : "border-gray-200 text-gray-500 bg-gray-50 hover:border-gray-300")}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-2.5 px-3 py-3 border-b border-gray-100 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-gray-200 flex-shrink-0" />
                <div className="flex-1 space-y-1.5"><div className="h-3 bg-gray-200 rounded w-3/4" /><div className="h-2.5 bg-gray-100 rounded w-1/2" /></div>
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <MessageCircle className="w-8 h-8 text-gray-300 mb-3" />
              <p className="text-xs text-gray-400">No conversations yet</p>
            </div>
          ) : (
            filtered.map(conv => {
              const isSelected = selectedId === conv.id;
              const cfg = STATE_CONFIG[conv.state] ?? { label: conv.state, bg: "#F3F4F6", color: "#6B7280" };
              return (
                <button key={conv.id} onClick={() => setSelectedId(conv.id)} className={cn("w-full text-left px-3 py-3 border-b border-gray-100 flex gap-2.5 transition-colors", isSelected ? "bg-green-50" : "hover:bg-gray-50")}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: "#1A3D2B" }}>
                    {initials(conv.lead)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold text-gray-900 truncate">{leadName(conv.lead)}</span>
                      <span className="text-[10px] text-gray-400 ml-1 flex-shrink-0">{timeAgo(conv.updatedAt)}</span>
                    </div>
                    {conv.lead?.company && <div className="text-[11px] text-gray-500 truncate mb-0.5">{conv.lead.company}</div>}
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                      {conv.lastMessage && <span className="text-[10px] text-gray-400 truncate">{conv.lastMessage}</span>}
                    </div>
                  </div>
                  {isSelected && <ChevronRight className="w-3.5 h-3.5 text-gray-300 self-center flex-shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className={cn("flex-1 flex flex-col overflow-hidden", !selectedConv && "hidden md:flex")}>
        {selectedConv && (
          <button className="md:hidden flex items-center gap-1 px-3 py-2 text-xs text-gray-500 border-b border-gray-200 bg-white flex-shrink-0" onClick={() => setSelectedId(null)}>
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}
        {!selectedConv ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "#1A3D2B15" }}>
              <MessageCircle className="w-8 h-8" style={{ color: "#1A3D2B" }} />
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Select a conversation</p>
            <p className="text-xs text-gray-400 max-w-xs">View the full WhatsApp thread — the AI bot handles all replies automatically</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: "#1A3D2B" }}>{initials(selectedConv.lead)}</div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{leadName(selectedConv.lead)}</div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    {selectedConv.lead?.company && <span>{selectedConv.lead.company}</span>}
                    <span>{selectedConv.waPhoneNumber}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StateBadge state={selectedConv.state} />
                {selectedConv.leadId && (
                  <Link href={`/leads/${selectedConv.leadId}`}>
                    <button className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-gray-200 text-gray-600 hover:bg-gray-50"><ExternalLink className="w-3 h-3" /> View Lead</button>
                  </Link>
                )}
                <button onClick={() => refetchConvs()} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><RefreshCw className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            {(() => {
              const bant = bantFromMeta(selectedConv.metadata as Record<string, unknown>);
              if (!bant) return null;
              return (
                <div className="px-4 py-2 flex gap-4 border-b border-gray-100 bg-purple-50 flex-shrink-0 flex-wrap">
                  {[{ label: "B", key: "budget", title: "Budget" }, { label: "A", key: "authority", title: "Authority" }, { label: "N", key: "need", title: "Need" }, { label: "T", key: "timeline", title: "Timeline" }].map(({ label, key, title }) => bant[key as keyof typeof bant] ? (
                    <div key={key} className="flex items-center gap-1">
                      <span className="text-[9px] font-bold w-4 h-4 rounded flex items-center justify-center" style={{ background: "#7C3AED", color: "#fff" }}>{label}</span>
                      <span className="text-[11px] text-purple-800" title={title}>{bant[key as keyof typeof bant]}</span>
                    </div>
                  ) : null)}
                </div>
              );
            })()}

            <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2" style={{ background: "#F0F4F0" }}>
              {msgLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : !msgData || msgData.messages.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-12">No messages yet</div>
              ) : (
                msgData.messages.map(msg => {
                  const isOut = msg.direction === "outbound";
                  return (
                    <div key={msg.id} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
                      <div className="max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-sm" style={{ background: isOut ? "#1A3D2B" : "#ffffff", color: isOut ? "#ffffff" : "#111827", borderBottomRightRadius: isOut ? 4 : 16, borderBottomLeftRadius: isOut ? 16 : 4 }}>
                        <p className="text-[13px] leading-snug whitespace-pre-wrap">{msg.content}</p>
                        <div className={cn("mt-1 text-[10px]", isOut ? "text-right" : "text-left")} style={{ color: isOut ? "rgba(255,255,255,0.55)" : "#9CA3AF" }}>{timeAgo(msg.sentAt)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50 flex-shrink-0">
              <p className="text-[11px] text-gray-400 text-center">AI bot handles all replies automatically · Read-only view</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ANALYTICS TAB ────────────────────────────────────────────────────────────
function AnalyticsTab() {
  const { data: analytics, isLoading: loading } = useGetWhatsAppAnalytics();
  const yesCount = analytics ? Math.round(analytics.totalInitiated * (analytics.yesRate / 100)) : 0;
  const funnelSteps = analytics ? [
    { label: "Initiated", count: analytics.totalInitiated, color: "#6B7280" },
    { label: "YES (replied)", count: yesCount, color: "#D97706" },
    { label: "Report Sent", count: analytics.reportsSent, color: "#2563EB" },
    { label: "Appt. Booked", count: analytics.appointmentsBooked, color: "#16A34A" },
    { label: "Opted Out", count: analytics.optedOut, color: "#DC2626" },
  ] : [];
  const maxCount = analytics ? Math.max(...funnelSteps.map(s => s.count), 1) : 1;

  return (
    <div className="p-4 md:p-6 space-y-5 overflow-y-auto flex-1">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">WhatsApp Conversation Funnel</div>
        {loading ? <div className="space-y-2.5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="flex items-center gap-3"><div className="w-24 h-2.5 bg-gray-100 rounded animate-pulse" /><div className="flex-1 h-5 bg-gray-100 rounded animate-pulse" /></div>)}</div> : (
          <div className="space-y-2.5">
            {funnelSteps.map(step => (
              <div key={step.label} className="flex items-center gap-3">
                <span className="text-[11px] text-gray-600 w-28 flex-shrink-0 text-right">{step.label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <div className="h-full rounded-full flex items-center justify-end pr-2 transition-all" style={{ width: `${(step.count / maxCount) * 100}%`, minWidth: step.count > 0 ? 24 : 0, background: step.color }}>
                    <span className="text-[10px] font-bold text-white">{step.count > 0 ? step.count : ""}</span>
                  </div>
                </div>
                <span className="text-xs font-semibold text-gray-700 w-6 text-right">{step.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {analytics && analytics.optedOut > 0 && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-sm text-red-700 font-medium"><AlertTriangle className="w-4 h-4" />{analytics.optedOut} lead{analytics.optedOut !== 1 ? "s" : ""} opted out</div>
          <p className="text-xs text-red-500 mt-1">These leads replied STOP, NO, or similar opt-out phrases and have been removed from the sequence.</p>
        </div>
      )}
    </div>
  );
}

// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
function SettingsTab() {
  const { toast } = useToast();
  const { data: savedSettings, isLoading: loading } = useGetWhatsAppSettings();
  const updateSettings = useUpdateWhatsAppSettings();
  const testConn = useTestWhatsAppConnection();

  const [form, setForm] = useState<Partial<WhatsAppSettings>>({ phoneNumberId: "", webhookVerifyToken: "", bookingUrl: "", consultantName: "", portfolioUrl: "", caseStudyUrl: "", companyProfileUrl: "", referenceSites: [], hookTemplateName: "mysa_hook", hookTemplateLang: "en_US" });
  const [newAccessToken, setNewAccessToken] = useState("");
  const [newAppSecret, setNewAppSecret] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => { setWebhookUrl(`${window.location.origin}/api/whatsapp/webhook`); }, []);
  useEffect(() => {
    if (savedSettings) {
      setForm({
        phoneNumberId: savedSettings.phoneNumberId ?? "", webhookVerifyToken: savedSettings.webhookVerifyToken ?? "",
        bookingUrl: savedSettings.bookingUrl ?? "", consultantName: savedSettings.consultantName ?? "",
        portfolioUrl: savedSettings.portfolioUrl ?? "", caseStudyUrl: savedSettings.caseStudyUrl ?? "",
        companyProfileUrl: savedSettings.companyProfileUrl ?? "",
        referenceSites: Array.isArray(savedSettings.referenceSites) ? savedSettings.referenceSites : [],
        hookTemplateName: savedSettings.hookTemplateName ?? "mysa_hook", hookTemplateLang: savedSettings.hookTemplateLang ?? "en_US",
      });
    }
  }, [savedSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: WhatsAppSettingsInput = {
      phoneNumberId: form.phoneNumberId ?? "", webhookVerifyToken: form.webhookVerifyToken ?? "",
      bookingUrl: form.bookingUrl || null, consultantName: form.consultantName || null,
      portfolioUrl: form.portfolioUrl || null, caseStudyUrl: form.caseStudyUrl || null,
      companyProfileUrl: form.companyProfileUrl || null,
      referenceSites: (form.referenceSites ?? []).filter(Boolean),
      hookTemplateName: form.hookTemplateName || null, hookTemplateLang: form.hookTemplateLang || "en_US",
      ...(newAccessToken ? { accessToken: newAccessToken } : {}),
      ...(newAppSecret ? { appSecret: newAppSecret } : {}),
    };
    updateSettings.mutate({ data: payload }, {
      onSuccess: () => { setNewAccessToken(""); setNewAppSecret(""); toast({ title: "Settings saved", description: "WhatsApp configuration updated." }); },
      onError: () => { toast({ title: "Save failed", description: "Check the form and try again.", variant: "destructive" }); },
    });
  };

  const handleTest = () => {
    setTestResult(null);
    testConn.mutate(undefined, {
      onSuccess: (d) => setTestResult({ ok: d.ok, detail: d.detail ?? (d.ok ? "Connected" : "Failed") }),
      onError: () => setTestResult({ ok: false, detail: "Network error" }),
    });
  };

  const setRef = (idx: number, val: string) => setForm(prev => { const refs = [...(prev.referenceSites ?? [])]; refs[idx] = val; return { ...prev, referenceSites: refs }; });
  const addRef = () => { if ((form.referenceSites ?? []).length >= 5) return; setForm(prev => ({ ...prev, referenceSites: [...(prev.referenceSites ?? []), ""] })); };
  const removeRef = (idx: number) => setForm(prev => ({ ...prev, referenceSites: (prev.referenceSites ?? []).filter((_, i) => i !== idx) }));

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div><label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>{children}</div>
  );
  const Input = ({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) => (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 bg-white" />
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <form onSubmit={handleSave} className="max-w-xl space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">WhatsApp API Credentials</div>
            <Field label="Phone Number ID"><Input value={form.phoneNumberId ?? ""} onChange={v => setForm(p => ({ ...p, phoneNumberId: v }))} placeholder="Enter Phone Number ID" /></Field>
            <Field label="Webhook Verify Token"><Input value={form.webhookVerifyToken ?? ""} onChange={v => setForm(p => ({ ...p, webhookVerifyToken: v }))} placeholder="Enter Webhook Verify Token" /></Field>
            <Field label="Access Token (leave blank to keep existing)"><Input value={newAccessToken} onChange={setNewAccessToken} type="password" placeholder="••••••••" /></Field>
            <Field label="App Secret (leave blank to keep existing)"><Input value={newAppSecret} onChange={setNewAppSecret} type="password" placeholder="••••••••" /></Field>
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Webhook URL</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-gray-600 font-mono break-all">{webhookUrl}</code>
                <button type="button" onClick={() => navigator.clipboard.writeText(webhookUrl)} className="p-1.5 rounded border border-gray-200 hover:bg-gray-50 text-gray-500"><Check className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Bot Personalisation</div>
            <Field label="Consultant Name"><Input value={form.consultantName ?? ""} onChange={v => setForm(p => ({ ...p, consultantName: v }))} placeholder="e.g. Krish Puranik" /></Field>
            <Field label="Booking URL"><Input value={form.bookingUrl ?? ""} onChange={v => setForm(p => ({ ...p, bookingUrl: v }))} placeholder="https://..." /></Field>
            <Field label="Portfolio URL"><Input value={form.portfolioUrl ?? ""} onChange={v => setForm(p => ({ ...p, portfolioUrl: v }))} placeholder="https://..." /></Field>
            <Field label="Case Study URL"><Input value={form.caseStudyUrl ?? ""} onChange={v => setForm(p => ({ ...p, caseStudyUrl: v }))} placeholder="https://..." /></Field>
            <Field label="Company Profile URL"><Input value={form.companyProfileUrl ?? ""} onChange={v => setForm(p => ({ ...p, companyProfileUrl: v }))} placeholder="https://..." /></Field>
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Reference Sites (up to 5)</div>
              <div className="space-y-1.5">
                {(form.referenceSites ?? []).map((ref, idx) => (
                  <div key={idx} className="flex gap-1.5">
                    <Input value={ref} onChange={v => setRef(idx, v)} placeholder={`https://example-${idx + 1}.com`} />
                    <button type="button" onClick={() => removeRef(idx)} className="p-2 rounded-lg border border-gray-200 hover:bg-red-50 text-gray-400 hover:text-red-500 flex-shrink-0"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                {(form.referenceSites ?? []).length < 5 && (
                  <button type="button" onClick={addRef} className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-700 font-medium mt-1"><Plus className="w-3 h-3" /> Add reference site</button>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={updateSettings.isPending} className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white rounded-xl disabled:opacity-60" style={{ background: "#4F35A8" }}>
              {updateSettings.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {updateSettings.isPending ? "Saving…" : "Save Settings"}
            </button>
            <button type="button" onClick={handleTest} disabled={testConn.isPending} className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60">
              {testConn.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
              {testConn.isPending ? "Testing…" : "Test Connection"}
            </button>
          </div>

          {testResult && (
            <div className={cn("flex items-center gap-2 p-3 rounded-xl text-xs font-medium", testResult.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200")}>
              {testResult.ok ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              {testResult.detail}
            </div>
          )}
        </form>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function SalesBrain() {
  const [tab, setTab] = useState<MainTab>("brain");

  const tabs: Array<{ id: MainTab; label: string; icon: React.ElementType; accent?: string }> = [
    { id: "brain",         label: "Lead Brain",    icon: Brain,          accent: "#4F35A8" },
    { id: "conversations", label: "WhatsApp",       icon: MessageCircle,  accent: "#25D366" },
    { id: "analytics",     label: "Analytics",      icon: BarChart2 },
    { id: "settings",      label: "Settings",       icon: Settings },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#fff" }}>
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 bg-white flex-shrink-0 px-4">
        {tabs.map(({ id, label, icon: Icon, accent }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn("flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors", tab === id ? "border-current" : "border-transparent text-gray-400 hover:text-gray-700")}
            style={tab === id ? { color: accent ?? "#111827", borderColor: accent ?? "#111827" } : {}}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {id === "brain" && tab !== "brain" && (
              <span className="w-2 h-2 rounded-full ml-0.5" style={{ background: "#4F35A8" }} />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex flex-1 overflow-hidden">
        {tab === "brain"         && <LeadBrainTab />}
        {tab === "conversations" && <ConversationsTab />}
        {tab === "analytics"     && <AnalyticsTab />}
        {tab === "settings"      && <SettingsTab />}
      </div>
    </div>
  );
}

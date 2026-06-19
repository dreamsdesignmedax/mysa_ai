import { useState, useRef, useEffect, useCallback } from "react";
import {
  useListAuditedLeads,
  useListLeads,
  useComposeOutreachEmail,
  useQuickSendEmail,
  getListOutreachEmailsQueryKey,
} from "@workspace/api-client-react";
import type { AuditedLead, Lead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  X, Minus, Maximize2, Minimize2, Bold, Italic, Underline,
  List, Link, Paperclip, Send, Save, Sparkles, CheckCircle2,
  AlertCircle, Loader2, AlignLeft, AlignCenter, AlignRight,
  Phone, Calendar, Monitor, FileText, ChevronDown, ChevronUp, Check,
} from "lucide-react";
import { cn, auditScoreColors } from "@/lib/utils";

interface ComposeModalProps {
  onClose: () => void;
  initialEmail?: {
    subject: string;
    body: string;
    leadId?: number;
  } | null;
}

interface ContactOption {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  country: string | null | undefined;
  designation: string;
  industry: string;
  photo?: string | null;
  companyLogo?: string | null;
  healthScore?: number;
  criticalCount?: number;
  highCount?: number;
  mediumCount?: number;
  aiReport?: string | null;
  isAudited: boolean;
}

interface AttachedFile {
  name: string;
  content: string;
  size: string;
}

type CtaType = "consultation" | "call" | "demo" | "report";
type Tone = "professional" | "friendly" | "direct" | "consultative";

const CTA_OPTIONS: { key: CtaType; label: string; icon: React.ReactNode }[] = [
  { key: "consultation", label: "Book Consultation", icon: <Calendar className="w-3.5 h-3.5" /> },
  { key: "call",         label: "20-min Call",       icon: <Phone className="w-3.5 h-3.5" /> },
  { key: "demo",         label: "Live Demo",          icon: <Monitor className="w-3.5 h-3.5" /> },
  { key: "report",       label: "Send Report",        icon: <FileText className="w-3.5 h-3.5" /> },
];

const TONE_OPTIONS: { key: Tone; label: string; emoji: string }[] = [
  { key: "professional", label: "Professional", emoji: "🎯" },
  { key: "friendly",     label: "Friendly",     emoji: "😊" },
  { key: "direct",       label: "Direct",       emoji: "⚡" },
  { key: "consultative", label: "Consultative", emoji: "🧠" },
];

const AI_STAGES = [
  "Reading brand audit…",
  "Identifying pain signals…",
  "Calculating revenue impact…",
  "Writing personalised email…",
  "Formatting for delivery…",
];

function initials(first: string, last: string) {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
}


function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ComposeModal({ onClose, initialEmail }: ComposeModalProps) {
  const qc = useQueryClient();
  const { data: auditedLeads = [] } = useListAuditedLeads();
  const { data: allLeadsRaw } = useListLeads({ limit: 1000 });
  const composeMutation = useComposeOutreachEmail();
  const quickSendMutation = useQuickSendEmail({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListOutreachEmailsQueryKey() }) },
  });

  const allLeadsList: Lead[] = (allLeadsRaw as { leads?: Lead[] } | undefined)?.leads ?? [];
  const auditedIds = new Set((auditedLeads as AuditedLead[]).map((l) => l.id));
  const contacts: ContactOption[] = [
    ...(auditedLeads as AuditedLead[]).map((l) => ({
      id: l.id, firstName: l.firstName, lastName: l.lastName,
      email: l.email, company: l.company, country: l.country,
      designation: l.designation, industry: l.industry,
      photo: l.photo, companyLogo: l.companyLogo,
      healthScore: l.healthScore, criticalCount: l.criticalCount,
      highCount: l.highCount, mediumCount: l.mediumCount,
      aiReport: l.aiReport, isAudited: true as const,
    })),
    ...allLeadsList
      .filter((l) => !auditedIds.has(l.id))
      .map((l) => ({
        id: l.id, firstName: l.firstName, lastName: l.lastName,
        email: l.email, company: l.company, country: l.country,
        designation: l.designation, industry: l.industry ?? "",
        photo: l.photoUrl ?? null, companyLogo: l.companyLogo ?? null,
        isAudited: false as const,
      })),
  ];

  const [minimized, setMinimized]   = useState(false);
  const [expanded, setExpanded]     = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(!initialEmail);

  const [selectedLead, setSelectedLead]         = useState<ContactOption | null>(null);
  const [leadSearch, setLeadSearch]             = useState("");
  const [leadDropdownOpen, setLeadDropdownOpen] = useState(false);
  const [showCc, setShowCc]   = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [cc, setCc]   = useState("");
  const [bcc, setBcc] = useState("");

  const [ctaTypes, setCtaTypes] = useState<CtaType[]>(["consultation"]);
  const [tone, setTone]         = useState<Tone>("professional");

  const [aiStage, setAiStage]   = useState(-1);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError]   = useState<string | null>(null);

  const [subject, setSubject]   = useState(initialEmail?.subject ?? "");
  const [bodyEmpty, setBodyEmpty] = useState(!initialEmail?.body);

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendError, setSendError]   = useState<string | null>(null);

  const bodyRef       = useRef<HTMLDivElement>(null);
  const leadSearchRef = useRef<HTMLInputElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const stageTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

  const attachReport = ctaTypes.includes("report");

  const filteredLeads = contacts.filter((l) => {
    const q = leadSearch.toLowerCase();
    return !q || `${l.firstName} ${l.lastName} ${l.company} ${l.email}`.toLowerCase().includes(q);
  });

  useEffect(() => {
    if (leadDropdownOpen && leadSearchRef.current) leadSearchRef.current.focus();
  }, [leadDropdownOpen]);

  useEffect(() => {
    if (initialEmail?.body && bodyRef.current) {
      const _escBody = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      bodyRef.current.innerHTML = _escBody(initialEmail.body).replace(/\n/g, "<br>");
      setBodyEmpty(false);
    }
  }, []);

  useEffect(() => {
    if (initialEmail?.leadId && contacts.length > 0) {
      const match = contacts.find((l) => l.id === initialEmail.leadId);
      if (match) setSelectedLead(match);
    }
  }, [contacts.length]);

  const selectLead = (lead: ContactOption) => {
    setSelectedLead(lead);
    setLeadSearch("");
    setLeadDropdownOpen(false);
    setAiError(null);
  };

  const toggleCta = (key: CtaType) => {
    setCtaTypes((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newAttachments = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        content: await readFileAsBase64(file),
        size: formatFileSize(file.size),
      }))
    );
    setAttachedFiles((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearStageTimer = () => {
    if (stageTimer.current) { clearInterval(stageTimer.current); stageTimer.current = null; }
  };

  const handleGenerate = useCallback(async () => {
    if (!selectedLead) return;
    setAiRunning(true);
    setAiError(null);
    setAiStage(0);

    let stage = 0;
    stageTimer.current = setInterval(() => {
      stage++;
      if (stage < AI_STAGES.length) setAiStage(stage);
      else clearStageTimer();
    }, 900);

    try {
      const result = await composeMutation.mutateAsync({
        data: { leadId: selectedLead.id, ctaTypes, tone },
      });
      clearStageTimer();
      setAiStage(-1);
      setSubject(result.subject);

      if (bodyRef.current) {
        bodyRef.current.innerHTML = result.body.replace(/\n/g, "<br>");
        setBodyEmpty(result.body.trim().length === 0);
      }

      setAiPanelOpen(false);
    } catch (e) {
      clearStageTimer();
      setAiStage(-1);
      setAiError((e as Error).message ?? "AI generation failed");
    } finally {
      setAiRunning(false);
    }
  }, [selectedLead, ctaTypes, tone, composeMutation]);

  const execFormat = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    bodyRef.current?.focus();
  };

  const insertLink = () => {
    const url = window.prompt("Enter URL:");
    if (url) execFormat("createLink", url);
  };

  const getBodyText = () => bodyRef.current?.innerText ?? "";
  const getBodyHtml = () => bodyRef.current?.innerHTML ?? "";

  const buildSendPayload = () => ({
    leadId: selectedLead!.id,
    toEmail: selectedLead!.email,
    toName: `${selectedLead!.firstName} ${selectedLead!.lastName}`,
    company: selectedLead!.company,
    country: selectedLead!.country ?? "",
    currency: "USD",
    subject,
    body: getBodyText(),
    bodyHtml: getBodyHtml(),
    cc: cc.trim(),
    bcc: bcc.trim(),
    attachReport,
    userAttachments: attachedFiles.map((f) => ({ name: f.name, content: f.content })),
  });

  const handleSend = async () => {
    if (!selectedLead || !subject.trim() || !getBodyText().trim()) return;
    setSendStatus("sending");
    setSendError(null);
    try {
      await quickSendMutation.mutateAsync({
        data: { ...buildSendPayload(), saveDraft: false },
      });
      setSendStatus("sent");
      setTimeout(onClose, 2000);
    } catch (e) {
      setSendStatus("error");
      setSendError((e as Error).message ?? "Send failed");
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedLead || !subject.trim()) return;
    await quickSendMutation.mutateAsync({
      data: { ...buildSendPayload(), saveDraft: true },
    });
    onClose();
  };

  const isReady = !!selectedLead && subject.trim().length > 0 && !bodyEmpty;
  const modalW  = expanded ? "min(820px, 96vw)" : "600px";
  const modalH  = expanded ? "min(760px, 92vh)" : "580px";

  const hasAttachments = attachReport || attachedFiles.length > 0;

  return (
    <div
      className="fixed z-50 flex flex-col shadow-2xl rounded-2xl overflow-hidden border border-gray-200"
      style={{ bottom: 24, right: 24, width: modalW, height: minimized ? "auto" : modalH, background: "#fff", transition: "width 0.2s, height 0.2s" }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 select-none" style={{ background: "#1A3D2B" }}>
        <div className="flex items-center gap-3">
          <Sparkles className="w-3.5 h-3.5 text-green-300" />
          <span className="text-sm font-semibold text-white">New Email</span>
          {selectedLead && (
            <span className="text-[11px] text-green-200 opacity-75">→ {selectedLead.firstName} {selectedLead.lastName}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized(v => !v)} className="p-1 rounded text-green-200 hover:text-white hover:bg-white/10 transition-colors" title={minimized ? "Expand" : "Minimise"}>
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(v => !v)} className="p-1 rounded text-green-200 hover:text-white hover:bg-white/10 transition-colors" title={expanded ? "Restore" : "Maximise"}>
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onClose} className="p-1 rounded text-green-200 hover:text-white hover:bg-white/10 transition-colors" title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="flex flex-col flex-1 overflow-hidden" onClick={() => setLeadDropdownOpen(false)}>

          {/* ── To field ── */}
          <div className="relative border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2 px-4 py-2">
              <span className="text-[11px] font-medium text-gray-400 w-6 flex-shrink-0">To</span>
              <div className="flex-1 flex items-center gap-2 min-w-0">
                {selectedLead ? (
                  <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-xs font-medium text-green-900">
                    {selectedLead.photo ? (
                      <img src={selectedLead.photo} className="w-4 h-4 rounded-full object-cover" />
                    ) : (
                      <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: "#1A3D2B" }}>
                        {initials(selectedLead.firstName, selectedLead.lastName)}
                      </div>
                    )}
                    {selectedLead.firstName} {selectedLead.lastName} &lt;{selectedLead.email}&gt;
                    <button onClick={(e) => { e.stopPropagation(); setSelectedLead(null); setLeadDropdownOpen(true); }} className="text-gray-400 hover:text-red-500 ml-1">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <input
                    ref={leadSearchRef}
                    value={leadSearch}
                    onChange={(e) => { setLeadSearch(e.target.value); setLeadDropdownOpen(true); }}
                    onFocus={(e) => { e.stopPropagation(); setLeadDropdownOpen(true); }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Search audited prospects…"
                    className="flex-1 text-xs outline-none text-gray-800 placeholder:text-gray-400"
                  />
                )}
              </div>
              <div className="flex items-center gap-1 ml-auto">
                {!showCc && <button onClick={(e) => { e.stopPropagation(); setShowCc(true); }} className="text-[10px] text-gray-400 hover:text-gray-600">Cc</button>}
                {!showBcc && <button onClick={(e) => { e.stopPropagation(); setShowBcc(true); }} className="text-[10px] text-gray-400 hover:text-gray-600 ml-1">Bcc</button>}
              </div>
            </div>

            {/* Prospect dropdown */}
            {leadDropdownOpen && !selectedLead && (
              <div className="absolute left-0 right-0 top-full z-50 bg-white border border-gray-200 shadow-2xl rounded-b-xl max-h-72 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                {filteredLeads.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-400">
                    {contacts.length === 0
                      ? "No leads found. Add leads first."
                      : "No contacts match your search."}
                  </div>
                ) : (
                  (() => {
                    const audited = filteredLeads.filter((l) => l.isAudited);
                    const unaudited = filteredLeads.filter((l) => !l.isAudited);
                    return (
                      <>
                        {audited.length > 0 && (
                          <>
                            <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                              Audited Prospects ({audited.length})
                            </div>
                            {audited.map((lead) => {
                              const c = auditScoreColors(lead.healthScore!);
                              return (
                                <button key={lead.id} onClick={() => selectLead(lead)}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0 transition-colors">
                                  {lead.photo ? (
                                    <img src={lead.photo} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                                  ) : lead.companyLogo ? (
                                    <img src={lead.companyLogo} className="w-8 h-8 rounded-lg object-contain border border-gray-200 bg-white p-0.5 flex-shrink-0" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ background: "#1A3D2B" }}>
                                      {initials(lead.firstName, lead.lastName)}
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-semibold text-gray-900 truncate">
                                      {lead.firstName} {lead.lastName}
                                      <span className="ml-1.5 text-gray-400 font-normal">{lead.designation}</span>
                                    </div>
                                    <div className="text-[11px] text-gray-500 truncate">{lead.company} · {lead.country}</div>
                                  </div>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ color: c.text, background: c.bg }}>
                                    {lead.healthScore}/100
                                  </span>
                                </button>
                              );
                            })}
                          </>
                        )}
                        {unaudited.length > 0 && (
                          <>
                            <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100 border-t border-t-gray-200">
                              All Leads ({unaudited.length})
                            </div>
                            {unaudited.map((lead) => (
                              <button key={lead.id} onClick={() => selectLead(lead)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0 transition-colors">
                                {lead.photo ? (
                                  <img src={lead.photo} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                                ) : lead.companyLogo ? (
                                  <img src={lead.companyLogo} className="w-8 h-8 rounded-lg object-contain border border-gray-200 bg-white p-0.5 flex-shrink-0" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ background: "#5C1A8C" }}>
                                    {initials(lead.firstName, lead.lastName)}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-gray-900 truncate">
                                    {lead.firstName} {lead.lastName}
                                    <span className="ml-1.5 text-gray-400 font-normal">{lead.designation}</span>
                                  </div>
                                  <div className="text-[11px] text-gray-500 truncate">{lead.company} · {lead.country}</div>
                                </div>
                                <span className="text-[10px] text-gray-400 flex-shrink-0">no audit</span>
                              </button>
                            ))}
                          </>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
            )}
          </div>

          {showCc && (
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-100 flex-shrink-0">
              <span className="text-[11px] font-medium text-gray-400 w-6">Cc</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Add Cc… (comma-separated)" className="flex-1 text-xs outline-none text-gray-800 placeholder:text-gray-400 py-0.5" />
              <button onClick={() => setShowCc(false)} className="text-gray-300 hover:text-gray-500"><X className="w-3 h-3" /></button>
            </div>
          )}
          {showBcc && (
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-100 flex-shrink-0">
              <span className="text-[11px] font-medium text-gray-400 w-6">Bcc</span>
              <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Add Bcc… (comma-separated)" className="flex-1 text-xs outline-none text-gray-800 placeholder:text-gray-400 py-0.5" />
              <button onClick={() => setShowBcc(false)} className="text-gray-300 hover:text-gray-500"><X className="w-3 h-3" /></button>
            </div>
          )}

          {/* ── AI Panel (collapsible) ── */}
          <div className="flex-shrink-0 border-b border-gray-100">
            <button
              onClick={(e) => { e.stopPropagation(); setAiPanelOpen(v => !v); }}
              className="w-full flex items-center gap-2 px-4 py-2 hover:bg-gray-50 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              <span className="text-[11px] font-semibold text-purple-700">AI Compose</span>
              <span className="text-[10px] text-gray-400 ml-1">
                {selectedLead
                  ? `${selectedLead.company} · ${ctaTypes.join(", ")} · ${tone}`
                  : "Select a prospect to generate"}
              </span>
              <div className="ml-auto text-gray-400">
                {aiPanelOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>

            {aiPanelOpen && (
              <div className="px-4 pb-3 bg-purple-50/40 space-y-2.5" onClick={(e) => e.stopPropagation()}>
                {/* CTA row */}
                <div className="flex-1">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    Call to Action
                    <span className="ml-1.5 font-normal normal-case text-gray-400">(tick all that apply)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CTA_OPTIONS.map((opt) => {
                      const selected = ctaTypes.includes(opt.key);
                      const isReportOpt = opt.key === "report";
                      return (
                        <button
                          key={opt.key}
                          onClick={() => toggleCta(opt.key)}
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all",
                            selected
                              ? isReportOpt
                                ? "border-amber-500 bg-amber-50 text-amber-800"
                                : "border-purple-600 bg-purple-100 text-purple-800"
                              : "border-gray-200 text-gray-500 hover:border-gray-300 bg-white"
                          )}
                        >
                          <span className={selected ? (isReportOpt ? "text-amber-600" : "text-purple-600") : "text-gray-400"}>
                            {opt.icon}
                          </span>
                          {opt.label}
                          {isReportOpt && selected && (
                            <span className="text-[9px] font-semibold text-amber-600 bg-amber-100 border border-amber-300 px-1 py-0.5 rounded ml-0.5">PDF</span>
                          )}
                          {selected && (
                            <Check className={cn("w-3 h-3 ml-0.5", isReportOpt ? "text-amber-600" : "text-purple-600")} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {attachReport && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-700">
                      <FileText className="w-3 h-3" />
                      {selectedLead?.isAudited
                        ? "The generated brand audit report PDF will be attached to the email."
                        : "Run a Brand Audit first to attach the report."}
                    </div>
                  )}
                </div>

                {/* Tone + Generate row */}
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Tone</div>
                    <div className="flex gap-1.5">
                      {TONE_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => setTone(opt.key)}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-all",
                            tone === opt.key
                              ? "border-purple-600 bg-purple-100 text-purple-800"
                              : "border-gray-200 text-gray-500 hover:border-gray-300 bg-white"
                          )}
                        >
                          <span>{opt.emoji}</span> {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ml-auto flex flex-col items-end gap-1 flex-shrink-0">
                    <button
                      onClick={handleGenerate}
                      disabled={!selectedLead || !selectedLead.isAudited || aiRunning}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all",
                        !selectedLead || !selectedLead.isAudited || aiRunning ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
                      )}
                      style={{ background: aiRunning ? "#7C3AED" : "#5C1A8C" }}
                    >
                      {aiRunning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {aiStage >= 0 && aiStage < AI_STAGES.length ? AI_STAGES[aiStage] : "Generating…"}
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Generate Email
                        </>
                      )}
                    </button>
                    {selectedLead && !selectedLead.isAudited && (
                      <span className="text-[10px] text-amber-600">Run Brand Audit first to use AI</span>
                    )}
                  </div>
                </div>

                {aiError && (
                  <div className="flex items-center gap-2 text-[11px] text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {aiError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Subject ── */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 flex-shrink-0">
            <span className="text-[11px] font-medium text-gray-400 w-12 flex-shrink-0">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject…"
              onClick={(e) => e.stopPropagation()}
              className="flex-1 text-sm outline-none text-gray-900 placeholder:text-gray-300 font-medium py-0.5"
            />
          </div>

          {/* ── Toolbar ── */}
          <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-100 bg-gray-50/50 flex-shrink-0">
            {[
              { cmd: "bold",      icon: <Bold className="w-3.5 h-3.5" />,      title: "Bold" },
              { cmd: "italic",    icon: <Italic className="w-3.5 h-3.5" />,    title: "Italic" },
              { cmd: "underline", icon: <Underline className="w-3.5 h-3.5" />, title: "Underline" },
            ].map(({ cmd, icon, title }) => (
              <button key={cmd} onMouseDown={(e) => { e.preventDefault(); execFormat(cmd); }}
                className="p-1.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-colors" title={title}>
                {icon}
              </button>
            ))}
            <div className="w-px h-4 bg-gray-200 mx-1" />
            {[
              { cmd: "justifyLeft",   icon: <AlignLeft className="w-3.5 h-3.5" />,   title: "Align Left" },
              { cmd: "justifyCenter", icon: <AlignCenter className="w-3.5 h-3.5" />, title: "Align Center" },
              { cmd: "justifyRight",  icon: <AlignRight className="w-3.5 h-3.5" />,  title: "Align Right" },
            ].map(({ cmd, icon, title }) => (
              <button key={cmd} onMouseDown={(e) => { e.preventDefault(); execFormat(cmd); }}
                className="p-1.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-colors" title={title}>
                {icon}
              </button>
            ))}
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <button onMouseDown={(e) => { e.preventDefault(); execFormat("insertUnorderedList"); }}
              className="p-1.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-colors" title="Bullet list">
              <List className="w-3.5 h-3.5" />
            </button>
            <button onMouseDown={(e) => { e.preventDefault(); insertLink(); }}
              className="p-1.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-colors" title="Insert link">
              <Link className="w-3.5 h-3.5" />
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <label
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer transition-all",
                  "border-gray-200 text-gray-500 hover:border-gray-300 bg-white hover:bg-gray-50"
                )}
                title="Attach a file to this email"
              >
                <Paperclip className="w-3.5 h-3.5" />
                Attach File
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                  accept="*/*"
                />
              </label>
            </div>
          </div>

          {/* ── Attachments strip ── */}
          {hasAttachments && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100 bg-amber-50/40 flex-shrink-0 flex-wrap">
              {attachReport && (
                <div
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
                    selectedLead?.isAudited
                      ? "text-amber-800 bg-amber-100 border-amber-300"
                      : "text-gray-500 bg-gray-100 border-gray-200"
                  )}
                >
                  <FileText className="w-3 h-3 flex-shrink-0" />
                  {selectedLead?.isAudited ? "Brand Audit Report PDF" : "Brand Audit Report (run audit first)"}
                  {selectedLead?.isAudited && (
                    <CheckCircle2 className="w-3 h-3 text-amber-600 ml-0.5 flex-shrink-0" />
                  )}
                </div>
              )}
              {attachedFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-blue-800 bg-blue-50 border border-blue-200 max-w-[200px]"
                >
                  <Paperclip className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-[10px] text-blue-400 ml-0.5 flex-shrink-0">({f.size})</span>
                  <button
                    onClick={() => removeAttachedFile(i)}
                    className="text-blue-400 hover:text-red-500 ml-0.5 flex-shrink-0 transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Body editor ── */}
          <div className="flex-1 overflow-hidden relative">
            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => setBodyEmpty((bodyRef.current?.innerText ?? "").trim().length === 0)}
              onClick={(e) => e.stopPropagation()}
              data-placeholder="Start writing your email, or use AI Compose above to generate a personalised draft…"
              className="h-full w-full px-5 py-4 text-sm text-gray-800 leading-relaxed outline-none overflow-y-auto"
              style={{ minHeight: 0 }}
            />
            {bodyEmpty && (
              <div className="absolute top-4 left-5 text-sm text-gray-300 pointer-events-none select-none leading-relaxed">
                Start writing your email, or use AI Compose above to generate a personalised draft…
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
            {sendStatus === "sent" ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Email sent successfully!
              </div>
            ) : sendStatus === "error" ? (
              <div className="flex items-center gap-2 text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5" />
                {sendError ?? "Send failed — please try again."}
              </div>
            ) : (
              <>
                <button
                  onClick={handleSaveDraft}
                  disabled={!selectedLead || !subject.trim() || quickSendMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-all"
                >
                  <Save className="w-3.5 h-3.5" /> Save Draft
                </button>
                {hasAttachments && (
                  <div className="flex items-center gap-1 text-[10px] text-amber-700 font-medium">
                    <Paperclip className="w-3 h-3" />
                    {[
                      attachReport && selectedLead?.isAudited ? "Audit PDF" : null,
                      attachedFiles.length > 0 ? `${attachedFiles.length} file${attachedFiles.length > 1 ? "s" : ""}` : null,
                    ].filter(Boolean).join(" + ")}
                    {" attached"}
                  </div>
                )}
                <button
                  onClick={handleSend}
                  disabled={!isReady || sendStatus === "sending"}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-all ml-auto"
                  style={{ background: "#1A3D2B" }}
                >
                  {sendStatus === "sending" ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
                  ) : (
                    <><Send className="w-3.5 h-3.5" /> Send Email</>
                  )}
                </button>
              </>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

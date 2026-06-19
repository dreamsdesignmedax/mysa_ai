import { useState, useEffect } from "react";
import {
  X, Loader2, FileText, Brain, Zap, Mail, ChevronDown, ChevronUp,
  Copy, Check, CheckCircle2, AlertCircle, Download,
} from "lucide-react";

function sanitizeProposalHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    .replace(/(href|src|action)\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, '$1="#"')
    .replace(/(href|src|action)\s*=\s*["']?\s*data:[^"'\s>]*/gi, '$1=""');
}
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Transcript {
  id: number;
  meetingId?: number | null;
  appointmentId?: number | null;
  source: string | null;
  rawTranscript: string | null;
  summary: string | null;
  actionItems: string | null;
  sentiment: string | null;
  nextSteps: string | null;
  proposalDraft: string | null;
  emailSequenceJson: string | null;
  recordingUrl: string | null;
  fetchedAt: string | null;
  createdAt: string;
}

interface EmailStep {
  day: number;
  label: string;
  subject: string;
  body: string;
}

interface TranscriptModalProps {
  meetingId?: number;
  appointmentId?: number;
  clientName?: string;
  company?: string;
  industry?: string;
  onClose: () => void;
}

type ActiveTab = "transcript" | "analysis" | "proposal" | "emails";

function sentimentColor(s: string | null) {
  if (s === "positive") return { bg: "#dcfce7", text: "#16a34a", label: "Positive" };
  if (s === "negative") return { bg: "#fee2e2", text: "#dc2626", label: "Negative" };
  return { bg: "#f3f4f6", text: "#6b7280", label: "Neutral" };
}

export default function TranscriptModal({ meetingId, appointmentId, clientName, company, industry, onClose }: TranscriptModalProps) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>("transcript");
  const [transcriptText, setTranscriptText] = useState("");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [genProposal, setGenProposal] = useState(false);
  const [genEmails, setGenEmails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedEmail, setExpandedEmail] = useState<number | null>(null);

  const apiBase = meetingId
    ? `/api/transcripts/meeting/${meetingId}`
    : `/api/transcripts/appointment/${appointmentId}`;

  async function loadTranscript() {
    setLoading(true);
    try {
      const r = await fetch(apiBase, { credentials: "include" });
      const data = await r.json() as Transcript | null;
      setTranscript(data);
      if (data?.rawTranscript) setTranscriptText(data.rawTranscript);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadTranscript(); }, []);

  async function saveTranscript() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(apiBase, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawTranscript: transcriptText }),
      });
      const data = await r.json() as Transcript;
      setTranscript(data);
    } catch { setError("Failed to save transcript"); }
    setSaving(false);
  }

  async function runAnalysis() {
    if (!transcript?.id) { setError("Save transcript first"); return; }
    setAnalyzing(true);
    setError(null);
    try {
      const r = await fetch(`/api/transcripts/${transcript.id}/analyze`, {
        method: "POST", credentials: "include",
      });
      const data = await r.json() as { transcript: Transcript };
      setTranscript(data.transcript);
      setActiveTab("analysis");
    } catch { setError("AI analysis failed"); }
    setAnalyzing(false);
  }

  async function runProposal() {
    if (!transcript?.id) { setError("Save transcript first"); return; }
    setGenProposal(true);
    setError(null);
    try {
      const r = await fetch(`/api/transcripts/${transcript.id}/proposal`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, company, industry }),
      });
      const data = await r.json() as { transcript: Transcript };
      setTranscript(data.transcript);
      setActiveTab("proposal");
    } catch { setError("Proposal generation failed"); }
    setGenProposal(false);
  }

  async function runEmailSequence() {
    if (!transcript?.id) { setError("Save transcript first"); return; }
    setGenEmails(true);
    setError(null);
    try {
      const r = await fetch(`/api/transcripts/${transcript.id}/email-sequence`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, company }),
      });
      const data = await r.json() as { transcript: Transcript };
      setTranscript(data.transcript);
      setActiveTab("emails");
    } catch { setError("Email sequence generation failed"); }
    setGenEmails(false);
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  const parsedEmails: EmailStep[] = (() => {
    try { return JSON.parse(transcript?.emailSequenceJson ?? "[]") as EmailStep[]; }
    catch { return []; }
  })();

  const parsedActionItems: string[] = (() => {
    try { return JSON.parse(transcript?.actionItems ?? "[]") as string[]; }
    catch { return []; }
  })();

  const sc = sentimentColor(transcript?.sentiment ?? null);
  const hasTranscript = !!transcript?.rawTranscript;
  const hasAnalysis = !!transcript?.summary;
  const hasProposal = !!transcript?.proposalDraft;
  const hasEmails = parsedEmails.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl sm:max-h-[90vh] flex flex-col shadow-2xl max-h-[95vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-600">
            <Brain className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 text-sm">Meeting Transcript & AI Analysis</div>
            {clientName && <div className="text-xs text-gray-500">{clientName}{company ? ` · ${company}` : ""}</div>}
          </div>
          {transcript?.source && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border"
              style={{ background: transcript.source === "meet" ? "#e0f2fe" : "#f0fdf4", color: transcript.source === "meet" ? "#0369a1" : "#16a34a", borderColor: transcript.source === "meet" ? "#bae6fd" : "#bbf7d0" }}>
              {transcript.source}
            </span>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5 gap-1 pt-1">
          {([
            { id: "transcript" as ActiveTab, label: "Transcript", icon: FileText, dot: hasTranscript },
            { id: "analysis" as ActiveTab, label: "AI Analysis", icon: Brain, dot: hasAnalysis },
            { id: "proposal" as ActiveTab, label: "Proposal", icon: FileText, dot: hasProposal },
            { id: "emails" as ActiveTab, label: "Email Sequence", icon: Mail, dot: hasEmails },
          ] as const).map(({ id, label, icon: Icon, dot }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors relative",
                activeTab === id ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500 hover:text-gray-700"
              )}
            >
              <Icon className="w-3 h-3" />
              {label}
              {dot && <span className="w-1.5 h-1.5 rounded-full bg-green-500 absolute top-1.5 right-0.5" />}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {!loading && activeTab === "transcript" && (
            <div className="space-y-4">
              {transcript?.recordingUrl && (
                <a href={transcript.recordingUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-700 px-3 py-1.5 bg-blue-50 rounded-lg border border-blue-100">
                  <Download className="w-3 h-3" />
                  Download Recording
                </a>
              )}

              <div>
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Transcript Text</div>
                <textarea
                  value={transcriptText}
                  onChange={(e) => setTranscriptText(e.target.value)}
                  placeholder="Paste meeting transcript here, or it will be auto-populated after a Google Meet call is processed..."
                  rows={14}
                  className="w-full text-xs border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 font-mono text-gray-700 bg-gray-50 placeholder:text-gray-400 placeholder:font-sans"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={saveTranscript}
                  disabled={saving || !transcriptText.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  {saving ? "Saving…" : "Save Transcript"}
                </button>
                {hasTranscript && (
                  <button
                    onClick={() => copyText(transcriptText, "transcript")}
                    className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {copied === "transcript" ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    Copy
                  </button>
                )}
              </div>
            </div>
          )}

          {!loading && activeTab === "analysis" && (
            <div className="space-y-4">
              {!hasAnalysis && !hasTranscript && (
                <div className="text-sm text-gray-500 text-center py-8">Add a transcript first, then run AI analysis.</div>
              )}

              {hasTranscript && !hasAnalysis && (
                <div className="text-center py-8 space-y-3">
                  <Brain className="w-10 h-10 text-indigo-300 mx-auto" />
                  <p className="text-sm text-gray-500">Run AI analysis to extract pain points, action items, and buying signals.</p>
                  <button onClick={runAnalysis} disabled={analyzing}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {analyzing ? "Analyzing…" : "Run AI Analysis"}
                  </button>
                </div>
              )}

              {hasAnalysis && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Analysis Results</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                        style={{ background: sc.bg, color: sc.text, borderColor: sc.bg }}>
                        {sc.label} Sentiment
                      </span>
                      <button onClick={runAnalysis} disabled={analyzing}
                        className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1">
                        {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Re-run"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Summary</div>
                    <p className="text-sm text-gray-700 leading-relaxed">{transcript?.summary}</p>
                  </div>

                  {parsedActionItems.length > 0 && (
                    <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Action Items</div>
                      <ul className="space-y-2">
                        {parsedActionItems.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {transcript?.nextSteps && (
                    <div className="rounded-xl border border-indigo-100 p-4 bg-indigo-50">
                      <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Recommended Next Steps</div>
                      <p className="text-sm text-indigo-800">{transcript.nextSteps}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!loading && activeTab === "proposal" && (
            <div className="space-y-4">
              {!hasProposal && !hasTranscript && (
                <div className="text-sm text-gray-500 text-center py-8">Add a transcript first, then generate a proposal.</div>
              )}

              {hasTranscript && !hasProposal && (
                <div className="text-center py-8 space-y-3">
                  <FileText className="w-10 h-10 text-indigo-300 mx-auto" />
                  <p className="text-sm text-gray-500">Generate a customized proposal based on what the client said in the call.</p>
                  <button onClick={runProposal} disabled={genProposal}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {genProposal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {genProposal ? "Generating…" : "Generate Proposal"}
                  </button>
                </div>
              )}

              {hasProposal && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">AI-Generated Proposal</div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => copyText(transcript?.proposalDraft?.replace(/<[^>]*>/g, "") ?? "", "proposal")}
                        className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1">
                        {copied === "proposal" ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                        {copied === "proposal" ? "Copied" : "Copy"}
                      </button>
                      <button onClick={runProposal} disabled={genProposal}
                        className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1">
                        {genProposal ? <Loader2 className="w-3 h-3 animate-spin" /> : "Regenerate"}
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-5 bg-white prose prose-sm max-w-none overflow-auto"
                    dangerouslySetInnerHTML={{ __html: sanitizeProposalHtml(transcript?.proposalDraft) }} />
                </div>
              )}
            </div>
          )}

          {!loading && activeTab === "emails" && (
            <div className="space-y-4">
              {!hasEmails && !hasTranscript && (
                <div className="text-sm text-gray-500 text-center py-8">Add a transcript first, then generate a follow-up sequence.</div>
              )}

              {hasTranscript && !hasEmails && (
                <div className="text-center py-8 space-y-3">
                  <Mail className="w-10 h-10 text-indigo-300 mx-auto" />
                  <p className="text-sm text-gray-500">Generate a 5-email follow-up sequence personalized to this conversation.</p>
                  <button onClick={runEmailSequence} disabled={genEmails}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {genEmails ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {genEmails ? "Generating…" : "Generate Email Sequence"}
                  </button>
                </div>
              )}

              {hasEmails && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{parsedEmails.length} Emails in Sequence</div>
                    <button onClick={runEmailSequence} disabled={genEmails}
                      className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1">
                      {genEmails ? <Loader2 className="w-3 h-3 animate-spin" /> : "Regenerate"}
                    </button>
                  </div>

                  {parsedEmails.map((email, idx) => (
                    <div key={idx} className="rounded-xl border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => setExpandedEmail(expandedEmail === idx ? null : idx)}
                        className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors text-left"
                      >
                        <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-700">{email.label}</span>
                            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                              Day {email.day}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 truncate">{email.subject}</div>
                        </div>
                        {expandedEmail === idx ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </button>

                      {expandedEmail === idx && (
                        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                          <div>
                            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Subject</div>
                            <div className="text-xs font-medium text-gray-800 bg-gray-50 px-3 py-2 rounded-lg">{email.subject}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Body</div>
                            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 px-3 py-2 rounded-lg max-h-48 overflow-y-auto">{email.body}</pre>
                          </div>
                          <button onClick={() => copyText(`Subject: ${email.subject}\n\n${email.body}`, `email-${idx}`)}
                            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
                            {copied === `email-${idx}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                            {copied === `email-${idx}` ? "Copied!" : "Copy email"}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer action bar */}
        {!loading && hasTranscript && activeTab !== "transcript" && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex items-center gap-2 flex-wrap">
            {activeTab !== "analysis" && (
              <button onClick={runAnalysis} disabled={analyzing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors disabled:opacity-50">
                {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                {analyzing ? "Analyzing…" : "Analyze"}
              </button>
            )}
            {activeTab !== "proposal" && (
              <button onClick={runProposal} disabled={genProposal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors disabled:opacity-50">
                {genProposal ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                {genProposal ? "Generating…" : "Proposal"}
              </button>
            )}
            {activeTab !== "emails" && (
              <button onClick={runEmailSequence} disabled={genEmails}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg border border-green-200 transition-colors disabled:opacity-50">
                {genEmails ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                {genEmails ? "Generating…" : "Email Sequence"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

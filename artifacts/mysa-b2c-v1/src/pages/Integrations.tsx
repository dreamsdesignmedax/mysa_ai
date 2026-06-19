import { useState, useEffect } from "react";
import {
  Calendar, Video, CheckCircle2, XCircle, Loader2, Copy, Check,
  RefreshCw, ExternalLink, AlertCircle, Link2, Zap, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface GoogleStatus {
  connected: boolean;
  managedBy?: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 font-mono break-all">{value}</code>
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex-shrink-0 p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-gray-500"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
      ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
    )}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

export default function Integrations() {
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleLoading, setGoogleLoading] = useState(true);

  async function loadGoogleStatus() {
    try {
      const r = await fetch(`/api/integrations/google/status`, { credentials: "include" });
      const data = await r.json() as GoogleStatus;
      setGoogleStatus(data);
    } catch { /* ignore */ }
    setGoogleLoading(false);
  }

  useEffect(() => {
    loadGoogleStatus();
  }, []);

  return (
    <div className="flex-1 min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
          <p className="text-sm text-gray-500 mt-1">Connect Google Calendar & Meet so every booking auto-syncs and transcripts flow into Sales Brain.</p>
        </div>

        {/* ── GOOGLE CALENDAR / MEET ─────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-4 px-6 pt-6 pb-4 border-b border-gray-100">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#4285F4,#34A853)" }}>
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-semibold text-gray-900">Google Calendar & Meet</h2>
                {googleLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                ) : googleStatus && (
                  <StatusBadge ok={googleStatus.connected} label={googleStatus.connected ? "Connected" : "Not connected"} />
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">Bookings auto-create calendar events with Google Meet links. Real-time sync included.</p>
            </div>
            <button onClick={() => { setGoogleLoading(true); loadGoogleStatus(); }} disabled={googleLoading} className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors">
              <RefreshCw className={cn("w-4 h-4", googleLoading && "animate-spin")} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-5">

            {/* Connected */}
            {googleStatus?.connected && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-green-50 border border-green-100">
                <ShieldCheck className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-green-800">Google Calendar & Meet active</div>
                  <div className="text-xs text-green-700 mt-0.5">
                    Connected via Mysa AI's secure Google integration — no API keys needed. All new bookings sync to Google Calendar and a Google Meet link is created automatically.
                  </div>
                </div>
              </div>
            )}

            {/* Not connected */}
            {!googleLoading && !googleStatus?.connected && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-100">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-amber-800">Google Calendar not reachable</div>
                  <div className="text-xs text-amber-700 mt-0.5">
                    The Google Calendar connection could not be verified. This may be a temporary issue — try refreshing in a moment. The integration is managed securely by Mysa AI.
                  </div>
                  <button
                    onClick={() => { setGoogleLoading(true); loadGoogleStatus(); }}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> Retry check
                  </button>
                </div>
              </div>
            )}

            {/* What you get */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: "📅", title: "Auto Calendar Events", desc: "Every booking creates a Google Calendar event instantly" },
                { icon: "🎥", title: "Google Meet Links", desc: "Meet link generated and sent in booking confirmation email" },
                { icon: "🔄", title: "Real-time Sync", desc: "Updates, cancellations reflected in your calendar" },
                { icon: "📝", title: "Manual Transcripts", desc: "Paste post-meeting transcripts for AI analysis and proposals" },
              ].map((f) => (
                <div key={f.title} className="flex gap-2.5 p-3 rounded-xl bg-gray-50">
                  <span className="text-base">{f.icon}</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-800">{f.title}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── GOOGLE MEET INFO ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-4 px-6 pt-6 pb-4 border-b border-gray-100">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#00832D,#0F9D58)" }}>
              <Video className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-semibold text-gray-900">Google Meet (Default)</h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                  <CheckCircle2 className="w-3 h-3" /> Included
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">Google Meet is the default video call option for all bookings — no extra setup needed.</p>
            </div>
          </div>

          <div className="px-6 py-5 space-y-5">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-green-50 border border-green-100">
              <ShieldCheck className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-green-800">No configuration required</div>
                <div className="text-xs text-green-700 mt-0.5">
                  Google Meet links are auto-generated when a Google Calendar event is created. When a prospect books a call, a unique Meet link is created and included in the confirmation email automatically.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: "🔗", title: "Auto Meet Link", desc: "Unique Meet link created per booking, no manual steps" },
                { icon: "📧", title: "Email Delivery", desc: "Link sent to prospect in booking confirmation email" },
                { icon: "📆", title: "Calendar Invite", desc: "Meet join button added to Google Calendar invite" },
                { icon: "🧠", title: "AI Analysis", desc: "Paste transcripts manually for Sales Brain analysis" },
              ].map((f) => (
                <div key={f.title} className="flex gap-2.5 p-3 rounded-xl bg-gray-50">
                  <span className="text-base">{f.icon}</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-800">{f.title}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <a
              href="https://meet.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 hover:text-green-800"
            >
              Open Google Meet <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* ── HOW IT WORKS ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-indigo-500" />
            <h3 className="font-semibold text-gray-900 text-sm">How the full flow works</h3>
          </div>
          <ol className="space-y-3">
            {[
              { step: "1", text: "Customer books a call via your booking link", color: "#4285F4" },
              { step: "2", text: "Mysa AI creates a Google Calendar event with a Google Meet link", color: "#34A853" },
              { step: "3", text: "Booking confirmation email sent with Google Meet join link", color: "#5C1A8C" },
              { step: "4", text: "You see the meeting in your Google Calendar with one-click join", color: "#FBBC05" },
              { step: "5", text: "After the call, paste the transcript into Sales Brain for analysis", color: "#2D8CFF" },
              { step: "6", text: "Sales Brain analyzes transcript → generates custom proposal + email sequence", color: "#E91E8C" },
            ].map(({ step, text, color }) => (
              <li key={step} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white mt-0.5" style={{ background: color }}>{step}</span>
                <span className="text-sm text-gray-700">{text}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* ── BOOKING LINK ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-4 h-4 text-gray-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Your Booking Link</h3>
          </div>
          <CopyField
            label="Share this with prospects — Google Meet link auto-created on booking"
            value={typeof window !== "undefined" ? `${window.location.origin}${BASE}/book` : `${BASE}/book`}
          />
        </div>

      </div>
    </div>
  );
}

import { useState } from "react";
import { useCreateMeeting, getListMeetingsQueryKey } from "@workspace/api-client-react";
import type { MeetingWithLead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const MEETING_TYPES = ["discovery", "demo", "proposal", "follow_up", "closing"] as const;

function toICSDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeICS(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function generateICS(meeting: MeetingWithLead): string {
  const start = new Date(meeting.scheduledAt);
  const end = new Date(start.getTime() + meeting.duration * 60 * 1000);
  const lead = meeting.lead;
  const leadName = lead ? `${lead.firstName} ${lead.lastName}`.trim() : "Lead";
  const company = lead?.company ?? "";
  const summary = escapeICS(
    `${meeting.type.replace(/_/g, " ")} with ${leadName}${company ? ` (${company})` : ""}`
  );
  const location = meeting.meetingUrl ?? "";
  const description = escapeICS(
    [
      `Meeting Type: ${meeting.type.replace(/_/g, " ")}`,
      `Duration: ${meeting.duration} min`,
      company ? `Company: ${company}` : "",
      location ? `Link: ${location}` : "",
      meeting.notes ? `Notes: ${meeting.notes}` : "",
    ].filter(Boolean).join("\n")
  );

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sales War Machine//Meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:swm-meeting-${meeting.id}@saleswarmachine`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${escapeICS(location)}` : "",
    `DESCRIPTION:${description}`,
    `DTSTAMP:${toICSDate(new Date())}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

export function downloadICS(meeting: MeetingWithLead): void {
  const content = generateICS(meeting);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const lead = meeting.lead;
  const leadSlug = lead ? `${lead.firstName}-${lead.lastName}`.toLowerCase().replace(/\s+/g, "-") : "meeting";
  a.href = url;
  a.download = `meeting-${leadSlug}-${meeting.id}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function NewMeetingModal({
  leads,
  defaultLeadId,
  onClose,
  onCreated,
}: {
  leads: { id: number; firstName: string; lastName: string; company: string }[];
  defaultLeadId?: number;
  onClose: () => void;
  onCreated: (meeting: MeetingWithLead, downloadIcs: boolean) => void;
}) {
  const [leadId, setLeadId] = useState<number | "">(defaultLeadId ?? leads[0]?.id ?? "");
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  });
  const [duration, setDuration] = useState(60);
  const [type, setType] = useState<typeof MEETING_TYPES[number]>("discovery");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [downloadIcsFlag, setDownloadIcsFlag] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const qc = useQueryClient();
  const createMeeting = useCreateMeeting({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() }),
    },
  });

  const inputCls = "w-full text-sm rounded-lg border border-gray-200 bg-white text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-700/20 focus:border-green-700 transition-colors";
  const labelCls = "block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide";

  const handleSubmit = async () => {
    if (!leadId) { setError("Please select a lead."); return; }
    if (!scheduledAt) { setError("Please set a date and time."); return; }
    setError(null);
    try {
      const created = await createMeeting.mutateAsync({
        data: {
          leadId: Number(leadId),
          scheduledAt: new Date(scheduledAt).toISOString(),
          duration,
          type,
          meetingUrl: meetingUrl.trim() || null,
        },
      });
      const selectedLead = leads.find(l => l.id === Number(leadId));
      const meetingWithLead: MeetingWithLead = {
        ...(created as MeetingWithLead),
        lead: selectedLead as MeetingWithLead["lead"],
      };
      onCreated(meetingWithLead, downloadIcsFlag);
    } catch (e) {
      setError((e as Error).message ?? "Failed to create meeting.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">New CRM Meeting</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Lead <span className="text-red-500">*</span></label>
            <select value={leadId} onChange={e => setLeadId(Number(e.target.value))} className={inputCls}>
              {leads.map(l => (
                <option key={l.id} value={l.id}>
                  {l.firstName} {l.lastName}{l.company ? ` — ${l.company}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Date &amp; Time <span className="text-red-500">*</span></label>
            <input type="datetime-local" value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Duration (min)</label>
              <input type="number" min={15} max={480} value={duration}
                onChange={e => setDuration(Number(e.target.value))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Meeting Type</label>
              <select value={type} onChange={e => setType(e.target.value as typeof MEETING_TYPES[number])} className={inputCls}>
                {MEETING_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Location / Video Link <span className="text-gray-400 font-normal normal-case">(optional)</span></label>
            <input
              type="text"
              value={meetingUrl}
              onChange={e => setMeetingUrl(e.target.value)}
              placeholder="e.g. https://meet.google.com/abc-defg-hij or Conference Room A"
              className={inputCls}
            />
            <p className="text-[11px] text-gray-400 mt-1">Included as LOCATION in the .ics calendar file</p>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer group">
            <div className={cn(
              "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all",
              downloadIcsFlag ? "bg-green-700 border-green-700" : "border-gray-300 group-hover:border-gray-400"
            )}>
              {downloadIcsFlag && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <input type="checkbox" checked={downloadIcsFlag} onChange={e => setDownloadIcsFlag(e.target.checked)} className="sr-only" />
            <span className="text-sm text-gray-700">Download .ics calendar file after creating</span>
          </label>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-50 rounded-lg border border-red-100 text-xs text-red-600">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMeeting.isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{ background: "#1A3D2B" }}
          >
            {createMeeting.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</> : "Create Meeting"}
          </button>
        </div>
      </div>
    </div>
  );
}

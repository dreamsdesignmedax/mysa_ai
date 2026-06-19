import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useGetAvailableSlots,
  useListAppointments,
  useCreateAppointment,
  useUpdateAppointment,
  useDeleteAppointment,
  useListMeetings,
  useUpdateMeeting,
  useDeleteMeeting,
  useGetMeetingPrep,
  useGenerateMeetingSummary,
  useListLeads,
  getListAppointmentsQueryKey,
  getListMeetingsQueryKey,
} from "@workspace/api-client-react";
import type { Appointment, MeetingWithLead, MeetingPrep, GeneratedEmail, UpdateAppointmentBodyStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Clock, ChevronLeft, ChevronRight, Video, MapPin, Calendar,
  CheckCircle2, Loader2, Trash2, Zap, FileText, CalendarDays,
  Users, User, Download, Plus, Pencil, X, AlertCircle, Brain, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NewMeetingModal, downloadICS, MEETING_TYPES } from "@/components/NewMeetingModal";
import TranscriptModal from "@/components/TranscriptModal";

type ApptExtended = Appointment & {
  meetingLink?: string | null;
  zoomMeetingId?: string | null;
  googleCalendarEventId?: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────
const SERVICES = [
  "Business Growth Consulting",
  "SEO & Lead Generation",
  "D2C Development / Marketing",
  "Ecommerce Development",
  "Website Development",
  "Digital Marketing & Brand Awareness",
  "Branding & Identity Management",
  "Mobile Apps and Software Development",
  "Marketing Automation & Funnel Development",
  "Films, Videos and Corporate Identity",
  "Other",
];

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_LABELS = ["MON","TUE","WED","THU","FRI","SAT","SUN"];

const DESCRIPTION = `Hello there,
PLEASE READ BELOW BEFORE BOOKING THE CALL 👇

1. I want to respect your time & mine so please fill out the form only if you are serious and available on given time.
2. Please REVIEW the form carefully before booking

Can't wait to speak with you! =)

Thanks,
Krishna Puranik`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDisplayDate(dateStr: string, timeLabel?: string) {
  const d = new Date(dateStr + "T00:00:00");
  const full = d.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", year:"numeric" });
  return timeLabel ? `${full} at ${timeLabel}` : full;
}

function statusColor(s: string) {
  if (s === "confirmed") return { bg: "#dcfce7", text: "#16a34a" };
  if (s === "completed") return { bg: "#dbeafe", text: "#1d4ed8" };
  if (s === "cancelled") return { bg: "#fee2e2", text: "#dc2626" };
  return { bg: "#f3f4f6", text: "#6b7280" };
}

// ── HostPanel (left side, shared across all steps) ───────────────────────────
function HostPanel({ selectedDate, selectedTimeLabel }: { selectedDate?: string; selectedTimeLabel?: string }) {
  return (
    <div className="w-64 flex-shrink-0 border-r border-gray-200 p-7 flex flex-col gap-5">
      <div className="flex flex-col items-start gap-3">
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-md"
          style={{ background: "linear-gradient(135deg,#5C1A8C,#E91E8C)" }}>
          KP
        </div>
        <div>
          <div className="text-[11px] text-gray-500 font-medium">Krishna Puranik</div>
          <div className="text-base font-bold text-gray-900 mt-0.5 leading-tight">Growth Discovery Call</div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span>45 min</span>
        </div>
        {selectedDate && (
          <div className="flex items-start gap-2 text-xs text-gray-600">
            <CalendarDays className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              {selectedTimeLabel && <span className="font-semibold text-gray-800">{selectedTimeLabel}, </span>}
              {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", year:"numeric" })}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full border border-gray-400 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            </div>
          </div>
          <span>India Standard Time</span>
        </div>
      </div>

      <div className="pt-1 border-t border-gray-100">
        <div className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-line">{DESCRIPTION}</div>
      </div>
    </div>
  );
}

// ── Step 1: Calendar + Time Slots ─────────────────────────────────────────────
function CalendarStep({ onSelect }: { onSelect: (date: string, time: string, label: string) => void }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const todayStr = toYMD(today);

  // Days in viewed month
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay  = new Date(viewYear, viewMonth + 1, 0);
  // ISO: 0=Mon..6=Sun
  const startPad = (firstDay.getDay() + 6) % 7; // days before first of month
  const totalCells = startPad + lastDay.getDate();
  const rows = Math.ceil(totalCells / 7);
  const cells: (number | null)[] = Array(rows * 7).fill(null);
  for (let i = 0; i < lastDay.getDate(); i++) cells[startPad + i] = i + 1;

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
    setSelectedDate(null);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
    setSelectedDate(null);
  }

  function getDateStr(day: number) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }

  function isDayAvailable(day: number) {
    const ds = getDateStr(day);
    if (ds < todayStr) return false;
    const d = new Date(ds + "T00:00:00");
    return d.getDay() !== 0; // Sunday blocked
  }

  // Fetch slots when date selected
  const { data: slotsData, isFetching: slotsFetching } = useGetAvailableSlots(
    { date: selectedDate ?? "" },
    { query: { enabled: !!selectedDate, queryKey: ["slots", selectedDate] } }
  );
  const slots = slotsData?.slots ?? [];

  // Can we go back? Only if not already at current month
  const canPrev = viewYear > today.getFullYear() || (viewYear === today.getFullYear() && viewMonth > today.getMonth());

  return (
    <div className="flex flex-1 min-h-0">
      {/* Calendar */}
      <div className="flex-1 p-7 border-r border-gray-200">
        <h2 className="text-base font-bold text-gray-900 mb-5">Select a Date &amp; Time</h2>

        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} disabled={!canPrev}
            className="p-1.5 rounded-full hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-sm font-semibold text-gray-900">{MONTHS[viewMonth]} {viewYear}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 mb-2">
          {DAY_LABELS.map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, idx) => {
            if (!day) return <div key={idx} />;
            const ds = getDateStr(day);
            const available = isDayAvailable(day);
            const isSelected = ds === selectedDate;
            const isToday = ds === todayStr;
            return (
              <button
                key={idx}
                disabled={!available}
                onClick={() => { setSelectedDate(ds); setSelectedTime(null); }}
                className={cn(
                  "mx-auto w-9 h-9 rounded-full text-sm font-medium flex items-center justify-center transition-all relative",
                  isSelected
                    ? "text-white shadow-sm"
                    : available
                      ? "text-gray-800 hover:border-2 hover:border-[#1A3D2B] hover:text-[#1A3D2B]"
                      : "text-gray-300 cursor-not-allowed"
                )}
                style={isSelected ? { background: "#1A3D2B" } : undefined}
              >
                {day}
                {isToday && !isSelected && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#1A3D2B]" />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-2 text-[11px] text-gray-400">
          <div className="w-3 h-3 rounded-full border border-gray-300 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          </div>
          Time zone: India Standard Time (IST)
        </div>
      </div>

      {/* Time Slots */}
      {selectedDate && (
        <div className="w-48 p-7 flex flex-col">
          <div className="text-sm font-semibold text-gray-900 mb-4">
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" })}
          </div>
          {slotsFetching ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          ) : slots.length === 0 ? (
            <div className="text-xs text-gray-400">No times available on this day.</div>
          ) : (
            <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "380px" }}>
              {slots.map((slot) => (
                <button
                  key={slot.time}
                  onClick={() => {
                    if (selectedTime === slot.time) {
                      onSelect(selectedDate, slot.time, slot.label);
                    } else {
                      setSelectedTime(slot.time);
                    }
                  }}
                  className={cn(
                    "py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
                    selectedTime === slot.time
                      ? "text-white border-transparent"
                      : "bg-white border-[#1A3D2B] text-[#1A3D2B] hover:bg-green-50"
                  )}
                  style={selectedTime === slot.time ? { background: "#1A3D2B" } : undefined}
                >
                  {selectedTime === slot.time ? "Confirm →" : slot.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 2: Details Form ──────────────────────────────────────────────────────
type FormData = {
  name: string; email: string; phone: string;
  location: "meet" | "inperson";
  businessSummary: string; specificProblem: string; desiredResult: string; whyCanHelp: string;
  investmentWillingness: string; minInvestmentConfirm: string; startSoon: string; businessPartner: string;
  services: string[]; otherService: string;
};

function DetailsStep({
  selectedDate, selectedTime, selectedTimeLabel,
  onBack, onSubmit, submitting, error,
}: {
  selectedDate: string; selectedTime: string; selectedTimeLabel: string;
  onBack: () => void; onSubmit: (fd: FormData) => void; submitting: boolean; error: string | null;
}) {
  const [form, setForm] = useState<FormData>({
    name: "", email: "", phone: "", location: "meet",
    businessSummary: "", specificProblem: "", desiredResult: "", whyCanHelp: "",
    investmentWillingness: "", minInvestmentConfirm: "", startSoon: "", businessPartner: "",
    services: [], otherService: "",
  });

  const set = (k: keyof FormData, v: string | string[]) => setForm(f => ({ ...f, [k]: v }));

  const toggleService = (svc: string) => {
    set("services", form.services.includes(svc)
      ? form.services.filter(s => s !== svc)
      : [...form.services, svc]);
  };

  const labelCls = "block text-[11px] font-semibold text-gray-700 mb-1.5";
  const inputCls = "w-full text-sm rounded-lg border border-gray-200 bg-white text-gray-900 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-700/20 focus:border-green-700 transition-colors";
  const textareaCls = inputCls + " resize-none";

  return (
    <div className="flex-1 overflow-y-auto p-7">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors">
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>
        <h2 className="text-base font-bold text-gray-900">Enter Details</h2>
      </div>

      <div className="space-y-5 max-w-lg">
        {/* Name */}
        <div>
          <label className={labelCls}>Name <span className="text-red-500">*</span></label>
          <input value={form.name} onChange={e => set("name", e.target.value)} className={inputCls} required />
        </div>

        {/* Email */}
        <div>
          <label className={labelCls}>Email <span className="text-red-500">*</span></label>
          <input type="email" value={form.email} onChange={e => set("email", e.target.value)} className={inputCls} required />
        </div>

        {/* Location */}
        <div>
          <label className={labelCls}>Location <span className="text-red-500">*</span></label>
          <div className="space-y-2">
            {[
              { val: "zoom" as const, label: "Zoom", icon: <Video className="w-4 h-4 text-blue-500" /> },
              { val: "inperson" as const, label: "In-person – Vadodara", icon: <MapPin className="w-4 h-4 text-red-500" /> },
            ].map(opt => (
              <label key={opt.val} className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all",
                form.location === opt.val ? "border-green-700 bg-green-50" : "border-gray-200 hover:border-gray-300"
              )}>
                <input type="radio" name="location" value={opt.val}
                  checked={form.location === opt.val}
                  onChange={() => set("location", opt.val)}
                  className="accent-green-700" />
                {opt.icon}
                <span className="text-sm text-gray-800 font-medium">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Phone */}
        <div>
          <label className={labelCls}>Your Call &amp; WhatsApp No <span className="text-red-500">*</span></label>
          <div className="flex">
            <div className="flex items-center gap-1.5 px-3 py-2.5 border border-r-0 border-gray-200 rounded-l-lg bg-gray-50 text-sm text-gray-700 whitespace-nowrap">
              🇮🇳 +91
            </div>
            <input value={form.phone} onChange={e => set("phone", e.target.value)}
              placeholder="98765 43210"
              className="flex-1 text-sm border border-gray-200 rounded-r-lg bg-white text-gray-900 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-700/20 focus:border-green-700" />
          </div>
        </div>

        {/* Business summary */}
        <div>
          <label className={labelCls}>
            Please provide a brief summary of your business &amp; what it is that you do?
            <span className="text-red-500"> *</span>
          </label>
          <textarea rows={3} value={form.businessSummary} onChange={e => set("businessSummary", e.target.value)} className={textareaCls} required />
        </div>

        {/* Specific problem */}
        <div>
          <label className={labelCls}>
            What specific problem are you facing right now in your business and would you like us to talk about?
            <span className="text-red-500"> *</span>
          </label>
          <textarea rows={3} value={form.specificProblem} onChange={e => set("specificProblem", e.target.value)} className={textareaCls} required />
        </div>

        {/* Desired result */}
        <div>
          <label className={labelCls}>
            What is your Desired Result in terms of Income Goal that you want to achieve in the next 3-6 months?
            <span className="text-red-500"> *</span>
          </label>
          <input value={form.desiredResult} onChange={e => set("desiredResult", e.target.value)} className={inputCls} required />
        </div>

        {/* Why can I help */}
        <div>
          <label className={labelCls}>
            Why do you believe I can help you to grow your business?
            <span className="text-red-500"> *</span>
          </label>
          <input value={form.whyCanHelp} onChange={e => set("whyCanHelp", e.target.value)} className={inputCls} required />
        </div>

        {/* Investment willingness */}
        <div>
          <label className={labelCls}>
            How willing and able are you to invest in solving your problem right now?
            <span className="text-red-500"> *</span>
          </label>
          <div className="space-y-2.5">
            {[
              "I have the financial resources and am ready to invest in my business right now.",
              "I have access to the resources to invest if I needed them.",
              "I don't have the resources to invest.",
            ].map(opt => (
              <label key={opt} className="flex items-start gap-2.5 cursor-pointer group">
                <div className={cn(
                  "mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
                  form.investmentWillingness === opt ? "border-green-700" : "border-gray-300 group-hover:border-gray-400"
                )}>
                  {form.investmentWillingness === opt && (
                    <div className="w-2 h-2 rounded-full bg-green-700" />
                  )}
                </div>
                <input type="radio" name="investmentWillingness" value={opt}
                  checked={form.investmentWillingness === opt}
                  onChange={() => set("investmentWillingness", opt)}
                  className="sr-only" />
                <span className="text-sm text-gray-700 leading-relaxed">{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Min investment */}
        <div>
          <label className={labelCls}>
            If we are a good fit, would you be able to invest a minimum of $1000 / INR 81,000 to get started with the project?
            <span className="text-red-500"> *</span>
          </label>
          <input value={form.minInvestmentConfirm} onChange={e => set("minInvestmentConfirm", e.target.value)} className={inputCls} required />
        </div>

        {/* How soon */}
        <div>
          <label className={labelCls}>
            If we are a fit, how soon can you get started?
            <span className="text-red-500"> *</span>
          </label>
          <input value={form.startSoon} onChange={e => set("startSoon", e.target.value)} className={inputCls} required />
        </div>

        {/* Business partner */}
        <div>
          <label className={labelCls}>
            Do you have anyone else (business partner, significant other, etc.) who should be on the call to help you make a decision?
          </label>
          <input value={form.businessPartner} onChange={e => set("businessPartner", e.target.value)} className={inputCls} />
        </div>

        {/* Services */}
        <div>
          <label className={labelCls}>If you are aware then choose for which solutions you would like to consult us.</label>
          <div className="space-y-2.5">
            {SERVICES.map(svc => (
              <label key={svc} className="flex items-center gap-2.5 cursor-pointer group">
                <div className={cn(
                  "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all",
                  form.services.includes(svc) ? "bg-green-700 border-green-700" : "border-gray-300 group-hover:border-gray-400"
                )}>
                  {form.services.includes(svc) && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <input type="checkbox" value={svc} checked={form.services.includes(svc)}
                  onChange={() => toggleService(svc)} className="sr-only" />
                <span className="text-sm text-gray-700">{svc}</span>
              </label>
            ))}
            {form.services.includes("Other") && (
              <div className="ml-6.5 mt-2">
                <input value={form.otherService} onChange={e => set("otherService", e.target.value)}
                  placeholder="Please specify…"
                  className={inputCls + " text-sm"} />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 rounded-lg border border-red-100 text-xs text-red-600">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        <div className="text-[11px] text-gray-400 leading-relaxed">
          By proceeding, you confirm that you have read and agree to our{" "}
          <a href="https://dreamsdesign.ca" target="_blank" rel="noreferrer" className="text-green-700 underline">Privacy Policy</a>.
        </div>

        <button
          onClick={() => onSubmit(form)}
          disabled={submitting || !form.name || !form.email || !form.businessSummary || !form.specificProblem || !form.desiredResult || !form.whyCanHelp || !form.investmentWillingness || !form.minInvestmentConfirm || !form.startSoon}
          className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ background: "#1A3D2B" }}
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Scheduling…</>
            : "Schedule Event"}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Confirmation ──────────────────────────────────────────────────────
function ConfirmStep({ appointment, onBookAnother }: { appointment: Appointment; onBookAnother: () => void }) {
  const [hStr, mStr] = appointment.scheduledTime.split(":");
  const h = Number(hStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const timeLabel = `${h12}:${mStr} ${suffix} IST`;
  const dateLabel = new Date(appointment.scheduledDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-10 text-center gap-5">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle2 className="w-9 h-9 text-green-600" />
      </div>
      <div>
        <div className="text-xl font-bold text-gray-900 mb-1">You're scheduled!</div>
        <div className="text-sm text-gray-500">A confirmation email has been sent to <strong>{appointment.email}</strong></div>
      </div>
      <div className="bg-gray-50 rounded-xl border border-gray-200 px-6 py-5 text-left space-y-3 w-full max-w-sm">
        <div className="flex items-start gap-3">
          <CalendarDays className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-xs text-gray-500">Date &amp; Time</div>
            <div className="text-sm font-semibold text-gray-800">{dateLabel}</div>
            <div className="text-sm text-gray-600">{timeLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div>
            <div className="text-xs text-gray-500">Duration</div>
            <div className="text-sm font-semibold text-gray-800">45 minutes</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {appointment.location === "meet"
            ? <Video className="w-4 h-4 text-blue-500 flex-shrink-0" />
            : <MapPin className="w-4 h-4 text-red-500 flex-shrink-0" />}
          <div>
            <div className="text-xs text-gray-500">Location</div>
            <div className="text-sm font-semibold text-gray-800">
              {appointment.location === "meet" ? "Google Meet (link sent before call)" : "In-person – Vadodara"}
            </div>
          </div>
        </div>
      </div>
      <button onClick={onBookAnother}
        className="text-xs font-semibold text-green-700 hover:underline mt-2">
        Book another time
      </button>
    </div>
  );
}

// ── Booking Widget (wraps all 3 steps) ────────────────────────────────────────
function BookingWidget() {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedTimeLabel, setSelectedTimeLabel] = useState<string | null>(null);
  const [bookedAppt, setBookedAppt] = useState<Appointment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createAppt = useCreateAppointment({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }) },
  });

  const handleSlotSelected = (date: string, time: string, label: string) => {
    setSelectedDate(date);
    setSelectedTime(time);
    setSelectedTimeLabel(label);
    setStep(2);
  };

  const handleSubmit = async (fd: FormData) => {
    if (!selectedDate || !selectedTime) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createAppt.mutateAsync({
        data: {
          name: fd.name, email: fd.email, phone: fd.phone,
          scheduledDate: selectedDate, scheduledTime: selectedTime,
          location: fd.location,
          businessSummary: fd.businessSummary, specificProblem: fd.specificProblem,
          desiredResult: fd.desiredResult, whyCanHelp: fd.whyCanHelp,
          investmentWillingness: fd.investmentWillingness, minInvestmentConfirm: fd.minInvestmentConfirm,
          startSoon: fd.startSoon, businessPartner: fd.businessPartner,
          services: fd.services, otherService: fd.otherService,
        },
      });
      setBookedAppt(result as Appointment);
      setStep(3);
    } catch (e) {
      setSubmitError((e as Error).message ?? "Booking failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetBooking = () => {
    setStep(1); setSelectedDate(null); setSelectedTime(null);
    setSelectedTimeLabel(null); setBookedAppt(null); setSubmitError(null);
  };

  return (
    <div className="flex items-start justify-center py-8 px-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl flex overflow-hidden"
        style={{ width: "min(900px, 100%)", minHeight: "560px" }}>
        <HostPanel
          selectedDate={step > 1 ? selectedDate ?? undefined : undefined}
          selectedTimeLabel={step > 1 ? selectedTimeLabel ?? undefined : undefined}
        />

        {step === 1 && <CalendarStep onSelect={handleSlotSelected} />}
        {step === 2 && selectedDate && selectedTime && selectedTimeLabel && (
          <DetailsStep
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            selectedTimeLabel={selectedTimeLabel}
            onBack={() => setStep(1)}
            onSubmit={handleSubmit}
            submitting={submitting}
            error={submitError}
          />
        )}
        {step === 3 && bookedAppt && (
          <ConfirmStep appointment={bookedAppt} onBookAnother={resetBooking} />
        )}
      </div>
    </div>
  );
}

// ── Admin Bookings View ───────────────────────────────────────────────────────
function AdminView() {
  const qc = useQueryClient();
  const { data: appts = [], isLoading } = useListAppointments();
  const appointments = appts as ApptExtended[];
  const updateAppt = useUpdateAppointment();
  const deleteAppt = useDeleteAppointment({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() }) },
  });

  const [activeId, setActiveId] = useState<number | null>(null);
  const active = appointments.find(a => a.id === activeId);

  async function handleStatusChange(id: number, status: UpdateAppointmentBodyStatus) {
    try {
      await updateAppt.mutateAsync({ id, data: { status } });
      qc.setQueryData<Appointment[]>(
        getListAppointmentsQueryKey(),
        (prev) => prev ? prev.map((a) => a.id === id ? { ...a, status } : a) : prev
      );
      qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
    } catch {
      qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
    }
  }
  const [transcriptApptId, setTranscriptApptId] = useState<number | null>(null);

  const upcoming = appointments.filter(a => {
    const now = new Date().toISOString().split("T")[0];
    return a.scheduledDate >= now && a.status === "confirmed";
  });
  const past = appointments.filter(a => !upcoming.includes(a));

  const [hStr, mStr] = active ? active.scheduledTime.split(":") : ["0","00"];
  const h = Number(hStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const activeTimeLabel = active ? `${h12}:${mStr} ${suffix} IST` : "";

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 p-3 md:p-6" style={{ minHeight: "calc(100vh - 120px)" }}>
      {/* List panel */}
      <div className="md:col-span-2 rounded-xl border border-gray-200 bg-white flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
            Appointments ({appointments.length})
          </span>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-50 rounded-lg animate-pulse" />)}
          </div>
        ) : appointments.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 p-10 text-center">
            <CalendarDays className="w-8 h-8 text-gray-200 mb-3" />
            <div className="text-sm text-gray-400">No appointments yet</div>
            <div className="text-xs text-gray-300 mt-1">Bookings will appear here</div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {[{ label: "Upcoming", items: upcoming }, { label: "Past / Other", items: past }].map(({ label, items }) =>
              items.length > 0 ? (
                <div key={label}>
                  <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50">{label}</div>
                  {items.map(appt => {
                    const sc = statusColor(appt.status);
                    const [hh, mm] = appt.scheduledTime.split(":");
                    const hnum = Number(hh);
                    const suf = hnum >= 12 ? "PM" : "AM";
                    const h12a = hnum > 12 ? hnum - 12 : hnum === 0 ? 12 : hnum;
                    const tl = `${h12a}:${mm} ${suf}`;
                    return (
                      <button key={appt.id}
                        onClick={() => setActiveId(appt.id)}
                        className={cn(
                          "w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors",
                          activeId === appt.id && "bg-green-50 border-l-2 border-green-700"
                        )}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-gray-900 truncate">{appt.name}</div>
                            <div className="text-[11px] text-gray-500 truncate">{appt.email}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ color: sc.text, background: sc.bg }}>
                                {appt.status}
                              </span>
                              {appt.location === "meet"
                                ? <Video className="w-3 h-3 text-blue-400" />
                                : <MapPin className="w-3 h-3 text-red-400" />}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-[11px] font-medium text-gray-700">
                              {new Date(appt.scheduledDate + "T00:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric" })}
                            </div>
                            <div className="text-[10px] text-gray-400">{tl}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      {/* Detail panel */}
      <div className="md:col-span-3">
        {!active ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white h-full flex flex-col items-center justify-center p-12 text-center">
            <User className="w-8 h-8 text-gray-200 mb-3" />
            <div className="text-sm text-gray-400">Select an appointment to view details</div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header card */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-base font-bold text-gray-900">{active.name}</div>
                  <div className="text-sm text-gray-500">{active.email}</div>
                  {active.phone && <div className="text-sm text-gray-500">{active.phone}</div>}
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
                    <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
                    {new Date(active.scheduledDate + "T00:00:00").toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", year:"numeric" })} · {activeTimeLabel}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                    {active.location === "meet"
                      ? <><Video className="w-3.5 h-3.5 text-blue-500" /> Zoom</>
                      : <><MapPin className="w-3.5 h-3.5 text-red-500" /> In-person – Vadodara</>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {active.meetingLink && (
                      <a href={active.meetingLink} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full hover:bg-blue-100 transition-colors">
                        <Video className="w-2.5 h-2.5" /> Join Zoom <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {active.googleCalendarEventId && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-2.5 h-2.5" /> In Google Calendar
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={active.status}
                      onChange={e => handleStatusChange(active.id, e.target.value as UpdateAppointmentBodyStatus)}
                      disabled={updateAppt.isPending}
                      className="text-xs rounded-lg border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none disabled:opacity-50"
                    >
                      {["confirmed","completed","cancelled","noshow"].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => { if (confirm("Delete this appointment?")) { deleteAppt.mutate({ id: active.id }); setActiveId(null); } }}
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => setTranscriptApptId(active.id)}
                    className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Brain className="w-3 h-3" /> AI Transcript & Proposal
                  </button>
                </div>
              </div>
            </div>

            {/* Form responses */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-4">Qualification Answers</div>
              <div className="space-y-3">
                {[
                  { label: "Business Summary", val: active.businessSummary },
                  { label: "Specific Problem", val: active.specificProblem },
                  { label: "Desired Result (3-6 months)", val: active.desiredResult },
                  { label: "Why I Can Help", val: active.whyCanHelp },
                  { label: "Investment Willingness", val: active.investmentWillingness },
                  { label: "Min Investment Confirmation", val: active.minInvestmentConfirm },
                  { label: "How Soon Can They Start", val: active.startSoon },
                  { label: "Business Partner on Call", val: active.businessPartner || "None mentioned" },
                ].map(({ label, val }) => val ? (
                  <div key={label} className="border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</div>
                    <div className="text-xs text-gray-800 leading-relaxed">{val}</div>
                  </div>
                ) : null)}

                {(active.services?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Services Interested In</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(active.services ?? []).map(svc => (
                        <span key={svc} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-800 border border-green-200">
                          {svc}
                        </span>
                      ))}
                    </div>
                    {active.otherService && <div className="text-xs text-gray-600 mt-1">Other: {active.otherService}</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>

    {transcriptApptId !== null && (() => {
      const ta = appointments.find(a => a.id === transcriptApptId);
      return (
        <TranscriptModal
          appointmentId={transcriptApptId}
          clientName={ta?.name}
          company={undefined}
          industry={undefined}
          onClose={() => setTranscriptApptId(null)}
        />
      );
    })()}
    </>
  );
}

// ── CRM Meetings View ─────────────────────────────────────────────────────────

const MEETING_STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "no_show"] as const;

type EditForm = {
  scheduledAt: string;
  duration: number;
  type: typeof MEETING_TYPES[number];
  status: typeof MEETING_STATUSES[number];
  meetingUrl: string;
  notes: string;
};

function toDatetimeLocal(isoStr: string): string {
  const d = new Date(isoStr);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CrmMeetingsView() {
  const { data: meetings = [], isLoading } = useListMeetings();
  const { data: leadsResp } = useListLeads();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateMeeting = useUpdateMeeting();
  const deleteMeeting = useDeleteMeeting();
  const [showModal, setShowModal] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [transcriptMeetingId, setTranscriptMeetingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const activeMeeting = meetings.find(m => m.id === activeId);

  function startEdit(m: MeetingWithLead) {
    const safeStatus = (MEETING_STATUSES as readonly string[]).includes(m.status)
      ? m.status as typeof MEETING_STATUSES[number]
      : "scheduled";
    setEditForm({
      scheduledAt: toDatetimeLocal(m.scheduledAt),
      duration: m.duration,
      type: (MEETING_TYPES.includes(m.type as typeof MEETING_TYPES[number]) ? m.type : "discovery") as typeof MEETING_TYPES[number],
      status: safeStatus,
      meetingUrl: m.meetingUrl ?? "",
      notes: m.notes ?? "",
    });
    setEditError(null);
    setIsEditing(true);
  }

  async function handleSave() {
    if (!activeMeeting || !editForm) return;
    setEditError(null);

    if (!editForm.scheduledAt) {
      setEditError("Please enter a valid date and time.");
      return;
    }
    const parsedDate = new Date(editForm.scheduledAt);
    if (isNaN(parsedDate.getTime())) {
      setEditError("The date and time you entered is invalid.");
      return;
    }
    if (editForm.duration < 15 || editForm.duration > 480) {
      setEditError("Duration must be between 15 and 480 minutes.");
      return;
    }

    const updatedFields = {
      scheduledAt: parsedDate.toISOString(),
      duration: editForm.duration,
      type: editForm.type,
      status: editForm.status,
      meetingUrl: editForm.meetingUrl.trim() || null,
      notes: editForm.notes.trim() || null,
    };

    try {
      await updateMeeting.mutateAsync({
        id: activeMeeting.id,
        data: updatedFields,
      });

      queryClient.setQueryData<MeetingWithLead[]>(
        getListMeetingsQueryKey(),
        (prev) =>
          prev
            ? prev.map((m) =>
                m.id === activeMeeting.id ? { ...m, ...updatedFields } : m
              )
            : prev
      );

      queryClient.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
      setIsEditing(false);
      const savedDateLabel = parsedDate.toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      });
      toast({ title: `Meeting updated — ${savedDateLabel}`, duration: 2000 });
    } catch {
      setEditError("Failed to save changes. Please try again.");
    }
  }

  async function handleDelete(id: number) {
    setDeleteError(null);
    try {
      await deleteMeeting.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
      setConfirmDeleteId(null);
      setActiveId(null);
      toast({ title: "Meeting deleted" });
    } catch {
      setDeleteError("Failed to delete the meeting. Please try again.");
    }
  }

  const handleCreated = (meeting: MeetingWithLead, shouldDownload: boolean) => {
    setShowModal(false);
    setActiveId(meeting.id);
    if (shouldDownload) downloadICS(meeting);
    toast({ title: "Meeting created" });
  };

  const rawLeads = leadsResp?.leads ?? [];
  const leadOptions = rawLeads.map((l: { id: number; firstName: string; lastName: string; company?: string | null }) => ({
    id: l.id,
    firstName: l.firstName ?? "",
    lastName: l.lastName ?? "",
    company: l.company ?? "",
  }));

  function formatMeetingTime(m: MeetingWithLead) {
    const d = new Date(m.scheduledAt);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  }

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 p-3 md:p-6" style={{ minHeight: "calc(100vh - 120px)" }}>
      {showModal && (
        <NewMeetingModal
          leads={leadOptions}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* List panel */}
      <div className="md:col-span-2 rounded-xl border border-gray-200 bg-white flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
            CRM Meetings ({meetings.length})
          </span>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-white px-2.5 py-1.5 rounded-lg transition-all"
            style={{ background: "#1A3D2B" }}
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-50 rounded-lg animate-pulse" />)}
          </div>
        ) : meetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 p-10 text-center">
            <CalendarDays className="w-8 h-8 text-gray-200 mb-3" />
            <div className="text-sm text-gray-400">No CRM meetings yet</div>
            <div className="text-xs text-gray-300 mt-1">Click &ldquo;New&rdquo; to schedule one</div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {meetings.map(m => {
              const sc = statusColor(m.status);
              return (
                <button key={m.id}
                  onClick={() => { setActiveId(m.id); setIsEditing(false); }}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors",
                    activeId === m.id && "bg-green-50 border-l-2 border-green-700"
                  )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-gray-900 truncate">
                        {m.lead ? `${m.lead.firstName} ${m.lead.lastName}` : `Meeting #${m.id}`}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">{m.lead?.company ?? ""}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ color: sc.text, background: sc.bg }}>
                          {m.status}
                        </span>
                        <span className="text-[10px] text-gray-400 capitalize">{m.type.replace(/_/g, " ")}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[11px] font-medium text-gray-700">
                        {new Date(m.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {new Date(m.scheduledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail panel */}
      <div className="md:col-span-3">
        {!activeMeeting ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white h-full flex flex-col items-center justify-center p-12 text-center">
            <CalendarDays className="w-8 h-8 text-gray-200 mb-3" />
            <div className="text-sm text-gray-400">Select a meeting to view details</div>
          </div>
        ) : isEditing && editForm ? (
          /* ── Edit form ── */
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base font-bold text-gray-900">
                  {activeMeeting.lead
                    ? `${activeMeeting.lead.firstName} ${activeMeeting.lead.lastName}`
                    : `Meeting #${activeMeeting.id}`}
                </div>
                {activeMeeting.lead?.company && (
                  <div className="text-sm text-gray-500">{activeMeeting.lead.company}</div>
                )}
              </div>
              <button
                onClick={() => setIsEditing(false)}
                className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
                title="Cancel editing"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const labelCls = "block text-[11px] font-semibold text-gray-600 mb-1";
              const inputCls = "w-full text-sm rounded-lg border border-gray-200 bg-white text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-700/20 focus:border-green-700 transition-colors";
              const setField = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
                setEditForm(f => f ? { ...f, [k]: v } : f);
              return (
                <div className="space-y-3 border-t border-gray-100 pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className={labelCls}>Date &amp; Time</label>
                      <input
                        type="datetime-local"
                        value={editForm.scheduledAt}
                        onChange={e => setField("scheduledAt", e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Duration (min)</label>
                      <input
                        type="number" min={15} max={480}
                        value={editForm.duration}
                        onChange={e => setField("duration", Number(e.target.value))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Meeting Type</label>
                      <select
                        value={editForm.type}
                        onChange={e => setField("type", e.target.value as typeof MEETING_TYPES[number])}
                        className={inputCls}
                      >
                        {MEETING_TYPES.map(t => (
                          <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>Status</label>
                    <select
                      value={editForm.status}
                      onChange={e => setField("status", e.target.value as typeof MEETING_STATUSES[number])}
                      className={inputCls}
                    >
                      {MEETING_STATUSES.map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>Location / Video Link <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input
                      type="text"
                      value={editForm.meetingUrl}
                      onChange={e => setField("meetingUrl", e.target.value)}
                      placeholder="e.g. https://meet.google.com/abc-defg-hij or Conference Room A"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Notes <span className="text-gray-400 font-normal">(optional)</span></label>
                    <textarea
                      rows={3}
                      value={editForm.notes}
                      onChange={e => setField("notes", e.target.value)}
                      className={inputCls + " resize-none"}
                    />
                  </div>

                  {editError && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-red-50 rounded-lg border border-red-100 text-xs text-red-600">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {editError}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={updateMeeting.isPending}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                      style={{ background: "#1A3D2B" }}
                    >
                      {updateMeeting.isPending
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                        : "Save Changes"}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          /* ── Read-only detail view ── */
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-bold text-gray-900">
                  {activeMeeting.lead
                    ? `${activeMeeting.lead.firstName} ${activeMeeting.lead.lastName}`
                    : `Meeting #${activeMeeting.id}`}
                </div>
                {activeMeeting.lead?.company && (
                  <div className="text-sm text-gray-500">{activeMeeting.lead.company}</div>
                )}
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
                  <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
                  {formatMeetingTime(activeMeeting)}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  {activeMeeting.duration} min · <span className="capitalize">{activeMeeting.type.replace(/_/g, " ")}</span>
                </div>
                {activeMeeting.meetingUrl && (
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
                    {activeMeeting.meetingUrl.startsWith("http")
                      ? <Video className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                      : <MapPin className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                    <a href={activeMeeting.meetingUrl.startsWith("http") ? activeMeeting.meetingUrl : undefined}
                      target="_blank" rel="noreferrer"
                      className={cn("truncate max-w-xs", activeMeeting.meetingUrl.startsWith("http") && "text-blue-600 underline hover:text-blue-800")}>
                      {activeMeeting.meetingUrl}
                    </a>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(activeMeeting)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                    title="Edit meeting details"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => downloadICS(activeMeeting)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                    title="Download .ics calendar file"
                  >
                    <Download className="w-3.5 h-3.5" /> Download .ics
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(activeMeeting.id)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                    title="Delete this meeting"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
                {(activeMeeting as MeetingWithLead & { googleCalendarEventId?: string | null }).googleCalendarEventId && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-2.5 h-2.5" /> In Google Calendar
                  </span>
                )}
                <button
                  onClick={() => setTranscriptMeetingId(activeMeeting.id)}
                  className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Brain className="w-3 h-3" /> AI Transcript & Proposal
                </button>
              </div>
            </div>

            {activeMeeting.notes && (
              <div className="border-t border-gray-100 pt-4">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</div>
                <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">{activeMeeting.notes}</div>
              </div>
            )}

            {(activeMeeting.painPoints?.length ?? 0) > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Pain Points</div>
                <div className="flex flex-wrap gap-1.5">
                  {(activeMeeting.painPoints ?? []).map((p, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">{p}</span>
                  ))}
                </div>
              </div>
            )}

            {activeMeeting.nextAction && (
              <div className="border-t border-gray-100 pt-4">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Next Action</div>
                <div className="text-xs text-gray-700">{activeMeeting.nextAction}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {transcriptMeetingId !== null && (() => {
      const tm = meetings.find(m => m.id === transcriptMeetingId);
      return (
        <TranscriptModal
          meetingId={transcriptMeetingId}
          clientName={tm?.lead ? `${tm.lead.firstName} ${tm.lead.lastName}` : undefined}
          company={tm?.lead?.company ?? undefined}
          industry={tm?.lead?.industry ?? undefined}
          onClose={() => setTranscriptMeetingId(null)}
        />
      );
    })()}

    {confirmDeleteId !== null && (() => {
      const tm = meetings.find(m => m.id === confirmDeleteId);
      const label = tm?.lead ? `${tm.lead.firstName} ${tm.lead.lastName}` : `Meeting #${confirmDeleteId}`;
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-gray-900">Delete meeting?</div>
                <div className="text-xs text-gray-500 mt-1">
                  This will permanently remove the meeting with <span className="font-semibold">{label}</span>. This action cannot be undone.
                </div>
              </div>
            </div>
            {deleteError && (
              <div className="flex items-start gap-2 px-3 py-2 bg-red-50 rounded-lg border border-red-100 text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {deleteError}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setConfirmDeleteId(null); setDeleteError(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleteMeeting.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{ background: "#dc2626" }}
              >
                {deleteMeeting.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting…</>
                  : "Delete"}
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    </>
  );
}

// ── Main Meetings page ────────────────────────────────────────────────────────
export default function Meetings() {
  const [mainTab, setMainTab] = useState<"book" | "manage" | "crm">("manage");

  return (
    <div className="min-h-screen" style={{ background: "#f5f5f5" }}>
      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-6 flex items-center gap-1">
        {([
          { key: "book" as const, label: "📅 Book a Meeting", icon: <Calendar className="w-3.5 h-3.5" /> },
          { key: "manage" as const, label: "📋 Manage Bookings", icon: <Users className="w-3.5 h-3.5" /> },
          { key: "crm" as const, label: "🤝 CRM Meetings", icon: <CalendarDays className="w-3.5 h-3.5" /> },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setMainTab(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors -mb-px",
              mainTab === tab.key
                ? "border-green-700 text-green-800"
                : "border-transparent text-gray-400 hover:text-gray-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mainTab === "book" && <BookingWidget />}
      {mainTab === "manage" && <AdminView />}
      {mainTab === "crm" && <CrmMeetingsView />}
    </div>
  );
}

import { useState, useEffect } from "react";
import {
  ChevronLeft, ChevronRight, Clock, Video, MapPin,
  CheckCircle2, Calendar, User, Mail, Phone, Building2,
  Copy, Check
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const SERVICES = [
  "Website / Landing Page",
  "SEO & Google Ranking",
  "Social Media Marketing",
  "Paid Ads (Google/Meta)",
  "Brand Identity & Design",
  "Sales Funnel Strategy",
  "Lead Generation",
  "Other",
];

interface Slot { time: string; label: string }

function pad2(n: number) { return String(n).padStart(2, "0"); }
function toYMD(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

export default function Booking() {
  const today = new Date();
  const [step, setStep]             = useState<1|2|3|4>(1);
  const [calYear, setCalYear]       = useState(today.getFullYear());
  const [calMonth, setCalMonth]     = useState(today.getMonth());
  const [selectedDate, setDate]     = useState<string>("");
  const [selectedSlot, setSlot]     = useState<string>("");
  const [slotLabel, setSlotLabel]   = useState<string>("");
  const [slots, setSlots]           = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [copied, setCopied]         = useState(false);

  const [form, setForm] = useState({
    name: "", email: "", phone: "",
    businessSummary: "", specificProblem: "", desiredResult: "",
    investmentWillingness: "", location: "google_meet",
    services: [] as string[], otherService: "",
  });

  function setField(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  function toggleService(s: string) {
    setForm(f => ({
      ...f,
      services: f.services.includes(s) ? f.services.filter(x => x !== s) : [...f.services, s],
    }));
  }

  async function loadSlots(date: string) {
    setSlotsLoading(true);
    setSlots([]);
    try {
      const r = await fetch(`/api/appointments/slots?date=${date}`);
      const j = await r.json();
      setSlots(j.slots ?? []);
    } catch { setSlots([]); }
    setSlotsLoading(false);
  }

  function pickDate(date: string) {
    setDate(date);
    setSlot("");
    setSlotLabel("");
    loadSlots(date);
    setStep(2);
  }

  function pickSlot(slot: Slot) {
    setSlot(slot.time);
    setSlotLabel(slot.label);
    setStep(3);
  }

  async function submit() {
    if (!form.name || !form.email) { setSubmitError("Name and email are required."); return; }
    setSubmitting(true);
    setSubmitError("");
    try {
      const r = await fetch(`/api/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, email: form.email, phone: form.phone || undefined,
          scheduledDate: selectedDate, scheduledTime: selectedSlot,
          location: form.location,
          businessSummary: form.businessSummary || undefined,
          specificProblem: form.specificProblem || undefined,
          desiredResult: form.desiredResult || undefined,
          investmentWillingness: form.investmentWillingness || undefined,
          services: form.services,
          otherService: form.otherService || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setSubmitError(j.error ?? "Booking failed. Please try again."); }
      else setStep(4);
    } catch { setSubmitError("Network error. Please try again."); }
    setSubmitting(false);
  }

  // Build calendar days
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayYMD = toYMD(today);

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y-1); setCalMonth(11); }
    else setCalMonth(m => m-1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y+1); setCalMonth(0); }
    else setCalMonth(m => m+1);
  }

  const dateLabel = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" })
    : "";

  const bookingUrl = typeof window !== "undefined"
    ? window.location.href.split("?")[0]
    : "";

  function copyLink() {
    navigator.clipboard.writeText(bookingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(135deg, #0f1c14 0%, #1a0a2e 100%)" }}>
      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5C1A8C,#E91E8C)" }}>
            <Calendar className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-[15px] leading-tight">Dreamsdesign</div>
            <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>dreamsdesign.in</div>
          </div>
        </div>
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
          style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied!" : "Copy link"}
        </button>
      </header>

      {/* Card */}
      <div className="flex-1 flex items-start justify-center px-4 py-6">
        <div className="w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#fff" }}>
          <div className="flex flex-col md:flex-row">

            {/* Left panel — always visible */}
            <div className="md:w-72 flex-shrink-0 p-8" style={{ background: "linear-gradient(160deg, #1A3D2B 0%, #0d2419 100%)" }}>
              <div className="w-12 h-12 rounded-xl mb-5 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.12)" }}>
                <User className="w-6 h-6 text-white" />
              </div>
              <div className="text-white font-bold text-[18px] leading-snug mb-1">Krish Puranik</div>
              <div className="text-[13px] mb-1" style={{ color: "rgba(255,255,255,0.6)" }}>Founder CEO · Dreamsdesign</div>
              <div className="text-[13px] mb-5 font-semibold" style={{ color: "#E91E8C" }}>Your Digital Growth Consultant</div>

              <div className="text-[13px] mb-6 leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
                Book a free 45-minute Growth Discovery Call to explore how Dreamsdesign can help your business grow online — more leads, more sales, guaranteed.
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 flex-shrink-0" style={{ color: "#E91E8C" }} />
                  <span className="text-[13px] text-white">45 minutes</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Video className="w-4 h-4 flex-shrink-0" style={{ color: "#E91E8C" }} />
                  <span className="text-[13px] text-white">Google Meet / In-person (Vadodara)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: "#E91E8C" }} />
                  <span className="text-[13px] text-white">Mon – Sat · 10 AM – 5 PM IST</span>
                </div>
              </div>

              {selectedDate && step >= 2 && (
                <div className="mt-8 pt-6 border-t" style={{ borderColor: "rgba(255,255,255,0.15)" }}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>Selected</div>
                  <div className="text-[13px] font-semibold text-white">{dateLabel}</div>
                  {selectedSlot && (
                    <div className="text-[13px] font-bold mt-1" style={{ color: "#E91E8C" }}>{slotLabel} IST</div>
                  )}
                </div>
              )}
            </div>

            {/* Right panel — steps */}
            <div className="flex-1 p-8">

              {/* Step indicators */}
              <div className="flex items-center gap-2 mb-8">
                {[
                  { n: 1, label: "Date" },
                  { n: 2, label: "Time" },
                  { n: 3, label: "Details" },
                ].map(({ n, label }, i) => (
                  <div key={n} className="flex items-center gap-2">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all",
                    )} style={
                      step > n
                        ? { background: "#1A3D2B", color: "#fff" }
                        : step === n
                        ? { background: "#5C1A8C", color: "#fff" }
                        : { background: "#F3F4F6", color: "#9CA3AF" }
                    }>
                      {step > n ? <Check className="w-3 h-3" /> : n}
                    </div>
                    <span className="text-[12px] font-medium" style={{ color: step === n ? "#111827" : "#9CA3AF" }}>
                      {label}
                    </span>
                    {i < 2 && <div className="w-8 h-px mx-1" style={{ background: "#E5E7EB" }} />}
                  </div>
                ))}
              </div>

              {/* ── Step 1: Calendar ── */}
              {step === 1 && (
                <div>
                  <div className="text-[17px] font-bold mb-1" style={{ color: "#111827" }}>Select a date</div>
                  <div className="text-[13px] mb-6" style={{ color: "#6B7280" }}>Choose an available day for your session</div>

                  <div className="flex items-center justify-between mb-4">
                    <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100">
                      <ChevronLeft className="w-4 h-4" style={{ color: "#374151" }} />
                    </button>
                    <div className="text-[14px] font-semibold" style={{ color: "#111827" }}>
                      {MONTHS[calMonth]} {calYear}
                    </div>
                    <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100">
                      <ChevronRight className="w-4 h-4" style={{ color: "#374151" }} />
                    </button>
                  </div>

                  {/* Day headers */}
                  <div className="grid grid-cols-7 mb-2">
                    {DAYS.map(d => (
                      <div key={d} className="text-center text-[11px] font-semibold py-1" style={{ color: "#9CA3AF" }}>{d}</div>
                    ))}
                  </div>

                  {/* Calendar grid */}
                  <div className="grid grid-cols-7 gap-0.5">
                    {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const dateStr = `${calYear}-${pad2(calMonth+1)}-${pad2(day)}`;
                      const dObj = new Date(dateStr + "T00:00:00");
                      const isSunday = dObj.getDay() === 0;
                      const isPast  = dateStr < todayYMD;
                      const disabled = isSunday || isPast;
                      const isSelected = dateStr === selectedDate;
                      const isToday = dateStr === todayYMD;

                      return (
                        <button
                          key={day}
                          disabled={disabled}
                          onClick={() => !disabled && pickDate(dateStr)}
                          className={cn(
                            "aspect-square flex items-center justify-center rounded-full text-[13px] font-medium transition-all",
                            disabled ? "cursor-not-allowed opacity-30" : "hover:bg-purple-50",
                          )}
                          style={
                            isSelected
                              ? { background: "#5C1A8C", color: "#fff" }
                              : isToday
                              ? { background: "#F0FDF4", color: "#1A3D2B", fontWeight: 700 }
                              : disabled
                              ? { color: "#D1D5DB" }
                              : { color: "#374151" }
                          }
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex items-center gap-4 text-[11px]" style={{ color: "#9CA3AF" }}>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full inline-block" style={{ background: "#F0FDF4" }} /> Today</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full inline-block" style={{ background: "#5C1A8C" }} /> Selected</span>
                    <span>Sundays unavailable</span>
                  </div>
                </div>
              )}

              {/* ── Step 2: Time slots ── */}
              {step === 2 && (
                <div>
                  <button onClick={() => setStep(1)} className="flex items-center gap-1 text-[13px] mb-4 font-medium" style={{ color: "#6B7280" }}>
                    <ChevronLeft className="w-4 h-4" /> Back to calendar
                  </button>
                  <div className="text-[17px] font-bold mb-1" style={{ color: "#111827" }}>Select a time</div>
                  <div className="text-[13px] mb-6" style={{ color: "#6B7280" }}>All times shown in IST (India Standard Time)</div>

                  {slotsLoading ? (
                    <div className="flex items-center gap-2 text-[13px]" style={{ color: "#9CA3AF" }}>
                      <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                      Loading available slots…
                    </div>
                  ) : slots.length === 0 ? (
                    <div className="text-center py-10">
                      <div className="text-[14px] font-semibold mb-1" style={{ color: "#374151" }}>No slots available</div>
                      <div className="text-[13px]" style={{ color: "#9CA3AF" }}>Please select a different date</div>
                      <button onClick={() => setStep(1)} className="mt-4 px-4 py-2 rounded-lg text-[13px] font-medium" style={{ background: "#5C1A8C", color: "#fff" }}>
                        Back to calendar
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {slots.map(s => (
                        <button
                          key={s.time}
                          onClick={() => pickSlot(s)}
                          className="py-3 px-4 rounded-xl text-[14px] font-semibold border-2 transition-all"
                          style={
                            selectedSlot === s.time
                              ? { background: "#5C1A8C", color: "#fff", borderColor: "#5C1A8C" }
                              : { background: "#fff", color: "#374151", borderColor: "#E5E7EB" }
                          }
                          onMouseEnter={e => { if (selectedSlot !== s.time) (e.currentTarget as HTMLElement).style.borderColor = "#5C1A8C"; }}
                          onMouseLeave={e => { if (selectedSlot !== s.time) (e.currentTarget as HTMLElement).style.borderColor = "#E5E7EB"; }}
                        >
                          {s.label} IST
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 3: Details form ── */}
              {step === 3 && (
                <div>
                  <button onClick={() => setStep(2)} className="flex items-center gap-1 text-[13px] mb-4 font-medium" style={{ color: "#6B7280" }}>
                    <ChevronLeft className="w-4 h-4" /> Back to time slots
                  </button>
                  <div className="text-[17px] font-bold mb-1" style={{ color: "#111827" }}>Your details</div>
                  <div className="text-[13px] mb-6" style={{ color: "#6B7280" }}>Help us prepare the most valuable session for you</div>

                  <div className="space-y-4">
                    {/* Contact */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[12px] font-semibold mb-1" style={{ color: "#374151" }}>Full Name *</label>
                        <div className="flex items-center gap-2 border rounded-xl px-3 py-2.5" style={{ borderColor: "#E5E7EB" }}>
                          <User className="w-4 h-4 flex-shrink-0" style={{ color: "#9CA3AF" }} />
                          <input value={form.name} onChange={e => setField("name", e.target.value)}
                            placeholder="Rahul Sharma" className="flex-1 text-[13px] outline-none" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold mb-1" style={{ color: "#374151" }}>Email *</label>
                        <div className="flex items-center gap-2 border rounded-xl px-3 py-2.5" style={{ borderColor: "#E5E7EB" }}>
                          <Mail className="w-4 h-4 flex-shrink-0" style={{ color: "#9CA3AF" }} />
                          <input value={form.email} onChange={e => setField("email", e.target.value)}
                            type="email" placeholder="rahul@company.com" className="flex-1 text-[13px] outline-none" />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[12px] font-semibold mb-1" style={{ color: "#374151" }}>Phone / WhatsApp</label>
                        <div className="flex items-center gap-2 border rounded-xl px-3 py-2.5" style={{ borderColor: "#E5E7EB" }}>
                          <Phone className="w-4 h-4 flex-shrink-0" style={{ color: "#9CA3AF" }} />
                          <input value={form.phone} onChange={e => setField("phone", e.target.value)}
                            placeholder="+91 98765 43210" className="flex-1 text-[13px] outline-none" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold mb-1" style={{ color: "#374151" }}>Meeting type</label>
                        <div className="flex gap-2 mt-1">
                          {[{ val:"google_meet", label:"Google Meet", icon: Video }, { val:"inperson", label:"In-person", icon: MapPin }].map(({ val, label, icon: Icon }) => (
                            <button key={val} onClick={() => setField("location", val)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold border-2 transition-all"
                              style={form.location === val ? { background: "#1A3D2B", color: "#fff", borderColor: "#1A3D2B" } : { color: "#374151", borderColor: "#E5E7EB" }}>
                              <Icon className="w-3.5 h-3.5" />{label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Services */}
                    <div>
                      <label className="block text-[12px] font-semibold mb-2" style={{ color: "#374151" }}>What do you need help with?</label>
                      <div className="flex flex-wrap gap-2">
                        {SERVICES.map(s => (
                          <button key={s} onClick={() => toggleService(s)}
                            className="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all"
                            style={form.services.includes(s)
                              ? { background: "#5C1A8C", color: "#fff", borderColor: "#5C1A8C" }
                              : { background: "#fff", color: "#374151", borderColor: "#E5E7EB" }}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Business summary */}
                    <div>
                      <label className="block text-[12px] font-semibold mb-1" style={{ color: "#374151" }}>Tell us about your business</label>
                      <textarea value={form.businessSummary} onChange={e => setField("businessSummary", e.target.value)}
                        rows={2} placeholder="What do you do, who do you serve, how long have you been in business?"
                        className="w-full border rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none" style={{ borderColor: "#E5E7EB" }} />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold mb-1" style={{ color: "#374151" }}>What's your biggest growth challenge?</label>
                      <textarea value={form.specificProblem} onChange={e => setField("specificProblem", e.target.value)}
                        rows={2} placeholder="Not enough leads, low website traffic, poor conversions…"
                        className="w-full border rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none" style={{ borderColor: "#E5E7EB" }} />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold mb-1" style={{ color: "#374151" }}>Desired outcome from working with us</label>
                      <textarea value={form.desiredResult} onChange={e => setField("desiredResult", e.target.value)}
                        rows={2} placeholder="10x more leads, 2× revenue in 6 months, rank #1 on Google…"
                        className="w-full border rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none" style={{ borderColor: "#E5E7EB" }} />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold mb-1" style={{ color: "#374151" }}>Investment range (monthly)</label>
                      <div className="flex flex-wrap gap-2">
                        {["Under ₹25k", "₹25k–₹50k", "₹50k–₹1L", "₹1L–₹2L", "₹2L+", "Happy to discuss"].map(opt => (
                          <button key={opt} onClick={() => setField("investmentWillingness", opt)}
                            className="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all"
                            style={form.investmentWillingness === opt
                              ? { background: "#1A3D2B", color: "#fff", borderColor: "#1A3D2B" }
                              : { background: "#fff", color: "#374151", borderColor: "#E5E7EB" }}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    {submitError && (
                      <div className="px-3 py-2.5 rounded-xl text-[13px] font-medium" style={{ background: "#FEF2F2", color: "#DC2626" }}>
                        {submitError}
                      </div>
                    )}

                    <button
                      onClick={submit}
                      disabled={submitting}
                      className="w-full py-3.5 rounded-xl text-[15px] font-bold text-white transition-all disabled:opacity-60"
                      style={{ background: "linear-gradient(135deg, #5C1A8C, #E91E8C)" }}
                    >
                      {submitting ? "Confirming your booking…" : "Confirm Booking →"}
                    </button>
                    <p className="text-center text-[11px]" style={{ color: "#9CA3AF" }}>
                      A confirmation email will be sent instantly to your inbox.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Step 4: Confirmed ── */}
              {step === 4 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: "#F0FDF4" }}>
                    <CheckCircle2 className="w-9 h-9" style={{ color: "#16a34a" }} />
                  </div>
                  <div className="text-[22px] font-bold mb-2" style={{ color: "#111827" }}>You're booked!</div>
                  <div className="text-[14px] mb-6" style={{ color: "#6B7280", maxWidth: 340 }}>
                    A confirmation email has been sent to <strong>{form.email}</strong>. We look forward to speaking with you!
                  </div>

                  <div className="w-full max-w-sm rounded-2xl border p-5 mb-6 text-left" style={{ borderColor: "#E5E7EB" }}>
                    <div className="text-[12px] font-semibold uppercase tracking-wide mb-3" style={{ color: "#9CA3AF" }}>Booking Summary</div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-[13px]">
                        <span style={{ color: "#6B7280" }}>Date</span>
                        <span className="font-semibold" style={{ color: "#111827" }}>{dateLabel}</span>
                      </div>
                      <div className="flex justify-between text-[13px]">
                        <span style={{ color: "#6B7280" }}>Time</span>
                        <span className="font-semibold" style={{ color: "#111827" }}>{slotLabel} IST</span>
                      </div>
                      <div className="flex justify-between text-[13px]">
                        <span style={{ color: "#6B7280" }}>Duration</span>
                        <span className="font-semibold" style={{ color: "#111827" }}>45 minutes</span>
                      </div>
                      <div className="flex justify-between text-[13px]">
                        <span style={{ color: "#6B7280" }}>Format</span>
                        <span className="font-semibold" style={{ color: "#111827" }}>{form.location === "google_meet" ? "Google Meet" : "In-person"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-[13px] font-semibold mb-1" style={{ color: "#374151" }}>Krish Puranik – Founder CEO</div>
                  <div className="text-[12px]" style={{ color: "#9CA3AF" }}>Your Digital Growth Consultant · dreamsdesign.in</div>
                  <div className="mt-6 text-[12px]" style={{ color: "#E91E8C" }}>With us your growth is guaranteed.</div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="py-4 text-center text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
        Powered by Dreamsdesign Sales War Machine · dreamsdesign.in
      </div>
    </div>
  );
}

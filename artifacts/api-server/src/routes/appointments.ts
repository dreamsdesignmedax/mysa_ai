import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { appointments } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod/v4";
import rateLimit from "express-rate-limit";
import { sendViaBrevo } from "../lib/brevo";
import { createGoogleMeetForAppointment, syncAppointmentToCalendar } from "../lib/calendar-sync";

const router = Router();

// Public booking endpoint: 10 submissions per 15 minutes per IP
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking attempts. Please try again later." },
});

// ── Slot generation ──────────────────────────────────────────────────────────
// Available Mon-Sat, 45-min slots, 10:00 AM – 5:00 PM IST
const ALL_SLOTS = [
  "10:00", "10:45", "11:30", "12:15",
  "13:00", "13:45", "14:30", "15:15",
  "16:00", "16:45",
];

function formatSlot(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun, 6=Sat
  return day === 0;       // block only Sunday
}

// ── GET /appointments/slots?date=YYYY-MM-DD&orgId=1 ──────────────────────────
router.get("/appointments/slots", async (req: Request, res: Response): Promise<void> => {
  const { date } = req.query as { date?: string };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
    return;
  }

  // Resolve org: authenticated user → their org; public form → always default org (1).
  // Callers must not be able to probe another tenant's availability by supplying an orgId.
  const orgId = req.user?.orgId ?? 1;

  // Sundays unavailable
  if (isWeekend(date)) {
    res.json({ date, slots: [] });
    return;
  }

  // Don't allow past dates
  const today = new Date().toISOString().split("T")[0];
  if (date < today) {
    res.json({ date, slots: [] });
    return;
  }

  // Fetch already-booked slots for this org only
  const booked = await db
    .select({ scheduledTime: appointments.scheduledTime })
    .from(appointments)
    .where(
      and(
        eq(appointments.orgId, orgId),
        eq(appointments.scheduledDate, date),
        eq(appointments.status, "confirmed")
      )
    );
  const bookedTimes = new Set(booked.map((b) => b.scheduledTime));

  const available = ALL_SLOTS.filter((s) => !bookedTimes.has(s)).map((s) => ({
    time: s,
    label: formatSlot(s),
  }));

  res.json({ date, slots: available });
});

// ── GET /appointments ─────────────────────────────────────────────────────────
router.get("/appointments", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const rows = await db
    .select()
    .from(appointments)
    .where(eq(appointments.orgId, orgId))
    .orderBy(desc(appointments.scheduledDate), desc(appointments.scheduledTime));
  res.json(rows);
});

// ── POST /appointments ────────────────────────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.enum(["google_meet", "inperson"]).default("google_meet"),
  businessSummary: z.string().optional(),
  specificProblem: z.string().optional(),
  desiredResult: z.string().optional(),
  whyCanHelp: z.string().optional(),
  investmentWillingness: z.string().optional(),
  minInvestmentConfirm: z.string().optional(),
  startSoon: z.string().optional(),
  businessPartner: z.string().optional(),
  services: z.array(z.string()).optional().default([]),
  otherService: z.string().optional(),
});

router.post("/appointments", bookingLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  // Resolve org: authenticated token wins; public form always uses default org (1).
  // Never accept a caller-supplied orgId — that would let unauthenticated callers
  // create appointments for arbitrary tenants.
  const orgId = req.user?.orgId ?? 1;

  // Check if slot is still available within this org's calendar
  const existing = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.orgId, orgId),
        eq(appointments.scheduledDate, data.scheduledDate),
        eq(appointments.scheduledTime, data.scheduledTime),
        eq(appointments.status, "confirmed")
      )
    );
  if (existing.length > 0) {
    res.status(409).json({ error: "This time slot is no longer available. Please pick another." });
    return;
  }

  const [appt] = await db
    .insert(appointments)
    .values({
      ...data,
      orgId,
      services: data.services ?? [],
      status: "confirmed",
    })
    .returning();

  // Fire-and-forget: create Google Meet + Calendar event + send email
  (async () => {
    let meetingLink: string | null = null;
    let calEventId: string | null = null;

    if (data.location === "google_meet") {
      // createGoogleMeetForAppointment creates the Calendar event AND the Meet link in one call
      const meet = await createGoogleMeetForAppointment(appt).catch(() => null);
      if (meet) {
        meetingLink = meet.joinUrl;
        calEventId = meet.calEventId;
        await db.update(appointments).set({ meetingLink, googleCalendarEventId: calEventId }).where(eq(appointments.id, appt.id));
      }
    } else {
      // In-person: just sync to calendar (no Meet link)
      calEventId = await syncAppointmentToCalendar(appt, null).catch(() => null);
      if (calEventId) {
        await db.update(appointments).set({ googleCalendarEventId: calEventId }).where(eq(appointments.id, appt.id));
      }
    }

    const finalAppt = { ...appt, meetingLink, googleCalendarEventId: calEventId };
    sendConfirmationEmail(finalAppt).catch(() => {});
  })();

  res.status(201).json(appt);
});

// ── PATCH /appointments/:id ───────────────────────────────────────────────────
router.patch("/appointments/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const schema = z.object({
    status: z.enum(["confirmed", "cancelled", "completed", "noshow"]).optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed" }); return; }

  const orgId = req.user!.orgId;
  const [updated] = await db
    .update(appointments)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(appointments.id, id), eq(appointments.orgId, orgId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── DELETE /appointments/:id ──────────────────────────────────────────────────
router.delete("/appointments/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const orgId = req.user!.orgId;
  await db.delete(appointments).where(and(eq(appointments.id, id), eq(appointments.orgId, orgId)));
  res.json({ ok: true });
});

// ── Confirmation email helper ─────────────────────────────────────────────────
async function sendConfirmationEmail(appt: typeof appointments.$inferSelect & { meetingLink?: string | null; googleCalendarEventId?: string | null }) {

  const dateLabel = new Date(appt.scheduledDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const [hStr, mStr] = appt.scheduledTime.split(":");
  const h = Number(hStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const timeLabel = `${h12}:${mStr} ${suffix} IST`;
  const locationLabel = appt.location === "google_meet"
    ? (appt.meetingLink ? `Google Meet – <a href="${appt.meetingLink}" style="color:#5C1A8C;">${appt.meetingLink}</a>` : "Google Meet (link will be shared before the call)")
    : "In-person – Vadodara";

  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#1A3D2B 0%,#5C1A8C 100%);padding:28px 32px;">
    <div style="font-size:22px;font-weight:700;color:#fff;">Booking Confirmed ✓</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:4px;">Growth Discovery Call with Krish Puranik - Founder CEO</div>
  </div>
  <div style="padding:28px 32px;">
    <p style="font-size:15px;color:#333;margin:0 0 16px;">Hi ${appt.name},</p>
    <p style="font-size:14px;color:#555;margin:0 0 24px;">Your 45-minute Growth Discovery Call has been confirmed. Here are your booking details:</p>
    <div style="background:#f9f9f9;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-size:13px;color:#888;width:110px;">Date</td><td style="padding:6px 0;font-size:13px;color:#222;font-weight:600;">${dateLabel}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#888;">Time</td><td style="padding:6px 0;font-size:13px;color:#222;font-weight:600;">${timeLabel}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#888;">Duration</td><td style="padding:6px 0;font-size:13px;color:#222;font-weight:600;">45 minutes</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#888;">Location</td><td style="padding:6px 0;font-size:13px;color:#222;font-weight:600;">${locationLabel}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#666;margin:0 0 8px;">Please make sure to be available at the scheduled time. If you need to reschedule, reply to this email.</p>
    <p style="font-size:13px;color:#666;margin:0 0 24px;">Can't wait to speak with you! =)</p>
    <p style="font-size:14px;color:#333;margin:0;">Best,<br><strong>Krish Puranik - Founder CEO</strong><br>Your Digital Growth Consultant at Dreamsdesign<br>dreamsdesign.in | krishna@dreamsdesign.in</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;text-align:center;font-size:11px;color:#aaa;">
    Dreamsdesign · krishna@dreamsdesign.in · dreamsdesign.in
  </div>
</div>
</body></html>`;

  await sendViaBrevo({
    senderName: "Krish Puranik – Dreamsdesign",
    senderEmail: "info@dreamsdesign.ca",
    to: [{ email: appt.email, name: appt.name }],
    bcc: [{ email: "sales@dreamsdesign.co" }],
    replyTo: "krishna@dreamsdesign.in",
    subject: `Confirmed: Growth Discovery Call – ${dateLabel} at ${timeLabel}`,
    htmlContent: html,
    textContent: `Hi ${appt.name},\n\nYour Growth Discovery Call is confirmed!\n\nDate: ${dateLabel}\nTime: ${timeLabel}\nDuration: 45 minutes\nLocation: ${locationLabel}\n\nBest,\nKrish Puranik - Founder CEO\nYour Digital Growth Consultant at Dreamsdesign\ndreamsdesign.in | krishna@dreamsdesign.in`,
  });
}

export default router;

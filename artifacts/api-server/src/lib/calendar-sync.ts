// Calendar sync helpers — uses Replit Connectors SDK for Google Calendar (no manual OAuth tokens needed)
import { logger } from "./logger";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  isGoogleCalendarConnected,
  type CalendarEventData,
} from "./google-calendar";

export { isGoogleCalendarConnected };

export function buildCallbackUrl(req: { headers: { host?: string }; protocol: string }): string {
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;
  if (replitDomain) {
    return `https://${replitDomain}/sales-war-machine/api/integrations/google/callback`;
  }
  const host = req.headers.host ?? "localhost:8080";
  return `${req.protocol}://${host}/api/integrations/google/callback`;
}

interface AppointmentLike {
  id: number;
  name: string;
  email: string;
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: number;
  businessSummary?: string | null;
  location?: string | null;
}

interface MeetingLike {
  id: number;
  scheduledAt: Date;
  duration: number;
  type: string;
  meetingUrl?: string | null;
  googleCalendarEventId?: string | null;
}

interface LeadLike {
  firstName: string;
  lastName: string;
  email?: string | null;
  company?: string;
}

export async function syncAppointmentToCalendar(
  appt: AppointmentLike,
  meetingLink?: string | null
): Promise<string | null> {
  try {
    const connected = await isGoogleCalendarConnected();
    if (!connected) return null;

    const [hStr, mStr] = appt.scheduledTime.split(":");
    const startDateTime = `${appt.scheduledDate}T${hStr.padStart(2, "0")}:${mStr.padStart(2, "0")}:00+05:30`;
    const endDate = new Date(`${appt.scheduledDate}T${hStr.padStart(2, "0")}:${mStr.padStart(2, "0")}:00`);
    endDate.setMinutes(endDate.getMinutes() + (appt.durationMinutes ?? 45));
    const endH = String(endDate.getHours()).padStart(2, "0");
    const endM = String(endDate.getMinutes()).padStart(2, "0");
    const endDateTime = `${appt.scheduledDate}T${endH}:${endM}:00+05:30`;

    const data: CalendarEventData = {
      summary: `Discovery Call with ${appt.name} – Dreamsdesign`,
      description: [
        `Client: ${appt.name} <${appt.email}>`,
        appt.businessSummary ? `Business: ${appt.businessSummary}` : "",
        meetingLink ? `Join: ${meetingLink}` : "",
        "Booked via Mysa AI Sales Platform",
      ].filter(Boolean).join("\n"),
      startDateTime,
      endDateTime,
      attendeeEmail: appt.email,
      attendeeName: appt.name,
      meetingUrl: meetingLink ?? undefined,
      location: meetingLink ?? (appt.location === "inperson" ? "Dreamsdesign – Vadodara" : undefined),
    };

    const event = await createCalendarEvent(data);
    return event.id;
  } catch (err) {
    logger.error({ err }, "syncAppointmentToCalendar failed");
    return null;
  }
}

export async function syncMeetingToCalendar(
  meeting: MeetingLike,
  lead: LeadLike
): Promise<string | null> {
  try {
    const connected = await isGoogleCalendarConnected();
    if (!connected) return null;

    const startDateTime = meeting.scheduledAt.toISOString();
    const endDate = new Date(meeting.scheduledAt.getTime() + meeting.duration * 60_000);
    const endDateTime = endDate.toISOString();

    const data: CalendarEventData = {
      summary: `${meeting.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} – ${lead.firstName} ${lead.lastName} (${lead.company ?? ""})`,
      description: [
        `Client: ${lead.firstName} ${lead.lastName}`,
        lead.email ? `Email: ${lead.email}` : "",
        meeting.meetingUrl ? `Join: ${meeting.meetingUrl}` : "",
      ].filter(Boolean).join("\n"),
      startDateTime,
      endDateTime,
      attendeeEmail: lead.email ?? undefined,
      attendeeName: `${lead.firstName} ${lead.lastName}`,
      meetingUrl: meeting.meetingUrl ?? undefined,
    };

    if (meeting.googleCalendarEventId) {
      const updated = await updateCalendarEvent(meeting.googleCalendarEventId, data);
      return updated.id;
    }
    const event = await createCalendarEvent(data);
    return event.id;
  } catch (err) {
    logger.error({ err }, "syncMeetingToCalendar failed");
    return null;
  }
}

export async function deleteCalendarEventById(eventId: string): Promise<void> {
  try {
    const connected = await isGoogleCalendarConnected();
    if (!connected) return;
    await deleteCalendarEvent(eventId);
  } catch (err) {
    logger.error({ err }, "deleteCalendarEventById failed");
  }
}

// Creates a Google Calendar event with an auto-generated Google Meet link.
// Returns both the Meet join URL and the calendar event ID in one call.
export async function createGoogleMeetForAppointment(
  appt: AppointmentLike
): Promise<{ joinUrl: string; calEventId: string } | null> {
  const connected = await isGoogleCalendarConnected();
  if (!connected) return null;
  try {
    const [hStr, mStr] = appt.scheduledTime.split(":");
    const startDateTime = `${appt.scheduledDate}T${hStr.padStart(2, "0")}:${mStr.padStart(2, "0")}:00+05:30`;
    const endDate = new Date(`${appt.scheduledDate}T${hStr.padStart(2, "0")}:${mStr.padStart(2, "0")}:00`);
    endDate.setMinutes(endDate.getMinutes() + (appt.durationMinutes ?? 45));
    const endH = String(endDate.getHours()).padStart(2, "0");
    const endM = String(endDate.getMinutes()).padStart(2, "0");
    const endDateTime = `${appt.scheduledDate}T${endH}:${endM}:00+05:30`;

    const event = await createCalendarEvent({
      summary: `Discovery Call with ${appt.name} – Dreamsdesign`,
      description: [
        `Client: ${appt.name} <${appt.email}>`,
        appt.businessSummary ? `Business: ${appt.businessSummary}` : "",
        "Booked via Mysa AI Sales Platform",
      ].filter(Boolean).join("\n"),
      startDateTime,
      endDateTime,
      attendeeEmail: appt.email,
      attendeeName: appt.name,
      // No meetingUrl → createCalendarEvent adds conferenceData → Google Meet auto-generated
    });

    const joinUrl = event.hangoutLink ?? "";
    return joinUrl ? { joinUrl, calEventId: event.id } : null;
  } catch (err) {
    logger.error({ err }, "createGoogleMeetForAppointment failed");
    return null;
  }
}

// Creates a Google Calendar event with an auto-generated Google Meet link for a pipeline meeting.
export async function createGoogleMeetForMeeting(
  meeting: MeetingLike,
  lead: LeadLike
): Promise<{ joinUrl: string; calEventId: string } | null> {
  const connected = await isGoogleCalendarConnected();
  if (!connected) return null;
  try {
    const startDateTime = meeting.scheduledAt.toISOString();
    const endDate = new Date(meeting.scheduledAt.getTime() + meeting.duration * 60_000);
    const endDateTime = endDate.toISOString();

    const event = await createCalendarEvent({
      summary: `${meeting.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} – ${lead.firstName} ${lead.lastName} (${lead.company ?? ""})`,
      description: [
        `Client: ${lead.firstName} ${lead.lastName}`,
        lead.email ? `Email: ${lead.email}` : "",
      ].filter(Boolean).join("\n"),
      startDateTime,
      endDateTime,
      attendeeEmail: lead.email ?? undefined,
      attendeeName: `${lead.firstName} ${lead.lastName}`,
      // No meetingUrl → conferenceData → Google Meet auto-generated
    });

    const joinUrl = event.hangoutLink ?? "";
    return joinUrl ? { joinUrl, calEventId: event.id } : null;
  } catch (err) {
    logger.error({ err }, "createGoogleMeetForMeeting failed");
    return null;
  }
}

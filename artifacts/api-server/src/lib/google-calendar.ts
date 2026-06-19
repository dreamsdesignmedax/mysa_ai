// Google Calendar via Replit Connectors SDK
// OAuth2 tokens are injected and refreshed automatically — no GOOGLE_CLIENT_ID/SECRET needed.
import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export interface CalendarEventData {
  summary: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  attendeeEmail?: string;
  attendeeName?: string;
  meetingUrl?: string;
  location?: string;
}

export interface CalendarEvent {
  id: string;
  htmlLink: string;
  hangoutLink?: string;
}

export async function isGoogleCalendarConnected(): Promise<boolean> {
  try {
    const res = await connectors.proxy("google-calendar", "/users/me/calendarList?maxResults=1");
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

export async function createCalendarEvent(data: CalendarEventData): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {
    summary: data.summary,
    description: data.description ?? "",
    start: { dateTime: data.startDateTime, timeZone: "Asia/Kolkata" },
    end: { dateTime: data.endDateTime, timeZone: "Asia/Kolkata" },
    location: data.location ?? data.meetingUrl ?? "",
  };

  if (!data.meetingUrl) {
    body.conferenceData = {
      createRequest: {
        requestId: `mysa-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  if (data.attendeeEmail) {
    body.attendees = [{ email: data.attendeeEmail, displayName: data.attendeeName ?? "" }];
  }

  const res = await connectors.proxy(
    "google-calendar",
    "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    { method: "POST", body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Calendar createEvent failed (${res.status}): ${err}`);
  }

  return res.json() as Promise<CalendarEvent>;
}

export async function updateCalendarEvent(
  eventId: string,
  data: Partial<CalendarEventData>
): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {};
  if (data.summary) body.summary = data.summary;
  if (data.description !== undefined) body.description = data.description;
  if (data.startDateTime) body.start = { dateTime: data.startDateTime, timeZone: "Asia/Kolkata" };
  if (data.endDateTime) body.end = { dateTime: data.endDateTime, timeZone: "Asia/Kolkata" };
  if (data.meetingUrl) body.location = data.meetingUrl;

  const res = await connectors.proxy(
    "google-calendar",
    `/calendars/primary/events/${eventId}?sendUpdates=all`,
    { method: "PATCH", body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Calendar updateEvent failed (${res.status}): ${err}`);
  }

  return res.json() as Promise<CalendarEvent>;
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const res = await connectors.proxy(
    "google-calendar",
    `/calendars/primary/events/${eventId}?sendUpdates=all`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const err = await res.text();
    throw new Error(`Google Calendar deleteEvent failed (${res.status}): ${err}`);
  }
}

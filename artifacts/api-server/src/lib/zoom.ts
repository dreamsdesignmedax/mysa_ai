const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_API = "https://api.zoom.us/v2";

interface ZoomTokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: ZoomTokenCache | null = null;

function getZoomCreds(): { accountId: string; clientId: string; clientSecret: string } {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret) {
    throw new Error("ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET env vars not set");
  }
  return { accountId, clientId, clientSecret };
}

export async function getZoomAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const { accountId, clientId, clientSecret } = getZoomCreds();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${ZOOM_TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Zoom token fetch failed: ${err}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.token;
}

export interface ZoomMeetingData {
  topic: string;
  startTime: string;
  durationMinutes: number;
  agenda?: string;
  hostEmail?: string;
}

export interface ZoomMeeting {
  id: number;
  uuid: string;
  join_url: string;
  start_url: string;
  password: string;
  topic: string;
  start_time: string;
  duration: number;
}

export async function createZoomMeeting(data: ZoomMeetingData): Promise<ZoomMeeting> {
  const token = await getZoomAccessToken();
  const body = {
    topic: data.topic,
    type: 2,
    start_time: data.startTime,
    duration: data.durationMinutes,
    timezone: "Asia/Kolkata",
    agenda: data.agenda ?? "",
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      mute_upon_entry: false,
      auto_recording: "cloud",
      waiting_room: false,
    },
  };

  const res = await fetch(`${ZOOM_API}/users/me/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Zoom createMeeting failed: ${err}`);
  }
  return res.json() as Promise<ZoomMeeting>;
}

export interface ZoomRecording {
  id: string;
  meeting_id: string;
  recording_type: string;
  file_type: string;
  download_url: string;
  play_url: string;
  status: string;
  recording_start: string;
  recording_end: string;
}

export interface ZoomRecordingList {
  uuid: string;
  id: number;
  topic: string;
  recording_files: ZoomRecording[];
}

export async function getZoomRecordings(meetingId: string): Promise<ZoomRecordingList | null> {
  const token = await getZoomAccessToken();
  const res = await fetch(`${ZOOM_API}/meetings/${encodeURIComponent(meetingId)}/recordings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Zoom getRecordings failed: ${err}`);
  }
  return res.json() as Promise<ZoomRecordingList>;
}

export async function downloadZoomTranscript(downloadUrl: string): Promise<string> {
  const token = await getZoomAccessToken();
  const res = await fetch(`${downloadUrl}?access_token=${token}`);
  if (!res.ok) {
    throw new Error(`Zoom transcript download failed: ${res.status}`);
  }
  const raw = await res.text();
  return parseVttTranscript(raw);
}

function parseVttTranscript(vtt: string): string {
  const lines = vtt.split("\n");
  const textLines: string[] = [];
  let lastSpeaker = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || /^\d+$/.test(line) || line.includes("-->")) {
      continue;
    }
    const speakerMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (speakerMatch) {
      const speaker = speakerMatch[1].trim();
      const text = speakerMatch[2].trim();
      if (speaker !== lastSpeaker) {
        textLines.push(`\n${speaker}: ${text}`);
        lastSpeaker = speaker;
      } else {
        textLines.push(text);
      }
    } else if (line.length > 0) {
      textLines.push(line);
    }
  }
  return textLines.join(" ").replace(/\s+/g, " ").trim();
}

export function isZoomConfigured(): boolean {
  return !!(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
}

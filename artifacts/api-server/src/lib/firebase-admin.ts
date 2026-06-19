import { type App, getApps, initializeApp, deleteApp, cert } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let _app: App | null = null;
let _auth: Auth | null = null;

/**
 * Bulletproof PEM reconstruction.
 * Whatever format the secret arrived in (actual newlines, literal \n, \\n,
 * whitespace-stripped, CRLF, etc.) we always extract the raw base64 body
 * and rebuild a clean PEM with proper LF newlines.
 */
function parsePrivateKey(raw: string): string {
  // Step 1 — replace any form of encoded newline with a real newline
  let normalized = raw
    .replace(/\\r\\n/g, "\n")   // \\r\\n  → \n
    .replace(/\\n/g, "\n")       // \n literal → real newline
    .replace(/\r\n/g, "\n")      // CRLF → LF
    .replace(/\r/g, "\n");       // lone CR → LF

  // Step 2 — strip the PEM armor headers and ALL whitespace from the body
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");        // remove every whitespace char

  if (!body) {
    throw new Error("FIREBASE_PRIVATE_KEY is empty after stripping headers");
  }

  // Step 3 — re-wrap at 64 chars (standard PEM line length)
  const wrapped = (body.match(/.{1,64}/g) ?? [body]).join("\n");

  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

export function getFirebaseAdmin(): { auth: Auth } | null {
  const projectId   = process.env["FIREBASE_PROJECT_ID"]?.trim();
  const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"]?.trim();
  const rawKey      = process.env["FIREBASE_PRIVATE_KEY"]?.trim();

  if (!projectId || !clientEmail || !rawKey) return null;

  if (_app && _auth) return { auth: _auth };

  // Clean up any previously broken app so we can retry
  const existing = getApps();
  if (existing.length > 0) {
    try { deleteApp(existing[0]!); } catch { /* ignore */ }
  }

  const privateKey = parsePrivateKey(rawKey);

  _app  = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  _auth = getAuth(_app);

  return { auth: _auth };
}

export function isFirebaseConfigured(): boolean {
  return !!(
    process.env["FIREBASE_PROJECT_ID"]?.trim() &&
    process.env["FIREBASE_CLIENT_EMAIL"]?.trim() &&
    process.env["FIREBASE_PRIVATE_KEY"]?.trim()
  );
}

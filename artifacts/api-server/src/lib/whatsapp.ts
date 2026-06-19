import { logger } from "./logger";
import { createHmac } from "crypto";
import { promises as dnsPromises } from "dns";
import { db } from "./db";
import { whatsappSettings } from "@workspace/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { encrypt, decrypt } from "./crypto";

const META_API_BASE = "https://graph.facebook.com/v21.0";

export interface WaSettings {
  accessToken: string;
  appSecret: string | null;
  phoneNumberId: string;
  webhookVerifyToken: string;
  bookingUrl: string | null;
  consultantName: string | null;
  portfolioUrl: string | null;
  caseStudyUrl: string | null;
  companyProfileUrl: string | null;
  referenceSites: string[];
  hookTemplateName: string | null;
  hookTemplateLang: string;
  n8nWebhookUrl: string | null;
}

function rowToSettings(row: typeof whatsappSettings.$inferSelect): WaSettings {
  let token = row.accessToken ?? "";
  try { if (token) token = decrypt(token); } catch { /* plain text fallback */ }

  let appSecret: string | null = null;
  if (row.appSecret) {
    try { appSecret = decrypt(row.appSecret); } catch { appSecret = row.appSecret; }
  }

  return {
    accessToken: token,
    appSecret,
    phoneNumberId: row.phoneNumberId ?? "",
    webhookVerifyToken: row.webhookVerifyToken ?? "",
    bookingUrl: row.bookingUrl ?? null,
    consultantName: row.consultantName ?? "Krishna Puranik",
    portfolioUrl: row.portfolioUrl ?? null,
    caseStudyUrl: row.caseStudyUrl ?? null,
    companyProfileUrl: row.companyProfileUrl ?? null,
    referenceSites: (row.referenceSites as string[]) ?? [],
    hookTemplateName: row.hookTemplateName ?? null,
    hookTemplateLang: row.hookTemplateLang ?? "en_US",
    n8nWebhookUrl: row.n8nWebhookUrl ?? null,
  };
}

export async function getWaSettings(orgId?: number): Promise<WaSettings | null> {
  const filter = orgId
    ? eq(whatsappSettings.orgId, orgId)
    : eq(whatsappSettings.id, 1);
  const [row] = await db.select().from(whatsappSettings).where(filter);
  if (!row || !row.accessToken || !row.phoneNumberId) return null;
  return rowToSettings(row);
}

export async function getOrCreateSettings(orgId?: number) {
  if (orgId) {
    const [existing] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.orgId, orgId));
    if (existing) return existing;
    const [created] = await db.insert(whatsappSettings).values({ orgId }).returning();
    return created;
  }
  const [existing] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.id, 1));
  if (existing) return existing;
  const [created] = await db.insert(whatsappSettings).values({ id: 1 }).returning();
  return created;
}

/** Look up which org owns a given WhatsApp phone_number_id (for inbound webhook routing). */
export async function getOrgIdByPhoneNumberId(phoneNumberId: string): Promise<number | null> {
  const [row] = await db
    .select({ orgId: whatsappSettings.orgId })
    .from(whatsappSettings)
    .where(eq(whatsappSettings.phoneNumberId, phoneNumberId))
    .limit(1);
  return row?.orgId ?? null;
}

/** Look up which org owns a given webhook verify token (for GET webhook challenge). */
export async function getOrgIdByVerifyToken(verifyToken: string): Promise<number | null> {
  // Linear scan — token count is tiny (one row per org)
  const all = await db
    .select({ orgId: whatsappSettings.orgId, token: whatsappSettings.webhookVerifyToken })
    .from(whatsappSettings)
    .where(isNotNull(whatsappSettings.webhookVerifyToken));
  const match = all.find(r => r.token === verifyToken);
  return match?.orgId ?? null;
}

export async function saveWaSettings(data: {
  accessToken?: string;
  appSecret?: string;
  phoneNumberId?: string;
  webhookVerifyToken?: string;
  bookingUrl?: string | null;
  consultantName?: string | null;
  portfolioUrl?: string | null;
  caseStudyUrl?: string | null;
  companyProfileUrl?: string | null;
  referenceSites?: string[];
  hookTemplateName?: string | null;
  hookTemplateLang?: string;
  n8nWebhookUrl?: string | null;
}, orgId?: number) {
  const existing = await getOrCreateSettings(orgId);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.accessToken !== undefined) updates.accessToken = data.accessToken ? encrypt(data.accessToken) : null;
  if (data.appSecret !== undefined) updates.appSecret = data.appSecret ? encrypt(data.appSecret) : null;
  if (data.phoneNumberId !== undefined) updates.phoneNumberId = data.phoneNumberId || null;
  if (data.webhookVerifyToken !== undefined) updates.webhookVerifyToken = data.webhookVerifyToken || null;
  if (data.bookingUrl !== undefined) updates.bookingUrl = data.bookingUrl || null;
  if (data.consultantName !== undefined) updates.consultantName = data.consultantName || null;
  if (data.portfolioUrl !== undefined) updates.portfolioUrl = data.portfolioUrl || null;
  if (data.caseStudyUrl !== undefined) updates.caseStudyUrl = data.caseStudyUrl || null;
  if (data.companyProfileUrl !== undefined) updates.companyProfileUrl = data.companyProfileUrl || null;
  if (data.referenceSites !== undefined) updates.referenceSites = data.referenceSites;
  if (data.hookTemplateName !== undefined) updates.hookTemplateName = data.hookTemplateName || null;
  if (data.hookTemplateLang !== undefined) updates.hookTemplateLang = data.hookTemplateLang || "en_US";
  if (data.n8nWebhookUrl !== undefined) updates.n8nWebhookUrl = data.n8nWebhookUrl || null;
  const [updated] = await db.update(whatsappSettings).set(updates).where(eq(whatsappSettings.id, existing.id)).returning();
  return updated;
}

export interface SendResult {
  waMessageId: string | null;
  errorCode?: number;
  errorMessage?: string;
}

export async function sendWhatsAppMessage(
  settings: WaSettings,
  to: string,
  text: string,
): Promise<SendResult> {
  const url = `${META_API_BASE}/${settings.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  return _postToMeta(settings, url, body);
}

/**
 * Sends a pre-approved WhatsApp template message.
 * Templates are required for business-initiated conversations (first outbound message).
 * @param templateName  Name of the approved template (e.g. "audit_hook")
 * @param langCode      Language code (e.g. "en_US", "hi", "gu")
 * @param bodyParams    Ordered positional parameter values for {{1}}, {{2}}, etc.
 */
export async function sendWhatsAppTemplate(
  settings: WaSettings,
  to: string,
  templateName: string,
  langCode: string,
  bodyParams: string[],
): Promise<SendResult> {
  const url = `${META_API_BASE}/${settings.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: langCode },
      components: bodyParams.length > 0
        ? [{
          type: "body",
          parameters: bodyParams.map(p => ({ type: "text", text: p })),
        }]
        : [],
    },
  };
  return _postToMeta(settings, url, body);
}

async function _postToMeta(
  settings: WaSettings,
  url: string,
  body: unknown,
): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json() as {
      messages?: { id: string }[];
      error?: { code: number; message: string };
    };
    if (!res.ok) {
      return {
        waMessageId: null,
        errorCode: data.error?.code,
        errorMessage: data.error?.message ?? `HTTP ${res.status}`,
      };
    }
    return { waMessageId: data.messages?.[0]?.id ?? null };
  } catch (e) {
    logger.error({ err: e }, "WhatsApp Meta API error");
    return { waMessageId: null, errorMessage: e instanceof Error ? e.message : "Network error" };
  }
}

export async function testWhatsAppConnection(settings: WaSettings): Promise<{ ok: boolean; detail: string }> {
  const url = `${META_API_BASE}/${settings.phoneNumberId}?fields=display_phone_number,verified_name`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${settings.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, detail: `API error ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { display_phone_number?: string; verified_name?: string };
    return {
      ok: true,
      detail: `Connected — ${data.verified_name ?? ""} (${data.display_phone_number ?? settings.phoneNumberId})`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * Normalises a phone string to digits only (E.164 without the +).
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export interface PhoneValidationResult {
  valid: boolean;
  normalizedPhone: string;
  reason?: string;
}

/**
 * Format-only phone validation against E.164 rules (7–15 digits).
 * Meta Cloud API v21.0 has no standalone "check contacts" endpoint;
 * actual WhatsApp registration is confirmed by the Meta API error response
 * when sendWhatsAppTemplate/sendWhatsAppMessage is called.
 */
export function validatePhoneFormat(raw: string): PhoneValidationResult {
  const normalized = normalizePhone(raw);
  if (normalized.length < 7 || normalized.length > 15) {
    return {
      valid: false,
      normalizedPhone: normalized,
      reason: `Phone number must be 7–15 digits (got ${normalized.length} digits after stripping non-numeric characters)`,
    };
  }
  return { valid: true, normalizedPhone: normalized };
}

/** Private IPv4 ranges to reject when checking resolved DNS addresses. */
const PRIVATE_IPv4_PATTERNS: RegExp[] = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,        // loopback
  /^0\.0\.0\.0$/,                              // unspecified
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,          // RFC1918 class A
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // RFC1918 class B
  /^192\.168\.\d{1,3}\.\d{1,3}$/,             // RFC1918 class C
  /^169\.254\.\d{1,3}\.\d{1,3}$/,             // link-local / metadata
];

/**
 * Returns true if the URL is safe to use as a webhook forwarding destination.
 *
 * Safety rules (synchronous; hostname-pattern only):
 * - null/empty → allowed (forwarding disabled, not a security risk)
 * - scheme must be https
 * - hostname must not be a literal loopback/RFC1918/link-local IP or "localhost"
 * - hostname must match at least one domain in the WA_WEBHOOK_FORWARD_ALLOWLIST
 *   environment variable (comma-separated list of approved domains/suffixes).
 *   If the env var is unset or empty, all forwarding URLs are rejected.
 *
 * Use `resolveHostnameSafe()` in addition for DNS-rebinding protection.
 */
export function isSafeForwardUrl(raw: string | null | undefined): boolean {
  if (!raw) return true; // null/empty means "disabled" — always allowed
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false; // unparseable URL is not safe
  }

  // Only allow https (prevent plaintext exfiltration and http-based SSRF tricks)
  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();

  // Block known internal/loopback hostnames by literal name
  if (host === "localhost" || host === "0.0.0.0") return false;

  // Block literal RFC1918/loopback/link-local IPv4
  for (const pattern of PRIVATE_IPv4_PATTERNS) {
    if (pattern.test(host)) return false;
  }

  // Block IPv6 loopback/link-local/ULA
  if (host === "::1") return false;
  if (/^fe80:/i.test(host)) return false;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return false; // fc00::/7 ULA

  // Domain allowlist: forwarding is disabled unless an explicit allowlist is configured.
  // WA_WEBHOOK_FORWARD_ALLOWLIST is a comma-separated list of approved domain suffixes,
  // e.g. "hooks.n8n.cloud,webhook.site". A hostname matches if it equals a listed domain
  // or ends with ".<domain>".
  const allowlistEnv = process.env["WA_WEBHOOK_FORWARD_ALLOWLIST"] ?? "";
  const allowedDomains = allowlistEnv
    .split(",")
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);

  if (allowedDomains.length === 0) {
    return false; // No allowlist configured — forwarding is disabled by default
  }

  return allowedDomains.some(d => host === d || host.endsWith(`.${d}`));
}

/**
 * Resolves a hostname via DNS and verifies that none of the returned IP addresses
 * fall within loopback, RFC1918, or link-local ranges.
 *
 * Returns true when the hostname is safe to connect to.
 * Returns false on DNS failure (fail-closed) or when any resolved IP is internal.
 * This defends against DNS-rebinding and CNAME-chained SSRF bypasses.
 */
export async function resolveHostnameSafe(hostname: string): Promise<boolean> {
  try {
    const ipv4s = await dnsPromises.resolve4(hostname).catch(() => [] as string[]);
    const ipv6s = await dnsPromises.resolve6(hostname).catch(() => [] as string[]);

    for (const ip of [...ipv4s, ...ipv6s]) {
      const lower = ip.toLowerCase();
      // Block IPv6 loopback/link-local/ULA
      if (lower === "::1") return false;
      if (/^fe80:/i.test(lower)) return false;
      if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return false;
      // Block private IPv4
      for (const pattern of PRIVATE_IPv4_PATTERNS) {
        if (pattern.test(ip)) return false;
      }
    }
    // If we got zero resolved addresses, fail closed
    if (ipv4s.length === 0 && ipv6s.length === 0) return false;
    return true;
  } catch {
    return false; // DNS error — fail closed
  }
}

/**
 * Verifies the Meta webhook payload signature using HMAC-SHA256.
 * Returns true only when the signature header matches the expected HMAC.
 * Returns false when the app secret is missing (fail-closed) or the signature is wrong/absent.
 * An unconfigured app secret is treated as a misconfiguration, not a pass-through,
 * because accepting unsigned requests downgrades the trust boundary to unauthenticated internet traffic.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string | null,
): boolean {
  if (!appSecret) return false; // App secret not configured — reject to avoid fail-open
  if (!signatureHeader) return false;

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  // Constant-time comparison via HMAC trick
  try {
    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(signatureHeader, "utf8");
    if (expectedBuf.length !== actualBuf.length) return false;
    let diff = 0;
    for (let i = 0; i < expectedBuf.length; i++) {
      diff |= (expectedBuf[i] ?? 0) ^ (actualBuf[i] ?? 0);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { db } from "../lib/db";
import { users, organizations } from "@workspace/db/schema";
import { eq, sql, or } from "drizzle-orm";
import { z } from "zod";
import { sendViaBrevo } from "../lib/brevo";
import { sendWelcomeEmail } from "../lib/trialEmail";
import { logger } from "../lib/logger";
import { getAppBaseUrl } from "../lib/app-url";

const router: IRouter = Router();

const _rawSecret = process.env["APP_AUTH_SECRET"];
if (!_rawSecret && process.env["NODE_ENV"] === "production") {
  throw new Error("APP_AUTH_SECRET environment variable is required in production");
}
const SECRET   = _rawSecret || "mysa-fallback-secret-dev-only";
const ENV_EMAIL    = process.env["APP_AUTH_EMAIL"]     || "";
const ENV_PWD_HASH = process.env["APP_AUTH_PASSWORD_HASH"] || "";

export interface TokenPayload {
  userId: number | null;
  orgId:  number | null;
  email:  string;
  role:   string | null;
  iat:    number;
}

export function signToken(payload: { userId: number; orgId: number; email: string; role: string }): string {
  const data    = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString("base64url");
  const sig     = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return null;
    const payload  = token.slice(0, dot);
    const sig      = token.slice(dot + 1);
    const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    if (expected !== sig) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (Date.now() - (data.iat as number) > 30 * 24 * 60 * 60 * 1000) return null;
    return {
      userId: typeof data.userId === "number" ? data.userId : null,
      orgId:  typeof data.orgId  === "number" ? data.orgId  : null,
      email:  String(data.email ?? ""),
      role:   typeof data.role   === "string"  ? data.role   : null,
      iat:    data.iat as number,
    };
  } catch {
    return null;
  }
}

const BCRYPT_COST = 10;

async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_COST);
}

function sha256Hash(pw: string): string {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

async function verifyPassword(pw: string, storedHash: string): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (storedHash.startsWith("$2b$") || storedHash.startsWith("$2a$")) {
    const ok = await bcrypt.compare(pw, storedHash);
    return { ok, needsUpgrade: false };
  }
  const ok = sha256Hash(pw) === storedHash;
  return { ok, needsUpgrade: ok };
}

const COOKIE_NAME = "mysa_token";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "none" as const,
  secure:   true,
  maxAge:   30 * 24 * 60 * 60 * 1000,
  path:     "/",
};

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Try DB first
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`);

  if (user) {
    if (!user.isActive) {
      res.status(403).json({ error: "Account is deactivated" });
      return;
    }
    if (!user.isVerified) {
      res.status(403).json({ error: "Please verify your email before logging in. Check your inbox for the verification link." });
      return;
    }
    const { ok: pwOk, needsUpgrade } = await verifyPassword(password, user.passwordHash);
    if (!pwOk) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    if (needsUpgrade) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(password), hasSetPassword: true, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }
    const orgId = user.orgId ?? 1;
    const token = signToken({ userId: user.id, orgId, email: user.email, role: user.role });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.json({ ok: true, email: user.email, orgId, role: user.role });
    return;
  }

  // Fallback: env-var bootstrap (Krishna's original setup before DB migration)
  if (
    ENV_EMAIL && ENV_PWD_HASH &&
    normalizedEmail === ENV_EMAIL.toLowerCase().trim() &&
    sha256Hash(password) === ENV_PWD_HASH
  ) {
    // Ensure a DB user row exists for the bootstrap account
    const bcryptHash = await hashPassword(password);
    let bootstrapUser = (await db.select().from(users).where(sql`lower(${users.email}) = ${normalizedEmail}`))[0];
    if (!bootstrapUser) {
      // Upsert the bootstrap user linked to org_id=1, storing bcrypt hash
      [bootstrapUser] = await db.insert(users).values({
        email: ENV_EMAIL,
        passwordHash: bcryptHash,
        firstName: "Krishna",
        lastName: "Puranik",
        orgId: 1,
        role: "owner",
        isActive: true,
      }).onConflictDoNothing().returning();
      // If still missing (race or conflict), do a plain select
      if (!bootstrapUser) {
        bootstrapUser = (await db.select().from(users).where(sql`lower(${users.email}) = ${normalizedEmail}`))[0];
      }
    }
    // Upgrade legacy SHA-256 hash to bcrypt if the DB row still has the old format
    if (bootstrapUser && !(bootstrapUser.passwordHash.startsWith("$2b$") || bootstrapUser.passwordHash.startsWith("$2a$"))) {
      await db
        .update(users)
        .set({ passwordHash: bcryptHash, updatedAt: new Date() })
        .where(eq(users.id, bootstrapUser.id));
    }
    const uid   = bootstrapUser?.id   ?? 1;
    const orgId = bootstrapUser?.orgId ?? 1;
    const role  = bootstrapUser?.role  ?? "owner";
    const token = signToken({ userId: uid, orgId, email: ENV_EMAIL, role });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.json({ ok: true, email: ENV_EMAIL, orgId, role });
    return;
  }

  res.status(401).json({ error: "Invalid email or password" });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post("/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, { path: "/", sameSite: "none", secure: true });
  res.json({ ok: true });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const data  = token ? verifyToken(token) : null;
  if (!data) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Always fetch full user profile from DB (so firstName/lastName are always fresh)
  const [user] = await db
    .select()
    .from(users)
    .where(
      data.userId
        ? eq(users.id, data.userId)
        : sql`lower(${users.email}) = ${data.email.toLowerCase()}`
    );

  if (user) {
    if (!user.isActive) {
      res.status(403).json({ error: "Account is deactivated" });
      return;
    }
    res.json({
      id:                        user.id,
      email:                     user.email,
      firstName:                 user.firstName,
      lastName:                  user.lastName,
      orgId:                     user.orgId ?? 1,
      role:                      user.role,
      phone:                     user.phone ?? null,
      phoneVerified:             user.role === "owner" ? true : (user.phoneVerified ?? false),
      isVerified:                user.role === "owner" ? true : (user.isVerified ?? false),
      pendingEmail:              user.pendingEmail ?? null,
      pendingEmailTokenExpiresAt: user.pendingEmailTokenExpiresAt ?? null,
      hasPassword:               user.hasSetPassword,
      businessWhy:               (user as Record<string, unknown>).businessWhy as string | null ?? null,
      onboardingCompleted:       (user as Record<string, unknown>).onboardingCompleted as boolean ?? true,
      onboardingSteps:           (user as Record<string, unknown>).onboardingSteps as Record<string, boolean> | null ?? null,
      createdAt:                 user.createdAt?.toISOString() ?? null,
    });
    return;
  }

  // Fallback for bootstrap token with no DB row yet
  res.json({
    id:           data.userId ?? 1,
    email:        data.email,
    firstName:    null,
    lastName:     null,
    orgId:        data.orgId ?? 1,
    role:         data.role ?? "owner",
    isVerified:   true,
    phoneVerified: true,
  });
});

// ── POST /auth/register ───────────────────────────────────────────────────────
const RegisterSchema = z.object({
  email:       z.string().email(),
  password:    z.string().min(8),
  firstName:   z.string().min(1),
  lastName:    z.string().min(1),
  companyName: z.string().optional(),
  phone:       z.string().optional(),
  website:     z.string().optional(),
});

router.post("/auth/register", async (req: Request, res: Response): Promise<void> => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { email, password, firstName, lastName, phone, website } = parsed.data;
  const companyName = parsed.data.companyName?.trim() || `${firstName} ${lastName}`;
  const normalizedEmail = email.toLowerCase().trim();

  // Check for existing user OR existing org with same email
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`);

  const [existingOrg] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`lower(${organizations.email}) = ${normalizedEmail}`);

  if (existingUser || existingOrg) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const verificationToken = crypto.randomBytes(32).toString("hex");
  const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const passwordHash = await hashPassword(password);

  // Create org + user in a transaction
  const result = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name:  companyName,
        email: normalizedEmail,
        ownerName: `${firstName} ${lastName}`,
        phone: phone ?? null,
        website: website ?? null,
        plan: "trial",
        subscriptionStatus: "trialing",
        trialStartedAt: new Date(),
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();

    const [user] = await tx
      .insert(users)
      .values({
        email:             normalizedEmail,
        passwordHash,
        firstName,
        lastName,
        orgId:             org!.id,
        role:              "owner",
        isActive:          true,
        isVerified:        false,
        verificationToken,
        verificationTokenExpiresAt,
      })
      .returning();

    return { org: org!, user: user! };
  });

  // Send verification email
  const baseUrl = getAppBaseUrl();
  const verifyUrl = `${baseUrl}/v1/verify?token=${verificationToken}`;

  let emailSent = false;
  try {
    await sendViaBrevo({
      to: [{ email: normalizedEmail, name: `${firstName} ${lastName}` }],
      subject: "Verify your Mysa AI account",
      htmlContent: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:#1A3D2B;border-radius:12px;margin-bottom:12px;">
              <span style="color:#fff;font-size:22px;font-weight:700;">M</span>
            </div>
            <h1 style="margin:0;font-size:20px;color:#111827;">Verify your email</h1>
            <p style="margin:8px 0 0;color:#6B7280;font-size:14px;">You're almost there, ${firstName}!</p>
          </div>
          <p style="color:#374151;font-size:14px;line-height:1.6;">
            Thanks for signing up for Mysa AI. Click the button below to verify your email address and activate your account.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${verifyUrl}" style="display:inline-block;background:#1A3D2B;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
              Verify my email
            </a>
          </div>
          <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0;">
            If you didn't create a Mysa AI account, you can safely ignore this email.
          </p>
        </div>
      `,
      textContent: `Hi ${firstName},\n\nPlease verify your email by visiting this link:\n${verifyUrl}\n\nIf you didn't create a Mysa AI account, you can ignore this email.`,
    });
    emailSent = true;
  } catch (err) {
    logger.error({ err }, "[register] failed to send verification email");
    // Registration succeeds but user is notified email may be delayed
  }

  // Send welcome / trial-start email (non-fatal — fires regardless of verification email result)
  sendWelcomeEmail(normalizedEmail, firstName, result.org.trialEndsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
    .then(() =>
      db.update(organizations)
        .set({ welcomeEmailSentAt: new Date() })
        .where(eq(organizations.id, result.org.id))
        .catch((err: unknown) => logger.error({ err }, "[register] failed to stamp welcomeEmailSentAt"))
    )
    .catch((err) => logger.error({ err }, "[register] failed to send welcome email"));

  res.status(201).json({
    ok:        true,
    emailSent,
    email:     result.user.email,
  });
});

// ── POST /auth/resend-verification ────────────────────────────────────────────
// Simple in-memory rate limit: 1 resend per email per 60 seconds
const resendCooldowns = new Map<string, number>();

router.post("/auth/resend-verification", async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Rate limit check
  const lastSent = resendCooldowns.get(normalizedEmail);
  if (lastSent && Date.now() - lastSent < 60_000) {
    const secondsLeft = Math.ceil((60_000 - (Date.now() - lastSent)) / 1000);
    res.status(429).json({ error: `Please wait ${secondsLeft} seconds before requesting another email.`, secondsLeft });
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`);

  if (!user) {
    // Don't reveal whether the email exists
    res.json({ ok: true });
    return;
  }

  if (user.isVerified) {
    // Respond silently to avoid leaking account state (email enumeration)
    res.json({ ok: true });
    return;
  }

  // Regenerate token with a fresh 24-hour expiry
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db
    .update(users)
    .set({ verificationToken, verificationTokenExpiresAt, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  resendCooldowns.set(normalizedEmail, Date.now());

  const baseUrl = getAppBaseUrl();
  const verifyUrl = `${baseUrl}/v1/verify?token=${verificationToken}`;

  const firstName = user.firstName ?? "there";
  try {
    await sendViaBrevo({
      to: [{ email: normalizedEmail, name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() }],
      subject: "Verify your Mysa AI account",
      htmlContent: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:#1A3D2B;border-radius:12px;margin-bottom:12px;">
              <span style="color:#fff;font-size:22px;font-weight:700;">M</span>
            </div>
            <h1 style="margin:0;font-size:20px;color:#111827;">Verify your email</h1>
            <p style="margin:8px 0 0;color:#6B7280;font-size:14px;">You're almost there, ${firstName}!</p>
          </div>
          <p style="color:#374151;font-size:14px;line-height:1.6;">
            Here's a fresh verification link for your Mysa AI account. Click the button below to activate it.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${verifyUrl}" style="display:inline-block;background:#1A3D2B;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
              Verify my email
            </a>
          </div>
          <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0;">
            If you didn't create a Mysa AI account, you can safely ignore this email.
          </p>
        </div>
      `,
      textContent: `Hi ${firstName},\n\nHere's a fresh verification link:\n${verifyUrl}\n\nIf you didn't create a Mysa AI account, you can ignore this email.`,
    });
  } catch (err) {
    logger.error({ err }, "[resend-verification] failed to send email");
    res.status(500).json({ error: "Failed to send verification email. Please try again." });
    return;
  }

  res.json({ ok: true });
});

// ── POST /auth/resend-pending-email ────────────────────────────────────────────
// Authenticated endpoint: resend the verification link for a phone-user's
// pending email address. Rate-limited to 1 resend per user per 60 seconds.
const pendingEmailCooldowns = new Map<number, number>();

// Periodically purge stale entries from all rate-limit maps so they don't grow
// unboundedly over time. Any entry older than the cooldown window (60 s) is
// no longer actionable and can be safely removed.
const COOLDOWN_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of resendCooldowns) {
    if (now - ts > COOLDOWN_MS) resendCooldowns.delete(key);
  }
  for (const [key, ts] of pendingEmailCooldowns) {
    if (now - ts > COOLDOWN_MS) pendingEmailCooldowns.delete(key);
  }
}, 5 * 60 * 1000).unref();

router.post("/auth/resend-pending-email", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const session = token ? verifyToken(token) : null;
  if (!session || !session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = session.userId;

  // Rate limit: 1 resend per 60 seconds per user
  const lastSent = pendingEmailCooldowns.get(userId);
  if (lastSent && Date.now() - lastSent < 60_000) {
    const secondsLeft = Math.ceil((60_000 - (Date.now() - lastSent)) / 1000);
    res.status(429).json({ error: `Please wait ${secondsLeft} seconds before requesting another email.`, secondsLeft });
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));

  if (!user || !user.pendingEmail) {
    res.status(400).json({ error: "No pending email address to verify." });
    return;
  }

  // Regenerate token with a fresh 24-hour expiry
  const pendingEmailToken = crypto.randomBytes(32).toString("hex");
  const pendingEmailTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db
    .update(users)
    .set({ pendingEmailToken, pendingEmailTokenExpiresAt, updatedAt: new Date() })
    .where(eq(users.id, userId));

  pendingEmailCooldowns.set(userId, Date.now());

  const baseUrl = getAppBaseUrl();
  const verifyUrl = `${baseUrl}/v1/verify?token=${pendingEmailToken}`;
  const displayName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "there";

  try {
    await sendViaBrevo({
      to: [{ email: user.pendingEmail, name: displayName }],
      subject: "Verify your email — Mysa AI",
      htmlContent: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:#1A3D2B;border-radius:12px;margin-bottom:12px;">
              <span style="color:#fff;font-size:22px;font-weight:700;">M</span>
            </div>
            <h1 style="margin:0;font-size:20px;color:#111827;">Verify your email</h1>
            <p style="margin:8px 0 0;color:#6B7280;font-size:14px;">Hi ${displayName}, here's your fresh link.</p>
          </div>
          <p style="color:#374151;font-size:14px;line-height:1.6;">
            Click the button below to verify <strong>${user.pendingEmail}</strong> and link it to your Mysa AI account.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${verifyUrl}" style="display:inline-block;background:#1A3D2B;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
              Verify my email
            </a>
          </div>
          <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
      textContent: `Hi ${displayName},\n\nHere's a fresh verification link for ${user.pendingEmail}:\n${verifyUrl}\n\nIf you didn't request this, you can ignore this email.`,
    });
  } catch (err) {
    logger.error({ err }, "[resend-pending-email] failed to send email");
    res.status(500).json({ error: "Failed to send verification email. Please try again." });
    return;
  }

  res.json({ ok: true });
});

// ── GET /auth/verify-email ─────────────────────────────────────────────────────
function htmlPage(title: string, icon: string, iconBg: string, heading: string, body: string, cta?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Mysa AI</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #F9FAFB; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { background: #fff; border: 1px solid #E5E7EB; border-radius: 16px; max-width: 480px; width: 100%; padding: 40px 32px; text-align: center; }
    .icon { width: 56px; height: 56px; background: ${iconBg}; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 26px; }
    h1 { font-size: 20px; color: #111827; margin-bottom: 10px; }
    p { font-size: 14px; color: #6B7280; line-height: 1.6; margin-bottom: 24px; }
    a.btn { display: inline-block; background: #1A3D2B; color: #fff; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; }
    a.btn:hover { background: #14532d; }
    .note { font-size: 12px; color: #9CA3AF; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${heading}</h1>
    ${body}
    ${cta ?? ""}
  </div>
</body>
</html>`;
}

router.get("/auth/verify-email", async (req: Request, res: Response): Promise<void> => {
  const token = (req.query["token"] as string | undefined)?.trim();
  if (!token) {
    res.status(400).json({ error: "Missing verification token" });
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.verificationToken, token), eq(users.pendingEmailToken, token)));

  if (!user) {
    res.status(400).json({ error: "Invalid or expired verification link" });
    return;
  }

  const frontendUrl = getAppBaseUrl();

  // ── Pending-email swap path (phone users adding a real email) ──────────────
  if (user.pendingEmailToken === token) {
    const isExpired = !user.pendingEmailTokenExpiresAt || user.pendingEmailTokenExpiresAt < new Date();
    if (isExpired) {
      res.status(410).send(htmlPage(
        "Link Expired",
        "⏱",
        "#FEF3C7",
        "Verification link expired",
        `<p>This link is only valid for 24 hours and it has expired. Go back to your profile settings and save the email address again to receive a fresh link.</p>`,
        `<a href="${frontendUrl}/v1/" class="btn">Back to app</a><p class="note">Didn't request this? You can safely ignore this page.</p>`,
      ));
      return;
    }

    const newEmail = user.pendingEmail!;
    try {
      await db
        .update(users)
        .set({
          email:                    newEmail,
          isVerified:               true,          // mark email as verified on swap
          pendingEmail:             null,
          pendingEmailToken:        null,
          pendingEmailTokenExpiresAt: null,
          updatedAt:                new Date(),
        })
        .where(eq(users.id, user.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("unique") || msg.includes("duplicate")) {
        res.status(409).send(htmlPage(
          "Email Already Taken",
          "✗",
          "#FEE2E2",
          "That email is already in use",
          `<p>Another account claimed <strong>${newEmail}</strong> before this link was clicked. Please go back to your profile settings and add a different email address.</p>`,
          `<a href="${frontendUrl}/v1/" class="btn">Back to app</a>`,
        ));
        return;
      }
      throw err;
    }

    const orgId = user.orgId ?? 1;
    const authToken = signToken({ userId: user.id, orgId, email: newEmail, role: user.role });
    res.cookie(COOKIE_NAME, authToken, COOKIE_OPTS);
    res.redirect(!user.hasSetPassword ? `${frontendUrl}/v1/settings?tab=profile` : `${frontendUrl}/v1/`);
    return;
  }

  // ── Standard new-account verification path ─────────────────────────────────
  if (user.isVerified) {
    // Already verified — just log them in
    const orgId = user.orgId ?? 1;
    const authToken = signToken({ userId: user.id, orgId, email: user.email, role: user.role });
    res.cookie(COOKIE_NAME, authToken, COOKIE_OPTS);
    res.redirect(`${frontendUrl}/v1/`);
    return;
  }

  // Treat NULL expiry as expired (legacy tokens issued before expiry was
  // introduced are no longer valid — users must request a fresh link).
  const isExpired = !user.verificationTokenExpiresAt || user.verificationTokenExpiresAt < new Date();
  if (isExpired) {
    const resendUrl = `/api/auth/trigger-resend?email=${encodeURIComponent(user.email)}`;
    res.status(410).send(htmlPage(
      "Link Expired",
      "⏱",
      "#FEF3C7",
      "Verification link expired",
      `<p>This link is only valid for 24 hours and it has expired. Request a new one and we'll send a fresh link to <strong>${user.email}</strong> right away.</p>`,
      `<a href="${resendUrl}" class="btn">Send a new link</a><p class="note">Didn't sign up? You can safely ignore this page.</p>`,
    ));
    return;
  }

  await db
    .update(users)
    .set({ isVerified: true, verificationToken: null, verificationTokenExpiresAt: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const orgId = user.orgId ?? 1;
  const authToken = signToken({ userId: user.id, orgId, email: user.email, role: user.role });
  res.cookie(COOKIE_NAME, authToken, COOKIE_OPTS);

  res.redirect(`${frontendUrl}/v1/`);
});

// ── POST /auth/verify-email ────────────────────────────────────────────────────
// Used by the frontend /verify page — accepts { token }, sets the session cookie,
// returns JSON. No server-side redirect needed.
router.post("/auth/verify-email", async (req: Request, res: Response): Promise<void> => {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Missing verification token." });
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.verificationToken, token), eq(users.pendingEmailToken, token)));

  if (!user) {
    res.status(400).json({ error: "Invalid or expired link. Please request a new verification email." });
    return;
  }

  // ── Pending-email swap path (phone users adding a real email) ──────────────
  if (user.pendingEmailToken === token) {
    const isExpired = !user.pendingEmailTokenExpiresAt || user.pendingEmailTokenExpiresAt < new Date();
    if (isExpired) {
      res.status(410).json({
        error:   "This link has expired. Go to your profile settings and save the email address again.",
        expired: true,
      });
      return;
    }

    const newEmail = user.pendingEmail!;
    try {
      await db
        .update(users)
        .set({
          email:                    newEmail,
          isVerified:               true,          // mark email as verified on swap
          pendingEmail:             null,
          pendingEmailToken:        null,
          pendingEmailTokenExpiresAt: null,
          updatedAt:                new Date(),
        })
        .where(eq(users.id, user.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("unique") || msg.includes("duplicate")) {
        res.status(409).json({
          error: "That email address has already been claimed by another account. Please go to your profile settings and add a different address.",
          emailConflict: true,
        });
        return;
      }
      throw err;
    }

    const orgId    = user.orgId ?? 1;
    const authToken = signToken({ userId: user.id, orgId, email: newEmail, role: user.role });
    res.cookie(COOKIE_NAME, authToken, COOKIE_OPTS);
    res.json({ ok: true, needsPassword: !user.hasSetPassword });
    return;
  }

  // ── Standard new-account verification path ─────────────────────────────────
  if (user.isVerified) {
    const orgId    = user.orgId ?? 1;
    const authToken = signToken({ userId: user.id, orgId, email: user.email, role: user.role });
    res.cookie(COOKIE_NAME, authToken, COOKIE_OPTS);
    res.json({ ok: true, alreadyVerified: true });
    return;
  }

  const isExpired = !user.verificationTokenExpiresAt || user.verificationTokenExpiresAt < new Date();
  if (isExpired) {
    res.status(410).json({
      error:   "This link has expired. Please request a new verification email.",
      expired: true,
      email:   user.email,
    });
    return;
  }

  await db
    .update(users)
    .set({ isVerified: true, verificationToken: null, verificationTokenExpiresAt: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const orgId    = user.orgId ?? 1;
  const authToken = signToken({ userId: user.id, orgId, email: user.email, role: user.role });
  res.cookie(COOKIE_NAME, authToken, COOKIE_OPTS);
  res.json({ ok: true });
});

// ── GET /auth/trigger-resend ───────────────────────────────────────────────────
// Browser-navigable endpoint linked from the expired-link page.
// Regenerates the verification token and sends a fresh email, then returns a
// self-contained HTML confirmation page (no frontend redirect needed).
router.get("/auth/trigger-resend", async (req: Request, res: Response): Promise<void> => {
  const email = (req.query["email"] as string | undefined)?.trim().toLowerCase();
  const frontendUrl = getAppBaseUrl();

  if (!email) {
    res.status(400).send(htmlPage("Error", "✗", "#FEE2E2", "Something went wrong", `<p>No email address was provided.</p>`));
    return;
  }

  // Rate limit (shared with the POST endpoint map)
  const lastSent = resendCooldowns.get(email);
  if (lastSent && Date.now() - lastSent < 60_000) {
    const secondsLeft = Math.ceil((60_000 - (Date.now() - lastSent)) / 1000);
    res.status(429).send(htmlPage(
      "Please wait",
      "⏳",
      "#FEF3C7",
      "Too many requests",
      `<p>We already sent a link recently. Please wait ${secondsLeft} seconds before requesting another.</p>`,
    ));
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`);

  // Respond with success page regardless to avoid email enumeration
  if (!user || user.isVerified) {
    res.send(htmlPage(
      "Check your inbox",
      "✉",
      "#D1FAE5",
      "Check your inbox",
      `<p>If that email belongs to an unverified Mysa AI account, we've sent a fresh verification link. It may take a minute to arrive.</p>`,
      `<a href="${frontendUrl}/v1/" class="btn">Back to sign in</a>`,
    ));
    return;
  }

  const verificationToken = crypto.randomBytes(32).toString("hex");
  const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db
    .update(users)
    .set({ verificationToken, verificationTokenExpiresAt, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  resendCooldowns.set(email, Date.now());

  const verifyUrl = `${frontendUrl}/v1/verify?token=${verificationToken}`;
  const firstName = user.firstName ?? "there";

  try {
    await sendViaBrevo({
      to: [{ email: user.email, name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() }],
      subject: "Verify your Mysa AI account",
      htmlContent: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:#1A3D2B;border-radius:12px;margin-bottom:12px;">
              <span style="color:#fff;font-size:22px;font-weight:700;">M</span>
            </div>
            <h1 style="margin:0;font-size:20px;color:#111827;">Verify your email</h1>
            <p style="margin:8px 0 0;color:#6B7280;font-size:14px;">You're almost there, ${firstName}!</p>
          </div>
          <p style="color:#374151;font-size:14px;line-height:1.6;">
            Here's a fresh verification link for your Mysa AI account. Click the button below to activate it.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${verifyUrl}" style="display:inline-block;background:#1A3D2B;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
              Verify my email
            </a>
          </div>
          <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0;">
            If you didn't create a Mysa AI account, you can safely ignore this email.
          </p>
        </div>
      `,
      textContent: `Hi ${firstName},\n\nHere's a fresh verification link:\n${verifyUrl}\n\nIf you didn't create a Mysa AI account, you can ignore this email.`,
    });
  } catch (err) {
    logger.error({ err }, "[trigger-resend] failed to send email");
    res.status(500).send(htmlPage(
      "Error",
      "✗",
      "#FEE2E2",
      "Something went wrong",
      `<p>We couldn't send the verification email right now. Please try again in a moment.</p>`,
    ));
    return;
  }

  res.send(htmlPage(
    "Check your inbox",
    "✉",
    "#D1FAE5",
    "Check your inbox",
    `<p>A fresh verification link has been sent to <strong>${user.email}</strong>. It's valid for 24 hours.</p>`,
    `<a href="${frontendUrl}/v1/" class="btn">Back to sign in</a>`,
  ));
});

// ── GET /organizations/me ─────────────────────────────────────────────────────
router.get("/organizations/me", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const data  = token ? verifyToken(token) : null;
  if (!data || !data.orgId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, data.orgId));

  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  res.json({
    id:      org.id,
    name:    org.name,
    email:   org.email,
    phone:   org.phone,
    website: org.website,
    plan:    org.plan,
    subscriptionStatus: org.subscriptionStatus,
    trialEndsAt:        org.trialEndsAt,
  });
});

// ── PATCH /organizations/me ───────────────────────────────────────────────────
const UpdateOrgSchema = z.object({
  name:    z.string().min(1).max(200).optional(),
  phone:   z.string().max(50).optional(),
  website: z.string().max(500).optional(),
});

router.patch("/organizations/me", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const data  = token ? verifyToken(token) : null;
  if (!data || !data.orgId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = UpdateOrgSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name    !== undefined) updates.name    = parsed.data.name.trim();
  if (parsed.data.phone   !== undefined) updates.phone   = parsed.data.phone.trim()   || null;
  if (parsed.data.website !== undefined) updates.website = parsed.data.website.trim() || null;

  const [updated] = await db
    .update(organizations)
    .set(updates)
    .where(eq(organizations.id, data.orgId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  res.json({
    id:      updated.id,
    name:    updated.name,
    email:   updated.email,
    phone:   updated.phone,
    website: updated.website,
  });
});

// ── GET /users/me ──────────────────────────────────────────────────────────────
router.get("/users/me", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const data  = token ? verifyToken(token) : null;
  if (!data || !data.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db.select().from(users).where(eq(users.id, data.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({
    id:                     user.id,
    email:                  user.email,
    firstName:              user.firstName,
    lastName:               user.lastName,
    orgId:                  user.orgId,
    role:                   user.role,
    phone:                  user.phone,
    phoneVerified:          user.phoneVerified,
    isVerified:             user.isVerified,
    pendingEmail:           user.pendingEmail,
    pendingEmailTokenExpiresAt: user.pendingEmailTokenExpiresAt,
    hasPassword:            user.hasSetPassword,
    businessWhy:            user.businessWhy,
    onboardingCompleted:    user.onboardingCompleted,
  });
});

// ── PATCH /users/me ────────────────────────────────────────────────────────────
const UpdateMeSchema = z.object({
  firstName:            z.string().min(1).max(100).optional(),
  lastName:             z.string().max(100).optional(),
  email:                z.string().email().optional(),
  city:                 z.string().max(100).optional(),
  designation:          z.string().max(200).optional(),
  teamSize:             z.string().max(50).optional(),
  companyName:          z.string().max(200).optional(),
  businessWhy:          z.string().max(500).optional(),
  onboardingCompleted:  z.boolean().optional(),
});

router.patch("/users/me", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const data  = token ? verifyToken(token) : null;
  if (!data || !data.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = UpdateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.firstName           !== undefined) updates.firstName           = parsed.data.firstName.trim();
  if (parsed.data.lastName            !== undefined) updates.lastName            = parsed.data.lastName.trim();
  if (parsed.data.city                !== undefined) updates.city                = parsed.data.city.trim() || null;
  if (parsed.data.designation         !== undefined) updates.designation         = parsed.data.designation.trim() || null;
  if (parsed.data.teamSize            !== undefined) updates.teamSize            = parsed.data.teamSize || null;
  if (parsed.data.businessWhy         !== undefined) updates.businessWhy         = parsed.data.businessWhy || null;
  if (parsed.data.onboardingCompleted !== undefined) updates.onboardingCompleted = parsed.data.onboardingCompleted;

  let verificationEmailSent = false;

  if (parsed.data.email !== undefined) {
    const newEmail = parsed.data.email.toLowerCase().trim();

    // Check the email isn't already taken by another user
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${newEmail} AND ${users.id} != ${data.userId}`);

    if (existing) {
      res.status(409).json({ error: "That email address is already in use." });
      return;
    }

    // If this is a real email (not a synthetic phone placeholder), store it as
    // pending and send a verification link. We do NOT overwrite `email` or
    // touch `isVerified` — the phone-OTP session stays alive until the link
    // is clicked.
    if (!newEmail.endsWith("@otp.mysa.internal")) {
      const pendingEmailToken = crypto.randomBytes(32).toString("hex");
      const pendingEmailTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      updates.pendingEmail = newEmail;
      updates.pendingEmailToken = pendingEmailToken;
      updates.pendingEmailTokenExpiresAt = pendingEmailTokenExpiresAt;

      const baseUrl = getAppBaseUrl();
      const verifyUrl = `${baseUrl}/v1/verify?token=${pendingEmailToken}`;
      const displayName = (parsed.data.firstName ?? "").trim() || "there";

      try {
        await sendViaBrevo({
          to: [{ email: newEmail, name: displayName }],
          subject: "Verify your email — Mysa AI",
          htmlContent: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
              <div style="text-align:center;margin-bottom:24px;">
                <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:#1A3D2B;border-radius:12px;margin-bottom:12px;">
                  <span style="color:#fff;font-size:22px;font-weight:700;">M</span>
                </div>
                <h1 style="margin:0;font-size:20px;color:#111827;">Verify your email</h1>
                <p style="margin:8px 0 0;color:#6B7280;font-size:14px;">Hi ${displayName}, please confirm your address.</p>
              </div>
              <p style="color:#374151;font-size:14px;line-height:1.6;">
                Click the button below to verify this email address and link it to your Mysa AI account.
              </p>
              <div style="text-align:center;margin:28px 0;">
                <a href="${verifyUrl}" style="display:inline-block;background:#1A3D2B;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
                  Verify my email
                </a>
              </div>
              <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </div>
          `,
          textContent: `Hi ${displayName},\n\nPlease verify your email by visiting:\n${verifyUrl}\n\nIf you didn't request this, you can ignore this email.`,
        });
        verificationEmailSent = true;
      } catch (err) {
        logger.error({ err }, "[users/me] failed to send verification email");
      }
    } else {
      // Synthetic phone placeholder — just overwrite directly
      updates.email = newEmail;
    }
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, data.userId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (parsed.data.companyName !== undefined && updated.orgId) {
    const companyTrimmed = parsed.data.companyName.trim();
    if (companyTrimmed) {
      await db
        .update(organizations)
        .set({ name: companyTrimmed, updatedAt: new Date() })
        .where(eq(organizations.id, updated.orgId));
    }
  }

  res.json({
    id:                    updated.id,
    email:                 updated.email,
    firstName:             updated.firstName,
    lastName:              updated.lastName,
    orgId:                 updated.orgId ?? 1,
    role:                  updated.role,
    pendingEmail:          updated.pendingEmail ?? null,
    verificationEmailSent,
  });
});

// ── GET /onboarding/steps ──────────────────────────────────────────────────────
router.get("/onboarding/steps", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const data  = token ? verifyToken(token) : null;
  if (!data || !data.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db
    .select({ onboardingSteps: users.onboardingSteps, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, data.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({
    steps: (user.onboardingSteps as Record<string, boolean> | null) ?? {},
    createdAt: user.createdAt.toISOString(),
  });
});

// ── PATCH /onboarding/steps ────────────────────────────────────────────────────
const OnboardingStepSchema = z.object({
  step: z.enum(["audit", "lead", "outreach"]),
  done: z.boolean(),
});

router.patch("/onboarding/steps", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const data  = token ? verifyToken(token) : null;
  if (!data || !data.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = OnboardingStepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const [user] = await db
    .select({ onboardingSteps: users.onboardingSteps })
    .from(users)
    .where(eq(users.id, data.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const current = (user.onboardingSteps as Record<string, boolean> | null) ?? {};
  const next = { ...current, [parsed.data.step]: parsed.data.done };

  await db
    .update(users)
    .set({ onboardingSteps: next, updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(users.id, data.userId));

  res.json({ steps: next });
});

// ── PATCH /users/me/password ───────────────────────────────────────────────────
const UpdatePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword:     z.string().min(8),
});

router.patch("/users/me/password", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const data  = token ? verifyToken(token) : null;
  if (!data || !data.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = UpdatePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, data.userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (parsed.data.currentPassword) {
    // Current password provided — always verify it
    const { ok: currentOk } = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!currentOk) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
  } else {
    // No current password supplied — only permitted when the user has explicitly
    // never set one (phone-OTP users with hasSetPassword = false).
    if (user.hasSetPassword) {
      res.status(400).json({ error: "Current password is required" });
      return;
    }
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.newPassword), hasSetPassword: true, updatedAt: new Date() })
    .where(eq(users.id, data.userId));

  res.json({ ok: true });
});

export default router;

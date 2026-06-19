import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { db } from "../lib/db";
import { users, organizations } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { signToken, verifyToken } from "./auth";
import { logger } from "../lib/logger";
import { getFirebaseAdmin, isFirebaseConfigured } from "../lib/firebase-admin";

const router: IRouter = Router();

const COOKIE_NAME = "mysa_token";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "none" as const,
  secure:   true,
  maxAge:   30 * 24 * 60 * 60 * 1000,
  path:     "/",
};

// ── Server-side rate limit: 1 verify attempt per phone per 60 s ───────────────
const verifyAttempts = new Map<string, number>();
const RATE_LIMIT_MS = 60_000;
function checkVerifyRateLimit(phone: string): boolean {
  const last = verifyAttempts.get(phone);
  const now  = Date.now();
  if (last && now - last < RATE_LIMIT_MS) return false;
  verifyAttempts.set(phone, now);
  return true;
}
// Purge stale entries every 10 minutes to avoid unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_MS;
  for (const [k, v] of verifyAttempts) {
    if (v < cutoff) verifyAttempts.delete(k);
  }
}, 600_000).unref();

// ── GET /auth/otp/available ───────────────────────────────────────────────────
router.get("/auth/otp/available", (_req: Request, res: Response): void => {
  res.json({ enabled: isFirebaseConfigured() });
});

// ── POST /auth/otp/firebase-verify ────────────────────────────────────────────
// Receives a Firebase ID token that was obtained on the frontend after the user
// passed phone + OTP verification through Firebase Authentication.
// Verifies the token server-side, then finds or creates a Mysa user.
router.post("/auth/otp/firebase-verify", async (req: Request, res: Response): Promise<void> => {
  const firebase = getFirebaseAdmin();
  if (!firebase) {
    res.status(503).json({ error: "Phone sign-in is not configured on this server." });
    return;
  }

  const { idToken } = req.body as { idToken?: string };
  if (!idToken || typeof idToken !== "string") {
    res.status(400).json({ error: "idToken is required." });
    return;
  }

  let phone: string;
  try {
    const decoded = await firebase.auth.verifyIdToken(idToken);
    if (!decoded.phone_number) {
      res.status(400).json({ error: "Firebase token does not contain a phone number." });
      return;
    }
    phone = decoded.phone_number;
  } catch (err) {
    logger.warn({ err }, "Firebase ID token verification failed");
    res.status(401).json({ error: "Invalid or expired token. Please try again." });
    return;
  }

  // Server-side rate limit: 1 successful verify per phone number per 60 s
  if (!checkVerifyRateLimit(phone)) {
    res.status(429).json({ error: "Too many attempts. Please wait 60 seconds before trying again." });
    return;
  }

  try {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.phone, phone));

    let user: typeof users.$inferSelect;

    if (existingUser) {
      if (!existingUser.isActive) {
        res.status(403).json({ error: "Account is deactivated." });
        return;
      }
      if (!existingUser.phoneVerified) {
        await db.update(users)
          .set({ phoneVerified: true, updatedAt: new Date() })
          .where(eq(users.id, existingUser.id));
      }
      user = { ...existingUser, phoneVerified: true };
    } else {
      const syntheticEmail = `phone_${phone.replace(/\+/g, "")}@otp.mysa.internal`;

      const txResult = await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({
            name:      `Phone user ${phone}`,
            email:     syntheticEmail,
            ownerName: phone,
            plan:      "trial",
            subscriptionStatus: "trialing",
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          })
          .returning();

        const [newUser] = await tx
          .insert(users)
          .values({
            email:          syntheticEmail,
            passwordHash:   crypto.randomBytes(32).toString("hex"),
            hasSetPassword: false,
            firstName:      "",
            lastName:       "",
            orgId:          org!.id,
            role:           "owner",
            isActive:       true,
            isVerified:     true,
            phone,
            phoneVerified:  true,
          })
          .returning();

        return { org: org!, user: newUser! };
      });

      user = txResult.user;
    }

    const token = signToken({
      userId: user.id,
      orgId:  user.orgId ?? 1,
      email:  user.email,
      role:   user.role,
    });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);

    res.json({
      ok:        true,
      phone,
      orgId:     user.orgId ?? 1,
      role:      user.role,
      isNewUser: !existingUser,
    });
  } catch (err) {
    logger.error({ err }, "OTP firebase-verify DB error");
    res.status(500).json({ error: "Internal server error. Please try again." });
  }
});

// ── POST /auth/otp/link-phone ─────────────────────────────────────────────────
// Links a verified phone number to the currently signed-in user's account.
// Receives a Firebase ID token (obtained after phone OTP on the frontend),
// verifies it server-side, checks for conflicts, and saves phone + phoneVerified.
router.post("/auth/otp/link-phone", async (req: Request, res: Response): Promise<void> => {
  const firebase = getFirebaseAdmin();
  if (!firebase) {
    res.status(503).json({ error: "Phone sign-in is not configured on this server." });
    return;
  }

  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const session = token ? verifyToken(token) : null;
  if (!session || !session.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const { idToken } = req.body as { idToken?: string };
  if (!idToken || typeof idToken !== "string") {
    res.status(400).json({ error: "idToken is required." });
    return;
  }

  let phone: string;
  try {
    const decoded = await firebase.auth.verifyIdToken(idToken);
    if (!decoded.phone_number) {
      res.status(400).json({ error: "Firebase token does not contain a phone number." });
      return;
    }
    phone = decoded.phone_number;
  } catch (err) {
    logger.warn({ err }, "Firebase ID token verification failed (link-phone)");
    res.status(401).json({ error: "Invalid or expired token. Please try again." });
    return;
  }

  try {
    // Check if this phone is already linked to a different account
    const [conflict] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.phone} = ${phone} AND ${users.id} != ${session.userId}`);

    if (conflict) {
      res.status(409).json({ error: "This phone number is already linked to another account." });
      return;
    }

    await db
      .update(users)
      .set({ phone, phoneVerified: true, updatedAt: new Date() })
      .where(eq(users.id, session.userId));

    res.json({ ok: true, phone });
  } catch (err) {
    logger.error({ err }, "OTP link-phone DB error");
    res.status(500).json({ error: "Internal server error. Please try again." });
  }
});

export default router;

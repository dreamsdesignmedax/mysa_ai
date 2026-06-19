import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { db } from "../lib/db";
import { users, inviteTokens, organizations } from "@workspace/db/schema";
import { eq, and, sql, gt } from "drizzle-orm";
import { sendViaBrevo } from "../lib/brevo";
import { signToken } from "./auth";
import { logger } from "../lib/logger";
import { getAppBaseUrl } from "../lib/app-url";

const router: IRouter = Router();

async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

function getAuth(req: Request, res: Response): { userId: number; orgId: number; role: string } | null {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return { userId: req.user.userId, orgId: req.user.orgId, role: req.user.role ?? "member" };
}

// ── GET /team/members ─────────────────────────────────────────────────────────
router.get("/team/members", async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const members = await db
    .select({
      id:        users.id,
      email:     users.email,
      firstName: users.firstName,
      lastName:  users.lastName,
      role:      users.role,
      isActive:  users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.orgId, auth.orgId))
    .orderBy(users.createdAt);

  res.json(members);
});

// ── POST /team/invite ─────────────────────────────────────────────────────────
const InviteSchema = z.object({
  email: z.string().email(),
  role:  z.enum(["admin", "member"]).default("member"),
});

router.post("/team/invite", async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req, res);
  if (!auth) return;

  if (auth.role !== "owner" && auth.role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can invite team members" });
    return;
  }

  const parsed = InviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { email, role } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  // Check if user already belongs to this org
  const [existingUser] = await db
    .select({ id: users.id, orgId: users.orgId })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`);

  if (existingUser) {
    if (existingUser.orgId === auth.orgId) {
      res.status(409).json({ error: "This person is already a member of your team" });
      return;
    }
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  // Invalidate any existing pending invites for this email + org
  await db
    .delete(inviteTokens)
    .where(
      and(
        sql`lower(${inviteTokens.email}) = ${normalizedEmail}`,
        eq(inviteTokens.orgId, auth.orgId),
      )
    );

  // Create invite token (valid 7 days)
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(inviteTokens).values({
    token,
    email: normalizedEmail,
    orgId: auth.orgId,
    role,
    invitedById: auth.userId,
    expiresAt,
  });

  // Fetch org name for the email
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, auth.orgId));

  const [inviter] = await db
    .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(users)
    .where(eq(users.id, auth.userId));

  const inviterName = inviter
    ? ([inviter.firstName, inviter.lastName].filter(Boolean).join(" ") || inviter.email)
    : "Your team";

  const orgName = org?.name ?? "Mysa AI";

  const baseUrl = getAppBaseUrl();
  const acceptUrl = `${baseUrl}/v1/invite/${token}`;

  try {
    await sendViaBrevo({
      to: [{ email: normalizedEmail }],
      subject: `${inviterName} invited you to join ${orgName} on Mysa AI`,
      htmlContent: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <div style="margin-bottom:24px;">
            <div style="font-size:20px;font-weight:700;color:#111827;margin-bottom:4px;">You've been invited!</div>
            <div style="font-size:14px;color:#6b7280;">${inviterName} has invited you to collaborate on <strong>${orgName}</strong> in Mysa AI.</div>
          </div>
          <a href="${acceptUrl}"
            style="display:inline-block;background:#1A3D2B;color:#fff;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;margin-bottom:24px;">
            Accept Invitation
          </a>
          <div style="font-size:12px;color:#9ca3af;margin-top:8px;">
            This link expires in 7 days. If you weren't expecting this invitation, you can safely ignore this email.
          </div>
          <div style="margin-top:16px;font-size:12px;color:#d1d5db;">
            Or copy this URL into your browser:<br/>
            <span style="color:#6b7280;word-break:break-all;">${acceptUrl}</span>
          </div>
        </div>
      `,
      textContent: `${inviterName} has invited you to join ${orgName} on Mysa AI.\n\nAccept the invitation here: ${acceptUrl}\n\nThis link expires in 7 days.`,
    });
  } catch (err) {
    logger.error({ err }, "[team/invite] email send error");
    res.status(500).json({ error: "Failed to send invitation email. Please check your email settings." });
    return;
  }

  res.json({ ok: true, email: normalizedEmail });
});

// ── GET /team/invite/:token ───────────────────────────────────────────────────
// Public endpoint — verify a token before the user fills out the form
router.get("/team/invite/:token", async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params as { token: string };

  const [invite] = await db
    .select()
    .from(inviteTokens)
    .where(eq(inviteTokens.token, token));

  if (!invite) {
    res.status(404).json({ error: "Invitation not found or already used" });
    return;
  }

  if (invite.acceptedAt) {
    res.status(409).json({ error: "This invitation has already been accepted" });
    return;
  }

  if (invite.expiresAt < new Date()) {
    res.status(410).json({ error: "This invitation has expired" });
    return;
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.orgId));

  res.json({
    email:   invite.email,
    role:    invite.role,
    orgName: org?.name ?? "Mysa AI",
  });
});

// ── POST /team/accept-invite ──────────────────────────────────────────────────
// Public endpoint — create the user account and set the session
const AcceptSchema = z.object({
  token:     z.string().min(1),
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  password:  z.string().min(8),
});

router.post("/team/accept-invite", async (req: Request, res: Response): Promise<void> => {
  const parsed = AcceptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { token, firstName, lastName, password } = parsed.data;

  const [invite] = await db
    .select()
    .from(inviteTokens)
    .where(eq(inviteTokens.token, token));

  if (!invite) {
    res.status(404).json({ error: "Invitation not found or already used" });
    return;
  }
  if (invite.acceptedAt) {
    res.status(409).json({ error: "This invitation has already been accepted" });
    return;
  }
  if (invite.expiresAt < new Date()) {
    res.status(410).json({ error: "This invitation has expired" });
    return;
  }

  // Ensure no existing user with that email
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${invite.email.toLowerCase()}`);

  if (existingUser) {
    res.status(409).json({ error: "A user with this email already exists. Please log in instead." });
    return;
  }

  // Create user + mark invite accepted in a transaction
  const result = await db.transaction(async (tx) => {
    const [newUser] = await tx
      .insert(users)
      .values({
        email:        invite.email,
        passwordHash: await hashPassword(password),
        firstName:    firstName.trim(),
        lastName:     lastName.trim(),
        orgId:        invite.orgId,
        role:         invite.role,
        isActive:     true,
        isVerified:   true,
      })
      .returning();

    await tx
      .update(inviteTokens)
      .set({ acceptedAt: new Date() })
      .where(eq(inviteTokens.id, invite.id));

    return newUser!;
  });

  const COOKIE_OPTS = {
    httpOnly: true,
    sameSite: "none" as const,
    secure:   true,
    maxAge:   30 * 24 * 60 * 60 * 1000,
    path:     "/",
  };

  const authToken = signToken({
    userId: result.id,
    orgId:  invite.orgId,
    email:  result.email,
    role:   result.role,
  });

  res.cookie("mysa_token", authToken, COOKIE_OPTS);
  res.status(201).json({
    ok:    true,
    email: result.email,
    orgId: invite.orgId,
    role:  result.role,
  });
});

// ── PATCH /team/members/:id ───────────────────────────────────────────────────
const UpdateMemberSchema = z.object({
  role:     z.enum(["admin", "member"]).optional(),
  isActive: z.boolean().optional(),
});

router.patch("/team/members/:id", async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req, res);
  if (!auth) return;

  if (auth.role !== "owner" && auth.role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can manage team members" });
    return;
  }

  const memberId = Number(req.params["id"]);
  if (isNaN(memberId)) {
    res.status(400).json({ error: "Invalid member ID" });
    return;
  }

  // Can't modify yourself
  if (memberId === auth.userId) {
    res.status(400).json({ error: "You cannot modify your own role or status here" });
    return;
  }

  const parsed = UpdateMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  // Ensure the target member belongs to the same org
  const [target] = await db
    .select({ id: users.id, role: users.role, orgId: users.orgId })
    .from(users)
    .where(and(eq(users.id, memberId), eq(users.orgId, auth.orgId)));

  if (!target) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  // Admins cannot modify other admins or the owner
  if (auth.role === "admin" && (target.role === "owner" || target.role === "admin")) {
    res.status(403).json({ error: "Admins can only manage member-level users" });
    return;
  }

  // Cannot promote someone to owner via this endpoint
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.role     !== undefined) updates["role"]     = parsed.data.role;
  if (parsed.data.isActive !== undefined) updates["isActive"] = parsed.data.isActive;

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, memberId))
    .returning({
      id:        users.id,
      email:     users.email,
      firstName: users.firstName,
      lastName:  users.lastName,
      role:      users.role,
      isActive:  users.isActive,
    });

  res.json(updated);
});

// ── DELETE /team/members/:id ──────────────────────────────────────────────────
router.delete("/team/members/:id", async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req, res);
  if (!auth) return;

  if (auth.role !== "owner") {
    res.status(403).json({ error: "Only the account owner can remove team members" });
    return;
  }

  const memberId = Number(req.params["id"]);
  if (isNaN(memberId)) {
    res.status(400).json({ error: "Invalid member ID" });
    return;
  }

  if (memberId === auth.userId) {
    res.status(400).json({ error: "You cannot remove yourself" });
    return;
  }

  // Ensure belongs to same org
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, memberId), eq(users.orgId, auth.orgId)));

  if (!target) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  await db.delete(users).where(eq(users.id, memberId));

  res.json({ ok: true });
});

// ── GET /team/pending-invites ─────────────────────────────────────────────────
router.get("/team/pending-invites", async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req, res);
  if (!auth) return;

  if (auth.role !== "owner" && auth.role !== "admin") {
    res.json([]);
    return;
  }

  try {
    const pending = await db
      .select({
        id:        inviteTokens.id,
        email:     inviteTokens.email,
        role:      inviteTokens.role,
        expiresAt: inviteTokens.expiresAt,
        createdAt: inviteTokens.createdAt,
      })
      .from(inviteTokens)
      .where(
        and(
          eq(inviteTokens.orgId, auth.orgId),
          sql`${inviteTokens.acceptedAt} IS NULL`,
          gt(inviteTokens.expiresAt, new Date()),
        )
      )
      .orderBy(inviteTokens.createdAt);
    res.json(pending);
  } catch (err) {
    logger.error({ err }, "[team/pending-invites] query error");
    res.json([]);
  }
});

// ── DELETE /team/pending-invites/:id ─────────────────────────────────────────
router.delete("/team/pending-invites/:id", async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req, res);
  if (!auth) return;

  if (auth.role !== "owner" && auth.role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can revoke invitations" });
    return;
  }

  const inviteId = Number(req.params["id"]);
  if (isNaN(inviteId)) {
    res.status(400).json({ error: "Invalid invite ID" });
    return;
  }

  await db
    .delete(inviteTokens)
    .where(and(eq(inviteTokens.id, inviteId), eq(inviteTokens.orgId, auth.orgId)));

  res.json({ ok: true });
});

export default router;

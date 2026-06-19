import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import https from "node:https";
import { db } from "../lib/db";
import { users, organizations } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { signToken } from "./auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const COOKIE_NAME = "mysa_token";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "none" as const,
  secure:   true,
  maxAge:   30 * 24 * 60 * 60 * 1000,
  path:     "/",
};

function getBaseUrl(): string {
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  return domain ? `https://${domain}` : (process.env["APP_BASE_URL"] ?? "http://localhost:8080");
}

// ── tiny HTTPS POST helper ────────────────────────────────────────────────────
function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── tiny HTTPS GET helper ─────────────────────────────────────────────────────
function httpsGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers,
    }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.end();
  });
}

// ── find-or-create user from OAuth profile ───────────────────────────────────
async function findOrCreateOAuthUser(profile: {
  email: string;
  firstName: string;
  lastName: string;
  provider: "google" | "microsoft";
}) {
  const normalizedEmail = profile.email.toLowerCase().trim();

  // Check for existing user
  const [existingUser] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`);

  if (existingUser) {
    // Mark as verified if they weren't (email confirmed by OAuth provider)
    if (!existingUser.isVerified) {
      await db
        .update(users)
        .set({ isVerified: true, verificationToken: null })
        .where(sql`lower(${users.email}) = ${normalizedEmail}`);
    }
    return { ...existingUser, isVerified: true };
  }

  // New user — derive company name from email domain
  const domain = normalizedEmail.split("@")[1] ?? "";
  const companyName = domain
    ? domain.split(".")[0]!.charAt(0).toUpperCase() + domain.split(".")[0]!.slice(1)
    : "My Company";

  const result = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name:      companyName,
        email:     normalizedEmail,
        ownerName: `${profile.firstName} ${profile.lastName}`,
        plan:      "trial",
        subscriptionStatus: "trialing",
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      })
      .returning();

    const [user] = await tx
      .insert(users)
      .values({
        email:             normalizedEmail,
        passwordHash:      crypto.randomBytes(32).toString("hex"), // unusable pw for OAuth users
        firstName:         profile.firstName,
        lastName:          profile.lastName,
        orgId:             org!.id,
        role:              "owner",
        isActive:          true,
        isVerified:        true,   // email proven by OAuth provider
        verificationToken: null,
      })
      .returning();

    return { org: org!, user: user! };
  });

  return result.user;
}

// ══════════════════════════════════════════════════════════════════════════════
//  GOOGLE OAUTH
// ══════════════════════════════════════════════════════════════════════════════

// GET /auth/google — kick off OAuth flow
router.get("/auth/google", (req: Request, res: Response): void => {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  if (!clientId) {
    res.status(503).send("Google sign-in is not configured. Please add GOOGLE_CLIENT_ID.");
    return;
  }

  const baseUrl = getBaseUrl();
  const redirectUri = `${baseUrl}/api/auth/google/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  // Store state in a short-lived cookie so we can verify on callback
  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "openid email profile",
    access_type:   "online",
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// GET /auth/google/callback — exchange code for profile, login/register user
router.get("/auth/google/callback", async (req: Request, res: Response): Promise<void> => {
  const clientId     = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const baseUrl      = getBaseUrl();
  const appUrl       = "/v1/";

  if (!clientId || !clientSecret) {
    res.redirect(`${appUrl}login?error=oauth_not_configured`);
    return;
  }

  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    logger.warn({ error }, "Google OAuth error from provider");
    res.redirect(`${appUrl}login?error=oauth_denied`);
    return;
  }

  // Validate state (CSRF protection)
  const storedState = (req.cookies as Record<string, string>)["oauth_state"];
  res.clearCookie("oauth_state", { path: "/" });
  if (!state || state !== storedState) {
    logger.warn("Google OAuth state mismatch");
    res.redirect(`${appUrl}login?error=state_mismatch`);
    return;
  }

  if (!code) {
    res.redirect(`${appUrl}login?error=no_code`);
    return;
  }

  try {
    // Exchange code for tokens
    const redirectUri = `${baseUrl}/api/auth/google/callback`;
    const tokenBody = new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }).toString();

    const tokenRaw = await httpsPost(
      "https://oauth2.googleapis.com/token",
      tokenBody,
      { "Content-Type": "application/x-www-form-urlencoded" },
    );

    const tokenData = JSON.parse(tokenRaw) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      logger.error({ tokenData }, "Google token exchange failed");
      res.redirect(`${appUrl}login?error=token_exchange_failed`);
      return;
    }

    // Fetch user profile
    const profileRaw = await httpsGet(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { Authorization: `Bearer ${tokenData.access_token}` },
    );

    const profile = JSON.parse(profileRaw) as {
      id?: string;
      email?: string;
      given_name?: string;
      family_name?: string;
      name?: string;
      picture?: string;
      verified_email?: boolean;
    };

    if (!profile.email) {
      res.redirect(`${appUrl}login?error=no_email`);
      return;
    }

    const firstName = profile.given_name ?? profile.name?.split(" ")[0] ?? "User";
    const lastName  = profile.family_name ?? profile.name?.split(" ").slice(1).join(" ") ?? "";

    const user = await findOrCreateOAuthUser({
      email: profile.email,
      firstName,
      lastName,
      provider: "google",
    });

    // Issue session cookie
    const token = signToken({
      userId: user.id,
      orgId:  user.orgId ?? 1,
      email:  user.email,
      role:   user.role,
    });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);

    // Redirect into the app
    res.redirect(appUrl);
  } catch (err) {
    logger.error({ err }, "Google OAuth callback error");
    res.redirect(`${appUrl}login?error=server_error`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  MICROSOFT OAUTH
// ══════════════════════════════════════════════════════════════════════════════

// GET /auth/microsoft — kick off OAuth flow
router.get("/auth/microsoft", (req: Request, res: Response): void => {
  const clientId = process.env["MICROSOFT_CLIENT_ID"];
  if (!clientId) {
    res.status(503).send("Microsoft sign-in is not configured. Please add MICROSOFT_CLIENT_ID.");
    return;
  }

  const baseUrl    = getBaseUrl();
  const redirectUri = `${baseUrl}/api/auth/microsoft/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  const tenantId = process.env["MICROSOFT_TENANT_ID"] ?? "common";
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "openid email profile User.Read",
    state,
  });

  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`);
});

// GET /auth/microsoft/callback
router.get("/auth/microsoft/callback", async (req: Request, res: Response): Promise<void> => {
  const clientId     = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  const baseUrl      = getBaseUrl();
  const appUrl       = "/v1/";

  if (!clientId || !clientSecret) {
    res.redirect(`${appUrl}login?error=oauth_not_configured`);
    return;
  }

  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    logger.warn({ error }, "Microsoft OAuth error from provider");
    res.redirect(`${appUrl}login?error=oauth_denied`);
    return;
  }

  const storedState = (req.cookies as Record<string, string>)["oauth_state"];
  res.clearCookie("oauth_state", { path: "/" });
  if (!state || state !== storedState) {
    logger.warn("Microsoft OAuth state mismatch");
    res.redirect(`${appUrl}login?error=state_mismatch`);
    return;
  }

  if (!code) {
    res.redirect(`${appUrl}login?error=no_code`);
    return;
  }

  try {
    const redirectUri = `${baseUrl}/api/auth/microsoft/callback`;
    const tenantId = process.env["MICROSOFT_TENANT_ID"] ?? "common";

    const tokenBody = new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
      scope:         "openid email profile User.Read",
    }).toString();

    const tokenRaw = await httpsPost(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      tokenBody,
      { "Content-Type": "application/x-www-form-urlencoded" },
    );

    const tokenData = JSON.parse(tokenRaw) as {
      access_token?: string;
      error?: string;
    };

    if (!tokenData.access_token) {
      logger.error({ tokenData }, "Microsoft token exchange failed");
      res.redirect(`${appUrl}login?error=token_exchange_failed`);
      return;
    }

    // Fetch user profile via Microsoft Graph
    const profileRaw = await httpsGet(
      "https://graph.microsoft.com/v1.0/me?$select=displayName,givenName,surname,mail,userPrincipalName",
      { Authorization: `Bearer ${tokenData.access_token}` },
    );

    const profile = JSON.parse(profileRaw) as {
      displayName?: string;
      givenName?: string;
      surname?: string;
      mail?: string;
      userPrincipalName?: string;
    };

    const email = profile.mail ?? profile.userPrincipalName;
    if (!email || email.includes("#EXT#")) {
      res.redirect(`${appUrl}login?error=no_email`);
      return;
    }

    const firstName = profile.givenName ?? profile.displayName?.split(" ")[0] ?? "User";
    const lastName  = profile.surname   ?? profile.displayName?.split(" ").slice(1).join(" ") ?? "";

    const user = await findOrCreateOAuthUser({
      email,
      firstName,
      lastName,
      provider: "microsoft",
    });

    const token = signToken({
      userId: user.id,
      orgId:  user.orgId ?? 1,
      email:  user.email,
      role:   user.role,
    });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.redirect(appUrl);
  } catch (err) {
    logger.error({ err }, "Microsoft OAuth callback error");
    res.redirect(`${appUrl}login?error=server_error`);
  }
});

export default router;

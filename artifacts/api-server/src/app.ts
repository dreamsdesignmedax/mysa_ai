import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { WebhookHandlers } from "./webhookHandlers";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { verifyToken } from "./routes/auth";
import { db } from "./lib/db";
import { users } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

import "./types/express.d.ts";

const PUBLIC_PATHS: string[] = [
  "/api/healthz",
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/auth/trigger-resend",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/auth/microsoft",
  "/api/auth/microsoft/callback",
  "/api/auth/otp/available",
  "/api/auth/otp/firebase-verify",
  "/api/feedback",
  "/api/docs",
  "/api/appointments/slots",
  "/api/team/accept-invite",
];

function isPublicPath(fullPath: string, method?: string): boolean {
  if (PUBLIC_PATHS.includes(fullPath)) return true;
  if (fullPath.startsWith("/api/audit/share/")) return true;
  if (fullPath.startsWith("/api/team/invite/") && method === "GET") return true;
  if (fullPath.startsWith("/api/tracking/")) return true;
  if (fullPath.startsWith("/api/book")) return true;
  if (fullPath.startsWith("/api/whatsapp/webhook")) return true;
  if (fullPath.startsWith("/api/integrations/google/callback")) return true;
  if (fullPath.startsWith("/api/integrations/zoom/webhook")) return true;
  if (fullPath.startsWith("/api/billing/razorpay/webhook")) return true;
  // Public booking endpoint (client-facing form, no auth required)
  if (fullPath === "/api/appointments" && method === "POST") return true;
  // Waitlist submission is public; reading the list requires authentication
  if (fullPath === "/api/waitlist" && method === "POST") return true;
  return false;
}

const app: Express = express();

app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

app.disable("x-powered-by");
app.use(compression());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Build the allowed origins list automatically from Replit env vars so both
// the dev workspace and the production deployment work without any manual config.
function buildAllowedOrigins(): string[] | null {
  const manual = process.env["CORS_ALLOWED_ORIGINS"];
  const list: string[] = manual ? manual.split(",").map((o) => o.trim()) : [];

  // Always allow requests from the same Replit deployment domain(s)
  const replitDomains = process.env["REPLIT_DOMAINS"];
  if (replitDomains) {
    replitDomains.split(",").forEach((d) => {
      const origin = `https://${d.trim()}`;
      if (!list.includes(origin)) list.push(origin);
    });
  }

  // Also allow the dev workspace domain
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) {
    const origin = `https://${devDomain}`;
    if (!list.includes(origin)) list.push(origin);
  }

  return list.length > 0 ? list : null;
}

const allowedOrigins = buildAllowedOrigins();

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (!allowedOrigins) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Also allow any subdomain of replit.app or replit.dev (Replit proxy)
      if (/\.replit\.(app|dev|co)$/.test(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
  }),
);

// ── Stripe webhook (MUST be before express.json parses the body) ──────────────
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) { res.status(400).json({ error: "Missing stripe-signature" }); return; }
    try {
      const sig = Array.isArray(signature) ? signature[0]! : signature;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      res.status(400).json({ error: "Webhook error: " + String(err) });
    }
  }
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({
  limit: "2mb",
  verify: (req: Request, _res, buf) => {
    (req as Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  skip: (req) => isPublicPath(`/api${req.path}`, req.method),
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a minute." },
});

app.use("/api", generalLimiter);
app.use("/api/auth/login", authLimiter);

// ── Request timeout (30 s) ───────────────────────────────────────────────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setTimeout(30_000, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout" });
    }
  });
  next();
});

// ── Authentication guard + req.user attachment ────────────────────────────────
app.use("/api", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const fullPath = `/api${req.path}`;
  if (isPublicPath(fullPath, req.method)) return next();

  const token = (req.cookies as Record<string, string | undefined>)?.["mysa_token"];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const data = verifyToken(token);
  if (!data) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // New token format — has userId and orgId embedded
  if (data.userId && data.orgId) {
    // Check isActive to honour deactivation immediately (don't rely on token expiry)
    try {
      const [dbUser] = await db
        .select({ id: users.id, orgId: users.orgId, email: users.email, role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, data.userId));

      if (dbUser) {
        if (!dbUser.isActive) {
          res.status(401).json({ error: "Account is deactivated" });
          return;
        }
        req.user = {
          userId: dbUser.id,
          orgId:  dbUser.orgId ?? data.orgId,
          email:  dbUser.email,
          role:   dbUser.role,
        };
        return next();
      }
    } catch {
      // DB unavailable — fall through to token-only path
    }

    // Bootstrap / env-only user: no DB row, trust token
    req.user = {
      userId: data.userId,
      orgId:  data.orgId,
      email:  data.email,
      role:   data.role ?? "owner",
    };
    return next();
  }

  // Backward compat: old token only has email — look up in DB
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${data.email.toLowerCase()}`);

    if (user) {
      if (!user.isActive) {
        res.status(401).json({ error: "Account is deactivated" });
        return;
      }
      req.user = {
        userId: user.id,
        orgId:  user.orgId ?? 1,
        email:  user.email,
        role:   user.role,
      };
    } else {
      // Bootstrap fallback (env-var login, no DB user yet)
      req.user = { userId: 1, orgId: 1, email: data.email, role: "owner" };
    }
  } catch {
    // DB unavailable — bootstrap fallback
    req.user = { userId: 1, orgId: 1, email: data.email, role: "owner" };
  }

  next();
});

// ── Role guard middleware ─────────────────────────────────────────────────────
export { requireOwnerOrAdmin } from "./middleware";

// ── Docs (public, no auth) ────────────────────────────────────────────────────
app.get("/api/docs", (_req: Request, res: Response) => {
  const docsPath = path.resolve(process.cwd(), "../../docs/mysa-ai-technical-docs.html");
  if (existsSync(docsPath)) {
    res.sendFile(docsPath);
  } else {
    res.status(404).send("Documentation file not found.");
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, method: req.method, path: req.path }, "Unhandled error");
  if (res.headersSent) return;
  const isDev = process.env["NODE_ENV"] !== "production";
  res.status(500).json({
    error: "Internal server error",
    ...(isDev ? { message: err.message, stack: err.stack } : {}),
  });
});

export default app;

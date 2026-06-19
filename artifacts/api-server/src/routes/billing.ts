import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { organizations } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { getLimits, PLAN_LIMITS } from "../config/planLimits";
import { logger } from "../lib/logger";

const router = Router();

const RAZORPAY_KEY_ID     = process.env["RAZORPAY_KEY_ID"];
const RAZORPAY_KEY_SECRET = process.env["RAZORPAY_KEY_SECRET"];

// ── Server-side pending-order registry (security: planKey is NEVER trusted from client) ─
interface PendingOrder {
  planKey:       string;
  orgId:         number;
  amountInPaise: number;
  interval:      "monthly" | "yearly";
  expiresAt:     number;
}
const pendingOrders = new Map<string, PendingOrder>();

// Prune expired entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingOrders.entries()) {
    if (val.expiresAt < now) pendingOrders.delete(key);
  }
}, 30 * 60 * 1000);

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

async function createRazorpayOrder(amountInPaise: number, currency = "INR", receipt: string): Promise<RazorpayOrder> {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay credentials not configured");
  }
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ amount: amountInPaise, currency, receipt, payment_capture: 1 }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Razorpay order failed: ${err}`);
  }
  return res.json() as Promise<RazorpayOrder>;
}

async function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): Promise<boolean> {
  if (!RAZORPAY_KEY_SECRET) return false;
  const crypto = await import("node:crypto");
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(body).digest("hex");
  return expectedSignature === signature;
}

// ── GET /api/billing/current-plan ─────────────────────────────────────────────
router.get("/billing/current-plan", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }

  const plan = org.plan ?? "trial";
  const limits = getLimits(plan);
  const now = new Date();
  const trialEndsAt = org.trialEndsAt ? new Date(org.trialEndsAt) : null;
  const trialExpired = org.trialExpired || (plan === "trial" && trialEndsAt !== null && now > trialEndsAt);
  const trialDaysLeft = trialEndsAt && !trialExpired
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  res.json({
    plan,
    subscriptionStatus: org.subscriptionStatus,
    trialEndsAt: org.trialEndsAt,
    trialStartedAt: org.trialStartedAt,
    trialExpired,
    trialDaysLeft,
    currentPeriodEnd: org.currentPeriodEnd,
    usage: {
      leads:  { used: org.leadsUsedThisMonth,  max: limits.leads_max },
      audits: { used: org.auditsUsedThisMonth, max: limits.audits_max },
      emails: { used: org.emailsUsedThisMonth, max: limits.emails_max },
    },
    features: {
      autopilot:    limits.autopilot,
      whatsapp_api: limits.whatsapp_api,
      hubspot_sync: limits.hubspot_sync,
      sales_brain:  limits.sales_brain,
      white_label:  limits.white_label,
      data_fetch:   limits.data_fetch,
      users_max:    limits.users_max,
      icps_max:     limits.icps_max,
    },
  });
});

// ── GET /api/billing/plans ─────────────────────────────────────────────────────
router.get("/billing/plans", (_req: Request, res: Response): void => {
  const plans = [
    {
      key: "solo",
      name: "Solo",
      tagline: "Perfect for solo founders & freelancers",
      priceINR: 2499,
      priceINRYearly: Math.round(2499 * 12 * 0.8),
      leads_max:  PLAN_LIMITS.solo.leads_max,
      audits_max: PLAN_LIMITS.solo.audits_max,
      emails_max: PLAN_LIMITS.solo.emails_max,
      users_max:  PLAN_LIMITS.solo.users_max,
      features:   PLAN_LIMITS.solo,
      highlight:  false,
    },
    {
      key: "growth",
      name: "Growth",
      tagline: "For growing agencies & small teams",
      priceINR: 6999,
      priceINRYearly: Math.round(6999 * 12 * 0.8),
      leads_max:  PLAN_LIMITS.growth.leads_max,
      audits_max: PLAN_LIMITS.growth.audits_max,
      emails_max: PLAN_LIMITS.growth.emails_max,
      users_max:  PLAN_LIMITS.growth.users_max,
      features:   PLAN_LIMITS.growth,
      highlight:  true,
    },
    {
      key: "agency",
      name: "Agency",
      tagline: "Unlimited power for established agencies",
      priceINR: 14999,
      priceINRYearly: Math.round(14999 * 12 * 0.8),
      leads_max:  PLAN_LIMITS.agency.leads_max,
      audits_max: PLAN_LIMITS.agency.audits_max,
      emails_max: PLAN_LIMITS.agency.emails_max,
      users_max:  PLAN_LIMITS.agency.users_max,
      features:   PLAN_LIMITS.agency,
      highlight:  false,
    },
  ];
  res.json({ plans, razorpayKeyId: RAZORPAY_KEY_ID ?? null });
});

// ── POST /api/billing/razorpay/create-order ───────────────────────────────────
router.post("/billing/razorpay/create-order", async (req: Request, res: Response): Promise<void> => {
  const { planKey, interval = "monthly" } = req.body as { planKey: string; interval?: "monthly" | "yearly" };
  const orgId = req.user!.orgId;

  const planPrices: Record<string, { monthly: number; yearly: number }> = {
    solo:   { monthly: 249900,  yearly: Math.round(2499  * 12 * 0.8 * 100) },
    growth: { monthly: 699900,  yearly: Math.round(6999  * 12 * 0.8 * 100) },
    agency: { monthly: 1499900, yearly: Math.round(14999 * 12 * 0.8 * 100) },
  };

  const priceMap = planPrices[planKey];
  if (!priceMap) { res.status(400).json({ error: "Invalid plan" }); return; }

  const amountInPaise = interval === "yearly" ? priceMap.yearly : priceMap.monthly;
  const receipt = `org_${orgId}_${planKey}_${Date.now()}`;

  try {
    const order = await createRazorpayOrder(amountInPaise, "INR", receipt);

    // ── Store intent server-side: planKey is NEVER accepted from client in verify ──
    pendingOrders.set(order.id, {
      planKey,
      orgId,
      amountInPaise,
      interval,
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 min TTL
    });

    res.json({ id: order.id, amount: order.amount, currency: order.currency, receipt });
  } catch (err) {
    logger.error({ err }, "Razorpay order creation failed");
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/billing/razorpay/verify (+ /verify-payment alias) ───────────────
async function handleRazorpayVerify(req: Request, res: Response): Promise<void> {
  const { orderId, paymentId, signature } = req.body as {
    orderId:   string;
    paymentId: string;
    signature: string;
    planKey?:  string;   // accepted from client but IGNORED — server-side intent is used
    interval?: string;
  };
  const orgId = req.user!.orgId;

  // ── Validate HMAC signature ────────────────────────────────────────────────
  const valid = await verifyRazorpaySignature(orderId, paymentId, signature);
  if (!valid) {
    res.status(400).json({ error: "Invalid payment signature" });
    return;
  }

  // ── Validate server-side order intent ─────────────────────────────────────
  const intent = pendingOrders.get(orderId);
  if (!intent) {
    res.status(400).json({ error: "Order not found or expired. Please try again." });
    return;
  }
  if (intent.orgId !== orgId) {
    res.status(403).json({ error: "Order does not belong to this organization" });
    return;
  }

  // Use server-stored planKey (never trust client)
  const verifiedPlanKey = intent.planKey;
  const verifiedInterval = intent.interval;
  pendingOrders.delete(orderId); // consume — single use

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + (verifiedInterval === "yearly" ? 12 : 1));

  // Update plan + reset usage counters on successful upgrade
  await db.update(organizations).set({
    plan:                verifiedPlanKey,
    subscriptionStatus:  "active",
    trialExpired:        false,
    currentPeriodEnd:    periodEnd,
    leadsUsedThisMonth:  0,
    auditsUsedThisMonth: 0,
    emailsUsedThisMonth: 0,
    updatedAt:           sql`now()`,
  }).where(eq(organizations.id, orgId));

  logger.info({ orgId, planKey: verifiedPlanKey, interval: verifiedInterval, paymentId }, "Razorpay payment verified — plan upgraded");
  res.json({ success: true, plan: verifiedPlanKey });
}
router.post("/billing/razorpay/verify",         handleRazorpayVerify);
router.post("/billing/razorpay/verify-payment", handleRazorpayVerify);

// ── POST /api/billing/razorpay/webhook ────────────────────────────────────────
router.post("/billing/razorpay/webhook", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env["RAZORPAY_WEBHOOK_SECRET"];
  if (secret) {
    const crypto = await import("node:crypto");
    const sig = req.headers["x-razorpay-signature"];
    const body = JSON.stringify(req.body);
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    if (sig !== expected) { res.status(400).json({ error: "Invalid signature" }); return; }
  }

  const event = req.body as { event?: string };
  logger.info({ event: event.event }, "Razorpay webhook received");
  res.json({ ok: true });
});

// ── POST /api/billing/contact-sales ───────────────────────────────────────────
router.post("/billing/contact-sales", async (req: Request, res: Response): Promise<void> => {
  const { message } = req.body as { message?: string };
  const orgId = req.user!.orgId;
  logger.info({ orgId, message }, "Sales contact request");
  res.json({ ok: true, message: "We've received your message and will reach out within 24 hours." });
});

export default router;

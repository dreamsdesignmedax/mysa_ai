import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { organizations, waitlist } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { storage } from "../storage";
import { stripeService } from "../stripeService";
import { logger } from "../lib/logger";

const router = Router();

const BASE_URL = process.env["APP_URL"] ?? `https://${process.env["REPLIT_DOMAINS"]?.split(",")[0] ?? "localhost"}`;

// ── Public: List products with prices (for pricing page) ─────────────────────
router.get("/stripe/products", async (_req: Request, res: Response) => {
  try {
    const rows = await storage.listProductsWithPrices(true);
    const productsMap = new Map<string, Record<string, unknown>>();
    for (const row of rows as Record<string, unknown>[]) {
      const pid = row.product_id as string;
      if (!productsMap.has(pid)) {
        productsMap.set(pid, {
          id: pid,
          name: row.product_name,
          description: row.product_description,
          metadata: row.product_metadata,
          images: row.product_images,
          prices: [],
        });
      }
      if (row.price_id) {
        (productsMap.get(pid)!.prices as unknown[]).push({
          id: row.price_id,
          unitAmount: row.unit_amount,
          currency: row.currency,
          recurring: row.recurring,
        });
      }
    }
    res.json({ data: Array.from(productsMap.values()) });
  } catch {
    res.json({ data: [] });
  }
});

// ── Create checkout session ───────────────────────────────────────────────────
router.post("/stripe/checkout", async (req: Request, res: Response) => {
  try {
    const { priceId, orgId, email, name, orgName } = req.body as {
      priceId: string; orgId?: number; email?: string; name?: string; orgName?: string;
    };

    if (!priceId) { res.status(400).json({ error: "priceId required" }); return; }

    let targetOrgId = orgId;

    // New user checkout: create an org first
    if (!targetOrgId && email) {
      let org = await storage.getOrganizationByEmail(email);
      if (!org) {
        const [newOrg] = await db.insert(organizations).values({
          email,
          name: orgName ?? name ?? email.split("@")[0] ?? "New Org",
          ownerName: name ?? null,
          plan: "trial",
          subscriptionStatus: "trialing",
          trialEndsAt: new Date(Date.now() + 7 * 86400000),
        }).returning();
        org = newOrg!;
      }
      targetOrgId = org.id;
    }

    if (!targetOrgId) { res.status(400).json({ error: "orgId or email required" }); return; }

    const customerId = await stripeService.getOrCreateCustomer(targetOrgId);

    const session = await stripeService.createCheckoutSession({
      customerId,
      priceId,
      orgId: targetOrgId,
      successUrl: `${BASE_URL}/sales-war-machine/billing?success=1`,
      cancelUrl: `${BASE_URL}/mysa-landing?canceled=1`,
      trialDays: 7,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Customer portal session ───────────────────────────────────────────────────
router.post("/stripe/portal", async (req: Request, res: Response) => {
  try {
    const { orgId } = req.body as { orgId?: number };
    if (!orgId) { res.status(400).json({ error: "orgId required" }); return; }

    const org = await storage.getOrganization(orgId);
    if (!org?.stripeCustomerId) { res.status(404).json({ error: "No Stripe customer" }); return; }

    const session = await stripeService.createCustomerPortalSession(
      org.stripeCustomerId,
      `${BASE_URL}/sales-war-machine/billing`
    );
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get subscription for org ──────────────────────────────────────────────────
router.get("/stripe/subscription/:orgId", async (req: Request, res: Response) => {
  try {
    const orgId = Number(req.params.orgId);
    const org = await storage.getOrganization(orgId);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    if (!org.stripeSubscriptionId) {
      res.json({ subscription: null, org });
      return;
    }

    const sub = await storage.getSubscription(org.stripeSubscriptionId);
    const invoices = org.stripeCustomerId ? await storage.getInvoices(org.stripeCustomerId) : [];
    res.json({ subscription: sub, invoices, org });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Waitlist → invite org ─────────────────────────────────────────────────────
router.post("/saas/waitlist/:id/invite", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [entry] = await db.select().from(waitlist).where(eq(waitlist.id, id)).limit(1);
    if (!entry) { res.status(404).json({ error: "Waitlist entry not found" }); return; }

    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const [org] = await db.insert(organizations).values({
      email: entry.email,
      name: entry.company ?? entry.name,
      ownerName: entry.name,
      plan: "trial",
      subscriptionStatus: "trialing",
      trialEndsAt: new Date(Date.now() + 7 * 86400000),
      inviteToken: token,
      inviteSentAt: new Date(),
    }).returning();

    // Mark waitlist as approved
    await db.update(waitlist).set({ approved: true }).where(eq(waitlist.id, id));

    res.json({ ok: true, org, inviteToken: token });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

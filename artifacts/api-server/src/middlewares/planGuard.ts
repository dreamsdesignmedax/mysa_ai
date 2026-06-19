import type { Request, Response, NextFunction } from "express";
import { db } from "../lib/db";
import { organizations } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getLimits, isPlanKey, type PlanLimits } from "../config/planLimits";

async function getOrg(orgId: number) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return org ?? null;
}

export function checkTrialExpired(org: {
  plan: string;
  trialExpired: boolean;
  trialEndsAt: Date | null;
}): boolean {
  if (org.plan !== "trial") return false;
  if (org.trialExpired) return true;
  if (org.trialEndsAt && new Date() > new Date(org.trialEndsAt)) return true;
  return false;
}

export function checkLimit(
  org: { plan: string; leadsUsedThisMonth: number; auditsUsedThisMonth: number; emailsUsedThisMonth: number },
  resource: "leads" | "audits" | "emails",
): { allowed: boolean; reason?: string; upgrade?: boolean } {
  const limits: PlanLimits = getLimits(org.plan);

  if (resource === "leads" && limits.leads_max !== -1 && org.leadsUsedThisMonth >= limits.leads_max) {
    return { allowed: false, reason: `Lead limit reached (${limits.leads_max} max on ${org.plan} plan)`, upgrade: true };
  }
  if (resource === "audits" && limits.audits_max !== -1 && org.auditsUsedThisMonth >= limits.audits_max) {
    return { allowed: false, reason: `Audit limit reached (${limits.audits_max} max on ${org.plan} plan)`, upgrade: true };
  }
  if (resource === "emails" && limits.emails_max !== -1 && org.emailsUsedThisMonth >= limits.emails_max) {
    return { allowed: false, reason: `Email limit reached (${limits.emails_max} max on ${org.plan} plan)`, upgrade: true };
  }
  return { allowed: true };
}

export function featureGuard(feature: keyof Pick<PlanLimits, "autopilot" | "whatsapp_api" | "hubspot_sync" | "sales_brain" | "white_label" | "data_fetch">) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.user?.orgId;
    if (!orgId) { res.status(401).json({ error: "Not authenticated" }); return; }

    const org = await getOrg(orgId);
    if (!org) { res.status(404).json({ error: "Organization not found" }); return; }

    if (checkTrialExpired(org)) {
      res.status(403).json({
        error: "TRIAL_EXPIRED",
        message: "Your 7-day free trial has ended. Choose a plan to continue.",
        upgrade_url: "/billing",
      });
      return;
    }

    const limits = getLimits(org.plan);
    if (!limits[feature]) {
      res.status(403).json({
        error: "PLAN_LIMIT",
        feature,
        message: `This feature is not available on your current plan (${org.plan}).`,
        upgrade_url: "/billing",
      });
      return;
    }

    next();
  };
}

export function resourceLimitGuard(resource: "leads" | "audits" | "emails") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.user?.orgId;
    if (!orgId) { res.status(401).json({ error: "Not authenticated" }); return; }

    const org = await getOrg(orgId);
    if (!org) { res.status(404).json({ error: "Organization not found" }); return; }

    if (checkTrialExpired(org)) {
      res.status(403).json({
        error: "TRIAL_EXPIRED",
        message: "Your 7-day free trial has ended. Choose a plan to continue.",
        upgrade_url: "/billing",
      });
      return;
    }

    const result = checkLimit(org, resource);
    if (!result.allowed) {
      res.status(403).json({
        error: "PLAN_LIMIT",
        resource,
        message: result.reason,
        upgrade_url: "/billing",
        upgrade: true,
      });
      return;
    }

    next();
  };
}

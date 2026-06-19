import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leads, organizations } from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getLimits } from "../config/planLimits";
import { featureGuard } from "../middlewares/planGuard";
import {
  fetchAllContacts,
  fetchAllCompanies,
  fetchPipelines,
  createDeal,
} from "../lib/hubspot.js";
import { logger } from "../lib/logger";
import { saveToLeadBank } from "../lib/saveToLeadBank";

const router = Router();

// ─── GET /api/hubspot/contacts ───────────────────────────────────────────────
// Pull all HubSpot contacts (raw, for preview)
router.get("/contacts", featureGuard("hubspot_sync"), async (_req: Request, res: Response) => {
  try {
    const contacts = await fetchAllContacts();
    if (!res.headersSent) res.json({ contacts, total: contacts.length });
  } catch (err: any) {
    logger.error({ err }, "[HubSpot] contacts error");
    if (!res.headersSent) res.status(502).json({ error: "HubSpot API error" });
  }
});

// ─── GET /api/hubspot/companies ──────────────────────────────────────────────
router.get("/companies", featureGuard("hubspot_sync"), async (_req: Request, res: Response) => {
  try {
    const companies = await fetchAllCompanies();
    if (!res.headersSent) res.json({ companies, total: companies.length });
  } catch (err: any) {
    logger.error({ err }, "[HubSpot] companies error");
    if (!res.headersSent) res.status(502).json({ error: "HubSpot API error" });
  }
});

// ─── POST /api/hubspot/import ────────────────────────────────────────────────
// Import HubSpot contacts → local leads table (skips duplicates by email)
router.post("/import", featureGuard("hubspot_sync"), async (req: Request, res: Response) => {
  const orgId = req.user!.orgId;
  try {
    const contacts = await fetchAllContacts();
    const [orgQuotaRow] = await db.select({ plan: organizations.plan, leadsUsedThisMonth: organizations.leadsUsedThisMonth })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const hubPlanCap = getLimits(orgQuotaRow?.plan ?? "trial");
    const hubQuotaRemaining = hubPlanCap.leads_max === -1 ? Infinity : Math.max(0, hubPlanCap.leads_max - (orgQuotaRow?.leadsUsedThisMonth ?? 0));
    if (hubPlanCap.leads_max !== -1 && hubQuotaRemaining <= 0) {
      if (!res.headersSent) res.status(429).json({ error: "PLAN_LIMIT", message: "Lead quota exhausted. Upgrade your plan to import more leads.", upgrade_url: "/billing" });
      return;
    }
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const c of contacts) {
      const p = c.properties;
      const email = p.email?.trim().toLowerCase();
      if (!email) { skipped++; continue; }

      // Skip if email already exists within this org
      const existing = await db.select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.email, email), eq(leads.orgId, orgId)))
        .limit(1);

      if (existing.length > 0) { skipped++; continue; }
      if (hubPlanCap.leads_max !== -1 && imported >= hubQuotaRemaining) { skipped++; continue; }

      const firstName = p.firstname?.trim() || "Unknown";
      const lastName  = p.lastname?.trim()  || "";
      const company   = p.company?.trim()   || "Unknown";
      const country   = p.country?.trim()   || "Unknown";
      const designation = p.jobtitle?.trim() || "Contact";
      const industry  = p.industry?.trim()  || "Other";

      try {
        const [hubInserted] = await db.insert(leads).values({
          orgId,
          firstName,
          lastName,
          email,
          phone:       p.phone ?? null,
          company,
          designation,
          industry,
          country,
          city:        p.city ?? null,
          website:     p.website ?? null,
          source:      "hubspot_import",
          status:      "new_enquiry",
          tags:        ["hubspot"],
        }).onConflictDoNothing().returning();
        if (hubInserted) void saveToLeadBank(hubInserted);
        imported++;
      } catch (insertErr: any) {
        errors.push(`${email}: ${insertErr.message}`);
      }
    }

    if (imported > 0) {
      void db.update(organizations).set({ leadsUsedThisMonth: sql`leads_used_this_month + ${imported}` }).where(eq(organizations.id, orgId)).execute().catch(() => {});
    }
    if (!res.headersSent) res.json({ imported, skipped, errors: errors.slice(0, 10) });
  } catch (err: any) {
    logger.error({ err }, "[HubSpot] import error");
    if (!res.headersSent) res.status(502).json({ error: "HubSpot API error" });
  }
});

// ─── GET /api/hubspot/pipelines ──────────────────────────────────────────────
router.get("/pipelines", featureGuard("hubspot_sync"), async (_req: Request, res: Response) => {
  try {
    const pipelines = await fetchPipelines();
    if (!res.headersSent) res.json({ pipelines });
  } catch (err: any) {
    if (!res.headersSent) res.status(502).json({ error: "HubSpot API error" });
  }
});

// ─── POST /api/hubspot/push-deal ─────────────────────────────────────────────
// Push a local lead as a Hot Deal into HubSpot pipeline
router.post("/push-deal", featureGuard("hubspot_sync"), async (req: Request, res: Response): Promise<void> => {
  const { leadId, pipeline, dealstage, amount } = req.body as {
    leadId: number;
    pipeline: string;
    dealstage: string;
    amount?: string;
  };
  const orgId = req.user!.orgId;

  if (!leadId || !pipeline || !dealstage) {
    res.status(400).json({ error: "leadId, pipeline, dealstage required" }); return;
  }

  try {
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId))).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    const deal = await createDeal({
      dealname:    `${lead.firstName} ${lead.lastName} — ${lead.company}`,
      pipeline,
      dealstage,
      amount,
      email:       lead.email,
      phone:       lead.phone ?? undefined,
      company:     lead.company,
      description: `Pushed from Sales War Machine. Status: ${lead.status}. BANT Score: ${lead.bantScore ?? "N/A"}. Industry: ${lead.industry}.`,
    });

    // Tag lead as pushed to HubSpot
    const currentTags = lead.tags ?? [];
    if (!currentTags.includes("hubspot_deal")) {
      await db.update(leads)
        .set({ tags: [...currentTags, "hubspot_deal"], updatedAt: new Date() })
        .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
    }

    res.json({ deal, leadId });
  } catch (err: any) {
    logger.error({ err }, "[HubSpot] push-deal error");
    res.status(502).json({ error: "HubSpot API error" });
  }
});

// ─── POST /api/hubspot/push-deals-bulk ───────────────────────────────────────
// Push multiple leads as deals at once
router.post("/push-deals-bulk", featureGuard("hubspot_sync"), async (req: Request, res: Response): Promise<void> => {
  const { leadIds, pipeline, dealstage } = req.body as {
    leadIds: number[];
    pipeline: string;
    dealstage: string;
  };
  const orgId = req.user!.orgId;

  if (!leadIds?.length || !pipeline || !dealstage) {
    res.status(400).json({ error: "leadIds[], pipeline, dealstage required" }); return;
  }

  try {
    const rows = await db.select().from(leads).where(and(inArray(leads.id, leadIds), eq(leads.orgId, orgId)));
    const results: { leadId: number; dealId: string; error?: string }[] = [];

    for (const lead of rows) {
      try {
        const deal = await createDeal({
          dealname:    `${lead.firstName} ${lead.lastName} — ${lead.company}`,
          pipeline,
          dealstage,
          email:       lead.email,
          phone:       lead.phone ?? undefined,
          company:     lead.company,
          description: `Pushed from Sales War Machine. Status: ${lead.status}. BANT Score: ${lead.bantScore ?? "N/A"}.`,
        });

        const currentTags = lead.tags ?? [];
        if (!currentTags.includes("hubspot_deal")) {
          await db.update(leads)
            .set({ tags: [...currentTags, "hubspot_deal"], updatedAt: new Date() })
            .where(and(eq(leads.id, lead.id), eq(leads.orgId, orgId)));
        }

        results.push({ leadId: lead.id, dealId: deal.id });
      } catch (e: any) {
        results.push({ leadId: lead.id, dealId: "", error: e.message });
      }
    }

    res.json({ results, pushed: results.filter(r => !r.error).length, failed: results.filter(r => r.error).length });
  } catch (err: any) {
    res.status(502).json({ error: "HubSpot API error" });
  }
});

export default router;

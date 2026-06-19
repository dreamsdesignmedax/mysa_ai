import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { leadBank, leads, icps } from "@workspace/db/schema";
import { eq, and, ilike, or, sql, isNull, count } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

// ── List leads in bank ────────────────────────────────────────────────────────
router.get("/lead-bank", async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const where: ReturnType<typeof and>[] = [
      eq(leadBank.orgId, orgId) as ReturnType<typeof and>,
    ];

    if (req.query.search) {
      const tokens = String(req.query.search).trim().split(/\s+/).filter(Boolean).slice(0, 6);
      for (const token of tokens) {
        const s = `%${token}%`;
        where.push(
          or(
            ilike(leadBank.firstName, s),
            ilike(leadBank.lastName, s),
            sql`CONCAT(${leadBank.firstName}, ' ', ${leadBank.lastName}) ilike ${s}`,
            ilike(leadBank.email, s),
            ilike(leadBank.company, s),
            ilike(leadBank.designation, s),
            sql`COALESCE(${leadBank.phone}, '') ilike ${s}`,
            sql`COALESCE(${leadBank.city}, '') ilike ${s}`,
            ilike(leadBank.country, s),
            ilike(leadBank.industry, s),
            sql`COALESCE(${leadBank.website}, '') ilike ${s}`,
            sql`COALESCE(${leadBank.notes}, '') ilike ${s}`,
          ) as ReturnType<typeof and>
        );
      }
    }

    if (req.query.industry) where.push(ilike(leadBank.industry, `%${req.query.industry}%`) as ReturnType<typeof and>);
    if (req.query.country) where.push(ilike(leadBank.country, `%${req.query.country}%`) as ReturnType<typeof and>);
    if (req.query.source) where.push(eq(leadBank.source, req.query.source as string) as ReturnType<typeof and>);
    if (req.query.onlyFresh === "true") where.push(isNull(leadBank.importedToLeadsAt) as ReturnType<typeof and>);

    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(leadBank)
        .where(and(...where))
        .orderBy(sql`${leadBank.createdAt} desc`)
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(leadBank)
        .where(and(...where)),
    ]);

    res.json({
      leads: rows,
      total: Number(total),
      page,
      totalPages: Math.ceil(Number(total) / limit),
    });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get("/lead-bank/stats", async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const [total, imported, bySource] = await Promise.all([
      db.select({ value: count() }).from(leadBank).where(eq(leadBank.orgId, orgId)),
      db.select({ value: count() }).from(leadBank).where(and(eq(leadBank.orgId, orgId), sql`${leadBank.importedToLeadsAt} is not null`)),
      db.select({ source: leadBank.source, value: count() })
        .from(leadBank)
        .where(eq(leadBank.orgId, orgId))
        .groupBy(leadBank.source),
    ]);

    const sources: Record<string, number> = {};
    for (const row of bySource) {
      sources[row.source] = Number(row.value);
    }

    res.json({
      total: Number(total[0].value),
      imported: Number(imported[0].value),
      fresh: Number(total[0].value) - Number(imported[0].value),
      sources,
    });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Bulk import to bank ───────────────────────────────────────────────────────
const BulkImportSchema = z.object({
  records: z.array(z.object({
    firstName:   z.string().default(""),
    lastName:    z.string().default(""),
    email:       z.string().email().optional().nullable(),
    phone:       z.string().optional().nullable(),
    company:     z.string().default(""),
    designation: z.string().default(""),
    industry:    z.string().default(""),
    city:        z.string().optional().nullable(),
    country:     z.string().default(""),
    companySize: z.string().optional().nullable(),
    website:     z.string().optional().nullable(),
    linkedInUrl: z.string().optional().nullable(),
    source:      z.string().optional(),
    tags:        z.array(z.string()).optional(),
    notes:       z.string().optional().nullable(),
  })).min(1),
});

router.post("/lead-bank/bulk-import", async (req: Request, res: Response): Promise<void> => {
  try {
    const { records } = BulkImportSchema.parse(req.body);
    const orgId = req.user!.orgId;

    let inserted = 0;
    let skipped = 0;

    for (const r of records) {
      try {
        await db.insert(leadBank).values({
          orgId,
          firstName:   r.firstName,
          lastName:    r.lastName,
          email:       r.email ?? undefined,
          phone:       r.phone ?? undefined,
          company:     r.company,
          designation: r.designation,
          industry:    r.industry,
          city:        r.city ?? undefined,
          country:     r.country,
          companySize: r.companySize ?? undefined,
          website:     r.website ?? undefined,
          linkedInUrl: r.linkedInUrl ?? undefined,
          source:      r.source ?? "manual",
          tags:        r.tags ?? [],
          notes:       r.notes ?? undefined,
        }).onConflictDoNothing();
        inserted++;
      } catch {
        skipped++;
      }
    }

    res.json({ inserted, skipped, total: records.length });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.errors }); return; }
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Delete bank entry ──────────────────────────────────────────────────────────
router.delete("/lead-bank/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const orgId = req.user!.orgId;
    await db.delete(leadBank).where(and(eq(leadBank.id, id), eq(leadBank.orgId, orgId)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Fetch from bank to active leads (Mysa Leads) ─────────────────────────────
const FetchToLeadsSchema = z.object({
  icpId:  z.number().int().positive().optional().nullable(),
  count:  z.number().int().min(1).max(500).default(50),
  onlyFresh: z.boolean().default(true),
});

router.post("/lead-bank/fetch-to-leads", async (req: Request, res: Response) => {
  try {
    const { icpId, count: limit, onlyFresh } = FetchToLeadsSchema.parse(req.body);
    const orgId = req.user!.orgId;

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event: string, data: object) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("status", { message: "Searching Lead Bank…" });

    // Build ICP-based where clause for bank
    const bankWhere: ReturnType<typeof and>[] = [
      eq(leadBank.orgId, orgId) as ReturnType<typeof and>,
    ];
    if (onlyFresh) bankWhere.push(isNull(leadBank.importedToLeadsAt) as ReturnType<typeof and>);

    let icp: typeof icps.$inferSelect | null = null;
    if (icpId) {
      const [icpRow] = await db.select().from(icps).where(and(eq(icps.id, icpId), eq(icps.orgId, orgId)));
      if (icpRow) {
        icp = icpRow;
        if (icpRow.industries?.length) {
          bankWhere.push(
            or(...icpRow.industries.map(ind => ilike(leadBank.industry, `%${ind}%`))) as ReturnType<typeof and>
          );
        }
        if (icpRow.markets?.length) {
          bankWhere.push(
            or(...icpRow.markets.map(mkt => ilike(leadBank.country, `%${mkt}%`))) as ReturnType<typeof and>
          );
        }
      }
    }

    const bankLeads = await db.select().from(leadBank)
      .where(and(...bankWhere))
      .orderBy(sql`${leadBank.createdAt} desc`)
      .limit(limit * 2);

    send("status", { message: `Found ${bankLeads.length} candidates — checking duplicates…` });

    let imported = 0;
    let skipped = 0;

    for (const bl of bankLeads) {
      if (imported >= limit) break;

      // Check email duplicate in active leads (within this org)
      if (bl.email) {
        const [existing] = await db.select({ id: leads.id }).from(leads)
          .where(and(eq(leads.email, bl.email), eq(leads.orgId, orgId)))
          .limit(1);
        if (existing) {
          skipped++;
          send("skip", { reason: "already_in_leads", email: bl.email });
          continue;
        }
      }

      try {
        const [newLead] = await db.insert(leads).values({
          orgId,
          firstName:   bl.firstName || "Unknown",
          lastName:    bl.lastName || "",
          email:       bl.email || `noemail_${bl.id}_${Date.now()}@leadbank.internal`,
          phone:       bl.phone ?? undefined,
          company:     bl.company || "Unknown",
          designation: bl.designation || "Unknown",
          industry:    bl.industry || "Unknown",
          city:        bl.city ?? undefined,
          country:     bl.country || "Unknown",
          website:     bl.website ?? undefined,
          linkedInUrl: bl.linkedInUrl ?? undefined,
          companySize: bl.companySize ?? undefined,
          annualRevenue: bl.annualRevenue ?? undefined,
          source:      "lead_bank",
          tags:        bl.tags ?? [],
          notes:       bl.notes ?? undefined,
          icpId:       icp?.id ?? undefined,
          intentKeywords:   bl.intentKeywords ?? [],
          behaviorKeywords: bl.behaviorKeywords ?? [],
          interestKeywords: bl.interestKeywords ?? [],
          status:      "new_enquiry",
        }).returning();

        // Mark in bank as imported
        await db.update(leadBank)
          .set({ importedToLeadsAt: new Date(), importedLeadId: newLead.id })
          .where(eq(leadBank.id, bl.id));

        imported++;
        send("lead", {
          lead: {
            firstName: newLead.firstName,
            lastName: newLead.lastName,
            email: bl.email || "",
            company: newLead.company,
            industry: newLead.industry,
            country: newLead.country,
          }
        });
      } catch {
        skipped++;
      }
    }

    send("done", { imported, skipped });
    res.end();
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: "Invalid request" })}\n\n`);
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
    }
    res.end();
  }
});

export default router;

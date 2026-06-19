import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { leads, touchpoints, meetings, proposals, leadAudits, outreachSequences, users, organizations, batchJobs } from "@workspace/db/schema";
import { eq, and, gte, lte, ilike, inArray, count, sql } from "drizzle-orm";
import { resourceLimitGuard } from "../middlewares/planGuard";
import { getLimits } from "../config/planLimits";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { validateLead } from "../lib/leadValidator";
import { enrichLeadByEmail } from "../lib/apolloEnrich";
import { scoreToBandKey } from "../lib/utils";
import { sendViaBrevo } from "../lib/brevo";
import { getAppBaseUrl } from "../lib/app-url";
import { logger } from "../lib/logger";
import { saveToLeadBank } from "../lib/saveToLeadBank";

const router = Router();

function deriveBantBand(score: number | null | undefined): "hot" | "qualified" | "nurture" | "disqualify" | null {
  return scoreToBandKey(score);
}

const LEAD_STATUSES = ["new_enquiry", "enquiry_qualified", "discovery_call", "quote_sent", "follow_up", "project_won", "project_lost"] as const;

const CreateLeadSchema = z.object({
  icpId:             z.number().int().positive().optional().nullable(),
  firstName:         z.string().min(1),
  lastName:          z.string().min(1),
  email:             z.string().email(),
  phone:             z.string().optional().nullable(),
  whatsapp:          z.string().optional().nullable(),
  linkedInUrl:       z.string().url().optional().nullable(),
  photoUrl:          z.string().url().optional().nullable(),
  companyLogo:       z.string().url().optional().nullable(),
  company:           z.string().min(1),
  city:              z.string().optional().nullable(),
  country:           z.string().optional().nullable(),
  designation:       z.string().optional().nullable(),
  website:           z.string().url().optional().nullable(),
  industry:          z.string().optional().nullable(),
  companySize:       z.string().optional().nullable(),
  annualRevenue:     z.string().optional().nullable(),
  source:            z.string().optional(),
  keywords:          z.array(z.string()).optional(),
  tags:              z.array(z.string()).optional(),
  notes:             z.string().optional().nullable(),
  behaviorKeywords:  z.array(z.string()).optional(),
  intentKeywords:    z.array(z.string()).optional(),
  interestKeywords:  z.array(z.string()).optional(),
});

const BulkUpdateLeadsSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  status: z.enum(LEAD_STATUSES).optional(),
});

function buildWhereClause(query: Record<string, string | undefined>, orgId: number) {
  const conditions = [eq(leads.orgId, orgId)];
  if (query.status) conditions.push(eq(leads.status, query.status));
  if (query.industry) conditions.push(eq(leads.industry, query.industry));
  if (query.country) conditions.push(eq(leads.country, query.country));
  if (query.source) conditions.push(eq(leads.source, query.source));
  if (query.icpId) conditions.push(eq(leads.icpId, Number(query.icpId)));
  if (query.assignedToId) conditions.push(eq(leads.assignedToId, Number(query.assignedToId)));
  if (query.minScore) conditions.push(gte(leads.bantScore, Number(query.minScore)));
  if (query.maxScore) conditions.push(lte(leads.bantScore, Number(query.maxScore)));
  if (query.behavior) conditions.push(sql`${leads.behaviorKeywords} @> ARRAY[${query.behavior}]::text[]`);
  if (query.intent) conditions.push(sql`${leads.intentKeywords} @> ARRAY[${query.intent}]::text[]`);
  if (query.interest) conditions.push(sql`${leads.interestKeywords} @> ARRAY[${query.interest}]::text[]`);
  if (query.search) {
    // Multi-token Google-style: split on whitespace, each token must match at least one field
    const tokens = query.search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const token of tokens) {
      const s = `%${token}%`;
      conditions.push(
        sql`(
          ${leads.firstName} ilike ${s} OR
          ${leads.lastName} ilike ${s} OR
          CONCAT(${leads.firstName}, ' ', ${leads.lastName}) ilike ${s} OR
          ${leads.company} ilike ${s} OR
          ${leads.email} ilike ${s} OR
          COALESCE(${leads.phone}, '') ilike ${s} OR
          COALESCE(${leads.city}, '') ilike ${s} OR
          ${leads.country} ilike ${s} OR
          ${leads.industry} ilike ${s} OR
          COALESCE(${leads.website}, '') ilike ${s} OR
          ${leads.designation} ilike ${s} OR
          COALESCE(${leads.notes}, '') ilike ${s} OR
          ${leads.source} ilike ${s} OR
          COALESCE(${leads.behaviorKeywords}::text, '') ilike ${s} OR
          COALESCE(${leads.intentKeywords}::text, '') ilike ${s} OR
          COALESCE(${leads.interestKeywords}::text, '') ilike ${s}
        )`
      );
    }
  }
  return and(...conditions);
}

// ── GET /leads/fake — fake leads for this org (kept for backwards compat) ─────
router.get("/leads/fake", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const page  = Math.max(1, Number((req.query as Record<string, string>).page ?? 1));
  const limit = Math.min(200, Math.max(1, Number((req.query as Record<string, string>).limit ?? 50)));
  const offset = (page - 1) * limit;

  const [rows, [countRow]] = await Promise.all([
    db.select().from(leads)
      .where(and(eq(leads.orgId, orgId), sql`${leads.isFake} = 1`))
      .orderBy(sql`${leads.updatedAt} DESC`)
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(leads)
      .where(and(eq(leads.orgId, orgId), sql`${leads.isFake} = 1`)),
  ]);

  res.json({ data: rows, total: Number(countRow?.total ?? 0), page, limit });
});

// ── GET /leads/not-qualified — email-failed OR BANT-disqualified leads ────────
router.get("/leads/not-qualified", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const page  = Math.max(1, Number((req.query as Record<string, string>).page ?? 1));
  const limit = Math.min(500, Math.max(1, Number((req.query as Record<string, string>).limit ?? 200)));
  const offset = (page - 1) * limit;

  // Not Qualified = email delivery failed (is_fake=1) OR BANT score in disqualify band (<45) but scored (not null/0)
  const notQualifiedWhere = and(
    eq(leads.orgId, orgId),
    sql`(${leads.isFake} = 1 OR (${leads.bantScore} IS NOT NULL AND ${leads.bantScore} > 0 AND ${leads.bantScore} < 45))`,
  );

  const [rows, [countRow]] = await Promise.all([
    db.select().from(leads)
      .where(notQualifiedWhere)
      .orderBy(sql`${leads.updatedAt} DESC`)
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(leads).where(notQualifiedWhere),
  ]);

  res.json({ data: rows, total: Number(countRow?.total ?? 0), page, limit });
});

// ── POST /leads/:id/mark-fake — flag a lead as fake ──────────────────────────
router.post("/leads/:id/mark-fake", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const leadId = Number(req.params.id);
  const [updated] = await db.update(leads)
    .set({ isFake: 1, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
    .returning({ id: leads.id });
  if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json({ ok: true });
});

// ── DELETE /leads/:id/mark-fake — remove fake flag ───────────────────────────
router.delete("/leads/:id/mark-fake", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const leadId = Number(req.params.id);
  const [updated] = await db.update(leads)
    .set({ isFake: 0, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
    .returning({ id: leads.id });
  if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json({ ok: true });
});

// ── GET /leads/assignee-counts — per-rep lead counts ─────────────────────────
router.get("/leads/assignee-counts", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const rows = await db
    .select({ assignedToId: leads.assignedToId, count: count() })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), sql`${leads.assignedToId} is not null`))
    .groupBy(leads.assignedToId);
  const counts: Record<number, number> = {};
  for (const row of rows) {
    if (row.assignedToId != null) counts[row.assignedToId] = Number(row.count);
  }
  res.json(counts);
});

// ── GET /leads/stats — source breakdown counts for Lead Bank ─────────────────
router.get("/leads/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const [bySource, [totalRow]] = await Promise.all([
    db.select({ source: leads.source, count: count() })
      .from(leads)
      .where(eq(leads.orgId, orgId))
      .groupBy(leads.source),
    db.select({ total: count() }).from(leads).where(eq(leads.orgId, orgId)),
  ]);
  const total = Number(totalRow?.total ?? 0);
  const sources: Record<string, number> = {};
  for (const row of bySource) {
    sources[row.source ?? "manual"] = Number(row.count);
  }
  res.json({ total, sources });
});

router.get("/leads", async (req: Request, res: Response): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(q.page ?? 1));
  const limit = Math.min(2000, Math.max(1, Number(q.limit ?? 50)));
  const offset = (page - 1) * limit;
  const where = buildWhereClause(q, req.user!.orgId);

  const [rows, totalRows] = await Promise.all([
    db.select().from(leads).where(where).orderBy(sql`${leads.createdAt} desc, ${leads.id} desc`).limit(limit).offset(offset),
    db.select({ c: count() }).from(leads).where(where),
  ]);

  // Resolve assignee names in a single batch query (scoped to same org)
  const assigneeIds = [...new Set(rows.map((l) => l.assignedToId).filter((id): id is number => id != null))];
  const assigneeMap: Record<number, string> = {};
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users).where(and(inArray(users.id, assigneeIds), eq(users.orgId, req.user!.orgId)));
    for (const u of assignees) {
      assigneeMap[u.id] = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
    }
  }

  const total = Number(totalRows[0]?.c ?? 0);
  const leadsWithBand = rows.map((l) => ({
    ...l,
    bantBand: deriveBantBand(l.bantScore),
    assignedToName: l.assignedToId != null ? (assigneeMap[l.assignedToId] ?? null) : null,
  }));
  res.json({ leads: leadsWithBand, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post("/leads", resourceLimitGuard("leads"), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateLeadSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const data = parsed.data;
  const check = validateLead(data);
  if (!check.valid) { res.status(400).json({ error: `Lead rejected: ${check.reason}` }); return; }
  const [created] = await db
    .insert(leads)
    .values({
      orgId:          req.user!.orgId,
      icpId:          data.icpId ?? null,
      firstName:      data.firstName,
      lastName:       data.lastName,
      email:          data.email,
      phone:          data.phone ?? null,
      whatsapp:       data.whatsapp ?? null,
      linkedInUrl:    data.linkedInUrl ?? null,
      photoUrl:       data.photoUrl ?? null,
      companyLogo:    data.companyLogo ?? null,
      company:        data.company,
      city:           data.city ?? null,
      country:        data.country || "",
      designation:    data.designation || "",
      website:        data.website ?? null,
      industry:       data.industry || "",
      companySize:    data.companySize ?? null,
      annualRevenue:  data.annualRevenue ?? null,
      source:         data.source ?? "manual",
      keywords:          data.keywords ?? [],
      tags:              data.tags ?? [],
      notes:             data.notes ?? null,
      behaviorKeywords:  data.behaviorKeywords ?? [],
      intentKeywords:    data.intentKeywords ?? [],
      interestKeywords:  data.interestKeywords ?? [],
    })
    .returning();
  res.status(201).json(created);

  if (created) {
    void db.update(organizations).set({ leadsUsedThisMonth: sql`leads_used_this_month + 1` }).where(eq(organizations.id, req.user!.orgId)).execute().catch(() => {});
    void saveToLeadBank(created);
    enrichLeadByEmail(created.email).then(enriched => {
      if (!enriched) return;
      const updates: Partial<typeof created> = {};
      if (!created.photoUrl    && enriched.photoUrl)    updates.photoUrl    = enriched.photoUrl;
      if (!created.linkedInUrl && enriched.linkedInUrl) updates.linkedInUrl = enriched.linkedInUrl;
      if (!created.designation && enriched.designation) updates.designation = enriched.designation;
      if (!created.companySize && enriched.companySize) updates.companySize = enriched.companySize;
      if (!created.industry    && enriched.industry)    updates.industry    = enriched.industry;
      if (!created.website     && enriched.website)     updates.website     = enriched.website;
      if (!created.phone       && enriched.phone)       updates.phone       = enriched.phone;
      if (!created.city        && enriched.city)        updates.city        = enriched.city;
      if (Object.keys(updates).length > 0) {
        db.update(leads).set({ ...updates, updatedAt: sql`now()` })
          .where(eq(leads.id, created.id))
          .execute()
          .catch(() => {});
      }
    }).catch(() => {});
  }
});

router.post("/leads/import/csv", resourceLimitGuard("leads"), async (req: Request, res: Response): Promise<void> => {
  const { rows, icpId } = req.body;
  const orgId = req.user!.orgId;
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // ── Parse and validate all rows first ──────────────────────────────────────
  type ValidRow = {
    firstName: string; lastName: string; email: string; company: string;
    designation: string; industry: string; country: string; phone: string;
    whatsapp: string; website: string; city: string; companySize: string;
    linkedInUrl: string; notes: string;
  };
  const validRows: ValidRow[] = [];

  for (const row of rows) {
    const rawEmail = (row.email ?? "").trim();
    const emailCandidates = rawEmail.split(/[\s,;]+/).map((e: string) => e.trim()).filter((e: string) => e.includes("@"));
    const email = emailCandidates[0] ?? "";

    const rawFirst = (row.firstName ?? row.first_name ?? "").trim();
    const rawLast  = (row.lastName  ?? row.last_name  ?? "").trim();
    let firstName = rawFirst;
    let lastName  = rawLast;
    if (!lastName) {
      const parts = rawFirst.split(/\s+/);
      firstName = parts[0] ?? "";
      lastName  = parts.slice(1).join(" ") || "-";
    }

    const check = validateLead({ firstName, lastName, email, company: row.company ?? "" });
    if (!check.valid) { skipped++; errors.push(`Skipped ${email || "(no email)"}: ${check.reason}`); continue; }

    validRows.push({
      firstName, lastName,
      email:       email.toLowerCase(),
      company:     (row.company ?? "").toString(),
      designation: (row.designation ?? row.title ?? "").toString(),
      industry:    (row.industry ?? "").toString(),
      country:     (row.country ?? "").toString(),
      phone:       (row.phone ?? row.mobile ?? "").toString(),
      whatsapp:    (row.whatsapp ?? "").toString(),
      website:     (row.website ?? row.companyWebsite ?? "").toString(),
      city:        (row.city ?? "").toString(),
      companySize: (row.companySize ?? row.company_size ?? "").toString(),
      linkedInUrl: (row.linkedInUrl ?? row.linkedin ?? row.linkedIn ?? "").toString(),
      notes:       (row.notes ?? "").toString(),
    });
  }

  // ── Cap to remaining quota (hard limit) ─────────────────────────────────────
  {
    const [orgRow] = await db.select({ plan: organizations.plan, leadsUsedThisMonth: organizations.leadsUsedThisMonth })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const planCap = getLimits(orgRow?.plan ?? "trial");
    if (planCap.leads_max !== -1) {
      const remaining = Math.max(0, planCap.leads_max - (orgRow?.leadsUsedThisMonth ?? 0));
      if (validRows.length > remaining) {
        errors.push(`Quota: only ${remaining} lead slot${remaining !== 1 ? "s" : ""} remaining — ${validRows.length - remaining} row(s) skipped.`);
        skipped += validRows.length - remaining;
        validRows.splice(remaining);
      }
    }
  }

  // ── Batch insert valid rows in one SQL call ──────────────────────────────────
  if (validRows.length > 0) {
    try {
      const inserted = await db.insert(leads).values(
        validRows.map((r) => ({ orgId, icpId: icpId ?? null, source: "file_import" as const, tags: [], ...r }))
      ).onConflictDoNothing().returning();
      imported = inserted.length;
      skipped += validRows.length - inserted.length;
      for (const lead of inserted) void saveToLeadBank(lead);
    } catch (e: unknown) {
      skipped += validRows.length;
      errors.push(`Batch insert failed: ${String(e)}`);
    }
  }

  if (imported > 0) {
    void db.update(organizations).set({ leadsUsedThisMonth: sql`leads_used_this_month + ${imported}` }).where(eq(organizations.id, orgId)).execute().catch(() => {});
  }
  res.json({ imported, skipped, errors });
});

router.post("/leads/import/paste", resourceLimitGuard("leads"), async (req: Request, res: Response): Promise<void> => {
  const { text, icpId } = req.body;
  const orgId = req.user!.orgId;

  const overrides = await fetchOrgOverrides(orgId);
  const msg = await anthropic.messages.create({
    model: getModel("lead_routing", overrides),
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `Parse the following pasted text into a JSON array of lead objects with fields: firstName, lastName, email, company, designation, industry, country. Return only valid JSON array, no explanation.\n\n${text}`,
      },
    ],
  });

  let parsed: unknown[] = [];
  try {
    const content = msg.content[0];
    const raw = content.type === "text" ? content.text : "";
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) parsed = JSON.parse(match[0]) as unknown[];
  } catch {
    res.json({ imported: 0, skipped: 0, errors: ["Failed to parse AI response"] });
    return;
  }

  let imported = 0;
  let skipped  = 0;
  const errors: string[] = [];

  // ── Cap to remaining quota (hard limit) ────────────────────────────────────
  {
    const [orgRow] = await db.select({ plan: organizations.plan, leadsUsedThisMonth: organizations.leadsUsedThisMonth })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const planCap = getLimits(orgRow?.plan ?? "trial");
    if (planCap.leads_max !== -1) {
      const remaining = Math.max(0, planCap.leads_max - (orgRow?.leadsUsedThisMonth ?? 0));
      if (parsed.length > remaining) {
        errors.push(`Quota: only ${remaining} lead slot${remaining !== 1 ? "s" : ""} remaining — ${parsed.length - remaining} row(s) skipped.`);
        skipped += parsed.length - remaining;
        parsed = parsed.slice(0, remaining);
      }
    }
  }

  for (const row of parsed) {
    const r = row as Record<string, string>;
    const check = validateLead({ firstName: r.firstName, lastName: r.lastName, email: r.email, company: r.company });
    if (!check.valid) { skipped++; errors.push(`Skipped ${r.email ?? "?"}: ${check.reason}`); continue; }
    try {
      const [inserted] = await db.insert(leads).values({
        orgId,
        icpId:       icpId ?? null,
        firstName:   r.firstName ?? "",
        lastName:    r.lastName  ?? "",
        email:       (r.email ?? "").toLowerCase().trim(),
        company:     r.company ?? "",
        designation: r.designation ?? "",
        industry:    r.industry ?? "",
        country:     r.country ?? "",
        source:      "paste_import",
        tags:        [],
      }).onConflictDoNothing().returning();
      if (inserted) { void saveToLeadBank(inserted); imported++; } else skipped++;
    } catch (e: unknown) {
      skipped++;
      errors.push(String(e));
    }
  }

  if (imported > 0) {
    void db.update(organizations).set({ leadsUsedThisMonth: sql`leads_used_this_month + ${imported}` }).where(eq(organizations.id, orgId)).execute().catch(() => {});
  }

  res.json({ imported, skipped, errors });
});

router.patch("/leads/bulk", async (req: Request, res: Response): Promise<void> => {
  const parsed = BulkUpdateLeadsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const { ids, status } = parsed.data;
  const orgId = req.user!.orgId;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  const updated = await db.update(leads).set(updates).where(and(inArray(leads.id, ids), eq(leads.orgId, orgId))).returning();
  res.json({ updated: updated.length });
});

router.get("/leads/:id", async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  // Resolve assignee name (scoped to same org to prevent cross-tenant exposure)
  let assignedToName: string | null = null;
  if (lead.assignedToId != null) {
    const [assignee] = await db.select({ firstName: users.firstName, lastName: users.lastName })
      .from(users).where(and(eq(users.id, lead.assignedToId), eq(users.orgId, orgId)));
    if (assignee) {
      assignedToName = `${assignee.firstName ?? ""} ${assignee.lastName ?? ""}`.trim() || null;
    }
  }

  const [tps, mtgs, props, audit] = await Promise.all([
    db.select().from(touchpoints).where(eq(touchpoints.leadId, id)),
    db.select().from(meetings).where(eq(meetings.leadId, id)),
    db.select().from(proposals).where(eq(proposals.leadId, id)),
    db.select().from(leadAudits).where(eq(leadAudits.leadId, id)),
  ]);

  res.json({ ...lead, bantBand: deriveBantBand(lead.bantScore), assignedToName, touchpoints: tps, meetings: mtgs, proposals: props, auditData: audit[0] ?? null });
});

const UpdateLeadSchema = z.object({
  icpId:          z.number().int().positive().optional().nullable(),
  assignedToId:   z.number().int().positive().optional().nullable(),
  firstName:      z.string().min(1).optional(),
  lastName:       z.string().min(1).optional(),
  email:          z.string().email().optional(),
  phone:          z.string().optional().nullable(),
  whatsapp:       z.string().optional().nullable(),
  linkedInUrl:    z.string().url().optional().nullable(),
  photoUrl:       z.string().url().optional().nullable(),
  companyLogo:    z.string().url().optional().nullable(),
  company:        z.string().min(1).optional(),
  city:           z.string().optional().nullable(),
  country:        z.string().optional(),
  designation:    z.string().optional(),
  website:        z.string().url().optional().nullable(),
  industry:       z.string().optional(),
  companySize:    z.string().optional().nullable(),
  annualRevenue:  z.string().optional().nullable(),
  source:         z.string().optional(),
  status:         z.enum(LEAD_STATUSES).optional(),
  bantScore:      z.number().int().min(0).max(100).optional().nullable(),
  bantBreakdown:  z.record(z.unknown()).optional().nullable(),
  keywords:          z.array(z.string()).optional(),
  tags:              z.array(z.string()).optional(),
  notes:             z.string().optional().nullable(),
  sequenceDay:       z.number().int().optional().nullable(),
  lastContactedAt:   z.string().datetime().optional().nullable(),
  behaviorKeywords:  z.array(z.string()).optional(),
  intentKeywords:    z.array(z.string()).optional(),
  interestKeywords:  z.array(z.string()).optional(),
});

router.patch("/leads/:id", async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  const role  = req.user!.role as string;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = UpdateLeadSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  // Only owners and admins may change lead assignment
  if (parsed.data.assignedToId !== undefined && role !== "owner" && role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can reassign leads" });
    return;
  }

  // Fetch current lead to detect assignee changes
  const [currentLead] = await db.select({ assignedToId: leads.assignedToId })
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.orgId, orgId)));
  if (!currentLead) { res.status(404).json({ error: "Lead not found" }); return; }
  const previousAssigneeId = currentLead.assignedToId;

  // Validate that the new assignee belongs to this org
  if (parsed.data.assignedToId != null) {
    const [assignee] = await db.select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, parsed.data.assignedToId), eq(users.orgId, orgId)));
    if (!assignee) {
      res.status(400).json({ error: "Assignee not found in your organisation" });
      return;
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) updates[k] = v;
  }
  const [updated] = await db.update(leads).set(updates).where(and(eq(leads.id, id), eq(leads.orgId, orgId))).returning();
  if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json(updated);

  // Send assignment notification email when the assignee changes to a new rep
  const newAssigneeId = parsed.data.assignedToId;
  if (
    newAssigneeId != null &&
    newAssigneeId !== previousAssigneeId
  ) {
    db.select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(and(eq(users.id, newAssigneeId), eq(users.orgId, orgId)))
      .then(([rep]) => {
        if (!rep) return;
        const leadName  = `${updated.firstName} ${updated.lastName}`.trim();
        const repName   = `${rep.firstName} ${rep.lastName}`.trim() || rep.email;
        const baseUrl   = getAppBaseUrl();
        const leadUrl   = `${baseUrl}/v2/leads/${updated.id}`;
        return sendViaBrevo({
          to: [{ email: rep.email, name: repName }],
          subject: `New lead assigned to you: ${leadName}`,
          htmlContent: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e">
  <h2 style="color:#6c47ff;margin-bottom:4px">You've been assigned a new lead</h2>
  <p style="margin-top:0;color:#555">Hi ${repName}, a lead has just been assigned to you in Mysa AI.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0">
    <tr>
      <td style="padding:10px;background:#f5f4ff;font-weight:bold;width:35%;border-radius:4px 0 0 4px">Lead name</td>
      <td style="padding:10px;background:#faf9ff;border-radius:0 4px 4px 0">${leadName}</td>
    </tr>
    <tr>
      <td style="padding:10px;background:#f5f4ff;font-weight:bold;border-radius:4px 0 0 4px">Company</td>
      <td style="padding:10px;background:#faf9ff;border-radius:0 4px 4px 0">${updated.company}</td>
    </tr>
  </table>
  <p>
    <a href="${leadUrl}" style="display:inline-block;padding:12px 24px;background:#6c47ff;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
      View Lead
    </a>
  </p>
  <p style="color:#999;font-size:12px;margin-top:32px">You received this email because a lead was assigned to your Mysa AI account.</p>
</div>`,
          textContent: `Hi ${repName},\n\nA lead has been assigned to you in Mysa AI.\n\nLead: ${leadName}\nCompany: ${updated.company}\n\nView lead: ${leadUrl}`,
        });
      })
      .catch((err: unknown) => {
        logger.warn({ err, leadId: updated.id, assigneeId: newAssigneeId }, "Lead assignment email failed to send");
      });
  }
});

router.delete("/leads/:id", async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  const [deleted] = await db.delete(leads).where(and(eq(leads.id, id), eq(leads.orgId, orgId))).returning();
  if (!deleted) { res.status(404).json({ error: "Lead not found" }); return; }
  res.status(204).send();
});

const AssignSequenceSchema = z.object({ sequenceId: z.number().int().positive() });

// ── POST /leads/:id/enrich-keywords — AI-generate behavior/intent/interest keywords ──
router.post("/leads/:id/enrich-keywords", async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const overrides = await fetchOrgOverrides(orgId);
  const prompt = `You are a B2B sales intelligence analyst. Analyze this lead and generate keyword tags across three dimensions.

Lead data:
- Name: ${lead.firstName} ${lead.lastName}
- Company: ${lead.company}
- Designation: ${lead.designation}
- Industry: ${lead.industry}
- Company size: ${lead.companySize ?? "unknown"}
- Annual revenue: ${lead.annualRevenue ?? "unknown"}
- Country: ${lead.country}
- Website: ${lead.website ?? "none"}
- Existing keywords: ${(lead.keywords ?? []).join(", ") || "none"}
- Tags: ${(lead.tags ?? []).join(", ") || "none"}
- Notes: ${lead.notes ?? "none"}

Generate exactly 3–6 keywords for each dimension:

1. BEHAVIOR KEYWORDS — How this person/company behaves as a buyer: their decision-making style, urgency level, responsiveness, buying patterns (e.g. "data-driven", "price-sensitive", "quick-decider", "research-heavy", "referral-based", "budget-approver")

2. INTENT KEYWORDS — What they're actively looking to accomplish or buy right now (e.g. "website-redesign", "seo-improvement", "lead-generation", "brand-identity", "social-media-growth", "ecommerce-setup", "google-ads")

3. INTEREST KEYWORDS — Topics and themes they care about broadly (e.g. "digital-marketing", "automation", "roi-focused", "brand-building", "customer-acquisition", "market-expansion", "competitive-positioning")

Return ONLY valid JSON, no explanation:
{
  "behaviorKeywords": ["keyword1", "keyword2", ...],
  "intentKeywords": ["keyword1", "keyword2", ...],
  "interestKeywords": ["keyword1", "keyword2", ...]
}`;

  const msg = await anthropic.messages.create({
    model: getModel("lead_routing", overrides),
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) { res.status(500).json({ error: "AI response unparseable" }); return; }

  const parsed = JSON.parse(match[0]) as { behaviorKeywords: string[]; intentKeywords: string[]; interestKeywords: string[] };

  const [updated] = await db.update(leads).set({
    behaviorKeywords:  parsed.behaviorKeywords ?? [],
    intentKeywords:    parsed.intentKeywords ?? [],
    interestKeywords:  parsed.interestKeywords ?? [],
    updatedAt: new Date(),
  }).where(eq(leads.id, id)).returning();

  res.json(updated);
});

// ── POST /leads/enrich-keywords-bulk — async Anthropic Batch API keyword enrichment ──
router.post("/leads/enrich-keywords-bulk", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const bodyParsed = z.object({ ids: z.array(z.number().int().positive()).optional() }).safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }
  const { ids } = bodyParsed.data;

  let targetLeads: typeof leads.$inferSelect[];
  if (ids && ids.length > 0) {
    targetLeads = await db.select().from(leads).where(and(inArray(leads.id, ids), eq(leads.orgId, orgId)));
  } else {
    targetLeads = await db.select().from(leads)
      .where(and(eq(leads.orgId, orgId), sql`array_length(${leads.intentKeywords}, 1) IS NULL OR array_length(${leads.intentKeywords}, 1) = 0`))
      .limit(50);
  }

  if (targetLeads.length === 0) { res.status(400).json({ error: "No leads to enrich" }); return; }

  const bulkOverrides = await fetchOrgOverrides(orgId);
  const requests = targetLeads.map((lead) => ({
    custom_id: String(lead.id),
    params: {
      model: getModel("lead_routing", bulkOverrides),
      max_tokens: 300,
      messages: [{
        role: "user" as const,
        content: `You are a B2B sales intelligence analyst. Analyze this lead and generate keyword tags.
Lead: ${lead.firstName} ${lead.lastName}, ${lead.designation} at ${lead.company} (${lead.industry}, ${lead.country})
Company size: ${lead.companySize ?? "unknown"}, Revenue: ${lead.annualRevenue ?? "unknown"}
Notes: ${lead.notes ?? "none"}, Tags: ${(lead.tags ?? []).join(", ") || "none"}

Return ONLY valid JSON:
{
  "behaviorKeywords": ["3-5 buyer-behavior keywords like data-driven, price-sensitive, quick-decider"],
  "intentKeywords": ["3-5 keywords for what they want to buy like website-redesign, seo, lead-generation"],
  "interestKeywords": ["3-5 broad interest topics like digital-marketing, brand-building, automation"]
}`,
      }],
    },
  }));

  let batchId: string;
  try {
    const batch = await anthropic.beta.messages.batches.create({ requests });
    batchId = batch.id;
  } catch (err) {
    logger.error({ err }, "Keyword Enrichment Batch: failed to create Anthropic batch");
    res.status(502).json({ error: "Failed to submit batch to Anthropic" });
    return;
  }

  const [job] = await db.insert(batchJobs).values({
    batchId,
    orgId,
    type: "keyword_enrichment",
    status: "in_progress",
    leadsCount: targetLeads.length,
  }).returning();

  res.json({ batchId, jobId: job.id, leadsCount: targetLeads.length, status: "in_progress" });
});

// ── GET /leads/enrich-keywords-batch/:batchId — poll keyword enrichment batch status ──
router.get("/leads/enrich-keywords-batch/:batchId", async (req: Request, res: Response): Promise<void> => {
  const batchId = String(req.params.batchId);
  const orgId = req.user!.orgId;

  const [job] = await db.select().from(batchJobs)
    .where(and(eq(batchJobs.batchId, batchId), eq(batchJobs.orgId, orgId)))
    .limit(1);

  if (!job) { res.status(404).json({ error: "Batch job not found" }); return; }

  if (job.status === "complete") {
    res.json({ batchId, status: "complete", leadsCount: job.leadsCount, completedAt: job.completedAt });
    return;
  }

  let anthropicBatch: { processing_status: string };
  try {
    anthropicBatch = await anthropic.beta.messages.batches.retrieve(batchId);
  } catch (err) {
    logger.error({ err, batchId }, "Keyword Enrichment Batch: failed to retrieve status");
    res.status(502).json({ error: "Failed to retrieve batch status from Anthropic" });
    return;
  }

  if (anthropicBatch.processing_status !== "ended") {
    res.json({ batchId, status: "in_progress", leadsCount: job.leadsCount, processingStatus: anthropicBatch.processing_status });
    return;
  }

  let enriched = 0;
  try {
    for await (const result of await anthropic.beta.messages.batches.results(batchId)) {
      const leadId = Number(result.custom_id);
      if (isNaN(leadId)) continue;
      if (result.result.type !== "succeeded") continue;
      const content = result.result.message.content[0];
      if (!content || content.type !== "text") continue;
      const match = content.text.match(/\{[\s\S]*\}/);
      if (!match) continue;
      try {
        const parsed = JSON.parse(match[0]) as { behaviorKeywords: string[]; intentKeywords: string[]; interestKeywords: string[] };
        await db.update(leads).set({
          behaviorKeywords:  parsed.behaviorKeywords ?? [],
          intentKeywords:    parsed.intentKeywords ?? [],
          interestKeywords:  parsed.interestKeywords ?? [],
          updatedAt: new Date(),
        }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
        enriched++;
      } catch { /* skip malformed result */ }
    }
    await db.update(batchJobs).set({ status: "complete", completedAt: new Date() })
      .where(eq(batchJobs.batchId, batchId));
  } catch (err) {
    logger.error({ err, batchId }, "Keyword Enrichment Batch: error processing results");
    res.status(502).json({ error: "Error processing batch results" });
    return;
  }

  res.json({ batchId, status: "complete", leadsCount: job.leadsCount, scored: enriched, completedAt: new Date().toISOString() });
});

router.post("/leads/:id/assign-sequence", async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  const parsed = AssignSequenceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "sequenceId is required", issues: parsed.error.issues }); return; }

  const { sequenceId } = parsed.data;

  const [sequence] = await db.select().from(outreachSequences).where(and(eq(outreachSequences.id, sequenceId), eq(outreachSequences.orgId, orgId)));
  if (!sequence) { res.status(404).json({ error: "Sequence not found" }); return; }

  const steps = Array.isArray(sequence.steps) ? sequence.steps as { day: number }[] : [];
  const firstDay = steps.length > 0 ? Math.min(...steps.map((s) => s.day)) : 1;

  const [updated] = await db
    .update(leads)
    .set({ sequenceDay: firstDay, status: "contacted", updatedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.orgId, orgId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json({ ...updated, assignedSequenceId: sequenceId, sequenceName: sequence.name });
});

export default router;

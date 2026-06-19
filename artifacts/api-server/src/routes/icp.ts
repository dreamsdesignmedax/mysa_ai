import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { icps, leads } from "@workspace/db/schema";
import { eq, count, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";

const router = Router();

const GenerateIcpSchema = z.object({
  website: z.string().optional().default(""),
  description: z.string().min(1),
});

const IcpSuggestionSchema = z.object({
  name: z.string(),
  markets: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  roles: z.array(z.string()).default([]),
  companySize: z.string().default(""),
  filters: z.record(z.unknown()).default({}),
});

const CreateIcpSchema = z.object({
  name: z.string().min(1),
  markets: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  roles: z.array(z.string()).default([]),
  companySize: z.string().default(""),
  filters: z.record(z.unknown()).default({}),
  active: z.boolean().default(true),
});

const UpdateIcpSchema = z.object({
  name: z.string().min(1).optional(),
  markets: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  roles: z.array(z.string()).optional(),
  companySize: z.string().optional(),
  filters: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});

router.post("/icp/generate", async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateIcpSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { website, description } = parsed.data;

  const prompt = `You are a B2B sales strategy expert. Based on this company's information, generate exactly 10 Ideal Customer Profile (ICP) suggestions they should target.

Company Website: ${website || "Not provided"}
Product / Service Description: ${description}

Return a JSON array of exactly 10 ICP objects. Each object must have EXACTLY these fields:
- name: string — concise label, e.g. "Healthcare SMB UAE"
- markets: string[] — target geographic markets, e.g. ["UAE", "Saudi Arabia"]
- industries: string[] — 2-4 target industries
- roles: string[] — 3-5 decision-maker titles, e.g. ["CEO", "CMO", "Marketing Director"]
- companySize: string — employee range, e.g. "11-200 employees"
- filters: object — can be {} or include any of: adSpendMin (number), adSpendMax (number), hasWebsite (boolean), hasLinkedIn (boolean), hasGMB (boolean), hiringMarketers (boolean), minBantScore (0-100), requiresAudit (boolean)

Make ICPs specific, realistic, and diverse — vary industries, company sizes, and geographies. Return ONLY valid JSON array, no markdown or explanation.`;

  const overrides = await fetchOrgOverrides(req.user!.orgId);
  try {
    const response = await anthropic.messages.create({
      model: getModel("icp_suggestions", overrides),
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) { res.status(500).json({ error: "AI returned an invalid response. Please try again." }); return; }

    const raw = JSON.parse(jsonMatch[0]) as unknown[];
    const suggestions = raw
      .map((item) => {
        const r = IcpSuggestionSchema.safeParse(item);
        return r.success ? r.data : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, 10);

    if (suggestions.length < 3) {
      res.status(500).json({ error: "AI could not generate enough valid ICP suggestions. Please try again with a more detailed description." });
      return;
    }

    res.json(suggestions);
  } catch (err) {
    req.log.error({ err }, "ICP generation failed");
    res.status(500).json({ error: "ICP generation failed. Please try again." });
  }
});

router.get("/icp", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const allIcps = await db.select().from(icps).where(eq(icps.orgId, orgId)).orderBy(icps.createdAt);

  const withCounts = await Promise.all(
    allIcps.map(async (icp) => {
      const [row] = await db.select({ c: count() }).from(leads).where(
        and(eq(leads.icpId, icp.id), eq(leads.orgId, orgId))
      );
      return { ...icp, leadCount: Number(row?.c ?? 0) };
    }),
  );

  res.json(withCounts);
});

router.post("/icp", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateIcpSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { name, markets, industries, roles, companySize, filters, active } = parsed.data;
  const [created] = await db
    .insert(icps)
    .values({ name, markets, industries, roles, companySize, filters, active, orgId: req.user!.orgId })
    .returning();
  res.status(201).json({ ...created, leadCount: 0 });
});

router.get("/icp/:id", async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [icp] = await db.select().from(icps).where(and(eq(icps.id, id), eq(icps.orgId, orgId)));
  if (!icp) { res.status(404).json({ error: "ICP not found" }); return; }
  const [row] = await db.select({ c: count() }).from(leads).where(
    and(eq(leads.icpId, id), eq(leads.orgId, orgId))
  );
  res.json({ ...icp, leadCount: Number(row?.c ?? 0) });
});

router.patch("/icp/:id", async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateIcpSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const updates: Record<string, unknown> = {};
  const data = parsed.data;
  if (data.name !== undefined) updates.name = data.name;
  if (data.markets !== undefined) updates.markets = data.markets;
  if (data.industries !== undefined) updates.industries = data.industries;
  if (data.roles !== undefined) updates.roles = data.roles;
  if (data.companySize !== undefined) updates.companySize = data.companySize;
  if (data.filters !== undefined) updates.filters = data.filters;
  if (data.active !== undefined) updates.active = data.active;

  const [updated] = await db
    .update(icps)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(icps.id, id), eq(icps.orgId, orgId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "ICP not found" }); return; }
  const [row] = await db.select({ c: count() }).from(leads).where(
    and(eq(leads.icpId, id), eq(leads.orgId, orgId))
  );
  res.json({ ...updated, leadCount: Number(row?.c ?? 0) });
});

router.delete("/icp/:id", async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [deleted] = await db.delete(icps).where(and(eq(icps.id, id), eq(icps.orgId, orgId))).returning();
  if (!deleted) { res.status(404).json({ error: "ICP not found" }); return; }
  res.status(204).send();
});

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import { leadLists, leadListItems, leads } from "@workspace/db/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import type { Request, Response } from "express";
import { logger } from "../lib/logger";

const router = Router();

/* ── GET /api/lead-lists ─────────────────────────────────────── */
router.get("/lead-lists", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  try {
    const lists = await db
      .select({
        id:          leadLists.id,
        name:        leadLists.name,
        description: leadLists.description,
        color:       leadLists.color,
        createdAt:   leadLists.createdAt,
        updatedAt:   leadLists.updatedAt,
        count:       sql<number>`(select count(*) from lead_list_items where list_id = ${leadLists.id})::int`,
      })
      .from(leadLists)
      .where(eq(leadLists.orgId, orgId))
      .orderBy(desc(leadLists.createdAt));
    res.json(lists);
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/lead-lists ────────────────────────────────────── */
const createSchema = z.object({
  name:        z.string().min(1).max(255),
  description: z.string().optional(),
  color:       z.string().optional(),
  leadIds:     z.array(z.number().int()).optional(),
});

router.post("/lead-lists", async (req: Request, res: Response): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const { name, description, color, leadIds } = parsed.data;
  const orgId = req.user!.orgId;

  try {
    const [list] = await db.insert(leadLists).values({
      orgId,
      name,
      description: description ?? null,
      color: color ?? "#6366F1",
    }).returning();

    if (leadIds && leadIds.length > 0) {
      await db.insert(leadListItems).values(
        leadIds.map((leadId) => ({ listId: list.id, leadId }))
      ).onConflictDoNothing();
    }

    res.json({ ...list, count: leadIds?.length ?? 0 });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/lead-lists/:id ─────────────────────────────────── */
router.get("/lead-lists/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const orgId = req.user!.orgId;

  try {
    const [list] = await db.select().from(leadLists).where(and(eq(leadLists.id, id), eq(leadLists.orgId, orgId)));
    if (!list) { res.status(404).json({ error: "Not found" }); return; }

    const items = await db
      .select({
        id:               leads.id,
        firstName:        leads.firstName,
        lastName:         leads.lastName,
        email:            leads.email,
        phone:            leads.phone,
        company:          leads.company,
        designation:      leads.designation,
        industry:         leads.industry,
        country:          leads.country,
        status:           leads.status,
        bantScore:        leads.bantScore,
        source:           leads.source,
        addedAt:          leadListItems.addedAt,
      })
      .from(leadListItems)
      .innerJoin(leads, and(eq(leadListItems.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(eq(leadListItems.listId, id))
      .orderBy(desc(leadListItems.addedAt));

    res.json({ ...list, leads: items, count: items.length });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/lead-lists/:id ─────────────────────────────────── */
const updateSchema = z.object({
  name:        z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  color:       z.string().optional(),
});

router.put("/lead-lists/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const orgId = req.user!.orgId;
  try {
    const [updated] = await db
      .update(leadLists)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(leadLists.id, id), eq(leadLists.orgId, orgId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/lead-lists/:id ──────────────────────────────── */
router.delete("/lead-lists/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const orgId = req.user!.orgId;

  try {
    await db.delete(leadLists).where(and(eq(leadLists.id, id), eq(leadLists.orgId, orgId)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/lead-lists/:id/leads ──────────────────────────── */
router.post("/lead-lists/:id/leads", async (req: Request, res: Response): Promise<void> => {
  const listId = Number(req.params.id);
  if (isNaN(listId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({ leadIds: z.array(z.number().int()).min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "leadIds must be a non-empty array of integers" }); return; }
  const { leadIds } = parsed.data;
  const orgId = req.user!.orgId;

  try {
    // Verify list belongs to org
    const [list] = await db.select({ id: leadLists.id }).from(leadLists).where(and(eq(leadLists.id, listId), eq(leadLists.orgId, orgId)));
    if (!list) { res.status(404).json({ error: "Not found" }); return; }

    await db.insert(leadListItems).values(
      leadIds.map((leadId) => ({ listId, leadId }))
    ).onConflictDoNothing();

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leadListItems)
      .where(eq(leadListItems.listId, listId));

    res.json({ ok: true, count });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/lead-lists/:id/leads/:leadId ────────────────── */
router.delete("/lead-lists/:id/leads/:leadId", async (req: Request, res: Response): Promise<void> => {
  const listId  = Number(req.params.id);
  const leadId  = Number(req.params.leadId);
  if (isNaN(listId) || isNaN(leadId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const orgId = req.user!.orgId;

  try {
    // Verify list belongs to org
    const [list] = await db.select({ id: leadLists.id }).from(leadLists).where(and(eq(leadLists.id, listId), eq(leadLists.orgId, orgId)));
    if (!list) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(leadListItems).where(
      and(eq(leadListItems.listId, listId), eq(leadListItems.leadId, leadId))
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

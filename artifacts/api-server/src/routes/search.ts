import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { leads, proposals, meetings } from "@workspace/db/schema";
import { ilike, or, sql, eq, and } from "drizzle-orm";

const router = Router();

router.get("/search", async (req: Request, res: Response): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 2) { res.json({ leads: [], proposals: [], meetings: [] }); return; }

  const orgId   = req.user!.orgId;
  const pattern = `%${q}%`;

  const [leadRows, proposalRows, meetingRows] = await Promise.all([
    db.select({
      id:          leads.id,
      firstName:   leads.firstName,
      lastName:    leads.lastName,
      email:       leads.email,
      company:     leads.company,
      designation: leads.designation,
      status:      leads.status,
    })
      .from(leads)
      .where(
        and(
          eq(leads.orgId, orgId),
          or(
            ilike(leads.firstName,   pattern),
            ilike(leads.lastName,    pattern),
            ilike(leads.email,       pattern),
            ilike(leads.company,     pattern),
            ilike(leads.designation, pattern),
          ),
        )
      )
      .limit(8),

    db.select({
      id:      proposals.id,
      title:   proposals.title,
      company: leads.company,
      status:  proposals.status,
    })
      .from(proposals)
      .innerJoin(leads, and(eq(proposals.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(
        or(
          ilike(proposals.title, pattern),
          ilike(leads.company,   pattern),
        )
      )
      .limit(5),

    db.select({
      id:          meetings.id,
      title:       leads.company,
      type:        meetings.type,
      scheduledAt: meetings.scheduledAt,
      status:      meetings.status,
    })
      .from(meetings)
      .innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(
        or(
          ilike(leads.firstName,  pattern),
          ilike(leads.lastName,   pattern),
          ilike(leads.company,    pattern),
          sql`coalesce(${meetings.notes},'') ilike ${pattern}`,
        )
      )
      .limit(5),
  ]);

  res.json({ leads: leadRows, proposals: proposalRows, meetings: meetingRows });
});

export default router;

import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import {
  leads,
  meetings,
  appointments,
  proposals,
  touchpoints,
} from "@workspace/db/schema";
import { eq, gte, and, sql, count } from "drizzle-orm";

const router = Router();

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

router.get("/dashboard/summary", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());

  const orgLeads = eq(leads.orgId, orgId);

  const [
    totalLeadsAll,
    leadsThisMonth,
    qualifiedLeads,
    meetingsThisWeekRaw,
    proposalsSent,
    dealsClosedThisMonth,
    bantQueue,
    outreachPending,
    pipelineRows,
  ] = await Promise.all([
    db.select({ c: count() }).from(leads).where(orgLeads),
    db.select({ c: count() }).from(leads).where(and(orgLeads, gte(leads.createdAt, startOfMonth))),
    db.select({ c: count() }).from(leads).where(and(orgLeads, gte(leads.bantScore, 65))),
    (async () => {
      const [m] = await db.select({ c: count() }).from(meetings)
        .innerJoin(leads, and(eq(meetings.leadId, leads.id), orgLeads))
        .where(gte(meetings.scheduledAt, startOfWeek));
      const [a] = await db.select({ c: count() }).from(appointments)
        .where(and(eq(appointments.orgId, orgId), gte(appointments.scheduledDate, toYMD(startOfWeek)), eq(appointments.status, "confirmed")));
      return [{ c: (Number(m?.c ?? 0) + Number(a?.c ?? 0)) }];
    })(),
    db.select({ c: count() }).from(proposals)
      .innerJoin(leads, and(eq(proposals.leadId, leads.id), orgLeads))
      .where(eq(proposals.status, "sent")),
    db.select({ c: count() }).from(proposals)
      .innerJoin(leads, and(eq(proposals.leadId, leads.id), orgLeads))
      .where(and(eq(proposals.status, "closed_won"), gte(proposals.createdAt, startOfMonth))),
    db.select({ c: count() }).from(leads).where(and(orgLeads, eq(leads.status, "new_enquiry"))),
    db.select({ c: count() }).from(touchpoints)
      .innerJoin(leads, and(eq(touchpoints.leadId, leads.id), orgLeads))
      .where(eq(touchpoints.status, "pending")),
    db.select({ inv: sql<number>`coalesce(sum(${proposals.investment}), 0)` }).from(proposals)
      .innerJoin(leads, and(eq(proposals.leadId, leads.id), orgLeads))
      .where(eq(proposals.status, "sent")),
  ]);

  res.json({
    totalLeads: totalLeadsAll[0]?.c ?? 0,
    totalLeadsThisMonth: leadsThisMonth[0]?.c ?? 0,
    qualifiedLeads: qualifiedLeads[0]?.c ?? 0,
    meetingsThisWeek: meetingsThisWeekRaw[0]?.c ?? 0,
    proposalsSent: proposalsSent[0]?.c ?? 0,
    pipelineValue: Number(pipelineRows[0]?.inv ?? 0),
    dealsClosedThisMonth: dealsClosedThisMonth[0]?.c ?? 0,
    bantQueueSize: bantQueue[0]?.c ?? 0,
    outreachPending: outreachPending[0]?.c ?? 0,
  });
});

router.get("/dashboard/activity", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;

  const recentLeads = await db
    .select()
    .from(leads)
    .where(eq(leads.orgId, orgId))
    .orderBy(sql`${leads.createdAt} desc`)
    .limit(10);

  const recentMeetings = await db
    .select({ meeting: meetings, lead: { firstName: leads.firstName, lastName: leads.lastName } })
    .from(meetings)
    .innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId)))
    .orderBy(sql`${meetings.createdAt} desc`)
    .limit(5);

  const items = [
    ...recentLeads.map((l, i) => ({
      id: i + 1,
      type: "lead_added",
      description: `New lead added: ${l.firstName} ${l.lastName}`,
      leadName: `${l.firstName} ${l.lastName}`,
      company: l.company,
      createdAt: l.createdAt,
    })),
    ...recentMeetings.map((r, i) => ({
      id: recentLeads.length + i + 1,
      type: "meeting_scheduled",
      description: `Meeting scheduled`,
      leadName: r.lead ? `${r.lead.firstName} ${r.lead.lastName}` : null,
      company: null,
      createdAt: r.meeting.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10);

  res.json(items);
});

router.get("/dashboard/pipeline-funnel", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const orgLeads = eq(leads.orgId, orgId);

  const statuses = ["new_enquiry", "enquiry_qualified", "discovery_call", "quote_sent", "follow_up", "project_won"];
  const counts = await Promise.all(
    statuses.map(status =>
      db.select({ c: count() }).from(leads).where(and(orgLeads, eq(leads.status, status)))
        .then(([r]) => Number(r?.c ?? 0))
    )
  );

  const stageNames = ["New Enquiry", "Enquiry Qualified", "Discovery Call", "Quote Sent", "Follow Up", "Project Won"];
  const stages = stageNames.map((stage, i) => ({
    stage,
    count: counts[i]!,
    conversionRate: i > 0 && counts[i - 1]! > 0 ? Math.round((counts[i]! / counts[i - 1]!) * 100) : null,
  }));

  res.json({ stages });
});

export default router;

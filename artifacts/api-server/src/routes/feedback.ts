import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { feedback } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, withCache } from "../config/modelRouting";

const router = Router();

// ── POST /api/feedback — public, anyone can submit ─────────────────────────
router.post("/feedback", async (req: Request, res: Response): Promise<void> => {
  const { category = "general", title, message, page, email, priority = "medium" } = req.body;
  if (!title || !message) {
    res.status(400).json({ error: "title and message are required" });
    return;
  }
  const [row] = await db
    .insert(feedback)
    .values({ category, title, message, page, email, priority })
    .returning({ id: feedback.id });
  res.status(201).json({ ok: true, id: row!.id });
});

// ── GET /api/saas/feedback — admin: list all feedback ──────────────────────
router.get("/saas/feedback", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.select().from(feedback).orderBy(desc(feedback.createdAt));
  res.json(rows);
});

// ── PUT /api/saas/feedback/:id/status — admin: update status ───────────────
router.put("/saas/feedback/:id/status", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { status, priority } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  await db.update(feedback).set(updates).where(eq(feedback.id, id));
  res.json({ ok: true });
});

// ── DELETE /api/saas/feedback/:id — admin: delete ──────────────────────────
router.delete("/saas/feedback/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(feedback).where(eq(feedback.id, id));
  res.json({ ok: true });
});

// ── POST /api/saas/feedback/:id/discuss — AI discussion ────────────────────
router.post("/saas/feedback/:id/discuss", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const [item] = await db.select().from(feedback).where(eq(feedback.id, id));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  const { userMessage } = req.body as { userMessage?: string };

  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  try {
    if (item.aiDiscussion) history = JSON.parse(item.aiDiscussion);
  } catch { history = []; }

  const systemPrompt = `You are a senior product manager and engineer for Mysa AI, an AI-powered sales automation SaaS for digital agencies. 
You are helping the founder analyze and discuss user feedback.

The feedback item is:
Category: ${item.category}
Priority: ${item.priority}
Title: ${item.title}
Message: ${item.message}
${item.page ? `Page/Feature: ${item.page}` : ""}
${item.email ? `From: ${item.email}` : ""}

Analyze this feedback thoughtfully. If it's a bug, identify the likely cause and steps to reproduce. 
If it's a feature request, evaluate its value and implementation complexity.
Be concise, practical, and specific. Format your response clearly.`;

  const newUserMsg: { role: "user"; content: string } = {
    role: "user",
    content: userMessage || "Analyze this feedback item. What's the root cause or value? What should we do about it?",
  };

  const messagesForApi = [...history, newUserMsg] as Array<{ role: "user" | "assistant"; content: string }>;

  const response = await anthropic.messages.create({
    model: getModel("sales_brain_query"),
    max_tokens: 1024,
    system: withCache(systemPrompt),
    messages: messagesForApi,
  });

  const assistantContent = response.content[0]?.type === "text" ? response.content[0].text : "";

  const updatedHistory = [
    ...history,
    newUserMsg,
    { role: "assistant" as const, content: assistantContent },
  ];

  await db.update(feedback).set({
    aiDiscussion: JSON.stringify(updatedHistory),
    updatedAt: new Date(),
  }).where(eq(feedback.id, id));

  res.json({ reply: assistantContent, history: updatedHistory });
});

// ── POST /api/saas/feedback/:id/fix — AI fix analysis ─────────────────────
router.post("/saas/feedback/:id/fix", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const [item] = await db.select().from(feedback).where(eq(feedback.id, id));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  const systemPrompt = `You are a senior full-stack engineer for Mysa AI, a sales automation SaaS built with:
- Backend: Express.js + TypeScript, PostgreSQL with Drizzle ORM (artifacts/api-server/src/)
- Frontend Admin: React + Vite + TailwindCSS (artifacts/sales-war-machine/src/)
- Landing Page: React + Vite (artifacts/mysa-landing/src/)
- Database Schema: lib/db/src/schema/

The tech stack uses pnpm monorepo, React Query for data fetching, Wouter for routing, and Lucide icons.

Analyze this feedback and provide a detailed, actionable implementation plan:
Category: ${item.category}
Priority: ${item.priority}
Title: ${item.title}
Description: ${item.message}
${item.page ? `Affected Page/Feature: ${item.page}` : ""}

Provide:
1. ROOT CAUSE or FEATURE ASSESSMENT
2. SPECIFIC FILES to create or modify (with exact file paths)
3. STEP-BY-STEP IMPLEMENTATION (with code snippets where relevant)
4. TESTING CHECKLIST

Be specific, actionable, and reference actual file paths.`;

  const response = await anthropic.messages.create({
    model: getModel("sales_brain_query"),
    max_tokens: 2048,
    messages: [{ role: "user", content: "Generate the implementation plan for this feedback item." }],
    system: withCache(systemPrompt),
  });

  const plan = response.content[0]?.type === "text" ? response.content[0].text : "";

  await db.update(feedback).set({
    status: "fixing",
    updatedAt: new Date(),
  }).where(eq(feedback.id, id));

  res.json({ plan });
});

export default router;

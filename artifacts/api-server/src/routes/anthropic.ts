import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { conversations, messages } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides, withCache } from "../config/modelRouting";
import { getDreamsdesignKnowledgeBase } from "../lib/dreamsdesign-knowledge";

const router = Router();

router.get("/anthropic/conversations", async (req: Request, res: Response): Promise<void> => {
  const rows = await db.select().from(conversations).orderBy(conversations.createdAt);
  res.json(rows);
});

router.post("/anthropic/conversations", async (req: Request, res: Response): Promise<void> => {
  const { title } = req.body;
  const [created] = await db.insert(conversations).values({ title }).returning();
  res.status(201).json(created);
});

router.get("/anthropic/conversations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
  res.json({ ...conv, messages: msgs });
});

router.delete("/anthropic/conversations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const [deleted] = await db.delete(conversations).where(eq(conversations.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.status(204).send();
});

router.get("/anthropic/conversations/:id/messages", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
  res.json(msgs);
});

router.post("/anthropic/chat/stream", async (req: Request, res: Response): Promise<void> => {
  const { messages: msgList, system } = req.body as { messages?: { role: "user" | "assistant"; content: string }[]; system?: string };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const kb = getDreamsdesignKnowledgeBase();
  const defaultSystem = `${kb}

You are Mysa AI — the expert B2B Sales Intelligence Brain of Dreamsdesign. 
You help Krishna Puranik's team with outreach strategy, proposal writing, 
objection handling, lead qualification, and closing deals.
Answer every sales question with the depth, confidence, and warmth of Krishna himself.`;
  const overrides = await fetchOrgOverrides(req.user!.orgId);
  const stream = anthropic.messages.stream({
    model: getModel("sales_brain_query", overrides),
    max_tokens: 1500,
    system: withCache(system ?? defaultSystem),
    messages: (msgList ?? []) as { role: "user" | "assistant"; content: string }[],
  });

  stream.on("text", (text: string) => {
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
  });

  stream.on("finalMessage", () => {
    res.write(`data: [DONE]\n\n`);
    res.end();
  });

  stream.on("error", (err: Error) => {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });
});

router.post("/anthropic/conversations/:id/messages", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { content } = req.body;

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  await db.insert(messages).values({ conversationId: id, role: "user", content });

  const history = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);

  const anthropicMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const kb2 = getDreamsdesignKnowledgeBase();
  const overrides2 = await fetchOrgOverrides(req.user!.orgId);
  const stream = anthropic.messages.stream({
    model: getModel("sales_brain_query", overrides2),
    max_tokens: 1500,
    system: withCache(`${kb2}

You are Mysa AI — the expert B2B Sales Intelligence Brain of Dreamsdesign.
You help Krishna Puranik's team craft winning outreach messages, write compelling proposals,
handle objections with empathy and data, qualify leads using BANT, and close deals.
You know every service, every proof point, and every pricing tier intimately.
Speak with the authority of someone who has helped 4,500+ brands grow — because you have.`),
    messages: anthropicMessages,
  });

  let fullContent = "";

  stream.on("text", (text: string) => {
    fullContent += text;
    res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
  });

  stream.on("finalMessage", async () => {
    await db.insert(messages).values({ conversationId: id, role: "assistant", content: fullContent });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  });

  stream.on("error", (err: Error) => {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });
});

export default router;

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { waitlist } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireOwnerOrAdmin } from "../middleware";

const router = Router();

const SubmitSchema = z.object({
  name:     z.string().min(1).max(200),
  email:    z.string().email().max(300),
  phone:    z.string().max(50).optional(),
  company:  z.string().max(200).optional(),
  role:     z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  message:  z.string().max(2000).optional(),
});

async function sendBrevoThankYou(to: string, name: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return;
  const firstName = name.split(" ")[0];
  const body = {
    sender: { name: "Mysa AI", email: "noreply@mysaai.com" },
    to: [{ email: to, name }],
    subject: "You're on the Mysa AI waitlist! 🎉",
    htmlContent: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#060612;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:48px 32px;">
    <div style="text-align:center;margin-bottom:40px;">
      <div style="display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#4F35A8,#7C3AED);padding:12px 24px;border-radius:50px;">
        <span style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.02em;">⚡ Mysa AI</span>
      </div>
    </div>

    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:48px 40px;text-align:center;">
      <div style="font-size:56px;margin-bottom:24px;">🎉</div>
      <h1 style="font-size:28px;font-weight:900;color:#fff;margin:0 0 16px;letter-spacing:-0.02em;">
        You're on the list, ${firstName}!
      </h1>
      <p style="font-size:16px;color:rgba(255,255,255,0.55);line-height:1.7;margin:0 0 32px;">
        Thank you for joining the Mysa AI waitlist. We're onboarding teams selectively 
        to ensure every customer gets the best experience possible.
      </p>

      <div style="background:rgba(79,53,168,0.15);border:1px solid rgba(79,53,168,0.25);border-radius:16px;padding:28px;text-align:left;margin-bottom:32px;">
        <h3 style="font-size:14px;font-weight:700;color:#9F7AEA;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 16px;">What happens next?</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="color:rgba(255,255,255,0.7);font-size:15px;">✅ &nbsp;Your application is under review</div>
          <div style="color:rgba(255,255,255,0.7);font-size:15px;">📩 &nbsp;Expect a personal invite within 24–48 hours</div>
          <div style="color:rgba(255,255,255,0.7);font-size:15px;">🚀 &nbsp;Get onboarded with a dedicated Mysa AI specialist</div>
        </div>
      </div>

      <p style="font-size:14px;color:rgba(255,255,255,0.35);margin:0;">
        In the meantime, feel free to share Mysa AI with your network.
      </p>
    </div>

    <div style="text-align:center;margin-top:40px;">
      <p style="font-size:12px;color:rgba(255,255,255,0.2);">
        © 2026 Mysa Ai Technology. Developed with love by Dreamsdesign.
      </p>
    </div>
  </div>
</body>
</html>`,
  };

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
}

router.post("/waitlist", async (req: Request, res: Response): Promise<void> => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid submission", issues: parsed.error.issues });
    return;
  }
  const { name, email, phone, company, role, location, message } = parsed.data;
  try {
    const [row] = await db.insert(waitlist).values({ name, email, phone, company, role, location, message }).returning();
    sendBrevoThankYou(email, name).catch(() => {});
    res.status(201).json({ ok: true, id: row.id });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      res.status(409).json({ error: "You're already on the waitlist!" });
      return;
    }
    throw err;
  }
});

router.get("/waitlist", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.select().from(waitlist).orderBy(desc(waitlist.createdAt));
  res.json(rows);
});

router.patch("/waitlist/:id/approve", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(waitlist).set({ approved: true }).where(eq(waitlist.id, id)).returning();
  res.json(row);
});

router.delete("/waitlist/:id", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(waitlist).where(eq(waitlist.id, id));
  res.json({ ok: true });
});

export default router;

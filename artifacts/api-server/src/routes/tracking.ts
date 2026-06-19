import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { outreachEmails } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router = Router();

const PIXEL = Buffer.from(
  "47494638396101000100800000ffffff00000021f90400000000002c00000000010001000002024401003b",
  "hex"
);

router.get("/track/open/:trackingId", async (req: Request, res: Response): Promise<void> => {
  const trackingId = String(req.params.trackingId);

  if (trackingId) {
    db.update(outreachEmails)
      .set({ openedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(outreachEmails.trackingId, trackingId))
      .execute()
      .catch(() => {});
  }

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.end(PIXEL);
});

export default router;

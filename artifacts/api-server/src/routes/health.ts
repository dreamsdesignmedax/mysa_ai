import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", async (_req: Request, res: Response): Promise<void> => {
  const startAt = Date.now();
  let dbStatus: "ok" | "error" = "ok";
  let dbLatencyMs: number | null = null;

  try {
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - dbStart;
  } catch (err) {
    logger.error({ err }, "Health check: DB connectivity failed");
    dbStatus = "error";
  }

  const status = dbStatus === "ok" ? "ok" : "degraded";
  const memUsage = process.memoryUsage();

  const payload = {
    status,
    uptime: Math.floor(process.uptime()),
    db: { status: dbStatus, latencyMs: dbLatencyMs },
    memory: {
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMb: Math.round(memUsage.rss / 1024 / 1024),
    },
    responseTimeMs: Date.now() - startAt,
    timestamp: new Date().toISOString(),
  };

  res.status(dbStatus === "ok" ? 200 : 503).json(payload);
});

export default router;

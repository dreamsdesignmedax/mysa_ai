import type { Request, Response, NextFunction } from "express";

const ADMIN_EMAIL = process.env["ADMIN_EMAIL"] ?? "";

export function requireOwnerOrAdmin(req: Request, res: Response, next: NextFunction): void {
  const role  = req.user?.role;
  const email = req.user?.email;
  if (role === "owner" || role === "admin" || (ADMIN_EMAIL && email === ADMIN_EMAIL)) return next();
  res.status(403).json({ error: "Forbidden: requires owner or admin role" });
}

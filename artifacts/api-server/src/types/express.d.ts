import "express";

declare module "express" {
  interface Request {
    user?: {
      userId: number;
      orgId: number;
      email: string;
      role: string;
    };
  }
}

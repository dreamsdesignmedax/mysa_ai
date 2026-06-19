import { db } from "../lib/db";
import { organizations } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export const MODELS = {
  FAST:  "claude-haiku-4-5",
  SMART: "claude-sonnet-4-5",
} as const;

export type ModelTier = keyof typeof MODELS;

export const MODEL_ROUTING: Record<string, ModelTier> = {
  bantb_scoring:      "FAST",
  belief_scoring:     "FAST",
  followup_email:     "FAST",
  whatsapp_message:   "FAST",
  icp_suggestions:    "FAST",
  lead_routing:       "FAST",
  brand_audit_report: "SMART",
  outreach_email:     "SMART",
  sales_brain_query:  "SMART",
  intent_summary:     "SMART",
};

export const OPERATION_LABELS: Record<string, string> = {
  bantb_scoring:      "BANT + Belief Scoring",
  belief_scoring:     "Belief Scoring",
  followup_email:     "Follow-up Emails",
  whatsapp_message:   "WhatsApp Messages",
  icp_suggestions:    "ICP Suggestions",
  lead_routing:       "Lead Routing",
  brand_audit_report: "Brand Audit Reports",
  outreach_email:     "Outreach Emails",
  sales_brain_query:  "Sales Brain Queries",
  intent_summary:     "Intent Summaries",
};

export function getModel(operationType: string, overrides?: Record<string, ModelTier>): string {
  const tier = overrides?.[operationType] ?? MODEL_ROUTING[operationType] ?? "FAST";
  return MODELS[tier];
}

export async function fetchOrgOverrides(orgId: number): Promise<Record<string, ModelTier>> {
  try {
    const [org] = await db.select({ modelRoutingOverrides: organizations.modelRoutingOverrides })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return org?.modelRoutingOverrides ?? {};
  } catch {
    return {};
  }
}

export async function getModelForOrg(operationType: string, orgId: number): Promise<string> {
  const overrides = await fetchOrgOverrides(orgId);
  return getModel(operationType, overrides);
}

export type CacheControlBlock = [{ type: "text"; text: string; cache_control: { type: "ephemeral" } }];

export function withCache(systemText: string): CacheControlBlock {
  return [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }];
}

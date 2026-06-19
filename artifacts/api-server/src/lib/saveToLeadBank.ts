import { db } from "./db";
import { leadBank } from "@workspace/db/schema";

interface LeadLike {
  id:            number;
  orgId:         number | null;
  firstName:     string;
  lastName:      string;
  email:         string | null;
  phone?:        string | null;
  company:       string;
  designation?:  string | null;
  industry?:     string | null;
  city?:         string | null;
  country?:      string | null;
  companySize?:  string | null;
  annualRevenue?: string | null;
  website?:      string | null;
  linkedInUrl?:  string | null;
  source?:       string | null;
  tags?:         string[];
  keywords?:     string[];
  intentKeywords?:   string[];
  behaviorKeywords?: string[];
  interestKeywords?: string[];
}

/**
 * Mirror a freshly-inserted lead into the lead bank.
 * Uses onConflictDoNothing on (orgId, email) so duplicates are silently skipped.
 * Fires-and-forgets — never throws so it can never block the main flow.
 */
export async function saveToLeadBank(lead: LeadLike): Promise<void> {
  if (!lead.email || !lead.orgId) return;

  try {
    await db.insert(leadBank).values({
      orgId:         lead.orgId,
      firstName:     lead.firstName || "Unknown",
      lastName:      lead.lastName  || "",
      email:         lead.email,
      phone:         lead.phone    ?? null,
      company:       lead.company  || "Unknown",
      designation:   lead.designation  ?? "",
      industry:      lead.industry     ?? "",
      city:          lead.city         ?? null,
      country:       lead.country      ?? "",
      companySize:   lead.companySize  ?? null,
      annualRevenue: lead.annualRevenue ?? null,
      website:       lead.website      ?? null,
      linkedInUrl:   lead.linkedInUrl  ?? null,
      source:        lead.source       ?? "platform",
      tags:          lead.tags         ?? [],
      intentKeywords:   lead.intentKeywords   ?? lead.keywords ?? [],
      behaviorKeywords: lead.behaviorKeywords ?? [],
      interestKeywords: lead.interestKeywords ?? [],
    }).onConflictDoNothing();
  } catch {
    // Never block the main flow — lead bank mirror is best-effort
  }
}

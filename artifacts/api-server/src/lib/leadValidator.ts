/**
 * Lead validation — blocks dummy, placeholder, or big-tech-corp entries
 * from being stored in the leads database.
 */

const BLOCKED_EMAIL_DOMAINS = new Set([
  "google.com", "amazon.com", "apple.com", "microsoft.com",
  "meta.com", "facebook.com", "twitter.com", "x.com",
  "tesla.com", "netflix.com", "uber.com", "airbnb.com",
  "spotify.com", "salesforce.com", "oracle.com", "sap.com",
  "ibm.com", "intel.com", "nvidia.com", "adobe.com",
  "example.com", "test.com", "dummy.com", "placeholder.com",
  "mailinator.com", "guerrillamail.com", "tempmail.com",
]);

const DUMMY_EMAIL_PREFIXES = [
  "test", "dummy", "sample", "fake", "placeholder",
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "admin123", "user123", "demo", "trial",
];

const DUMMY_NAME_VALUES = new Set([
  "unknown", "test", "dummy", "sample", "fake", "placeholder",
  "na", "n/a", "none", "null", "undefined", "user", "name",
  "first", "last", "firstname", "lastname", "anonymous",
]);

const BLOCKED_COMPANIES = new Set([
  "google", "amazon", "apple", "microsoft", "meta", "facebook",
  "twitter", "tesla", "netflix", "uber", "airbnb", "spotify",
  "salesforce", "oracle", "sap", "ibm", "intel", "nvidia", "adobe",
  "amazon web services", "aws", "google llc", "apple inc",
]);

export interface LeadValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateLead(lead: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  company?: string | null;
}): LeadValidationResult {
  const email   = (lead.email   ?? "").trim().toLowerCase();
  const first   = (lead.firstName ?? "").trim().toLowerCase();
  const last    = (lead.lastName  ?? "").trim().toLowerCase();
  const company = (lead.company   ?? "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return { valid: false, reason: "missing or invalid email" };
  }

  const [prefix, domain] = email.split("@");

  if (!domain || !domain.includes(".")) {
    return { valid: false, reason: "invalid email domain" };
  }

  if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
    return { valid: false, reason: `email domain '${domain}' is not a valid B2B prospect` };
  }

  if (DUMMY_EMAIL_PREFIXES.some((p) => prefix === p || prefix.startsWith(`${p}@`) || prefix.startsWith(`${p}_`) || prefix.startsWith(`${p}.`))) {
    return { valid: false, reason: `email prefix '${prefix}' looks like a placeholder` };
  }

  if (!first || DUMMY_NAME_VALUES.has(first)) {
    return { valid: false, reason: `first name '${first}' is missing or placeholder` };
  }

  if (!last || DUMMY_NAME_VALUES.has(last)) {
    return { valid: false, reason: `last name '${last}' is missing or placeholder` };
  }

  if (!company) {
    return { valid: false, reason: "company name is missing" };
  }

  const companyNorm = company.replace(/[^a-z0-9 ]/g, "").trim();
  if (BLOCKED_COMPANIES.has(companyNorm)) {
    return { valid: false, reason: `company '${company}' is a global tech giant, not a valid B2B prospect` };
  }

  const name = `${first} ${last}`;
  if (/^(manager|director|ceo|cto|owner|employee)\s+(manager|director|ceo|cto|owner|employee)$/i.test(name)) {
    return { valid: false, reason: "name looks like a placeholder job title" };
  }

  return { valid: true };
}

export function filterValidLeads<T extends { firstName?: string | null; lastName?: string | null; email?: string | null; company?: string | null }>(
  leads: T[]
): { valid: T[]; skipped: { item: T; reason: string }[] } {
  const valid: T[] = [];
  const skipped: { item: T; reason: string }[] = [];
  const seenEmails = new Set<string>();

  for (const lead of leads) {
    const result = validateLead(lead);
    if (!result.valid) {
      skipped.push({ item: lead, reason: result.reason ?? "invalid" });
      continue;
    }
    const email = (lead.email ?? "").trim().toLowerCase();
    if (seenEmails.has(email)) {
      skipped.push({ item: lead, reason: "duplicate email in batch" });
      continue;
    }
    seenEmails.add(email);
    valid.push(lead);
  }

  return { valid, skipped };
}

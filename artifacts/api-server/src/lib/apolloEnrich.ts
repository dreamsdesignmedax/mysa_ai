/**
 * Apollo.io People Match — enriches a lead by email.
 * Returns partial lead fields that can be merged into the DB record.
 */

import { logApolloUsage } from "./logApiUsage";

const APOLLO_API = "https://api.apollo.io/api/v1";

export interface EnrichedLeadData {
  firstName?:    string;
  lastName?:     string;
  photoUrl?:     string;
  linkedInUrl?:  string;
  designation?:  string;
  company?:      string;
  website?:      string;
  industry?:     string;
  companySize?:  string;
  city?:         string;
  country?:      string;
  phone?:        string;
}

export async function enrichLeadByEmail(email: string): Promise<EnrichedLeadData | null> {
  const apiKey = process.env["APOLLO_API_KEY"];
  if (!apiKey) return null;

  try {
    const res = await fetch(`${APOLLO_API}/people/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        api_key: apiKey,
        email,
        reveal_personal_emails: false,
        reveal_phone_number: false,
      }),
    });

    if (!res.ok) return null;
    void logApolloUsage({ feature: "lead-enrichment" });
    const data = await res.json() as Record<string, unknown>;
    const person = (data.person ?? data) as Record<string, unknown>;
    if (!person || typeof person !== "object") return null;

    const org = (person.organization ?? (person.employment_history as Record<string, unknown>[] | undefined)?.[0]) as Record<string, unknown> | undefined;
    const photo = String(person.photo_url ?? "").trim() || undefined;

    return {
      firstName:   person.first_name   ? String(person.first_name)   : undefined,
      lastName:    person.last_name    ? String(person.last_name)    : undefined,
      photoUrl:    photo               ? photo                       : undefined,
      linkedInUrl: person.linkedin_url ? String(person.linkedin_url) : undefined,
      designation: person.title        ? String(person.title)        : undefined,
      company:     org?.name           ? String(org.name)            : undefined,
      website:     org?.website_url    ? String(org.website_url)     : undefined,
      industry:    org?.industry       ? String(org.industry)        : undefined,
      companySize: org?.estimated_num_employees
        ? String(org.estimated_num_employees)
        : undefined,
      city:    person.city    ? String(person.city)    : undefined,
      country: person.country ? String(person.country) : undefined,
      phone:   (person.phone_numbers as Array<Record<string, unknown>> | undefined)?.[0]?.sanitized_number
        ? String((person.phone_numbers as Array<Record<string, unknown>>)[0].sanitized_number)
        : undefined,
    };
  } catch {
    return null;
  }
}

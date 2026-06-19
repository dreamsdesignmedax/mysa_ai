/**
 * Apollo Company Search
 * Standalone helper: given a company name (+ optional domain / titles),
 * returns the top matching person (decision maker) from Apollo's
 * mixed_people/search endpoint.
 *
 * Extracted from entityResolver.ts so the play funnel can use it
 * without pulling in the entire resolver pipeline.
 */

import { logger } from "../logger";

export interface ApolloContact {
  email?:       string;
  firstName?:   string;
  lastName?:    string;
  title?:       string;
  linkedInUrl?: string;
  photoUrl?:    string;
  company?:     string;
  website?:     string;
  industry?:    string;
  city?:        string;
  country?:     string;
  companySize?: string;
}

const DECISION_MAKER_TITLES = [
  "CEO", "Founder", "Co-Founder", "Owner", "Managing Director",
  "Director", "Head of Marketing", "CMO", "VP Marketing",
  "Head of Sales", "CTO", "COO",
];

export async function searchApolloByCompany(
  companyName: string,
  domain?:     string,
  perPage     = 3,
): Promise<ApolloContact[]> {
  const apiKey = process.env["APOLLO_API_KEY"];
  if (!apiKey || !companyName) return [];

  try {
    const body: Record<string, unknown> = {
      api_key:             apiKey,
      q_organization_name: companyName,
      person_titles:       DECISION_MAKER_TITLES,
      page:                1,
      per_page:            perPage,
    };

    if (domain) {
      body.q_organization_domains = [domain.replace(/^https?:\/\//, "").split("/")[0]];
    }

    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body:    JSON.stringify(body),
    });

    if (!res.ok) return [];

    const data    = await res.json() as { people?: Record<string, unknown>[] };
    const people  = data.people ?? [];

    return people.map(person => {
      const org = (person.organization ?? {}) as Record<string, unknown>;
      return {
        email:       person.email        ? String(person.email)        : undefined,
        firstName:   person.first_name   ? String(person.first_name)   : undefined,
        lastName:    person.last_name    ? String(person.last_name)    : undefined,
        title:       person.title        ? String(person.title)        : undefined,
        linkedInUrl: person.linkedin_url ? String(person.linkedin_url) : undefined,
        photoUrl:    person.photo_url    ? String(person.photo_url)    : undefined,
        company:     org.name            ? String(org.name)            : companyName,
        website:     org.website_url     ? String(org.website_url)     : domain,
        industry:    org.industry        ? String(org.industry)        : undefined,
        city:        person.city         ? String(person.city)         : undefined,
        country:     person.country      ? String(person.country)      : undefined,
        companySize: org.estimated_num_employees
          ? String(org.estimated_num_employees)
          : undefined,
      };
    });
  } catch (err) {
    logger.warn({ err, companyName }, "[APOLLO SEARCH] Company search failed");
    return [];
  }
}

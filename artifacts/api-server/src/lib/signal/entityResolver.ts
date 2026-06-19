/**
 * Entity Resolver
 * Processes signal_entity_queue:
 *  Phase A — Claude extracts company/contact entities from the post
 *  Phase B — Apollo searches for company + people
 *  Phase C — Hunter.io email fallback if Apollo found no email
 *  Phase D — Apify LinkedIn scrape if LinkedIn URL found
 *  Phase E — Create lead via Drizzle insert (same pattern as POST /leads),
 *             then UPDATE signal columns (signal_type, signal_strength, etc.)
 */

import { db } from "../db";
import { leads } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { scrapeLinkedInProfile } from "./apifyService";
import { logger } from "../logger";
import { logAnthropicUsage } from "../logApiUsage";

const RESOLVER_BATCH = 5;

interface QueueRow {
  id:             number;
  signal_post_id: number;
  intent_type:    string;
  confidence:     number;
}

interface ExtractedEntity {
  company_name:  string | null;
  person_name:   string | null;
  person_title:  string | null;
  website:       string | null;
  industry:      string | null;
  budget_hint:   string | null;
  email:         string | null;
  location:      string | null;
}

interface PostRow {
  id:                number;
  title:             string;
  body:              string;
  company_mentioned: string | null;
  industry_hint:     string | null;
  budget_hint:       string | null;
  post_url:          string;
}

// ── Phase A: Claude entity extraction ────────────────────────────────────────
async function extractEntities(post: PostRow): Promise<ExtractedEntity> {
  const content = `Extract the following from this Reddit post. Return JSON only.

Post title: ${post.title}
Post body: ${(post.body ?? "").slice(0, 2000)}
${post.company_mentioned ? `Company mentioned: ${post.company_mentioned}` : ""}

Return JSON with: company_name, person_name, person_title, website, industry, budget_hint, email, location.
Use null for unknown fields.`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content }],
    });

    void logAnthropicUsage({ model: "claude-haiku-4-5", inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "signal_entity_extraction", orgId: null });
    const raw   = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return emptyEntity(post);
    return { ...emptyEntity(post), ...(JSON.parse(match[0]) as Partial<ExtractedEntity>) };
  } catch {
    return emptyEntity(post);
  }
}

function emptyEntity(post: PostRow): ExtractedEntity {
  return {
    company_name: post.company_mentioned ?? null,
    person_name:  null,
    person_title: null,
    website:      null,
    industry:     post.industry_hint ?? null,
    budget_hint:  post.budget_hint   ?? null,
    email:        null,
    location:     null,
  };
}

// ── Phase B: Apollo company + people search ───────────────────────────────────
interface ApolloPersonResult {
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

async function searchApollo(entity: ExtractedEntity): Promise<ApolloPersonResult | null> {
  const apiKey = process.env["APOLLO_API_KEY"];
  if (!apiKey || !entity.company_name) return null;

  try {
    const body: Record<string, unknown> = {
      api_key:             apiKey,
      q_organization_name: entity.company_name,
      person_titles:       ["CEO", "Founder", "Co-Founder", "Director", "Head of Marketing", "CMO"],
      page:     1,
      per_page: 1,
    };

    if (entity.website) {
      body.q_organization_domains = [entity.website.replace(/^https?:\/\//, "").split("/")[0]];
    }

    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body:    JSON.stringify(body),
    });

    if (!res.ok) return null;

    const data   = await res.json() as { people?: Record<string, unknown>[] };
    const person = data.people?.[0];
    if (!person) return null;

    const org = (person.organization ?? {}) as Record<string, unknown>;
    return {
      email:       person.email        ? String(person.email)        : undefined,
      firstName:   person.first_name   ? String(person.first_name)   : undefined,
      lastName:    person.last_name    ? String(person.last_name)    : undefined,
      title:       person.title        ? String(person.title)        : undefined,
      linkedInUrl: person.linkedin_url ? String(person.linkedin_url) : undefined,
      photoUrl:    person.photo_url    ? String(person.photo_url)    : undefined,
      company:     org.name            ? String(org.name)            : entity.company_name ?? undefined,
      website:     org.website_url     ? String(org.website_url)     : entity.website ?? undefined,
      industry:    org.industry        ? String(org.industry)        : entity.industry ?? undefined,
      city:        person.city         ? String(person.city)         : undefined,
      country:     person.country      ? String(person.country)      : undefined,
      companySize: org.estimated_num_employees ? String(org.estimated_num_employees) : undefined,
    };
  } catch (err) {
    logger.warn({ err }, "[ENTITY RESOLVER] Apollo search failed");
    return null;
  }
}

// ── Phase C: Hunter.io email fallback ─────────────────────────────────────────
async function hunterFindEmail(
  domain:    string,
  firstName: string,
  lastName:  string,
): Promise<string | null> {
  const apiKey = process.env["HUNTER_API_KEY"];
  if (!apiKey || !domain || !firstName || !lastName) return null;

  try {
    const params = new URLSearchParams({ domain, first_name: firstName, last_name: lastName, api_key: apiKey });
    const res    = await fetch(`https://api.hunter.io/v2/email-finder?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json() as { data?: { email?: string } };
    return data.data?.email ?? null;
  } catch {
    return null;
  }
}

// ── Phase E: Create lead ───────────────────────────────────────────────────────
async function createSignalLead(
  entity:     ExtractedEntity,
  apollo:     ApolloPersonResult | null,
  linkedin:   Awaited<ReturnType<typeof scrapeLinkedInProfile>>,
  email:      string,
  orgId:      number,
  intentType: string,
  confidence: number,
  postUrl:    string,
  postBody:   string,
): Promise<number | null> {
  const firstName = apollo?.firstName ?? linkedin?.fullName?.split(" ")[0]             ?? entity.person_name?.split(" ")[0]               ?? "Unknown";
  const lastName  = apollo?.lastName  ?? linkedin?.fullName?.split(" ").slice(1).join(" ") ?? entity.person_name?.split(" ").slice(1).join(" ") ?? "Signal";
  const company   = apollo?.company   ?? linkedin?.company  ?? entity.company_name ?? "Unknown Company";
  const title     = apollo?.title     ?? linkedin?.headline  ?? entity.person_title ?? "";
  const strength  = Math.round(confidence * 100);

  // Deduplicate within the org by email
  if (email && !email.includes("@noemail.mysa.internal")) {
    const exists = await db.execute(sql`
      SELECT id FROM leads WHERE email = ${email} AND org_id = ${orgId} LIMIT 1
    `);
    const existRows = (exists as unknown as { rows: { id: number }[] }).rows;
    if ((existRows?.length ?? 0) > 0) return existRows[0]?.id ?? null;
  }

  const resolvedEmail = email || `signal.${Date.now()}@noemail.mysa.internal`;
  const notes = `Signal type: ${intentType}. Source: ${postUrl}. Context: ${postBody.slice(0, 300)}`;

  try {
    // Insert via Drizzle + signal column UPDATE in a single transaction
    // to prevent orphaned lead rows when metadata update fails
    const leadId = await db.transaction(async (tx) => {
      const [created] = await tx.insert(leads).values({
        orgId,
        firstName,
        lastName,
        email:       resolvedEmail,
        company,
        designation: title,
        country:     apollo?.country  ?? entity.location ?? "",
        industry:    apollo?.industry ?? entity.industry ?? "",
        website:     apollo?.website  ?? entity.website  ?? undefined,
        linkedInUrl: apollo?.linkedInUrl ?? undefined,
        photoUrl:    apollo?.photoUrl ?? linkedin?.photoUrl ?? undefined,
        companySize: apollo?.companySize ?? undefined,
        source:      "signal_detection",
        notes,
        tags:        [],
      }).returning({ id: leads.id });

      if (!created?.id) return null;

      // Populate signal metadata columns (INTEGER signal_strength = 0-100 scale)
      await tx.execute(sql`
        UPDATE leads SET
          signal_type        = ${intentType},
          signal_strength    = ${strength},
          original_post_url  = ${postUrl},
          original_post_text = ${postBody.slice(0, 1000)},
          signal_detected_at = NOW()
        WHERE id = ${created.id}
      `);

      return created.id;
    });

    return leadId;
  } catch (err) {
    logger.warn({ err }, "[ENTITY RESOLVER] Lead insert failed");
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function processEntityQueue(orgId: number): Promise<{ processed: number; leadsCreated: number }> {
  let processed    = 0;
  let leadsCreated = 0;

  const rows = await db.execute(sql`
    SELECT eq.id, eq.signal_post_id, eq.intent_type, eq.confidence
    FROM signal_entity_queue eq
    WHERE eq.status = 'pending'
    ORDER BY eq.queued_at ASC
    LIMIT ${RESOLVER_BATCH}
  `);

  const queue = (rows as unknown as { rows: QueueRow[] }).rows ?? [];

  for (const item of queue) {
    await db.execute(sql`
      UPDATE signal_entity_queue SET status = 'processing' WHERE id = ${item.id}
    `);

    try {
      const postRows = await db.execute(sql`
        SELECT id, title, body, company_mentioned, industry_hint, budget_hint, post_url
        FROM signal_posts WHERE id = ${item.signal_post_id} LIMIT 1
      `);
      const post = ((postRows as unknown as { rows: PostRow[] }).rows)[0];

      if (!post) {
        await db.execute(sql`UPDATE signal_entity_queue SET status = 'failed' WHERE id = ${item.id}`);
        continue;
      }

      // Phase A — Entity extraction
      const entity = await extractEntities(post);

      // Phase B — Apollo
      const apollo = await searchApollo(entity);

      // Phase C — Hunter.io fallback
      let email = apollo?.email ?? entity.email ?? "";
      if (!email && apollo?.firstName && apollo?.lastName && apollo?.website) {
        const domain = apollo.website.replace(/^https?:\/\//, "").split("/")[0] ?? "";
        email = (await hunterFindEmail(domain, apollo.firstName, apollo.lastName)) ?? "";
      }

      // Phase D — Apify LinkedIn only if we got a LinkedIn URL from Apollo
      let linkedin = null;
      if (apollo?.linkedInUrl) {
        linkedin = await scrapeLinkedInProfile(apollo.linkedInUrl);
      }

      // Phase E — Create lead (Drizzle insert + signal column UPDATE)
      if (entity.company_name || apollo?.company) {
        const leadId = await createSignalLead(
          entity, apollo, linkedin, email,
          orgId, item.intent_type, item.confidence,
          post.post_url, post.body ?? "",
        );
        if (leadId) leadsCreated++;
      }

      const resolvedEmail    = email || null;
      const resolvedRole     = (linkedin as { headline?: string } | null)?.headline
                              ?? (apollo as { title?: string } | null)?.title
                              ?? null;
      const resolvedLocation = [
        (apollo as { city?: string } | null)?.city,
        (apollo as { state?: string } | null)?.state,
        (apollo as { country?: string } | null)?.country,
      ].filter(Boolean).join(", ") || null;
      const resolvedWebsite  = (apollo as { website?: string } | null)?.website
                              ?? entity.website
                              ?? null;
      const resolvedName     = [
        (apollo as { firstName?: string } | null)?.firstName,
        (apollo as { lastName?: string } | null)?.lastName,
      ].filter(Boolean).join(" ") || entity.person_name || null;

      await db.execute(sql`
        UPDATE signal_entity_queue
        SET status        = 'done',
            processed_at  = NOW(),
            resolved_email    = ${resolvedEmail},
            resolved_role     = ${resolvedRole},
            resolved_location = ${resolvedLocation},
            resolved_website  = ${resolvedWebsite},
            resolved_name     = ${resolvedName}
        WHERE id = ${item.id}
      `);
      processed++;
    } catch (err) {
      logger.error({ err, queueId: item.id }, "[ENTITY RESOLVER] Processing failed");
      await db.execute(sql`UPDATE signal_entity_queue SET status = 'failed' WHERE id = ${item.id}`);
    }
  }

  logger.info({ processed, leadsCreated }, "[ENTITY RESOLVER] Queue batch complete");
  return { processed, leadsCreated };
}

# MysaAI — AI Sales Brain (B2B Sales Automation Platform)

A full-stack B2B sales automation platform with AI-powered lead scoring, outreach generation, brand audits, WhatsApp conversations, and pipeline management.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080, path `/api`)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → `lib/api-client-react`)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + TailwindCSS + shadcn/ui

## Where things live

- `artifacts/api-server/src/routes/` — all API route handlers
- `artifacts/api-server/src/routes/index.ts` — route registration
- `artifacts/mysa-b2c-v1/src/pages/` — all 30+ frontend pages
- `artifacts/mysa-b2c-v1/src/components/Layout.tsx` — nav sidebar, global search, feedback modal
- `artifacts/mysa-b2c-v1/src/contexts/AuthContext.tsx` — AuthUser type, login state
- `lib/api-client-react/src/` — generated React Query hooks (from OpenAPI spec)
- `lib/api-client-react/src/generated/generated/` — full generated files (orval output)
- `lib/api-client-react/src/index.ts` — re-exports from `./generated/generated/`
- `lib/db/` — Drizzle schema, shared across API server
- `lib/api-spec/openapi.yaml` — source of truth for all API contracts

## Architecture decisions

- Auth uses a custom HMAC token (not JWT) stored in cookie `mysa_token` (sameSite=none, secure=true). Token verified via `APP_AUTH_SECRET` env var.
- Password stored as SHA-256 hash in `APP_AUTH_PASSWORD_HASH` env var (shared single-user auth model).
- The generated API client lives in `lib/api-client-react/src/generated/generated/` (double-nested); `index.ts` exports from that path.
- ICPs route is `/api/icp` (singular), NOT `/api/icps`.
- `leads.brand_audit_completed` and `leads.agent_processed` are `INTEGER` type (0/1), not boolean.
- Meetings table has no `title` or `org_id` column — org is inferred via lead join.
- `outreach_sequences` has no `description` column.

## Product

**MysaAI Sales Brain** is a B2B sales OS that:
- Scores leads using BANT + Belief methodology
- Audits prospect websites automatically
- Writes personalized AI outreach emails
- Manages WhatsApp conversations with leads
- Tracks the full pipeline from ICP → Qualified → Meeting → Proposal → Won
- Runs autonomous agents (Scout, Sales, Follow-up) in the background
- Reports daily on pipeline activity

## User preferences

- Demo login: `dreamsdesign.in@gmail.com` / `Vishnu@5900`
- Org: Dreamsdesign (org_id=1), user_id=1, role=owner
- `APP_AUTH_SECRET` and `APP_AUTH_PASSWORD_HASH` set as shared env vars

## Gotchas

- After running codegen (`pnpm --filter @workspace/api-spec run codegen`), the new files land in `lib/api-client-react/src/generated/` (NOT the old `generated/generated/` double-nested path). The `index.ts` correctly exports from `./generated/api` and `./generated/api.schemas`.
- The `lib/api-client-react/src/team.ts` defines `TeamMember` inline (not generated) since the team endpoint is a custom hand-written hook, not in the OpenAPI spec.
- The seed script at `artifacts/api-server/src/migrate-seed-dreamsdesign.ts` references ICP IDs 22-26 (old IDs). The actual seeded ICPs are IDs 1-5. The seed runs non-fatally on startup.
- The lead auto-sync (`migrate-seed-dreamsdesign.ts`) inserts 158 leads from a built-in lead bank on startup.
- Never use `pnpm dev` at workspace root — use `restart_workflow` or the workflow panel instead.
- `appointments.location` enum: `"meet"` (not `"zoom"`) or `"inperson"`. Updated in OpenAPI spec and regenerated.
- Fields not in OpenAPI spec (accessed via type cast): `Lead.behaviorKeywords`, `Lead.intentKeywords`, `Lead.interestKeywords`, `Lead.assignedToName`, `Lead.assignedToId`, `AuditRunSummary.categoryScores`. Cast using `(x as unknown as {...}).field`.
- `OutreachEmailEntry.openedAt` is not in spec; access via `(x as unknown as { openedAt?: string }).openedAt`.

## Signal Intelligence

Buying-intent detection pipeline — crawls Reddit, classifies with Claude Haiku, enriches via Apify/Apollo/Hunter.io, and auto-creates leads.

Required env vars:
- `REDDIT_CLIENT_ID` — Reddit OAuth app client ID
- `REDDIT_CLIENT_SECRET` — Reddit OAuth app client secret
- `REDDIT_USERNAME` — Reddit account username for password flow
- `REDDIT_PASSWORD` — Reddit account password
- `REDDIT_USER_AGENT` — e.g. `MysaAI Signal Bot/1.0 by u/<username>`
- `APIFY_TOKEN` — Apify API token (already set as `APIFY_TOKEN`)
- `HUNTER_API_KEY` — Hunter.io API key (email finder fallback)

Signal tables: `signal_posts` (crawled + classified posts), `signal_entity_queue` (ready for enrichment).
API routes under `/api/signal-feed` (7 routes — list, stats, add-to-pipeline, dismiss, google-maps-leads).
Cron jobs: Reddit every 15 min, classifier every 5 min, resolver every 10 min, job boards 01:30 UTC, Google Maps 02:30 UTC.
New lead columns: `signal_type`, `signal_strength`, `original_post_url`, `original_post_text`, `signal_detected_at`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- API routes are registered in `artifacts/api-server/src/routes/index.ts`
- All 27 core API endpoints verified working as of May 2026
- Signal Intelligence routes: `artifacts/api-server/src/routes/signals.ts`
- Signal services: `artifacts/api-server/src/lib/signal/` (redditCrawler, signalClassifier, apifyService, entityResolver)

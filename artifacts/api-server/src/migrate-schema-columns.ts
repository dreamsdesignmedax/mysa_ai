import { db } from "./lib/db";
import { sql } from "drizzle-orm";
import { logger } from "./lib/logger";

/**
 * Idempotent startup migration: adds any columns / tables that exist in the
 * Drizzle schema but may be missing from older production databases.
 *
 * Every statement uses IF NOT EXISTS so it is a safe no-op on re-run.
 */
export async function runSchemaColumnMigrations(): Promise<{ applied: string[] }> {
  const applied: string[] = [];

  const migrations: Array<{ name: string; ddl: string }> = [
    // ── users columns ────────────────────────────────────────────────────────
    {
      name: "users.verification_token_expires_at",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS verification_token_expires_at
              TIMESTAMP WITH TIME ZONE`,
    },
    {
      name: "users.is_verified",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS is_verified
              BOOLEAN NOT NULL DEFAULT false`,
    },
    {
      name: "users.verification_token",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS verification_token
              TEXT`,
    },

    // ── users pending-email columns ───────────────────────────────────────────
    {
      name: "users.pending_email",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS pending_email TEXT`,
    },
    {
      name: "users.pending_email_token",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS pending_email_token TEXT`,
    },
    {
      name: "users.pending_email_token_expires_at",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS pending_email_token_expires_at
              TIMESTAMP WITH TIME ZONE`,
    },

    // ── organizations columns ─────────────────────────────────────────────────
    {
      name: "organizations.is_active",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`,
    },
    {
      name: "organizations.is_suspended",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false`,
    },

    // ── leads columns ─────────────────────────────────────────────────────────
    {
      name: "leads.pipeline_stage",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS pipeline_stage TEXT`,
    },
    {
      name: "leads.whatsapp",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS whatsapp TEXT`,
    },
    {
      name: "leads.linkedin_url",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS linkedin_url TEXT`,
    },
    {
      name: "leads.last_contacted_at",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMP WITH TIME ZONE`,
    },
    {
      name: "leads.notes",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS notes TEXT`,
    },
    {
      name: "leads.currency",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD'`,
    },
    {
      name: "leads.deal_value",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS deal_value NUMERIC`,
    },
    {
      name: "leads.keywords",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS keywords JSONB DEFAULT '[]'`,
    },
    {
      name: "leads.sequence_id",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS sequence_id INTEGER`,
    },
    {
      name: "leads.sequence_step",
      ddl: `ALTER TABLE leads
              ADD COLUMN IF NOT EXISTS sequence_step INTEGER DEFAULT 0`,
    },

    // ── invite_tokens table (missing from older prod DBs) ──────────────────
    {
      name: "invite_tokens table",
      ddl: `CREATE TABLE IF NOT EXISTS invite_tokens (
              id            SERIAL PRIMARY KEY,
              token         TEXT        NOT NULL UNIQUE,
              email         TEXT        NOT NULL,
              org_id        INTEGER     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
              role          TEXT        NOT NULL DEFAULT 'member',
              invited_by_id INTEGER     REFERENCES users(id) ON DELETE SET NULL,
              expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
              accepted_at   TIMESTAMP WITH TIME ZONE,
              created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )`,
    },

    // ── outreach_emails columns ───────────────────────────────────────────────
    {
      name: "outreach_emails.opened_at",
      ddl: `ALTER TABLE outreach_emails
              ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP WITH TIME ZONE`,
    },
    {
      name: "outreach_emails.tracking_id",
      ddl: `ALTER TABLE outreach_emails
              ADD COLUMN IF NOT EXISTS tracking_id TEXT`,
    },

    // ── appointments columns ──────────────────────────────────────────────────
    {
      name: "appointments.org_id",
      ddl: `ALTER TABLE appointments
              ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE`,
    },
    {
      name: "appointments.lead_id",
      ddl: `ALTER TABLE appointments
              ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL`,
    },
    {
      name: "appointments.notes",
      ddl: `ALTER TABLE appointments
              ADD COLUMN IF NOT EXISTS notes TEXT`,
    },
    {
      name: "appointments.meeting_link",
      ddl: `ALTER TABLE appointments
              ADD COLUMN IF NOT EXISTS meeting_link TEXT`,
    },

    // ── campaigns columns ─────────────────────────────────────────────────────
    {
      name: "campaigns.org_id",
      ddl: `ALTER TABLE campaigns
              ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE`,
    },

    // ── automations table (created by seed but ensure columns exist) ──────────
    {
      name: "automations table",
      ddl: `CREATE TABLE IF NOT EXISTS automations (
              id           SERIAL PRIMARY KEY,
              name         TEXT        NOT NULL,
              trigger      TEXT        NOT NULL,
              description  TEXT,
              active       BOOLEAN     NOT NULL DEFAULT true,
              runs         INTEGER     NOT NULL DEFAULT 0,
              conversions  INTEGER     NOT NULL DEFAULT 0,
              steps        JSONB       NOT NULL DEFAULT '[]',
              org_id       INTEGER     REFERENCES organizations(id) ON DELETE CASCADE,
              created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
              updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )`,
    },

    // ── audit_runs.lead_id column (if missing) ────────────────────────────────
    {
      name: "audit_runs.brand_score",
      ddl: `ALTER TABLE audit_runs
              ADD COLUMN IF NOT EXISTS brand_score INTEGER`,
    },

    // ── users phone columns (phone OTP sign-in) ───────────────────────────────
    {
      name: "users.phone",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS phone TEXT`,
    },
    {
      name: "users.phone_verified",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false`,
    },
    // ── has_set_password: explicit flag distinguishing phone-OTP placeholder
    // hashes from real SHA-256 / bcrypt passwords ─────────────────────────────
    {
      name: "users.has_set_password",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS has_set_password BOOLEAN NOT NULL DEFAULT true`,
    },
    // Backfill pass 1: phone-OTP users still on their synthetic email.
    {
      name: "users.has_set_password.backfill",
      ddl: `UPDATE users
              SET has_set_password = false
              WHERE email LIKE '%@otp.mysa.internal'
                AND has_set_password = true`,
    },
    // ── leads: Belief Alignment Score (BANTB 5th dimension) ─────────────────
    {
      name: "leads.belief_score",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS belief_score INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "leads.belief_reason",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS belief_reason TEXT`,
    },
    {
      name: "leads.belief_evidence",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS belief_evidence TEXT`,
    },
    {
      name: "leads.belief_signals",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS belief_signals JSONB`,
    },
    {
      name: "leads.bantb_total",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS bantb_total INTEGER NOT NULL DEFAULT 0`,
    },

    // Backfill pass 2: phone-OTP users who already swapped to a real email
    // (verified before this column was added). We identify them by:
    //   • phone IS NOT NULL AND phone_verified = true (created via OTP flow)
    //   • password_hash does NOT start with '$2' (not a real bcrypt password)
    //   • email NOT LIKE '%@otp.mysa.internal' (email already swapped)
    // SHA-256 legacy email/password users who later added phone are the only
    // false-positive risk; they will be covered by the upcoming bcrypt-upgrade
    // task anyway, and the current-password bypass window is limited to
    // authenticated sessions.
    {
      name: "users.has_set_password.backfill_swapped",
      ddl: `UPDATE users
              SET has_set_password = false
              WHERE phone IS NOT NULL
                AND phone_verified = true
                AND email NOT LIKE '%@otp.mysa.internal'
                AND password_hash NOT LIKE '$2%'
                AND has_set_password = true`,
    },

    // ── business_why + onboarding_completed ──────────────────────────────────
    {
      name: "users.business_why",
      ddl: `ALTER TABLE users ADD COLUMN IF NOT EXISTS business_why TEXT`,
    },
    {
      name: "users.onboarding_completed",
      ddl: `ALTER TABLE users
              ADD COLUMN IF NOT EXISTS onboarding_completed
              BOOLEAN NOT NULL DEFAULT true`,
    },
    // ── agent_activity_log table ──────────────────────────────────────────────
    {
      name: "agent_activity_log table",
      ddl: `CREATE TABLE IF NOT EXISTS agent_activity_log (
              id            SERIAL PRIMARY KEY,
              org_id        INTEGER,
              lead_id       INTEGER REFERENCES leads(id) ON DELETE SET NULL,
              lead_name     TEXT,
              company_name  TEXT,
              agent_name    TEXT NOT NULL,
              activity_type TEXT NOT NULL,
              detail        JSONB,
              channel       TEXT,
              status        TEXT NOT NULL DEFAULT 'success',
              error_message TEXT,
              executed_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )`,
    },
    {
      name: "leads.is_fake",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_fake INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "agent_activity_log.org_id_idx",
      ddl: `CREATE INDEX IF NOT EXISTS aal_org_id_idx ON agent_activity_log(org_id)`,
    },
    {
      name: "agent_activity_log.lead_id_idx",
      ddl: `CREATE INDEX IF NOT EXISTS aal_lead_id_idx ON agent_activity_log(lead_id)`,
    },
    {
      name: "agent_activity_log.executed_at_idx",
      ddl: `CREATE INDEX IF NOT EXISTS aal_executed_at_idx ON agent_activity_log(executed_at)`,
    },

    // ── agent_config table — persists Agent Hub state across restarts ─────────
    {
      name: "agent_config table",
      ddl: `CREATE TABLE IF NOT EXISTS agent_config (
              scope_key  VARCHAR(200) PRIMARY KEY,
              value      JSONB        NOT NULL,
              updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )`,
    },

    // ── organizations billing / usage / trial columns ─────────────────────────
    {
      name: "organizations.audits_used_this_month",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS audits_used_this_month INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "organizations.trial_started_at",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP WITH TIME ZONE`,
    },
    {
      name: "organizations.trial_expired",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS trial_expired BOOLEAN NOT NULL DEFAULT false`,
    },
    // Backfill trial_started_at for existing trial orgs
    {
      name: "organizations.trial_started_at.backfill",
      ddl: `UPDATE organizations
              SET trial_started_at = COALESCE(created_at, NOW())
              WHERE plan = 'trial' AND trial_started_at IS NULL`,
    },

    // ── organizations.trial_nudge_sent_at ────────────────────────────────────
    {
      name: "organizations.trial_nudge_sent_at",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS trial_nudge_sent_at TIMESTAMP WITH TIME ZONE`,
    },

    // ── organizations.welcome_email_sent_at ───────────────────────────────────
    {
      name: "organizations.welcome_email_sent_at",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMP WITH TIME ZONE`,
    },

    // ── organizations.model_routing_overrides ─────────────────────────────────
    {
      name: "organizations.model_routing_overrides",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS model_routing_overrides JSONB NOT NULL DEFAULT '{}'::jsonb`,
    },

    // ── Signal Intelligence tables ─────────────────────────────────────────────
    {
      name: "signal_posts table",
      ddl: `CREATE TABLE IF NOT EXISTS signal_posts (
              id                 SERIAL PRIMARY KEY,
              post_url           TEXT        NOT NULL UNIQUE,
              platform           TEXT        NOT NULL DEFAULT 'reddit',
              title              TEXT        NOT NULL,
              body               TEXT,
              author             TEXT,
              subreddit          TEXT,
              score              INTEGER     NOT NULL DEFAULT 0,
              raw_json           TEXT,
              crawled_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
              classified_at      TIMESTAMP WITH TIME ZONE,
              intent_type        TEXT,
              confidence         NUMERIC(4,3),
              is_buying_signal   BOOLEAN     NOT NULL DEFAULT false,
              company_mentioned  TEXT,
              industry_hint      TEXT,
              budget_hint        TEXT,
              classifier_notes   TEXT,
              dismissed_at       TIMESTAMP WITH TIME ZONE
            )`,
    },
    {
      name: "signal_posts.crawled_at_idx",
      ddl: `CREATE INDEX IF NOT EXISTS sp_crawled_at_idx ON signal_posts(crawled_at)`,
    },
    {
      name: "signal_posts.classified_at_idx",
      ddl: `CREATE INDEX IF NOT EXISTS sp_classified_at_idx ON signal_posts(classified_at)`,
    },
    {
      name: "signal_posts.is_buying_signal_idx",
      ddl: `CREATE INDEX IF NOT EXISTS sp_is_buying_signal_idx ON signal_posts(is_buying_signal)`,
    },
    {
      name: "signal_posts.platform_idx",
      ddl: `CREATE INDEX IF NOT EXISTS sp_platform_idx ON signal_posts(platform)`,
    },
    {
      name: "signal_entity_queue table",
      ddl: `CREATE TABLE IF NOT EXISTS signal_entity_queue (
              id               SERIAL PRIMARY KEY,
              signal_post_id   INTEGER     NOT NULL UNIQUE REFERENCES signal_posts(id) ON DELETE CASCADE,
              status           TEXT        NOT NULL DEFAULT 'pending',
              intent_type      TEXT,
              confidence       NUMERIC(4,3),
              queued_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
              processed_at     TIMESTAMP WITH TIME ZONE
            )`,
    },
    {
      name: "signal_entity_queue.status_idx",
      ddl: `CREATE INDEX IF NOT EXISTS seq_status_idx ON signal_entity_queue(status)`,
    },
    {
      name: "signal_entity_queue.queued_at_idx",
      ddl: `CREATE INDEX IF NOT EXISTS seq_queued_at_idx ON signal_entity_queue(queued_at)`,
    },

    // ── Signal columns on leads ────────────────────────────────────────────────
    {
      name: "leads.signal_type",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS signal_type TEXT`,
    },
    {
      name: "leads.signal_strength",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS signal_strength INTEGER`,
    },
    {
      name: "leads.signal_strength.retype_to_integer",
      ddl: `DO $$ BEGIN IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'signal_strength') = 'numeric' THEN ALTER TABLE leads ALTER COLUMN signal_strength TYPE INTEGER USING COALESCE(ROUND(signal_strength)::INTEGER, NULL); END IF; END $$`,
    },
    {
      name: "leads.original_post_url",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS original_post_url TEXT`,
    },
    {
      name: "leads.original_post_text",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS original_post_text TEXT`,
    },
    {
      name: "leads.signal_detected_at",
      ddl: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS signal_detected_at TIMESTAMP WITH TIME ZONE`,
    },

    // ── Signal settings table ──────────────────────────────────────────────────
    {
      name: "signal_settings table",
      ddl: `CREATE TABLE IF NOT EXISTS signal_settings (
              id                   SERIAL PRIMARY KEY,
              org_id               INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
              enabled              BOOLEAN NOT NULL DEFAULT TRUE,
              auto_add             BOOLEAN NOT NULL DEFAULT FALSE,
              confidence           REAL    NOT NULL DEFAULT 0.70,
              subreddits           JSONB   NOT NULL DEFAULT '[]',
              keywords             JSONB   NOT NULL DEFAULT '[]',
              google_maps_cities   JSONB   NOT NULL DEFAULT '[]',
              updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )`,
    },
    // Idempotent column additions for existing installs that got the old schema
    {
      name: "signal_settings.enabled",
      ddl: `ALTER TABLE signal_settings ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE`,
    },
    {
      name: "signal_settings.confidence",
      ddl: `ALTER TABLE signal_settings ADD COLUMN IF NOT EXISTS confidence REAL NOT NULL DEFAULT 0.70`,
    },
    {
      name: "signal_settings.subreddits",
      ddl: `ALTER TABLE signal_settings ADD COLUMN IF NOT EXISTS subreddits JSONB NOT NULL DEFAULT '[]'`,
    },
    {
      name: "signal_settings.keywords",
      ddl: `ALTER TABLE signal_settings ADD COLUMN IF NOT EXISTS keywords JSONB NOT NULL DEFAULT '[]'`,
    },
    {
      name: "signal_settings.google_maps_cities_retype_jsonb",
      ddl: `DO $$ BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'signal_settings' AND column_name = 'google_maps_cities'
                  AND data_type = 'text'
              ) THEN
                ALTER TABLE signal_settings ALTER COLUMN google_maps_cities TYPE JSONB USING google_maps_cities::JSONB;
              END IF;
            END $$`,
    },

    // ── Resolved entity columns on signal_entity_queue ─────────────────────────
    {
      name: "signal_entity_queue.resolved_email",
      ddl: `ALTER TABLE signal_entity_queue ADD COLUMN IF NOT EXISTS resolved_email TEXT`,
    },
    {
      name: "signal_entity_queue.resolved_role",
      ddl: `ALTER TABLE signal_entity_queue ADD COLUMN IF NOT EXISTS resolved_role TEXT`,
    },
    {
      name: "signal_entity_queue.resolved_location",
      ddl: `ALTER TABLE signal_entity_queue ADD COLUMN IF NOT EXISTS resolved_location TEXT`,
    },
    {
      name: "signal_entity_queue.resolved_website",
      ddl: `ALTER TABLE signal_entity_queue ADD COLUMN IF NOT EXISTS resolved_website TEXT`,
    },
    {
      name: "signal_entity_queue.resolved_name",
      ddl: `ALTER TABLE signal_entity_queue ADD COLUMN IF NOT EXISTS resolved_name TEXT`,
    },

    // ── users: credits balance ───────────────────────────────────────────────────
    {
      name: "users.credits_balance",
      ddl: `ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_balance INTEGER DEFAULT 50`,
    },

    // ── users: onboarding step tracking ──────────────────────────────────────────
    {
      name: "users.onboarding_steps",
      ddl: `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_steps JSONB`,
    },

    // ── plays ────────────────────────────────────────────────────────────────────
    {
      name: "plays table",
      ddl: `CREATE TABLE IF NOT EXISTS plays (
              id                  SERIAL PRIMARY KEY,
              org_id              INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
              user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
              name                TEXT NOT NULL,
              description         TEXT,
              status              VARCHAR(30) DEFAULT 'draft',
              intent_keywords     JSONB DEFAULT '[]',
              icp_ids             JSONB DEFAULT '[]',
              qualification_mode  VARCHAR(20) DEFAULT 'manual',
              scout_daily_budget  INTEGER DEFAULT 10,
              collect_phone       BOOLEAN DEFAULT false,
              created_at          TIMESTAMPTZ DEFAULT now(),
              updated_at          TIMESTAMPTZ DEFAULT now()
            )`,
    },
    {
      name: "idx_plays_org",
      ddl: `CREATE INDEX IF NOT EXISTS idx_plays_org ON plays(org_id)`,
    },
    {
      name: "idx_plays_user",
      ddl: `CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id)`,
    },

    // ── signal_configs ───────────────────────────────────────────────────────────
    {
      name: "signal_configs table",
      ddl: `CREATE TABLE IF NOT EXISTS signal_configs (
              id                  SERIAL PRIMARY KEY,
              play_id             INTEGER REFERENCES plays(id) ON DELETE CASCADE,
              org_id              INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
              problem_signals     JSONB DEFAULT '[]',
              buying_signals      JSONB DEFAULT '[]',
              competitor_signals  JSONB DEFAULT '[]',
              industry_keywords   JSONB DEFAULT '[]',
              target_subreddits   JSONB DEFAULT '[]',
              target_companies    JSONB DEFAULT '[]',
              min_score           INTEGER DEFAULT 50,
              is_active           BOOLEAN DEFAULT true,
              created_at          TIMESTAMPTZ DEFAULT now()
            )`,
    },

    // ── signal_posts: play linkage columns ───────────────────────────────────────
    {
      name: "signal_posts.play_id",
      ddl: `ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS play_id INTEGER REFERENCES plays(id) ON DELETE SET NULL`,
    },
    {
      name: "signal_posts.user_id",
      ddl: `ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    },

    // ── funnel_events ────────────────────────────────────────────────────────────
    {
      name: "funnel_events table",
      ddl: `CREATE TABLE IF NOT EXISTS funnel_events (
              id              SERIAL PRIMARY KEY,
              play_id         INTEGER REFERENCES plays(id) ON DELETE CASCADE,
              signal_post_id  INTEGER REFERENCES signal_posts(id) ON DELETE SET NULL,
              stage           VARCHAR(40),
              passed          BOOLEAN,
              reason          TEXT,
              created_at      TIMESTAMPTZ DEFAULT now()
            )`,
    },
    {
      name: "idx_funnel_play_stage",
      ddl: `CREATE INDEX IF NOT EXISTS idx_funnel_play_stage ON funnel_events(play_id, stage)`,
    },

    // ── play_leads ───────────────────────────────────────────────────────────────
    {
      name: "play_leads table",
      ddl: `CREATE TABLE IF NOT EXISTS play_leads (
              id               SERIAL PRIMARY KEY,
              play_id          INTEGER REFERENCES plays(id) ON DELETE CASCADE,
              org_id           INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
              signal_post_id   INTEGER REFERENCES signal_posts(id) ON DELETE SET NULL,
              lead_id          INTEGER REFERENCES leads(id) ON DELETE SET NULL,
              company_name     TEXT,
              intent_summary   TEXT,
              lead_score       INTEGER,
              score_breakdown  JSONB,
              key_contacts     JSONB DEFAULT '[]',
              enriched         BOOLEAN DEFAULT false,
              credits_charged  INTEGER DEFAULT 0,
              status           VARCHAR(30) DEFAULT 'new',
              created_at       TIMESTAMPTZ DEFAULT now()
            )`,
    },
    {
      name: "idx_play_leads_play",
      ddl: `CREATE INDEX IF NOT EXISTS idx_play_leads_play ON play_leads(play_id)`,
    },
    {
      name: "idx_play_leads_org",
      ddl: `CREATE INDEX IF NOT EXISTS idx_play_leads_org ON play_leads(org_id)`,
    },

    // ── credit_ledger ────────────────────────────────────────────────────────────
    {
      name: "credit_ledger table",
      ddl: `CREATE TABLE IF NOT EXISTS credit_ledger (
              id            SERIAL PRIMARY KEY,
              org_id        INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
              play_lead_id  INTEGER REFERENCES play_leads(id) ON DELETE SET NULL,
              type          VARCHAR(20),
              amount        INTEGER,
              reason        TEXT,
              balance_after INTEGER,
              created_at    TIMESTAMPTZ DEFAULT now()
            )`,
    },
    {
      name: "idx_credit_ledger_org",
      ddl: `CREATE INDEX IF NOT EXISTS idx_credit_ledger_org ON credit_ledger(org_id)`,
    },

    // ── signal_posts: play_id index ──────────────────────────────────────────────
    {
      name: "idx_signal_posts_play_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_signal_posts_play_id ON signal_posts(play_id) WHERE play_id IS NOT NULL`,
    },

    // ── signal_posts: per-play crawl columns (Module 5) ──────────────────────────
    {
      name: "signal_posts.matched_signal",
      ddl: `ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS matched_signal TEXT`,
    },
    {
      name: "signal_posts.processed",
      ddl: `ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS processed BOOLEAN NOT NULL DEFAULT false`,
    },
    {
      name: "idx_signal_posts_play_processed",
      ddl: `CREATE INDEX IF NOT EXISTS idx_sp_play_processed ON signal_posts(play_id, processed) WHERE play_id IS NOT NULL`,
    },

    // ── signal_posts: split global uniqueness into two partial indexes ───────────
    // Drop the old global UNIQUE constraint on post_url so the same URL can be
    // captured independently by multiple plays (each play has its own play_id).
    // We replace it with two partial unique indexes:
    //   1. (post_url) WHERE play_id IS NULL  — covers global (non-play) crawlers
    //   2. (post_url, play_id) WHERE play_id IS NOT NULL — per-play deduplication
    {
      name: "signal_posts.drop_post_url_unique",
      ddl: `ALTER TABLE signal_posts DROP CONSTRAINT IF EXISTS signal_posts_post_url_key`,
    },
    {
      name: "idx_sp_post_url_global",
      ddl: `CREATE UNIQUE INDEX IF NOT EXISTS idx_sp_post_url_global ON signal_posts(post_url) WHERE play_id IS NULL`,
    },
    {
      name: "idx_sp_post_url_play_id",
      ddl: `CREATE UNIQUE INDEX IF NOT EXISTS idx_sp_post_url_play_id ON signal_posts(post_url, play_id) WHERE play_id IS NOT NULL`,
    },

    // ── signal_posts: key_phrase (Module 6 funnel) ────────────────────────────
    {
      name: "signal_posts.key_phrase",
      ddl: `ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS key_phrase TEXT`,
    },

    // ── organizations: AI spend daily alert threshold ──────────────────────────
    {
      name: "organizations.ai_spend_daily_limit_usd",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS ai_spend_daily_limit_usd REAL`,
    },
    {
      name: "organizations.ai_spend_alert_sent_at",
      ddl: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS ai_spend_alert_sent_at TIMESTAMP WITH TIME ZONE`,
    },
  ];

  for (const m of migrations) {
    try {
      await db.execute(sql.raw(m.ddl));
      applied.push(m.name);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate column") ||
        msg.includes("relation") && msg.includes("already exists")
      ) {
        // Already present — skip silently
      } else {
        logger.error({ migration: m.name, msg }, "Schema migration failed");
      }
    }
  }

  return { applied };
}

import { pool } from "@workspace/db";

const TABLES = [
  "leads", "icps", "outreach_sequences", "smtp_settings",
  "branding_settings", "whatsapp_settings", "lead_lists",
  "oauth_tokens", "campaigns", "lead_fetch_configs", "appointments",
  "audit_runs", "share_tokens", "outreach_emails",
  "whatsapp_conversations", "lead_brain_memory",
] as const;

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Step 1: Ensure org id=1 exists for Dreamsdesign — deterministic/idempotent.
    // If the email already belongs to a different row, relocate it so id=1 can own it.
    await client.query(`
      UPDATE organizations
      SET email = 'legacy-' || id || '@placeholder.invalid'
      WHERE email = 'dreamsdesign.in@gmail.com' AND id <> 1
    `);
    // Upsert id=1 — update name/email/plan if id=1 already exists.
    await client.query(`
      INSERT INTO organizations (id, name, email, plan, subscription_status)
      VALUES (1, 'Dreamsdesign', 'dreamsdesign.in@gmail.com', 'trial', 'trialing')
      ON CONFLICT (id) DO UPDATE
        SET name               = EXCLUDED.name,
            email              = EXCLUDED.email,
            plan               = EXCLUDED.plan,
            subscription_status = EXCLUDED.subscription_status
    `);
    // Advance the sequence so future auto-inserts never collide with id=1.
    await client.query(`
      SELECT setval('organizations_id_seq',
        GREATEST(1, (SELECT MAX(id) FROM organizations)))
    `);

    // Step 2: Add org_id column to every tenant-scoped table (idempotent).
    for (const t of TABLES) {
      await client.query(
        `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id)`
      );
    }
    await client.query(`CREATE INDEX IF NOT EXISTS leads_org_id_idx ON leads(org_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS icps_org_id_idx  ON icps(org_id)`);

    // Step 3: Backfill via parent-lead FK where applicable.
    await client.query(`
      UPDATE audit_runs ar SET org_id = l.org_id
      FROM leads l WHERE ar.lead_id = l.id AND ar.org_id IS NULL
    `);
    await client.query(`
      UPDATE outreach_emails oe SET org_id = l.org_id
      FROM leads l WHERE oe.lead_id = l.id AND oe.org_id IS NULL
    `);
    await client.query(`
      UPDATE whatsapp_conversations wc SET org_id = l.org_id
      FROM leads l WHERE wc.lead_id = l.id AND wc.org_id IS NULL
    `);
    await client.query(`
      UPDATE lead_brain_memory lbm SET org_id = l.org_id
      FROM leads l WHERE lbm.lead_id = l.id AND lbm.org_id IS NULL
    `);
    await client.query(`
      UPDATE share_tokens st SET org_id = ar.org_id
      FROM audit_runs ar WHERE st.audit_run_id = ar.id AND st.org_id IS NULL
    `);
    for (const t of TABLES) {
      const res = await client.query(
        `UPDATE ${t} SET org_id = 1 WHERE org_id IS NULL RETURNING id`
      );
      if (res.rowCount && res.rowCount > 0) {
        console.log(`backfilled ${res.rowCount} rows in ${t}`);
      }
    }

    // Step 4: Create users table with role check constraint.
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        first_name    TEXT NOT NULL DEFAULT '',
        last_name     TEXT NOT NULL DEFAULT '',
        org_id        INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        role          TEXT NOT NULL DEFAULT 'owner'
                        CHECK (role IN ('owner', 'admin', 'member')),
        is_active     BOOLEAN NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN ('owner', 'admin', 'member'));
        END IF;
      END
      $$
    `);

    // Step 5: Upsert Krishna's user row.
    // Uses env-var hash when available; falls back to a sentinel that prevents
    // login until APP_AUTH_PASSWORD_HASH is set (row must exist for Task 2).
    const email   = "dreamsdesign.in@gmail.com";
    const pwdHash = process.env["APP_AUTH_PASSWORD_HASH"] || "__UNSET__";
    await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, org_id, role)
       VALUES ($1, $2, 'Krishna', 'Puranik', 1, 'owner')
       ON CONFLICT (email) DO UPDATE
         SET password_hash = CASE
               WHEN EXCLUDED.password_hash <> '__UNSET__' THEN EXCLUDED.password_hash
               ELSE users.password_hash
             END,
             org_id     = 1,
             role       = 'owner',
             updated_at = NOW()`,
      [email, pwdHash]
    );

    await client.query("COMMIT");
    console.log("multitenancy migration complete");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

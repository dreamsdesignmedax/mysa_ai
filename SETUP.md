# MysaAI — Offline Setup Guide

## What's in this archive

| File | Contents |
|------|----------|
| `database.sql` | Full PostgreSQL dump (all tables, data, sequences) |
| `codebase.tar.gz` | All source code (src dirs, configs, lockfile) |

---

## Prerequisites

- Node.js 20+ (or 24 to match production)
- pnpm 9+  (`npm i -g pnpm`)
- PostgreSQL 15+ running locally

---

## Steps

### 1 — Restore the database

```bash
createdb mysaai
psql mysaai < database.sql
```

### 2 — Extract source code

```bash
tar -xzf codebase.tar.gz
```

### 3 — Install dependencies

```bash
pnpm install
```

### 4 — Set environment variables

Create a `.env` file (or export these in your shell):

```env
DATABASE_URL=postgresql://localhost/mysaai
SESSION_SECRET=<any-random-string>
PORT=8080

# AI (Anthropic) — needed for intent summaries, BANT scoring, etc.
ANTHROPIC_API_KEY=<your-key>

# Optional — only needed for signal crawling
APIFY_TOKEN=<your-token>
APOLLO_API_KEY=<your-key>

# Email (SMTP) — only needed for outreach/alerts
GMAIL_USER=<your-gmail>
GMAIL_APP_PASSWORD=<your-app-password>

# Firebase — only needed for push notifications
FIREBASE_PROJECT_ID=<your-project-id>
FIREBASE_CLIENT_EMAIL=<your-client-email>
FIREBASE_PRIVATE_KEY=<your-private-key>
```

> **Auth note:** The app uses a custom HMAC token. Set these two to match what's in the DB:
> ```
> APP_AUTH_SECRET=<any-secret-string>
> APP_AUTH_PASSWORD_HASH=<sha256-of-your-password>
> ```
> To generate the hash: `echo -n "YourPassword" | sha256sum`

### 5 — Run the API server

```bash
pnpm --filter @workspace/api-server run dev
```

### 6 — Run a frontend (pick one)

```bash
# B2C v3 (latest)
pnpm --filter @workspace/mysa-b2c-v3 run dev

# B2C v1 (full features)
pnpm --filter @workspace/mysa-b2c-v1 run dev
```

---

## Stack quick reference

- **API:** Express 5 on port 8080 (`/api`)
- **DB:** PostgreSQL + Drizzle ORM
- **Frontend:** React + Vite + TailwindCSS + shadcn/ui
- **AI:** Anthropic Claude (Sonnet for scoring, Haiku for classification)

## Demo login (from DB)

- Email: `dreamsdesign.in@gmail.com`
- Password: `Vishnu@5900`

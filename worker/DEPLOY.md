# Signet Reviews Worker — Deploy Guide

This Worker aggregates marketplace reviews synced from user Signet daemons
and serves them publicly for the marketplace frontend.

**Prerequisites:** Cloudflare account with Workers + D1 enabled. `wrangler` CLI
installed (`bun install` in this directory will install it locally).

---

## Step 1 — Create the D1 database

```bash
cd marketplace/worker
npx wrangler d1 create signet-reviews
```

You'll get output like:

```
✅ Successfully created DB 'signet-reviews'
{
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "name": "signet-reviews"
}
```

Copy the `uuid` value and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding       = "DB"
database_name = "signet-reviews"
database_id   = "PASTE_UUID_HERE"   # ← replace this
```

---

## Step 2 — Run migrations

Apply the schema to the remote D1 database:

```bash
npx wrangler d1 migrations apply signet-reviews --remote
```

You should see:

```
✅ Applied 1 migration(s)
```

To verify the table exists:

```bash
npx wrangler d1 execute signet-reviews --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table'"
```

---

## Step 3 — Set the CORS origin

In `wrangler.toml`, update the production CORS origin to match the exact
marketplace domain (no trailing slash):

```toml
[env.production.vars]
CORS_ORIGIN = "https://marketplace.signetai.sh"
```

> If the marketplace is still on the default Pages subdomain, use that:
> `https://signet-marketplace.pages.dev`

---

## Step 4 — Deploy the Worker

```bash
npx wrangler deploy --env production
```

Note the deployed URL — it will be something like:

```
https://signet-reviews.<your-subdomain>.workers.dev
```

Or add a custom route in the Cloudflare dashboard (Workers → Routes):

```
reviews.signetai.sh/*  →  signet-reviews (production)
```

---

## Step 5 — Set PUBLIC_REVIEWS_ENDPOINT in Cloudflare Pages

In the Cloudflare dashboard:

1. Go to **Pages** → `signet-marketplace` → **Settings** → **Environment variables**
2. Add a **Production** variable:
   - Name: `PUBLIC_REVIEWS_ENDPOINT`
   - Value: `https://reviews.signetai.sh/api/reviews` (your Worker URL)
3. Redeploy the Pages project (trigger a new build or push a commit)

---

## Step 6 — Set the sync endpoint in signetai

The signetai daemon needs to know where to send reviews. Set the sync URL
via the daemon API (users run this once, or it becomes the default):

```bash
curl -X PATCH http://localhost:3850/api/marketplace/reviews/config \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "endpointUrl": "https://reviews.signetai.sh/api/reviews/sync"
  }'
```

> **Note for the signetai PR:** update `DEFAULT_CONFIG.endpointUrl` in
> `packages/daemon/src/routes/marketplace-reviews.ts` to this URL once deployed,
> and flip `enabled: true` as the default so sync happens automatically.

---

## Step 7 — Verify end-to-end

**Check the Worker is up:**
```bash
curl https://reviews.signetai.sh/
# → {"ok":true,"service":"signet-reviews"}
```

**Check the reviews endpoint:**
```bash
curl "https://reviews.signetai.sh/api/reviews?limit=5"
```

**Trigger a manual sync from a local daemon:**
```bash
curl -X POST http://localhost:3850/api/marketplace/reviews/sync
```

Then re-query the Worker to confirm the review landed.

---

## Local dev

To test the Worker locally against a local D1 instance:

```bash
# Run migrations on local D1
npx wrangler d1 migrations apply signet-reviews --local

# Start the Worker dev server (binds to http://localhost:8787)
npx wrangler dev
```

The marketplace dev server (port 4321) will pick up reviews from `localhost:3850`
(the Signet daemon) by default. Point it at the Worker instead by setting:

```bash
PUBLIC_REVIEWS_ENDPOINT=http://localhost:8787/api/reviews bun run dev
```

---

## Security notes

- **Rate limiting:** 5 sync requests per IP per 60 seconds. Adjust `namespace_id`
  `simple.limit` / `simple.period` in `wrangler.toml` if needed.
- **Origin gate:** All non-GET requests from non-allowed origins get a 403.
  The `CORS_ORIGIN` var must be your exact marketplace domain in production.
- **Sync gate:** POST `/api/reviews/sync` requires the `X-Signet-Sync: 1` header.
  The signetai daemon sets this automatically.
- **Input validation:** UUIDs, timestamps, field lengths, and rating range are
  all validated. Invalid reviews are skipped (not rejected wholesale).
- **Idempotent:** Re-syncing the same review UUID is safe — it upserts.
- **No PII stored:** Only `displayName` (user-chosen) is persisted. No IPs,
  emails, or account identifiers are stored.

---

## Files

```
worker/
├── migrations/
│   └── 001_initial.sql   D1 schema
├── src/
│   └── index.ts          Worker — all routes, validation, DB logic
├── package.json
├── tsconfig.json
├── wrangler.toml         ← fill in database_id and CORS_ORIGIN
└── DEPLOY.md             ← this file
```

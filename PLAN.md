# Signet Marketplace — Product & Engineering Plan

> Generated from the founding session, March 9 2026.
> Contributors: Nicholai, Oogie, Jake, MrClaude

---

## What We're Building

A publicly accessible marketplace for the agent economy — skills, MCP servers, and knowledge bases. Open to browse. Signet-verified to sell.

**The North Star:** *"Your agent's knowledge has value. Here's how to monetize it."*

---

## Why This Matters

Existing marketplaces (ClawHub, skills.sh, npm) are directories. No accountability. No identity. No trust signal. Anyone can publish a credential stealer and call it a weather skill.

Signet Marketplace is the first marketplace where trust is structural, not hoped for. The verification model has three tiers — each adds a trust signal, none gate access to browsing.

---

## The Three-Tier Verification Model

### Tier 1 — Listed (Default)
We scrape and mirror every major source automatically. Your skill or MCP server appears on day one, whether or not you've ever heard of us. Creators can claim their listing via **GitHub OAuth** — proves repo ownership, grants edit access to description, links, and tags. Zero friction, no cost.

### Tier 2 — Verified (Entire.io)
A listing becomes `verified` when the creator provides **Entire.io session logs** as the audit trail.

Entire hooks into your git workflow to capture AI agent sessions — every prompt/response transcript, files touched, and checkpoints — stored on a separate branch alongside commits. This is the provenance record.

Signet is the distillation layer: Entire captures *what happened*, Signet turns it into *persistent, structured knowledge*. Together they produce a verifiable claim: "this skill was built this way, here's the receipts."

The verified badge means:
- The creator has proven authorship (GitHub OAuth)
- The build process is auditable (Entire.io session chain)
- The identity is DID-anchored (did:signet:)

Entire.io is a foundational partner in this model, not a bolt-on. Their logo appears in the colophon.

### Tier 3 — Sponsored
Paid visibility. USDC staking on Base. Stake to surface a listing in featured/top tiers. Stakes expire, no lock-in. This is the revenue layer.

---

## Knowledge Bases — The Crown Jewel

Skills and MCP servers are code. Knowledge bases are *understanding*.

Signet's distillation pipeline is powerful enough that any raw, unstructured data dump — internal docs, decades of company history, domain expertise, chat logs — can be ingested and turned into actionable agent knowledge. Not raw observations. Structured entities, mapped dependencies, atomic facts with context.

This means:
- A company can embed their entire institutional knowledge into a portable, agent-readable asset
- That asset can be listed, sold, and transferred on the marketplace
- The buyer gets a verified knowledge base — DID-signed, with Entire.io provenance if the creator provided it
- Companies could effectively **auction off their accumulated expertise** — knowledge bases as exit vehicles

This is the category nobody else has. Not code. Not tools. *Verified agent knowledge.*

---

## Architecture

### Stack
- **Frontend:** Astro 5 + Tailwind CSS 4 — Cloudflare Pages
- **API layer:** Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite) for listings, claims, verification
- **Storage:** R2 for mirrored content
- **Cache:** KV for hot listings and search
- **Queue:** Cloudflare Queues for async crawl jobs
- **Search:** Cloudflare Vectorize (semantic) or lightweight keyword index

### D1 Schema

```sql
listings (
  id, slug, name, description,
  type          TEXT,  -- 'skill' | 'mcp' | 'knowledge'
  source_url    TEXT,
  source_repo   TEXT,
  install_count INTEGER DEFAULT 0,
  created_at    TIMESTAMP,
  verification_status TEXT DEFAULT 'unclaimed'  -- 'unclaimed' | 'claimed' | 'verified'
)

claims (
  id, listing_id,
  github_user         TEXT,
  github_oauth_token_hash TEXT,
  claimed_at          TIMESTAMP
)

verification (
  id, listing_id,
  did                 TEXT,  -- did:signet:<pubkey>
  did_document        TEXT,
  entire_session_ref  TEXT,  -- Entire.io checkpoint branch/commit ref
  anchor_tx_hash      TEXT,  -- null until Phase 2 on-chain anchor
  chain               TEXT,
  verified_at         TIMESTAMP,
  status              TEXT   -- 'pending' | 'verified' | 'revoked'
)

visibility (
  id, listing_id,
  stake_amount_usdc   REAL,
  stake_tx_hash       TEXT,
  expires_at          TIMESTAMP,
  tier                TEXT   -- 'basic' | 'featured' | 'top'
)

index_runs (
  id, source, started_at, completed_at,
  listings_added INTEGER, listings_updated INTEGER
)
```

---

## Phase 1 — Launch with Density (This Week)

- [x] Astro scaffold at `~/signet/marketplace/`
- [x] Indexer crawled **10,110 listings** (5,451 skills + 4,659 MCP servers) — `public/data/listings.json`
- [ ] Wire `listings.json` into Astro pages for real data at build time
- [ ] GitHub OAuth claim flow
- [ ] Deploy to `market.signetai.sh` via Cloudflare Pages (already live, needs real data)

---

## Phase 2 — Trust Layer (Next Week)

- [ ] Cherry-pick PR #25 Phase 0: Ed25519 keypairs + `did:signet:` DID generation — pure crypto, no chain dependency
- [ ] `signet did generate` → DID stored in D1 → verified badge on listing
- [ ] Entire.io session log ingestion for Tier 2 verification
- [ ] Hold Phase 4A (ERC-8004 escrow) until external audit
- [ ] Basic USDC staking for Tier 3 on Base

---

## Phase 3 — Data Economy

- [ ] Knowledge base listing format + upload flow
- [ ] Distillation pipeline integration (Signet daemon → knowledge bundle export)
- [ ] DID-signed knowledge bundles with Entire.io provenance chain
- [ ] BroadcastRegistry + ReferralGraph contracts (agents earn for downstream discovery)
- [ ] WorldBlast integration

---

## Parallel Marketing Track

1. **Moltbook** — MrClaude seeding trust chains → identity → marketplace narrative. Oracle post live. eudaemon_0 engagement underway.
2. **ClawHub skill** — publish a Signet skill for native OpenClaw distribution
3. **awesome-openclaw lists** — get into curated lists
4. **rentamac.io** — target for write-up (ran "best skills" piece ~1 week ago)
5. **Entire.io** — reach out when ready; joint positioning is natural and mutually beneficial

---

## Immediate Next Steps

| Who | What | When |
|-----|------|-------|
| MrClaude | Wire listings.json into Astro pages | Today |
| Nicholai | Validate D1 schema | Today |
| Nicholai | Confirm PR #25 Phase 0 cherry-pick scope | Today |
| Jake | Review Phase 0 cherry-pick plan | This week |
| Oogie | Indexer dedup + additional sources | This week |
| All | Schedule external audit for ERC-8004 escrow | Before Phase 2 |

---

## Repos

| Repo | Purpose | Status |
|------|---------|--------|
| `Signet-AI/signetai` | Core daemon, CLI, SDK | Active |
| `Signet-AI/marketplace` | This marketplace | Active |
| `NicholaiVogel/signet` | Private planning | Active |

---

*Powered by [Entire.io](https://entire.io) for verifiable session provenance.*

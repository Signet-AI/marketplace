/**
 * Signet Reviews Worker
 *
 * Central aggregation endpoint for Signet marketplace reviews.
 * Receives synced reviews from user daemons and serves them publicly.
 *
 * Routes:
 *   GET  /              — health check
 *   GET  /api/reviews   — list/query reviews (public)
 *   POST /api/reviews/sync — receive batch sync from signetai daemon
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  RATE_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  CORS_ORIGIN: string;
}

interface ReviewRow {
  id: string;
  target_type: "skill" | "mcp";
  target_id: string;
  display_name: string;
  rating: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  received_at: string;
}

interface IncomingReview {
  id: string;
  targetType: "skill" | "mcp";
  targetId: string;
  displayName: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation limits — enforced on every inbound review
// ─────────────────────────────────────────────────────────────────────────────

const LIMITS = {
  BATCH_SIZE: 100,       // max reviews per sync call
  TARGET_ID: 200,        // max chars for targetId
  DISPLAY_NAME: 50,      // max chars for displayName
  TITLE: 100,            // max chars for title
  BODY: 2_000,           // max chars for body
  BODY_MIN: 10,          // min chars for body
  TITLE_MIN: 3,          // min chars for title
  REQUEST_BODY_BYTES: 512_000, // 512 KB max request body
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns a safe trimmed string or null if invalid/too long/too short. */
function parseStr(
  value: unknown,
  minLen: number,
  maxLen: number,
): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length < minLen || t.length > maxLen) return null;
  return t;
}

function parseTargetType(v: unknown): "skill" | "mcp" | null {
  if (v === "skill" || v === "mcp") return v;
  return null;
}

function parseRating(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  if (r < 1 || r > 5) return null;
  return r;
}

/** UUID v4 format check. Prevents arbitrary strings as primary keys. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseUUID(v: unknown): string | null {
  if (typeof v !== "string" || !UUID_RE.test(v)) return null;
  return v.toLowerCase();
}

/** ISO 8601 timestamp check — accept only reasonable recent dates. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function parseTimestamp(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_RE.test(v)) return null;
  const ts = new Date(v).getTime();
  if (isNaN(ts)) return null;
  // Reject timestamps more than 30 days in the future
  if (ts > Date.now() + 30 * 24 * 60 * 60 * 1_000) return null;
  return v;
}

/** Validates and normalizes one incoming review. Returns null if invalid. */
function validateReview(raw: unknown): IncomingReview | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const id          = parseUUID(r["id"]);
  const targetType  = parseTargetType(r["targetType"]);
  const targetId    = parseStr(r["targetId"], 1, LIMITS.TARGET_ID);
  const displayName = parseStr(r["displayName"], 1, LIMITS.DISPLAY_NAME);
  const rating      = parseRating(r["rating"]);
  const title       = parseStr(r["title"], LIMITS.TITLE_MIN, LIMITS.TITLE);
  const body        = parseStr(r["body"], LIMITS.BODY_MIN, LIMITS.BODY);
  const createdAt   = parseTimestamp(r["createdAt"]);
  const updatedAt   = parseTimestamp(r["updatedAt"]);

  if (
    !id || !targetType || !targetId || !displayName ||
    rating === null || !title || !body || !createdAt || !updatedAt
  ) {
    return null;
  }

  return { id, targetType, targetId, displayName, rating, title, body, createdAt, updatedAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Signet-Sync",
    "Access-Control-Max-Age": "86400",
  };
}

function isOriginAllowed(requestOrigin: string | null, allowed: string): boolean {
  if (allowed === "*") return true;
  if (!requestOrigin) return false;
  // Allow exact match and localhost for dev
  if (requestOrigin === allowed) return true;
  try {
    const u = new URL(requestOrigin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  } catch {
    // ignore
  }
  return false;
}

function makeResponse(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      ...extra,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

function rowToPublic(row: ReviewRow) {
  return {
    id:          row.id,
    targetType:  row.target_type,
    targetId:    row.target_id,
    displayName: row.display_name,
    rating:      row.rating,
    title:       row.title,
    body:        row.body,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

async function upsertReviews(
  db: D1Database,
  reviews: IncomingReview[],
  receivedAt: string,
): Promise<{ accepted: number; rejected: number }> {
  let accepted = 0;
  let rejected = 0;

  // D1 batch — one statement per review, all in one round-trip
  const stmts = reviews.map((r) =>
    db
      .prepare(
        `INSERT INTO reviews
           (id, target_type, target_id, display_name, rating, title, body,
            created_at, updated_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           rating       = excluded.rating,
           title        = excluded.title,
           body         = excluded.body,
           updated_at   = excluded.updated_at,
           received_at  = excluded.received_at`,
      )
      .bind(
        r.id, r.targetType, r.targetId, r.displayName,
        r.rating, r.title, r.body,
        r.createdAt, r.updatedAt, receivedAt,
      ),
  );

  const results = await db.batch(stmts);
  for (const res of results) {
    if (res.success) accepted++;
    else rejected++;
  }
  return { accepted, rejected };
}

// ─────────────────────────────────────────────────────────────────────────────
// Request parsing helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseIntParam(v: string | null, min: number, max: number, def: number): number {
  if (!v) return def;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleGetReviews(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const url    = new URL(request.url);
  const type   = url.searchParams.get("type");
  const id     = url.searchParams.get("id");
  const limit  = parseIntParam(url.searchParams.get("limit"), 1, 50, 20);
  const offset = parseIntParam(url.searchParams.get("offset"), 0, 100_000, 0);

  // Build WHERE clause safely — no string interpolation of user values
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (type === "skill" || type === "mcp") {
    conditions.push("target_type = ?");
    bindings.push(type);
  }
  if (id) {
    const cleanId = id.slice(0, LIMITS.TARGET_ID);
    conditions.push("target_id = ?");
    bindings.push(cleanId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rowsResult, countResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, target_type, target_id, display_name, rating, title, body,
              created_at, updated_at
       FROM reviews ${where}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(...bindings, limit, offset),
    env.DB.prepare(
      `SELECT COUNT(*) as total,
              AVG(rating) as avg_rating
       FROM reviews ${where}`,
    ).bind(...bindings),
  ]);

  const rows    = (rowsResult.results ?? []) as ReviewRow[];
  const summary = (countResult.results?.[0] ?? { total: 0, avg_rating: 0 }) as {
    total: number;
    avg_rating: number | null;
  };

  return makeResponse(
    {
      reviews: rows.map(rowToPublic),
      total:   summary.total,
      limit,
      offset,
      summary: {
        count:     summary.total,
        avgRating: summary.avg_rating != null
          ? Math.round(summary.avg_rating * 10) / 10
          : 0,
      },
    },
    200,
    { ...cors, "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
  );
}

async function handleSync(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  clientIp: string,
): Promise<Response> {
  // ── Rate limit ──────────────────────────────────────────────────────────────
  const { success: allowed } = await env.RATE_LIMITER.limit({ key: clientIp });
  if (!allowed) {
    return makeResponse(
      { error: "rate limit exceeded — try again in a minute" },
      429,
      { ...cors, "Retry-After": "60" },
    );
  }

  // ── Require the X-Signet-Sync header (lightweight origin gate) ─────────────
  if (request.headers.get("X-Signet-Sync") !== "1") {
    return makeResponse({ error: "missing required header" }, 400, cors);
  }

  // ── Content-Type check ─────────────────────────────────────────────────────
  const ct = request.headers.get("Content-Type") ?? "";
  if (!ct.includes("application/json")) {
    return makeResponse({ error: "Content-Type must be application/json" }, 415, cors);
  }

  // ── Body size guard (CF Workers stream; clone + arrayBuffer to check size) ──
  const cloned = request.clone();
  const bodyBuffer = await cloned.arrayBuffer();
  if (bodyBuffer.byteLength > LIMITS.REQUEST_BODY_BYTES) {
    return makeResponse({ error: "request body too large" }, 413, cors);
  }

  // ── Parse JSON ──────────────────────────────────────────────────────────────
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bodyBuffer));
  } catch {
    return makeResponse({ error: "invalid JSON" }, 400, cors);
  }

  // ── Validate envelope ───────────────────────────────────────────────────────
  if (
    typeof payload !== "object" || payload === null ||
    (payload as Record<string, unknown>)["source"] !== "signet-marketplace" ||
    (payload as Record<string, unknown>)["type"] !== "reviews-sync"
  ) {
    return makeResponse({ error: "invalid sync payload" }, 400, cors);
  }

  const rawReviews = (payload as Record<string, unknown>)["reviews"];
  if (!Array.isArray(rawReviews)) {
    return makeResponse({ error: "'reviews' must be an array" }, 400, cors);
  }
  if (rawReviews.length > LIMITS.BATCH_SIZE) {
    return makeResponse(
      { error: `batch too large — max ${LIMITS.BATCH_SIZE} reviews per sync` },
      400,
      cors,
    );
  }

  // ── Validate each review ────────────────────────────────────────────────────
  const valid: IncomingReview[] = [];
  let skipped = 0;
  for (const raw of rawReviews) {
    const r = validateReview(raw);
    if (r) valid.push(r);
    else skipped++;
  }

  if (valid.length === 0) {
    return makeResponse({ error: "no valid reviews in batch", skipped }, 400, cors);
  }

  // ── Upsert ──────────────────────────────────────────────────────────────────
  const receivedAt = new Date().toISOString();
  const { accepted, rejected } = await upsertReviews(env.DB, valid, receivedAt);

  return makeResponse(
    { success: true, accepted, rejected, skipped, receivedAt },
    200,
    cors,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main fetch handler
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    // ── CORS origin check ─────────────────────────────────────────────────────
    const requestOrigin = request.headers.get("Origin");
    const allowed = isOriginAllowed(requestOrigin, env.CORS_ORIGIN);
    const cors = allowed
      ? corsHeaders(requestOrigin ?? env.CORS_ORIGIN)
      : {};

    // Preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: allowed
          ? corsHeaders(requestOrigin ?? env.CORS_ORIGIN)
          : { "Content-Length": "0" },
      });
    }

    // Block non-allowed cross-origins on state-changing requests
    if (!allowed && method !== "GET") {
      return makeResponse({ error: "forbidden" }, 403, {});
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";

    // ── Health check ──────────────────────────────────────────────────────────
    if (path === "/" && method === "GET") {
      return makeResponse({ ok: true, service: "signet-reviews" }, 200, cors);
    }

    // ── GET /api/reviews ──────────────────────────────────────────────────────
    if (path === "/api/reviews" && method === "GET") {
      return handleGetReviews(request, env, cors);
    }

    // ── POST /api/reviews/sync ────────────────────────────────────────────────
    if (path === "/api/reviews/sync" && method === "POST") {
      const clientIp =
        request.headers.get("CF-Connecting-IP") ??
        request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
        "unknown";
      return handleSync(request, env, cors, clientIp);
    }

    return makeResponse({ error: "not found" }, 404, cors);
  },
} satisfies ExportedHandler<Env>;

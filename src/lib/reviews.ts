/**
 * Reviews fetching utilities.
 *
 * In development: fetches from the local Signet daemon at localhost:3850.
 * In production: set PUBLIC_REVIEWS_ENDPOINT to the Cloudflare Worker URL.
 *
 * All DOM rendering uses textContent — no innerHTML.
 */

// Inlined at build time via Astro's PUBLIC_ env convention.
// Fallback to local daemon for dev.
const REVIEWS_ENDPOINT =
  (typeof import.meta !== "undefined" && (import.meta as { env?: { PUBLIC_REVIEWS_ENDPOINT?: string } }).env?.PUBLIC_REVIEWS_ENDPOINT) ||
  "http://localhost:3850/api/marketplace/reviews";

export interface MarketplaceReview {
  readonly id: string;
  readonly targetType: "skill" | "mcp";
  readonly targetId: string;
  readonly displayName: string;
  readonly rating: number;
  readonly title: string;
  readonly body: string;
  readonly source: "local" | "synced";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewsSummary {
  readonly count: number;
  readonly avgRating: number;
}

export interface ReviewsResult {
  readonly reviews: MarketplaceReview[];
  readonly total: number;
  readonly summary: ReviewsSummary;
}

export async function fetchReviews(opts: {
  type?: "skill" | "mcp";
  id?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ReviewsResult> {
  const url = new URL(REVIEWS_ENDPOINT);
  if (opts.type) url.searchParams.set("type", opts.type);
  if (opts.id) url.searchParams.set("id", opts.id);
  if (opts.limit !== undefined) url.searchParams.set("limit", String(opts.limit));
  if (opts.offset !== undefined) url.searchParams.set("offset", String(opts.offset));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Reviews fetch failed: ${res.status}`);
  return res.json() as Promise<ReviewsResult>;
}

/** Renders a star rating as unicode — safe for textContent. */
export function renderStars(rating: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/** Format relative time, e.g. "2 days ago". */
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Build a review card element using safe DOM APIs only. */
export function buildReviewCard(review: MarketplaceReview): HTMLElement {
  const article = document.createElement("article");
  article.className = "review-card";

  // Header: stars + display name + time
  const header = document.createElement("div");
  header.className = "review-header";

  const stars = document.createElement("span");
  stars.className = "review-stars";
  stars.textContent = renderStars(review.rating);

  const meta = document.createElement("span");
  meta.className = "review-meta";
  const nameSpan = document.createElement("span");
  nameSpan.className = "review-name";
  nameSpan.textContent = review.displayName;
  const timeSpan = document.createElement("span");
  timeSpan.className = "review-time";
  timeSpan.textContent = formatRelativeTime(review.updatedAt);
  meta.appendChild(nameSpan);
  meta.appendChild(timeSpan);

  header.appendChild(stars);
  header.appendChild(meta);

  // Target badge
  const badge = document.createElement("span");
  badge.className = `review-target-badge review-target-${review.targetType}`;
  badge.textContent = `${review.targetType}: ${review.targetId}`;

  // Title
  const title = document.createElement("p");
  title.className = "review-title";
  title.textContent = review.title;

  // Body
  const body = document.createElement("p");
  body.className = "review-body";
  body.textContent = review.body;

  article.appendChild(header);
  article.appendChild(badge);
  article.appendChild(title);
  article.appendChild(body);

  return article;
}

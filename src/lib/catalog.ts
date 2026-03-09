/**
 * Catalog data fetching and safe DOM utilities.
 * All card building uses DOM APIs (textContent) — no innerHTML.
 *
 * Data sources (in priority order):
 *   1. /data/listings.json — pre-built seed file from scripts/index.ts
 *   2. Live APIs (MCP registry, skills.sh search) — fallback if seed missing
 */

const MONOGRAM_COLORS = [
  "var(--sig-icon-bg-1)",
  "var(--sig-icon-bg-2)",
  "var(--sig-icon-bg-3)",
  "var(--sig-icon-bg-4)",
  "var(--sig-icon-bg-5)",
  "var(--sig-icon-bg-6)",
] as const;

export function getMonogram(name: string): string {
  const parts = name.split(/[-_.\s/]+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function getMonogramBg(name: string): string {
  let hash = 0;
  for (const ch of name) hash = ((hash * 31) + ch.charCodeAt(0)) & 0xffff;
  return MONOGRAM_COLORS[Math.abs(hash) % MONOGRAM_COLORS.length] ?? MONOGRAM_COLORS[0];
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export interface CardData {
  name: string;
  description: string;
  badges: string[];
  official?: boolean;
  stat?: string;
  href?: string;
}

/** Clone the card template and populate it with safe textContent. */
export function buildCard(tpl: HTMLTemplateElement, data: CardData): HTMLElement {
  const clone = tpl.content.cloneNode(true) as DocumentFragment;
  const article = clone.querySelector("article")!;

  const iconEl = article.querySelector<HTMLElement>("[data-icon]")!;
  iconEl.textContent = getMonogram(data.name);
  iconEl.style.background = getMonogramBg(data.name);

  const nameEl = article.querySelector<HTMLElement>("[data-name]")!;
  nameEl.textContent = data.name;

  const descEl = article.querySelector<HTMLElement>("[data-desc]")!;
  descEl.textContent = data.description || "No description.";

  const metaEl = article.querySelector<HTMLElement>("[data-meta]")!;
  data.badges.forEach((badge) => {
    const span = document.createElement("span");
    span.className = "badge" + (data.official && badge === "official" ? " badge-official" : "");
    span.textContent = badge;
    metaEl.appendChild(span);
  });
  if (data.stat) {
    const span = document.createElement("span");
    span.className = "badge badge-provider";
    span.textContent = data.stat;
    metaEl.appendChild(span);
  }

  if (data.href) {
    article.setAttribute("role", "link");
    article.style.cursor = "pointer";
    article.addEventListener("click", () => { window.location.href = data.href!; });
    article.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        window.location.href = data.href!;
      }
    });
  }

  return article;
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface SkillItem {
  name: string;
  description?: string;
  provider?: string;
  downloads?: number;
  stars?: number;
  fullName?: string;
  href?: string;
}

export interface McpItem {
  id: string;
  name: string;
  description?: string;
  category?: string;
  source?: string;
  official?: boolean;
  popularityRank?: number;
  href?: string;
}

export interface FetchResult<T> {
  items: T[];
  total: number;
}

interface Listings {
  generated?: string;
  skills: SkillItem[];
  mcp: McpItem[];
  stats?: { skills: number; mcp: number };
}

let _listingsCache: Listings | null = null;

async function loadListings(): Promise<Listings> {
  if (_listingsCache) return _listingsCache;
  try {
    const res = await fetch("/data/listings.json");
    if (res.ok) {
      _listingsCache = (await res.json()) as Listings;
      return _listingsCache;
    }
  } catch {
    // fall through to empty
  }
  return { skills: [], mcp: [] };
}

// ---------------------------------------------------------------------------
// Public fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch skills catalog.
 * Primary: /data/listings.json seed file.
 * Fallback: skills.sh /api/search (search-based, requires 2+ char query).
 *   Note: skills.sh has no list endpoint — fallback only works with a query.
 */
export async function fetchSkills(query = "", limit = 500): Promise<FetchResult<SkillItem>> {
  const listings = await loadListings();

  if (listings.skills.length > 0) {
    const items = query
      ? listings.skills.filter(
          (s) =>
            s.name.toLowerCase().includes(query.toLowerCase()) ||
            (s.description ?? "").toLowerCase().includes(query.toLowerCase()),
        )
      : listings.skills;
    return { items: items.slice(0, limit), total: listings.stats?.skills ?? listings.skills.length };
  }

  // Fallback: skills.sh search API (requires a query of 2+ chars)
  if (query.length >= 2) {
    try {
      const url = `https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 100)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          skills: Array<{ id: string; name: string; installs: number; source: string }>;
          count: number;
        };
        const items: SkillItem[] = (data.skills ?? []).map((s) => ({
          name: s.name,
          provider: "skills.sh",
          downloads: s.installs,
          fullName: s.source,
          href: `https://github.com/${s.source}`,
        }));
        return { items, total: data.count ?? items.length };
      }
    } catch {
      // ignore, fall through
    }
  }

  return { items: [], total: 0 };
}

/**
 * Fetch MCP server catalog.
 * Primary: /data/listings.json seed file.
 * Fallback: MCP official registry (registry.modelcontextprotocol.io/v0.1/servers).
 *
 * Skipped sources (no public API):
 *   - clawhub.ai — domain does not resolve
 *   - mcpservers.org — Next.js SSR site, no public JSON endpoint
 *   - api.clawhub.com — returns 404 on all probed paths
 */
export async function fetchMcpServers(query = "", limit = 500): Promise<FetchResult<McpItem>> {
  const listings = await loadListings();

  if (listings.mcp.length > 0) {
    const items = query
      ? listings.mcp.filter(
          (s) =>
            s.name.toLowerCase().includes(query.toLowerCase()) ||
            (s.description ?? "").toLowerCase().includes(query.toLowerCase()),
        )
      : listings.mcp;
    return { items: items.slice(0, limit), total: listings.stats?.mcp ?? listings.mcp.length };
  }

  // Fallback: MCP official registry (first page only)
  try {
    const res = await fetch("https://registry.modelcontextprotocol.io/v0.1/servers?limit=100");
    if (res.ok) {
      const data = (await res.json()) as {
        servers: Array<{
          server: {
            name: string;
            description?: string;
            websiteUrl?: string;
          };
        }>;
        metadata?: { count?: number };
      };
      const items: McpItem[] = (data.servers ?? []).map((entry, i) => ({
        id: entry.server.name,
        name: entry.server.name,
        description: entry.server.description,
        source: "mcp-registry",
        official: true,
        popularityRank: i + 1,
        href: entry.server.websiteUrl ?? "https://registry.modelcontextprotocol.io",
      }));
      return { items, total: data.metadata?.count ?? items.length };
    }
  } catch {
    // ignore
  }

  return { items: [], total: 0 };
}

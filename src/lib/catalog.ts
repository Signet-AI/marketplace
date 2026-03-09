/**
 * Catalog data fetching and safe DOM utilities.
 * All card building uses DOM APIs (textContent) — no innerHTML.
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
// Data fetching
// ---------------------------------------------------------------------------

export interface SkillItem {
  name: string;
  description?: string;
  provider?: string;
  downloads?: number;
  stars?: number;
  fullName?: string;
}

export interface McpItem {
  id: string;
  name: string;
  description?: string;
  category?: string;
  source?: string;
  official?: boolean;
  popularityRank?: number;
}

export interface FetchResult<T> {
  items: T[];
  total: number;
}

/** Fetch skills catalog from skills.sh public API */
export async function fetchSkills(query = "", limit = 60): Promise<FetchResult<SkillItem>> {
  const url = new URL("https://skills.sh/api/v1/search");
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`skills.sh API error: ${res.status}`);
  const data = await res.json() as { results?: SkillItem[]; total?: number };
  return {
    items: data.results ?? [],
    total: data.total ?? (data.results?.length ?? 0),
  };
}

/** Fetch MCP server catalog from mcpservers.org public API */
export async function fetchMcpServers(query = "", limit = 60): Promise<FetchResult<McpItem>> {
  const url = new URL("https://mcpservers.org/api/v1/servers");
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`mcpservers.org API error: ${res.status}`);
  const data = await res.json() as { servers?: McpItem[]; total?: number; items?: McpItem[] };
  const items = data.servers ?? data.items ?? [];
  return {
    items,
    total: data.total ?? items.length,
  };
}

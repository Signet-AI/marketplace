/**
 * Signet Marketplace Indexer
 *
 * Crawls real data sources and writes public/data/listings.json.
 * Run with: bun scripts/index.ts
 *
 * Sources:
 *   - MCP Official Registry (registry.modelcontextprotocol.io) — cursor paginated
 *   - npm @modelcontextprotocol packages — offset paginated
 *   - npm keywords:mcp-server packages — offset paginated
 *   - skills.sh /api/search — search-based, multiple queries
 *   - GitHub topic:claude-skill repos — offset paginated
 *
 * Skipped (no public API):
 *   - clawhub.ai — domain does not resolve
 *   - mcpservers.org — Next.js SSR, no public API endpoint
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Shared types matching src/lib/catalog.ts interfaces
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

export interface Listings {
  generated: string;
  skills: SkillItem[];
  mcp: McpItem[];
  stats: { skills: number; mcp: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...opts, headers: { "User-Agent": "signet-marketplace-indexer/0.1", ...((opts?.headers as Record<string, string>) ?? {}) } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function dedupeSkills(items: SkillItem[]): SkillItem[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    const key = `${s.name.toLowerCase()}|${s.provider ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeMcp(items: McpItem[]): McpItem[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    const key = `${s.name.toLowerCase()}|${s.source ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Infer a rough category from package name / description */
function inferCategory(name: string, desc = ""): string {
  const text = `${name} ${desc}`.toLowerCase();
  if (/\b(filesystem|file|folder|dir)\b/.test(text)) return "files";
  if (/\b(database|db|sql|postgres|mysql|sqlite|mongo|redis|supabase)\b/.test(text)) return "data";
  if (/\b(browser|web|http|fetch|url|scrape|crawl|puppeteer|playwright)\b/.test(text)) return "web";
  if (/\b(search|google|bing|duckduckgo|perplexity|exa)\b/.test(text)) return "search";
  if (/\b(git|github|gitlab|bitbucket|pr|pull.?request|issue)\b/.test(text)) return "devtools";
  if (/\b(slack|discord|email|gmail|calendar|notion|linear|jira|asana)\b/.test(text)) return "productivity";
  if (/\b(code|lint|format|test|ci|deploy|docker|k8s|kubernetes)\b/.test(text)) return "devtools";
  if (/\b(memory|knowledge|rag|embed|vector|semantic)\b/.test(text)) return "ai";
  return "general";
}

// ---------------------------------------------------------------------------
// Source 1: MCP Official Registry (registry.modelcontextprotocol.io)
// ---------------------------------------------------------------------------

interface McpRegistryServer {
  server: {
    name: string;
    description?: string;
    websiteUrl?: string;
    repository?: { url?: string };
    version?: string;
  };
  _meta?: Record<string, unknown>;
}

interface McpRegistryResponse {
  servers: McpRegistryServer[];
  metadata?: { nextCursor?: string; count?: number };
}

async function fetchMcpRegistry(): Promise<McpItem[]> {
  const items: McpItem[] = [];
  let cursor: string | undefined;
  let page = 0;
  const BASE = "https://registry.modelcontextprotocol.io";

  while (true) {
    const url = cursor
      ? `${BASE}/v0.1/servers?limit=100&cursor=${encodeURIComponent(cursor)}`
      : `${BASE}/v0.1/servers?limit=100`;

    const data = await fetchJSON<McpRegistryResponse>(url);
    if (!data?.servers?.length) break;

    for (const entry of data.servers) {
      const srv = entry.server;
      items.push({
        id: srv.name,
        name: srv.name,
        description: srv.description,
        category: inferCategory(srv.name, srv.description),
        source: "mcp-registry",
        official: true,
        href: srv.websiteUrl ?? srv.repository?.url ?? `https://registry.modelcontextprotocol.io`,
      });
    }

    cursor = data.metadata?.nextCursor;
    page++;
    process.stdout.write(`  [mcp-registry] page ${page} — ${items.length} so far\n`);

    if (!cursor) break;
    await sleep(150);
  }

  return items;
}

// ---------------------------------------------------------------------------
// Source 2: npm packages (@modelcontextprotocol scope + mcp-server keyword)
// ---------------------------------------------------------------------------

interface NpmSearchObject {
  package: {
    name: string;
    description?: string;
    version?: string;
    keywords?: string[];
    links?: { npm?: string; homepage?: string; repository?: string };
  };
  downloads?: { monthly?: number; weekly?: number };
  score?: { detail?: { popularity?: number } };
}

interface NpmSearchResponse {
  total: number;
  objects: NpmSearchObject[];
}

const NPM_SKIP_NAMES = new Set([
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/inspector",
  "@modelcontextprotocol/ext-apps",
  "@modelcontextprotocol/create-python-server",
  "@modelcontextprotocol/create-typescript-server",
]);

async function fetchNpmPackages(query: string, maxPages = 10, label = "npm"): Promise<McpItem[]> {
  const items: McpItem[] = [];
  const size = 200;

  for (let page = 0; page < maxPages; page++) {
    const from = page * size;
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${size}&from=${from}`;
    const data = await fetchJSON<NpmSearchResponse>(url);
    if (!data?.objects?.length) break;

    for (const obj of data.objects) {
      const pkg = obj.package;
      if (NPM_SKIP_NAMES.has(pkg.name)) continue;

      // Filter: must look like a server/tool (not pure SDK or unrelated)
      const isServer =
        pkg.name.includes("server") ||
        pkg.name.includes("mcp") ||
        pkg.name.includes("-mcp") ||
        pkg.name.includes("mcp-") ||
        (pkg.keywords?.some((k) => k === "mcp" || k === "mcp-server" || k === "model-context-protocol") ?? false);

      if (!isServer) continue;

      items.push({
        id: pkg.name,
        name: pkg.name,
        description: pkg.description,
        category: inferCategory(pkg.name, pkg.description),
        source: "npm",
        official: pkg.name.startsWith("@modelcontextprotocol/"),
        href: pkg.links?.homepage ?? pkg.links?.npm ?? `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`,
      });
    }

    const total = data.total;
    process.stdout.write(`  [${label}] page ${page + 1} — ${items.length} servers from ${Math.min((page + 1) * size, total)}/${total} packages\n`);

    if ((page + 1) * size >= Math.min(total, maxPages * size)) break;
    await sleep(200);
  }

  return items;
}

// ---------------------------------------------------------------------------
// Source 3: skills.sh search API
// ---------------------------------------------------------------------------

interface SkillsShItem {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

interface SkillsShResponse {
  skills: SkillsShItem[];
  count: number;
}

// Broad search terms to maximize coverage. Min 2 chars required by API.
const SKILLS_SEARCH_TERMS = [
  "ai", "ml", "web", "db", "git", "api", "cli", "code", "test",
  "file", "data", "dev", "seo", "mcp", "sql", "bash", "python",
  "search", "doc", "cloud", "aws", "react", "ts", "js", "go",
  "rust", "node", "docker", "ci", "cd", "lint", "format", "deploy",
  "auth", "jwt", "slack", "email", "notion", "linear", "github",
  "image", "pdf", "csv", "json", "xml", "yaml", "log", "monitor",
  "scrape", "crawl", "fetch", "parse", "chart", "viz", "ui",
  "skill", "agent", "chat", "llm", "prompt", "embed", "vector",
  "memory", "rag", "tool", "fn", "func", "util", "helper",
];

async function fetchSkillsSh(): Promise<SkillItem[]> {
  const allSkills = new Map<string, SkillItem>();

  for (let i = 0; i < SKILLS_SEARCH_TERMS.length; i++) {
    const term = SKILLS_SEARCH_TERMS[i]!;
    const url = `https://skills.sh/api/search?q=${encodeURIComponent(term)}&limit=100`;
    const data = await fetchJSON<SkillsShResponse>(url);

    if (data?.skills) {
      for (const s of data.skills) {
        if (!allSkills.has(s.id)) {
          allSkills.set(s.id, {
            name: s.name,
            description: undefined,
            provider: "skills.sh",
            downloads: s.installs,
            fullName: s.source,
            href: `https://github.com/${s.source}`,
          });
        }
      }
    }

    process.stdout.write(`  [skills.sh] "${term}" — ${allSkills.size} unique skills total\n`);
    await sleep(300);
  }

  return Array.from(allSkills.values());
}

// ---------------------------------------------------------------------------
// Source 4: GitHub topic:claude-skill repos
// ---------------------------------------------------------------------------

interface GithubRepo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  topics: string[];
}

interface GithubSearchResponse {
  total_count: number;
  items: GithubRepo[];
}

async function fetchGithubSkills(): Promise<SkillItem[]> {
  const items: SkillItem[] = [];
  const perPage = 100;

  for (let page = 1; page <= 3; page++) {
    const url = `https://api.github.com/search/repositories?q=topic:claude-skill&sort=stars&per_page=${perPage}&page=${page}`;
    const data = await fetchJSON<GithubSearchResponse>(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (!data?.items?.length) break;

    for (const repo of data.items) {
      items.push({
        name: repo.name,
        description: repo.description ?? undefined,
        provider: "github",
        stars: repo.stargazers_count,
        fullName: repo.full_name,
        href: repo.html_url,
      });
    }

    process.stdout.write(`  [github:claude-skill] page ${page} — ${items.length} repos from ${data.total_count} total\n`);

    if (data.items.length < perPage) break;
    await sleep(500);
  }

  // Also fetch skills-sh topic
  for (let page = 1; page <= 1; page++) {
    const url = `https://api.github.com/search/repositories?q=topic:skills-sh&sort=stars&per_page=${perPage}&page=${page}`;
    const data = await fetchJSON<GithubSearchResponse>(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (!data?.items?.length) break;

    for (const repo of data.items) {
      items.push({
        name: repo.name,
        description: repo.description ?? undefined,
        provider: "github",
        stars: repo.stargazers_count,
        fullName: repo.full_name,
        href: repo.html_url,
      });
    }

    process.stdout.write(`  [github:skills-sh] page ${page} — fetched ${data.items.length} repos\n`);
    await sleep(500);
  }

  return items;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Signet Marketplace Indexer ===\n");

  // -- MCP Servers --
  console.log("[1/4] Fetching MCP Official Registry...");
  const mcpRegistry = await fetchMcpRegistry();
  console.log(`  => ${mcpRegistry.length} servers from MCP registry\n`);

  console.log("[2/4] Fetching npm MCP packages (@modelcontextprotocol)...");
  const npmMcp = await fetchNpmPackages("@modelcontextprotocol server", 12, "npm:@mcp");
  console.log(`  => ${npmMcp.length} servers from npm @modelcontextprotocol\n`);

  console.log("[2b] Fetching npm MCP packages (keywords:mcp-server)...");
  const npmMcpKw = await fetchNpmPackages("keywords:mcp-server", 14, "npm:mcp-server-kw");
  console.log(`  => ${npmMcpKw.length} servers from npm keywords:mcp-server\n`);

  const allMcp = dedupeMcp([...mcpRegistry, ...npmMcp, ...npmMcpKw]);
  console.log(`  => ${allMcp.length} MCP servers after dedup\n`);

  // -- Skills --
  console.log("[3/4] Fetching skills from skills.sh...");
  const skillsSh = await fetchSkillsSh();
  console.log(`  => ${skillsSh.length} skills from skills.sh\n`);

  console.log("[4/4] Fetching skill repos from GitHub...");
  const githubSkills = await fetchGithubSkills();
  console.log(`  => ${githubSkills.length} skills from GitHub\n`);

  const allSkills = dedupeSkills([...skillsSh, ...githubSkills]);
  console.log(`  => ${allSkills.length} skills after dedup\n`);

  // -- Write output --
  const output: Listings = {
    generated: new Date().toISOString(),
    skills: allSkills,
    mcp: allMcp,
    stats: {
      skills: allSkills.length,
      mcp: allMcp.length,
    },
  };

  const outDir = join(import.meta.dirname ?? ".", "..", "public", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "listings.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("=== Done ===");
  console.log(`Skills:      ${allSkills.length}`);
  console.log(`MCP Servers: ${allMcp.length}`);
  console.log(`Output:      ${outPath}`);
}

main().catch((err) => {
  console.error("Indexer failed:", err);
  process.exit(1);
});

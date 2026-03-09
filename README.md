# Signet Marketplace

Public marketplace for AI agent skills, MCP servers, and knowledge bases — built for the [Signet](https://signetai.io) agent platform.

## Stack

- **Astro 5** — static site framework
- **Tailwind CSS 4** — CSS-first, no config file needed
- **Vanilla JS** — client-side filtering/search, no heavy framework
- **Cloudflare Pages** — deployment target

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home — hero, featured skills, featured MCP servers |
| `/skills` | Full skills catalog with search/filter/sort |
| `/mcp` | Full MCP server catalog with search/filter/sort |

## Design system

Inherits the Signet dashboard aesthetic: dark background, monospace type, CSS variables (`--sig-*`), monogram icon system. Source of truth lives in `src/styles/global.css`.

## Running locally

```bash
bun install
bun run dev
```

## Building

```bash
bun run build
```

Output goes to `dist/`.

## Deploying to Cloudflare Pages

```bash
bun run deploy
```

Or connect the repo to Cloudflare Pages and set:
- Build command: `bun run build`
- Build output: `dist`

## Data sources

Client-side fetching from:
- **skills.sh** — skills catalog API
- **mcpservers.org** — MCP server registry API

No backend required — fully static at build time, live data fetched in the browser.

## Structure

```
src/
  layouts/     Layout.astro (site shell, nav, footer)
  pages/       index.astro, skills.astro, mcp.astro
  lib/         catalog.ts (fetch + safe DOM utilities)
  styles/      global.css (Signet design tokens)
public/        favicon.svg
```

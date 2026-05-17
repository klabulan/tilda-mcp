# CLAUDE.md — `klabulan/tilda-mcp`

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Fork of `theYahia/tilda-mcp@1.1.1` adding **write-tools** for Tilda via reverse-engineered editor XHR endpoints. Originally created for the `failclub_landing` project (`/home/levko/failclub_landing/`), but works as a standalone MCP server for any Tilda Business-tariff account.

## Architecture

```
Claude Code agent
   │
   │  MCP stdio (or HTTP)
   ▼
src/index.ts            ← server boot, 16 tool registrations
   │
   ├── tools/read/      ← 5 tools, wrappers over Tilda Export API (api.tildacdn.info, read-only)
   │   └── pages.ts     ← inherited from upstream
   │
   ├── tools/write/     ← 7 fork-added tools
   │   ├── createPage.ts          ← ✅ working
   │   ├── setPageSettings.ts     ← ✅ working
   │   ├── deletePage.ts          ← ✅ working
   │   ├── addBlock.ts            ← ✅ working (T396 Zero Block confirmed; other T-codes by analogy)
   │   ├── importZeroBlock.ts     ← ⏳ STUB (Zero Block content endpoints TBD)
   │   ├── editBlock.ts           ← ⏳ STUB
   │   └── publish.ts             ← ✅ working
   │
   ├── tools/helpers/   ← 4 tools
   │   ├── healthCheck.ts            ← ✅ working
   │   ├── loginHeadedBootstrap.ts   ← ✅ working (Playwright headed mode for first login)
   │   ├── resolveCaptchaInteractive.ts  ← ⏳ STUB (Playwright limitation, see fork_spec.md §5.4)
   │   └── dumpTransportLog.ts       ← ✅ working
   │
   ├── transport/
   │   ├── writeTransport.ts   ← interface
   │   ├── factory.ts          ← selects transport via $TILDA_MCP_TRANSPORT (default: xhr)
   │   ├── xhr/                ← PRIMARY transport — direct HTTP to editor endpoints
   │   │   ├── index.ts        ← XhrTransport class with 5/7 write tools impl
   │   │   ├── cookies.ts      ← format Cookie header from Playwright storageState
   │   │   └── signatures/     ← *.template.json — captured editor XHR specs
   │   └── playwright/         ← FALLBACK transport — drives editor UI in browser
   │       ├── index.ts        ← PlaywrightTransport (stubs only — wait for v0.1)
   │       ├── auth.ts         ← storageState bootstrap (headed first login)
   │       ├── selectors.ts    ← TBD selectors for UI-driven flow
   │       ├── antibot.ts      ← fingerprint normalization
   │       └── flows/          ← stubs
   │
   ├── client.ts          ← Tilda Export API HTTP client (read-only, inherited from upstream)
   ├── config.ts          ← env var resolution
   └── logging.ts         ← ring-buffer logger with credential redaction
```

## Transport model

**Tilda Export API** (read, `api.tildacdn.info`) requires PublicKey + SecretKey. Auth model #1.

**Tilda editor XHRs** (write, `tilda.ru`) require a logged-in session cookie. Auth model #2.

The fork supports BOTH:
- Read tools use Export API (`src/client.ts`) — env `TILDA_PUBLIC_KEY` + `TILDA_SECRET_KEY`.
- Write tools use editor XHRs (`src/transport/xhr/`) — session cookie loaded from a Playwright storageState file (default `~/.config/tilda-mcp/state.json`).

To produce the storageState file, call the `login_headed_bootstrap` MCP tool — it opens a headed Chromium window (works via WSLg on WSL2), user logs in once, state persists ~14 days.

`TILDA_MCP_TRANSPORT` env:
- `xhr` (default) — direct HTTP only, no browser. Fast (~500ms / write).
- `playwright` — drive editor UI in headless Chromium (stubs in v0; activate later).
- `auto` — try xhr first, failover to playwright after N consecutive failures.

## Captured endpoints (XHR-RE)

All on `https://tilda.ru/`:

| Tool | Method | Path | Body |
|---|---|---|---|
| `create_page` | POST | `/projects/submit/` | `comm=addnewpagedublicateexample&projectid=N&examplepageid=1231&folderid=&csrf=` |
| `set_page_settings` | POST | `/projects/submit/` | `comm=savepagesettings&pageid=N&title=T&descr=D&alias=A&...(40 SEO fields)` |
| `delete_page` | POST | `/projects/submit/` | `comm=delpage&pageid=N&csrf=` |
| `add_block` | POST | `/page/submit/` | `comm=addnewrecord&pageid=N&tplid=N&with_code=yes` |
| `publish` | POST | `/page/publish/` | `comm=pagepublish&pageid=N&csrf=&returnjson=yes` |

Notes:
- `csrf=` empty is accepted (Tilda validates on cookies, not CSRF token).
- Templates: `examplepageid=1231` = Blank. Other templates: `1232` = AI Template. More TBD.
- T-block codes: `T396` = Zero Block (confirmed). Others (T123, T030, T142, etc.) follow the same `addnewrecord` pattern with appropriate `tplid`.
- Tilda occasionally prepends `<!--tlp-->` to JSON responses — `XhrTransport.post()` strips it.

## TBD (next session — Zero Block content + animations)

Captured so far via `scripts/tilda/explore*.mjs`:
- ✅ Zero Block editor entrypoint: `tp__openZero(recordid)` JS function → opens `https://tilda.ru/zero/?recordid=N&pageid=P`.
- ✅ ZB editor uses `POST /zero/get/` with multipart `comm=getzerocode` to read current ZB JSON.
- ⏳ ZB write endpoint (probably `/zero/submit/` with `comm=savezerocode` or similar) — not yet captured.
- ⏳ Element JSON schema (text/image/shape/button) — not yet captured.
- ⏳ Animation endpoints — not yet captured.
- ⏳ Form submit handlers — not yet captured.

**Rate-limit observation**: Tilda anti-bot triggers Yandex SmartCaptcha after ~20-30 automated operations within 30 minutes. After cooldown (~1-2h) access restores. For long capture sessions, pace operations to 1 per 30+ seconds.

## Commands

```bash
npm install            # uses npm 10+, Node 22+ recommended (Node 18+ supported per upstream)
npm run build          # tsc → dist/
npm test               # vitest run
npm run dev            # tsx src/index.ts (dev mode, stdio)
npm start              # node dist/index.js (production, stdio)
node dist/index.js --http --port 3001   # HTTP mode (StreamableHTTPServerTransport)

# Smoke tests (need $TILDA_PUBLIC_KEY + $TILDA_SECRET_KEY + ~/.config/tilda-mcp/state.json)
node scripts/smoke.mjs              # basic: create → add_block → publish
node scripts/smoke2_lifecycle.mjs   # full: create → settings → block → publish → cleanup
node scripts/smoke_10run.mjs        # stability: 10× add_block + publish

# Re-capture session cookie (when state.json expires ~14 days, or anti-bot invalidates)
TILDA_EMAIL=... TILDA_PASSWORD=... node scripts/tilda/explore.mjs
```

## Workflow conventions (mirror failclub_landing)

- Branch: `feature/<scope>` → PR to `main` (don't push to `main` directly).
- Commit messages: scoped — `feat(xhr):`, `chore(playwright):`, `fix(transport):`, etc.
- Each captured XHR endpoint → corresponding `src/transport/xhr/signatures/*.template.json` for self-documentation.
- `scripts/tilda/explore*.mjs` are research scripts — keep them in repo for re-capture sessions when Tilda bumps editor.
- `scripts/tilda/explore-out/` is .gitignored (runtime dumps).
- Sensitive files (`state.json`, `.auth/`, `*.captured.json`, `.env`) are .gitignored.

## Anti-patterns

| Don't | Do |
|---|---|
| Bypass Tilda's UI to call write endpoints on accounts you don't own | This fork is for **owner's own account** automation; doc in README. |
| Hammer Tilda with 50+ ops/min | Pace human-like (jittered 250-1500ms) or hit Yandex SmartCaptcha lockout |
| Commit `state.json` / `*.captured.json` | They contain session cookies / IDs |
| Hardcode `tilda.cc` URLs | Cookies live on `.ru` after geo-redirect; use `tilda.ru` |
| Skip `Accept` header in editor XHR POST | Tilda flags missing Accept as bot → returns HTML error page |
| Add new tool without capturing endpoint signature | Each XHR-RE tool must have `signatures/*.template.json` |

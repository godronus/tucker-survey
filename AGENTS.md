# AGENTS.md

Instructions for AI coding agents (and humans) working on this repo. Read this before changing anything. For first-time setup, follow `quickstart.md`. For architecture and data-model detail, see `README.md`.

## What this is

An anonymous-by-default survey for Gcore's ISP / peering / embedded-cache partner program.

- **Frontend and API:** one **Gcore FastEdge HTTP app**, written in TypeScript and compiled to wasm. It serves the survey UI, a submission API and a results dashboard (`/admin`).
- **Storage:** **Supabase Postgres**. The app only calls database functions over PostgREST, using the publishable key.
- **Frontend code:** plain HTML, CSS and ES modules. No framework, no bundler, no external CDNs.

```
shared/survey.js      THE survey: questions, options, branching, validation, relational rows
shared/report.js      CSV flattening + aggregation (admin page + export script)
src/index.ts          FastEdge entry: routing, static files, form tokens, rate limit, submit, admin API
src/supabase.ts       PostgREST RPC client (only file that talks to the database)
public/               index.html + app.js (survey), admin.html + admin.js (results), styles.css
supabase/migrations/  SQL, applied in order in the Supabase SQL Editor (append-only)
supabase/reader-role.sql  optional read-only DB role for Grafana/Metabase
scripts/              setup, check, deploy, export, dev (+ env.mjs shared helper)
tests/app.test.mjs    end-to-end tests: built wasm -> real Supabase project; cleans up after itself
```

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | Create `.env` (asks for the Supabase URL and publishable key; generates secrets; prints the admin-token SQL) |
| `npm run check` | Read-only check of `.env` and the Supabase project (schema, admin token, functions) |
| `npm run build` | `tsc` type check, then `fastedge-build` → `dist/tucker-survey.wasm` |
| `npm test` | Build, then 13 end-to-end tests against the Supabase project in `.env`. Deletes what it creates |
| `npm run dev` | Build, then serve locally on http://localhost:8080 (writes **real rows** to Supabase) |
| `npm run deploy` | Build, then create or update the FastEdge app, secret and settings from `.env` (needs `GCORE_API_KEY`) |
| `npm run export` | Dump all responses to `exports/<timestamp>/` (JSON + CSV) |

After changing code, the minimum you must run is `npm run build && npm test`. If you touched the UI, also run `npm run dev` and click through the flow in a browser. Then delete your test rows (see "Test data").

## Hard rules

### Survey definition (`shared/survey.js`)

1. **It's the single source of truth.** The browser renders from it, the server validates against it (`validateAnswers`), the database rows come from it (`relationalRows`), and reports read it. Never duplicate question or option lists anywhere else.
2. **Option values are permanent IDs.** Stored data and analysis depend on them.
   - Adding options or questions is fine.
   - **Renaming or removing** a value requires bumping `SURVEY.version`, and noting it in the PR.
   - Changing a **label** (the second array element) is always safe.
3. **Survey edits need no database migration.** The relational tables are generic (`question`, `option`, `item`). Don't add per-question columns.
4. **Branching (`showIf`) is enforced on the server.** `validateAnswers` drops answers to hidden questions. Keep that behaviour, and don't add client-only rules.
5. **Keep prioritisation.** Feature lists are "top N" (`type: 'rank'`) or capped (`max`). Don't turn them into unbounded tick-all lists.

### Privacy

6. **Anonymous by default.**
   - Don't store or log client IP, ASN from geo lookups, user agents, or anything else that identifies a respondent's network. Only `country` is kept.
   - Contact details exist only when the respondent opts in, and they live only in `survey.contacts`.
7. **Never `console.log` answers, contact details, tokens or keys.** FastEdge app logs are visible to anyone with portal access.

### Database (Supabase)

8. **Tables live in the `survey` schema, which is not exposed over the Data API.** Never add `survey` to the exposed schemas, and never create tables in `public`.
9. **The app uses only the publishable (anon) key.** It never uses `sb_secret_…` or `service_role` keys, in code, `.env`, docs or the FastEdge config.
10. **New database access means a new function, in a new migration file** (`supabase/migrations/0003_<name>.sql`, and so on). Follow the existing pattern:
    - `security definer` and `set search_path = ''`
    - schema-qualified names (`survey.responses`)
    - `revoke execute … from public; grant execute … to anon;`
    - admin-only functions call `perform survey.check_admin(p_token);` first
11. **Migrations are append-only.** Never edit a file that has been applied to a project; write a new one. Tell the user which new SQL file to run in the SQL Editor.
12. **Idempotency:** `submit_response` ignores a response ID it has already stored (`on conflict do nothing`). The browser retries with the same ID, so don't change this to an upsert.

### FastEdge runtime (the app is not Node.js)

13. **No Node APIs** (`fs`, `path`, `process`, `Buffer`, `node:crypto`) in `src/` or in shared code imported by `src/`. Use web APIs: `fetch`, `crypto.subtle`, `TextEncoder`.
14. **Static files are embedded at build time** with `readFileSync` from `fastedge::fs`, at module top level only. **A new file in `public/` must also be added to the `embed(...)` list in `src/index.ts`**, or it will 404.
15. **Watch the time budget.** Each request has a small execution-time budget (50 ms on Basic, 200 ms on Pro), and the Supabase round trip counts against it. Keep **one** database call per request. Don't add sequential outbound `fetch` calls.
16. **Logging goes through `console.log` only** (stdout). Log short, non-sensitive facts ("stored response <id>", error codes).
17. **Config comes from `getEnv` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) and `getSecret` (`FORM_SECRET`)**, read at request time and never at module top level. If you add a setting, update `.env.example`, `scripts/setup.mjs`, `scripts/deploy.mjs` and `quickstart.md`.

### Frontend

18. **The CSP is `default-src 'self'`.** No external scripts, fonts, analytics or CDNs; everything is served by the app. No inline `<script>` or `on*=` attributes.
19. **Accessibility is a requirement.** Use native inputs inside `fieldset`/`legend`, link errors with `aria-describedby`, keep touch targets at least 44 px, keep keyboard alternatives for ranking (the ↑/↓ buttons), and make sure there's no horizontal scroll at 390 px wide.
20. **Autosave:** answers live in `localStorage` under `tucker-survey:v<version>` until the server confirms. Never clear them before a 2xx.
21. **Styling:** colours are CSS variables in `:root` in `public/styles.css`. Reuse them.

### Secrets and hygiene

22. **Never commit `.env`**, and never print its values into chat, logs or docs. To show someone a value, tell them which `.env` line to read.
23. **Don't commit account-specific IDs or URLs** (FastEdge app IDs, `*.fastedge.cdn.gc.onl` URLs, Supabase project refs). If a tool inserts a `/* FastEdge Deployment Magic Comments */` block into `src/index.ts`, remove it before committing. `npm run deploy` finds the app by name, so it doesn't need them.

## Test data

`npm test` deletes every response it creates. Rows created with `npm run dev` or on the live URL are real; remove them with SQL in the Supabase SQL Editor:

```sql
delete from survey.responses where id = '<id>';   -- one response (cascades to all child rows)
truncate survey.responses cascade;                -- everything (only before launch!)
```

Never run `truncate` once the survey is live unless the user explicitly asks.

## Recipes

**Add or change a question**
1. Edit `shared/survey.js`. Follow the type table in the header comment.
2. If it adds a branch, use `showIf: { q, in: [...] }` and check `validateAnswers` drops it when hidden.
3. Add or adjust a case in `tests/app.test.mjs` if the behaviour is new.
4. Run `npm test`, then `npm run dev` and check it in the browser. The admin page picks it up automatically.

**Add a new static asset**
Put it in `public/` and add an `embed('/path', './public/file', 'content/type')` line in `src/index.ts`.

**Add an admin data view** (e.g. a pre-aggregated SQL report)
Add a function in a new migration file (rule 10), call it from `src/index.ts` behind `/admin/api/...` through `rpc()`, and give the user the SQL file to run.

**Deploy a change**
Run `npm test`, then `GCORE_API_KEY=… npm run deploy`. Use `APP_NAME=tucker-survey-staging` for a staging copy.

## Claude Code plugin (optional)

If the `gcore-fastedge` Claude Code plugin is installed, `/gcore-fastedge:*` skills (docs, test, debug, manage) are available and useful for FastEdge questions. Deploy with `npm run deploy` rather than `/gcore-fastedge:deploy`: the script also creates the secret and settings from `.env`, and it doesn't insert magic comments (rule 23).

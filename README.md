# tucker-survey

Survey for Gcore's ISP / peering / embedded-cache partner program: what operators want from a self-service peering and cache-partner portal. It runs as a single **Gcore FastEdge HTTP app** (TypeScript) and stores responses in **Supabase Postgres**. There is no SaaS survey tool.

- **Setting it up for the first time?** Follow [`quickstart.md`](quickstart.md), a step-by-step guide from zero to a live survey.
- **Changing it, or working with an AI agent?** Read [`AGENTS.md`](AGENTS.md) first. It lists the rules that keep data comparable, private and working on FastEdge.

This README is the reference: architecture, data model, analysis.

## Architecture

```
browser ──HTTPS──▶ FastEdge HTTP app (dist/tucker-survey.wasm)
                    ├─ GET  /                  survey UI (static, embedded in the wasm)
                    ├─ GET  /api/token         signed form token (anti-bot)
                    ├─ POST /api/submit        validate → rpc submit_response
                    ├─ GET  /admin             results dashboard (static)
                    └─ GET  /admin/api/entries → rpc admin_responses / admin_contacts
                              │
                              └──HTTPS──▶ Supabase  /rest/v1/rpc/*   (publishable key)
                                            └─ Postgres schema "survey" (not exposed over REST)
```

- **The app never touches tables.** Tables live in a `survey` schema that isn't exposed over REST. The app calls three `SECURITY DEFINER` functions using the publishable key:
  - `submit_response`: one transaction, idempotent on the response id.
  - `admin_responses` and `admin_contacts`: these check the admin token inside the database, so the app holds no read credentials.
- **Two forms of every response:**
  - `survey.responses.answers` is the complete JSON record the app validated.
  - `choices`, `ratings` and `texts` hold the same answers as rows for SQL, written in the same transaction.
- **One definition drives everything.** `shared/survey.js` defines the survey once. The browser renders from it, the app validates against it, the relational rows are built from it, and so are the reports. Branching (`showIf`) is enforced on the server as well.
- **The frontend is plain JS with no framework or build step.** It's embedded into the wasm with `fastedge::fs.readFileSync`. `fastedge::cache` is used only for per-IP rate limiting.

### Plan and region

Each submission is one HTTPS round trip from the FastEdge PoP to your Supabase region.
- **Plan:** use the FastEdge **Pro** plan (200 ms). With Basic's 50 ms, respondents far from the database would see submissions fail. The browser keeps their answers when that happens, but nothing is saved.
- **Region:** put the Supabase project in the region where most respondents are.

## Project layout

```
shared/survey.js                  survey definition, validation, relational rows
shared/report.js                  CSV flattening + aggregation (admin page, export)
src/index.ts                      FastEdge app: routing, tokens, rate limit, submit, admin API
src/supabase.ts                   PostgREST RPC client
public/                           index.html, app.js (survey), admin.html, admin.js, styles.css
supabase/migrations/0001_survey.sql         schema, views, API functions, grants
supabase/migrations/0002_admin_delete.sql   admin_delete_responses (spam, GDPR, test cleanup)
supabase/reader-role.sql          optional read-only role for Grafana/Metabase
scripts/setup.mjs                 creates .env, generates secrets, prints admin-token SQL
scripts/check.mjs                 verifies .env + Supabase wiring (read-only)
scripts/deploy.mjs                creates/updates the FastEdge app, secret and settings from .env
scripts/dev.mjs                   local server (fastedge-run on :8080) against the cloud project
scripts/export.mjs                export to JSON/CSV
scripts/env.mjs                   shared .env loader + Supabase RPC helper
tests/app.test.mjs                end-to-end tests: local wasm → cloud Supabase (cleans up after itself)
```

## Setup, local development and deployment

Everything is in [`quickstart.md`](quickstart.md). In short:

```bash
npm install
npm run setup                          # .env + secrets; run the printed SQL in Supabase
npm run check                          # verifies the wiring
npm test                               # 14 end-to-end tests against your Supabase project
npm run dev                            # http://localhost:8080 (writes real rows)
GCORE_API_KEY=... npm run deploy       # create/update the FastEdge app from .env
```

The schema is installed by running `supabase/migrations/*.sql` in order, in the Supabase SQL Editor (or with `supabase db push`, or with `psql -f`). The direct `db.<ref>.supabase.co` host is IPv6-only, so from IPv4 networks use the **Session pooler** connection string.

## Environment variables and secrets

`npm run deploy` sets these on the FastEdge app from `.env`. Anything changed by hand in the portal is overwritten on the next deploy.

| Name | Kind | Purpose |
|---|---|---|
| `SUPABASE_URL` | env var | `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | env var | Publishable (or legacy anon) key. It can only call the three functions |
| `FORM_SECRET` | secret | HMAC key for form tokens. Generated by `npm run setup`; `npm run deploy` stores it as the FastEdge secret `<app-name>-form-secret` |

The admin token isn't configured on the app. It's checked against the hash in `survey.settings`. `.env` also holds `ADMIN_TOKEN`, but only the tests and `npm run export` read it.

## Data model (schema `survey`)

| Table | One row per | Notes |
|---|---|---|
| `responses` | submission | `answers` jsonb (full record), plus `role`, `network_type`, `operates_cache`, `country`, `duration_sec`, `survey_version` |
| `choices` | selected option (single, multi, rank) | `rank` 1..N and `points` (N..1) for top-N questions |
| `ratings` | routing-matrix item | `score` 0 = not useful … 3 = extremely important |
| `texts` | free-text answer | Includes "Other" fields (`question = '<id>Other'`). Full-text indexed |
| `contacts` | respondent who opted into follow-up | Personal data kept apart. `contacted_at` and `notes` are for the survey team |
| `settings` | — | sha256 of the admin token |

Views `v_choices` and `v_ratings` join the segment columns onto each row, which makes them ready for dashboards.

- **Anonymity:** no IP or connection ASN is stored. An operator's ASN would identify them. Only the country is kept.
- **`duration_sec`:** measured by the server, from when the form token was issued.
- **Deletion:** `on delete cascade` means deleting a `responses` row removes all its data, contact details included. Use it for GDPR requests.
- **Changing the survey:**
  - Option values are stable identifiers. You can add new options freely.
  - If you rename or remove one, bump `SURVEY.version`.
  - No schema change is needed for survey edits, because the relational rows are generic (`question`, `option`).

## Analysing results

**`/admin` dashboard**
- **Charts:**
  - A chart for every question.
  - Top-N questions are ranked by rank points and show % who picked each item.
  - The routing matrix is shown as stacked bars sorted by mean importance.
- **Filters:** role, network type and cache-operator status.
- **Downloads:** JSON and CSV.

**SQL** (Supabase SQL editor, or `psql`):

```sql
-- Top portal priorities, by rank points, split by network type
select network_type, option, count(*) picked, sum(points) pts
from survey.v_choices where question = 'portalTop5'
group by 1, 2 order by 1, pts desc;

-- What do people who rank capacity forecasting in their top 3 want alerts on?
select a.option, count(*) from survey.choices p
join survey.choices a on a.response_id = p.response_id and a.question = 'alertsTop5'
where p.question = 'portalTop5' and p.option = 'capacity_forecast' and p.rank <= 3
group by 1 order by 2 desc;

-- Routing-transparency importance, cache operators vs everyone else
select item, round(avg(score) filter (where operates_cache = 'yes'), 2) cache_ops,
             round(avg(score) filter (where operates_cache <> 'yes'), 2) others
from survey.v_ratings group by 1 order by 2 desc nulls last;

-- Search every free-text answer
select question, body from survey.texts
where to_tsvector('english', body) @@ websearch_to_tsquery('english', 'rpki OR irr');

-- Follow-up list with each person's top pick
select c.email, c.organization, r.network_type, p.option as top_priority
from survey.contacts c join survey.responses r on r.id = c.response_id
left join survey.choices p on p.response_id = c.response_id and p.question = 'portalTop5' and p.rank = 1
where c.contacted_at is null;
```

**Grafana or Metabase:** run `supabase/reader-role.sql` to create a read-only `survey_reader` login. It can read everything except `contacts`. Then add a Postgres datasource that uses the pooler connection string.

**Files:** `npm run export` (reads `.env`) writes `responses.json`, `responses.csv`, `picks.csv` (long format) and `contacts.csv`.

## Abuse protection (no CAPTCHA)

- **Signed form token:** `/api/token` returns `HMAC(FORM_SECRET, issued-at)`.
  - A submission needs a valid token that is at least 15 s old and at most 7 days old.
  - If someone submits sooner, the browser waits out the remaining seconds and retries automatically.
- **Honeypot field:** the form has a `website` field that people never see. If it's filled in, the app replies with success but stores nothing.
- **Rate limit:** one submission per client IP per 5-minute window, per PoP, using `fastedge::cache` (`claimSubmitSlot` in `src/index.ts`).
  - The claim is atomic (`incr`), so a parallel burst from one IP stores one response. The keys are per window, so a cache fault can't lock an IP out permanently. The trade-off is that two submissions can land either side of a window boundary.
  - A form that fails validation doesn't use up the window. A retry of the same response is let through (the database ignores duplicates). A failed database write releases the window.
  - The IP comes from `event.client.address`, which the PoP sets. Sending `x-real-ip` or `x-forwarded-for` doesn't bypass it (checked on the edge). The IP is kept only as an HMAC tag in a 5-minute cache entry.
  - The browser shows how long to wait and retries by itself if it's under 30 s. Colleagues behind one office NAT have to take turns, which is acceptable for this audience; change `SUBMIT_WINDOW_S` if not.
  - It fails open: a cache error never loses a genuine response.
  - **This isn't DDoS protection.** Every request still runs the app. For volumetric attacks, put the app behind a Gcore CDN resource with WAAP / rate-limiting rules.
- **Validation:**
  - In the app, every answer is checked against `shared/survey.js`, payloads are capped at 100 KB and unknown fields are dropped.
  - In the database, check constraints and primary keys back that up.

## Accessibility and resilience

- **Autosave:**
  - Answers are saved to `localStorage` on every change.
  - Reloading resumes on the same section.
  - The saved copy is only cleared after the database confirms the write.
  - If the database is unreachable (503), the answers stay in the browser.
- **Controls:**
  - Native form controls with fieldsets and legends.
  - Errors are linked to their fields with `aria-describedby`.
  - Keyboard users can reorder rankings with ↑/↓ buttons.
  - Focus is visible, touch targets are at least 44 px, and the layout works on phones.

## Limitations

- **Admin access is one shared token.** For per-person access, use Supabase dashboard accounts or the reader role.
- **The admin page loads every response into the browser.** That's fine for a few thousand. Beyond that, use SQL.
- **A retry doesn't update an earlier submission.** If an earlier attempt already saved the response, a later edit sent under the same id is ignored.

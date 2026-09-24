# Quickstart: from zero to a live survey

This guide takes you from a fresh clone to a deployed survey. You create two things of your own:

1. **A Supabase project**, which stores the responses.
2. **A Gcore FastEdge app**, which serves the survey. It's created for you by `npm run deploy`.

It takes about 20 minutes. Every step says exactly what to click, what to copy and what you should see. If something doesn't match, see [Troubleshooting](#troubleshooting).

---

## What you need first

| Need | How to check / get it |
|---|---|
| **Node.js 20.12 or newer** | `node --version`. Install from https://nodejs.org if older |
| **git** | `git --version` |
| **A Supabase account** | Sign up at https://supabase.com. The free plan is fine |
| **A Gcore account with FastEdge** | Sign in at https://portal.gcore.com. You should see **FastEdge** in the left menu |

No Docker or database install is needed. Everything runs against your cloud Supabase project.

---

## Step 1: Get the code

```bash
git clone <this-repo-url> tucker-survey
cd tucker-survey
npm install
```

✅ You should see `added N packages` and no errors. Warnings about `npm audit` are fine.

---

## Step 2: Create the Supabase project

1. Go to https://supabase.com/dashboard and click **New project**.
2. Fill in:
   - **Organization:** yours.
   - **Project name:** `tucker-survey`, or anything you like.
   - **Database password:** click *Generate a password* and save it in your password manager. The survey never uses it, but you'll want it for direct database access later.
   - **Region:** the one **closest to most respondents**, for example *Central EU (Frankfurt)* for a mostly-European audience. Every submission makes one round trip to this region.
   - **Plan:** Free is fine to start.
3. Click **Create new project** and wait until the dashboard says the project is ready (about 1–2 minutes).
4. Note your **project ref**, the random string in the browser address bar: `https://supabase.com/dashboard/project/<project-ref>`. Your **Project URL** is `https://<project-ref>.supabase.co`.

---

## Step 3: Install the database schema

This creates the tables and the three database functions the app calls. You run two SQL files, **in order**.

1. In the Supabase dashboard, open **SQL Editor** in the left menu and click **New query** (or **+**).
2. Open `supabase/migrations/0001_survey.sql` from this repo in any text editor. Copy **the whole file**, paste it into the SQL Editor and click **Run**.
   ✅ You should see: *Success. No rows returned*.
3. Click **New query** again. Paste the whole of `supabase/migrations/0002_admin_delete.sql` and click **Run**.
   ✅ Again: *Success. No rows returned*.

Supabase may show warnings such as *"RLS enabled, no policies"* for the `survey` tables. That's intended: nobody can touch those tables directly, only through the functions.

⚠️ Don't add `survey` to *Project Settings → Data API → Exposed schemas*. Keeping it unexposed is what keeps the data private.

---

## Step 4: Wire your credentials into the project

1. **Copy the publishable key.** In the Supabase dashboard, go to **Project Settings → API Keys**. Copy the **publishable** key, which starts with `sb_publishable_`.
   - This key is designed to be public. It can only call the survey's three functions.
   - ⚠️ Never use a **secret** key (`sb_secret_…`) or a legacy `service_role` key. They bypass all protection.
   - Older projects may only show *legacy* keys. The legacy **anon** key (a long string starting with `eyJ`) also works.
2. **Run the setup script** in the repo folder:
   ```bash
   npm run setup
   ```
   Paste your **Project URL** (`https://<project-ref>.supabase.co`) and the **publishable key** when asked. The script:
   - writes `.env`, which is gitignored; never commit it.
   - generates `FORM_SECRET`, the anti-bot signing key.
   - generates `ADMIN_TOKEN`, the password for the results dashboard.
   - prints three lines of SQL.
3. **Register the admin password.** Back in the Supabase SQL Editor, open a **New query**, paste the three lines `npm run setup` printed, and click **Run**. They look like this:
   ```sql
   delete from survey.settings;
   insert into survey.settings (admin_token_sha256)
   values ('<64 hex characters>');
   ```
   This stores only a hash of the admin token, never the token itself.
4. **Check everything is connected:**
   ```bash
   npm run check
   ```
   ✅ Every line should show ✓ and end with **All good**. If a line shows ✗, it tells you exactly what to fix.

> Your admin password is the `ADMIN_TOKEN=` line in `.env`. Keep it in a password manager and share it only with people who should see responses.

---

## Step 5: Try it locally

```bash
npm test        # builds the app and runs 14 end-to-end tests against your Supabase project
npm run dev     # starts the survey at http://localhost:8080
```

- `npm test` should finish with **`14/14 passed; cleaned up N test responses`**. It deletes everything it creates.
- **Open http://localhost:8080** and click through the survey:
  - The embedded-cache questions only appear if you answer **Yes** (or *evaluating*) to "Do you currently operate embedded caches…".
  - Reloading the page keeps your answers.
  - Submitting shows the thank-you page.
- **Open http://localhost:8080/admin**, enter your `ADMIN_TOKEN`, and your test response should appear in the charts.
- Stop the server with **Ctrl+C**.

Your local test responses are real rows in Supabase. You'll clear them before launch (step 7).

---

## Step 6: Deploy to Gcore FastEdge

1. **Create a Gcore API token:**
   1. In https://portal.gcore.com, open your **profile menu** (top right) and choose **API tokens**, then **Create token**.
   2. Give it a name (e.g. `tucker-survey-deploy`), an expiry, and a role that can manage **FastEdge** apps and secrets.
   3. Copy the token. It's shown only once.
2. **Deploy:**
   ```bash
   export GCORE_API_KEY='<your Gcore API token>'
   npm run deploy
   ```
   The script builds the app, uploads it, and creates the FastEdge secret, the app and its settings, all from your `.env`. Re-running it later updates the same app.

   ✅ It ends with:
   ```
   Live: https://tucker-survey-XXXXXXX.fastedge.cdn.gc.onl/
   Admin: https://tucker-survey-XXXXXXX.fastedge.cdn.gc.onl/admin
   ```
3. **Smoke test:** open the **Live** URL and submit a test response, then open **Admin** and check it's there.

**Options:**
- **Different app name:** app names must be unique on your Gcore account. If `tucker-survey` is taken, or you want a second copy (e.g. staging), run `APP_NAME=tucker-survey-staging npm run deploy`.
- **Plan and timeout:** every submission waits for one round trip to Supabase. If submissions fail with **HTTP 532** (timeout) from some locations, ask Gcore to move the app to a plan with a higher execution-time limit (Pro: 200 ms), or move Supabase closer to respondents.

---

## Step 7: Before you send the link to anyone

1. **Delete all test data.** In the Supabase SQL Editor, run:
   ```sql
   truncate survey.responses cascade;
   ```
   This clears every response, answer row and contact detail. The schema and your admin password stay.
2. **Check the admin password is private.** If `ADMIN_TOKEN` was ever pasted into a chat, ticket or AI assistant, make a new one:
   ```bash
   npm run setup -- --rotate-admin-token
   ```
   Then run the printed SQL in the SQL Editor. No redeploy is needed, because the password lives in the database.
3. **Optional custom domain:** create a Gcore CDN resource with the FastEdge app as its origin. See Gcore's docs on *FastEdge HTTP apps as CDN origins*.
4. **Share the Live URL.**

---

## Everyday tasks

| Task | How |
|---|---|
| **See results** | `<Live URL>/admin`: charts, filters, CSV/JSON downloads |
| **Query results in SQL** | Supabase SQL Editor. Examples are in the README under *Analysing results* |
| **Export everything to files** | `npm run export` writes `exports/<timestamp>/` |
| **Delete one response** (spam, GDPR request) | `delete from survey.responses where id = '<id>';` (removes its contact details too) |
| **Change questions or wording** | Edit `shared/survey.js`, run `npm test`, then `npm run deploy`. See `AGENTS.md` for the rules |
| **Grafana / Metabase dashboards** | Run `supabase/reader-role.sql` (change the password first) and connect with the pooler connection string |
| **Change the admin password** | `npm run setup -- --rotate-admin-token`, then run the printed SQL |

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm run check`: *Supabase rejected the publishable key* | Wrong or truncated key. Copy the **publishable** key again (Project Settings → API Keys), put it in `.env` (`FASTEDGE_VAR_ENV_SUPABASE_PUBLISHABLE_KEY=`), and rerun `npm run check` |
| `npm run check`: *survey functions not found* | Step 3 didn't run, or ran on a different project. Run `0001_survey.sql` in the SQL Editor of **this** project |
| `npm run check`: *admin token not registered* | Run the SQL that `npm run check` prints, in the SQL Editor |
| `npm run check`: *admin_delete_responses not found* | Run `0002_admin_delete.sql` in the SQL Editor |
| `npm run check`: *cannot reach …supabase.co* | Typo in the URL, or the project is **paused** (free projects pause after a week of inactivity; click *Restore* in the dashboard) |
| SQL Editor: *relation "survey.responses" already exists* | `0001` was already applied. That's fine; carry on with `0002` |
| `npm run deploy`: *Gcore API rejected the key* | The token is wrong, expired, or lacks FastEdge permissions. Create a new one (step 6) |
| `npm run deploy`: *app update failed … name* | The name is taken by an app you can't update. Use `APP_NAME=<other-name> npm run deploy` |
| Survey says *"We couldn't save your response"* | Supabase is unreachable or paused, or the app is misconfigured. Run `npm run check`, then `npm run deploy` to push the config again. Respondents' answers stay saved in their browser, so they can retry |
| Survey says *"Someone on your network submitted a response in the last few minutes"* | Working as intended: one submission per IP per 5 minutes. Answers stay in the browser; submit again after the time shown. Locally (`npm run dev`) every submission shares one IP, so wait 5 minutes between test submissions |
| Live URL returns **532** | Timeout. Supabase is too far from that PoP for the app's plan. See *Plan and timeout* in step 6 |
| Live URL returns **530/531** | Bad deploy. Rerun `npm test`, then `npm run deploy` |
| `/admin` rejects the password | The `ADMIN_TOKEN` in your `.env` doesn't match the hash in Supabase. Run `npm run check` and follow its SQL |

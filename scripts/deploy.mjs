#!/usr/bin/env node
// Deploys dist/tucker-survey.wasm to Gcore FastEdge. Safe to re-run: it creates
// the app and its secret the first time and updates them after that.
//
//   GCORE_API_KEY=... npm run deploy          (npm runs the build first)
//
// Optional: APP_NAME (default tucker-survey), GCORE_API_BASE (default https://api.gcore.com)
//
// The app's configuration comes entirely from .env. Anything changed by hand in
// the Gcore portal (env vars, secrets) is overwritten by the next deploy.
import { readFileSync } from 'node:fs';
import { loadEnv } from './env.mjs';

const API = (process.env.GCORE_API_BASE || 'https://api.gcore.com').replace(/\/$/, '');
const KEY = process.env.GCORE_API_KEY;
const APP_NAME = process.env.APP_NAME || 'tucker-survey';
const SECRET_NAME = `${APP_NAME}-form-secret`;
const WASM = 'dist/tucker-survey.wasm';

const env = loadEnv();
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
if (!KEY) die('Set GCORE_API_KEY (Gcore portal -> Profile -> API tokens). See quickstart.md, step 6.');
if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(APP_NAME)) die(`APP_NAME "${APP_NAME}" must be lowercase letters, digits and hyphens.`);
if (!env.supabaseUrl || !env.publishableKey || !env.formSecret) die('.env is incomplete. Run `npm run setup` and `npm run check` first.');

async function api(method, path, body, headers = { 'content-type': 'application/json' }) {
  const res = await fetch(`${API}/fastedge/v1${path}`, {
    method,
    headers: { authorization: `APIKey ${KEY}`, ...headers },
    body: body === undefined ? undefined : headers['content-type'] === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) die(`Gcore API rejected the key (${res.status}). Check GCORE_API_KEY.`);
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

console.log(`\nDeploying "${APP_NAME}" via ${API}\n`);

// 1. Binary
const bin = await api('POST', '/binaries/raw', readFileSync(WASM), { 'content-type': 'application/octet-stream' });
if (bin.status >= 300) die(`binary upload failed: ${bin.status} ${JSON.stringify(bin.data)}`);
console.log(`  ✓ uploaded binary ${bin.data.id}`);

// 2. Secret (FORM_SECRET), kept in sync with .env
const found = await api('GET', `/secrets?secret_name=${encodeURIComponent(SECRET_NAME)}`);
const existingSecret = found.data?.secrets?.find((s) => s.name === SECRET_NAME);
const secretBody = { name: SECRET_NAME, comment: `${APP_NAME}: FORM_SECRET (anti-bot form token key)`, secret_slots: [{ slot: 0, value: env.formSecret }] };
const sec = existingSecret
  ? await api('PUT', `/secrets/${existingSecret.id}`, secretBody)
  : await api('POST', '/secrets', secretBody);
if (sec.status >= 300) die(`secret ${existingSecret ? 'update' : 'create'} failed: ${sec.status} ${JSON.stringify(sec.data)}`);
const secretId = existingSecret?.id ?? sec.data.id;
console.log(`  ✓ ${existingSecret ? 'updated' : 'created'} secret ${SECRET_NAME} (${secretId})`);

// 3. App
const list = await api('GET', `/apps?name=${encodeURIComponent(APP_NAME)}&limit=200`);
const existing = list.status === 200 ? list.data.apps.find((a) => a.name === APP_NAME) : null;
if (existing && existing.api_type !== 'wasi-http') die(`an app named "${APP_NAME}" exists but is ${existing.api_type}, not an HTTP app. Pick another APP_NAME.`);
const appBody = {
  name: APP_NAME,
  binary: bin.data.id,
  status: 1,
  comment: 'Gcore peering / embedded-cache partner survey (Supabase-backed)',
  env: { SUPABASE_URL: env.supabaseUrl, SUPABASE_PUBLISHABLE_KEY: env.publishableKey },
  secrets: { FORM_SECRET: { id: secretId } },
};
const app = existing
  ? await api('PUT', `/apps/${existing.id}`, appBody)
  : await api('POST', '/apps', appBody);
if (app.status >= 300) die(`app ${existing ? 'update' : 'create'} failed: ${app.status} ${JSON.stringify(app.data)}`);
const url = app.data.url || existing?.url;
console.log(`  ✓ ${existing ? 'updated' : 'created'} app ${APP_NAME} (id ${app.data.id ?? existing.id}, plan ${app.data.plan ?? '?'})`);

// 4. Verify
let status = 0;
for (let i = 0; i < 10 && status !== 200; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  status = await fetch(`${url.replace(/\/$/, '')}/api/token`).then((r) => r.status, () => 0);
}
console.log(status === 200
  ? `\nLive: ${url}\nAdmin: ${url.replace(/\/$/, '')}/admin  (password: ADMIN_TOKEN in .env)\n`
  : `\n⚠ Deployed, but ${url} did not answer 200 yet (last status ${status}). Wait a minute and open it; see quickstart.md, troubleshooting.\n`);

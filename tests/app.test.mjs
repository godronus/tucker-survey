// End-to-end tests: the built wasm under fastedge-run, writing to the cloud
// Supabase project configured in .env. Every response the suite creates is
// deleted again at the end (admin_delete_responses).
//   npm test        (needs .env with SUPABASE_*, FORM_SECRET and ADMIN_TOKEN)
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineTestSuite, runTestSuite, runHttpRequest,
  assertHttpStatus, assertHttpJson, assertHttpContentType, assertHttpBodyContains,
} from '@gcoredev/fastedge-test/test';
import { createRunner } from '@gcoredev/fastedge-test';

if (!existsSync('.env')) {
  console.error('Missing .env. Copy .env.example to .env and fill in the values.');
  process.exit(1);
}
process.loadEnvFile('.env');
const SUPABASE_URL = process.env.FASTEDGE_VAR_ENV_SUPABASE_URL;
const KEY = process.env.FASTEDGE_VAR_ENV_SUPABASE_PUBLISHABLE_KEY;
const FORM_SECRET = process.env.FASTEDGE_VAR_SECRET_FORM_SECRET;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!SUPABASE_URL || !KEY || !FORM_SECRET || !ADMIN_TOKEN) {
  console.error('.env must set FASTEDGE_VAR_ENV_SUPABASE_URL, FASTEDGE_VAR_ENV_SUPABASE_PUBLISHABLE_KEY, FASTEDGE_VAR_SECRET_FORM_SECRET and ADMIN_TOKEN.');
  process.exit(1);
}

/** Call a database function directly, as the admin. */
async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ p_token: ADMIN_TOKEN, ...args }),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

const created = [];
async function fetchAll(fn) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rpc(fn, { p_offset: offset, p_limit: 1000 });
    items.push(...page.items);
    if (offset + 1000 >= page.count || !page.items.length) return items;
  }
}
const stored = async (id) => (await fetchAll('admin_responses')).find((r) => r.id === id);
const contactOf = async (id) => (await fetchAll('admin_contacts')).find((c) => c.id === id);

const newId = () => { const id = `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`; created.push(id); return id; };
/** A form token issued `age` seconds ago, as if the page had been open that long. */
function token(age = 300) {
  const ts = String(Math.floor(Date.now() / 1000) - age);
  return `${ts}.${createHmac('sha256', FORM_SECRET).update(ts).digest('hex')}`;
}

const BASE = { role: 'peering', networkType: 'isp_broadband', portalTop5: ['api', 'rpki', 'bgp_public'], operatesCache: 'no' };

async function post(runner, body) {
  return runHttpRequest(runner, {
    path: '/api/submit', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const suite = defineTestSuite({
  wasmPath: './dist/tucker-survey.wasm',
  runnerConfig: { dotenv: { enabled: true } },
  tests: [
    {
      name: 'serves the survey page and assets',
      async run(runner) {
        const page = await runHttpRequest(runner, { path: '/' });
        assertHttpStatus(page, 200);
        assertHttpContentType(page, 'text/html');
        assertHttpBodyContains(page, '/app.js');
        const def = await runHttpRequest(runner, { path: '/shared/survey.js' });
        assertHttpStatus(def, 200);
        assertHttpBodyContains(def, 'operatesCache');
        assert(String(page.headers['content-security-policy']).includes("default-src 'self'"), 'missing CSP');
      },
    },
    {
      name: 'issues a verifiable form token',
      async run(runner) {
        const res = await runHttpRequest(runner, { path: '/api/token' });
        const { token: t } = assertHttpJson(res);
        const [ts, sig] = t.split('.');
        assert(sig === createHmac('sha256', FORM_SECRET).update(ts).digest('hex'), 'bad signature');
      },
    },
    {
      name: 'rejects a submission made seconds after page load',
      async run(runner) {
        const res = await post(runner, { id: newId(), token: token(2), answers: BASE });
        assertHttpStatus(res, 400);
        const data = assertHttpJson(res);
        assert(data.error === 'token_too_fast' && data.retryAfter > 0 && data.retryAfter <= 15, res.body);
      },
    },
    {
      name: 'rejects a forged token',
      async run(runner) {
        const res = await post(runner, { id: newId(), token: `${Math.floor(Date.now() / 1000) - 300}.${'0'.repeat(64)}`, answers: BASE });
        assertHttpStatus(res, 400);
        assert(assertHttpJson(res).error === 'token_invalid', res.body);
      },
    },
    {
      name: 'stores a valid response and strips cache answers for non-operators',
      async run(runner) {
        const id = newId();
        const res = await post(runner, {
          id, token: token(400),
          answers: {
            ...BASE,
            cacheFriction: ['shipping', 'customs'],      // hidden when operatesCache=no
            cacheTelemetryTop5: ['hit_ratio'],             // whole section hidden
            routingMatrix: { rpki_state: 3, irr_state: 1 },
            buildNext3: ['Looking glass', '', 'Webhooks'],
            unknownField: 'dropped',
          },
        });
        assertHttpStatus(res, 200);
        const rec = await stored(id);
        assert(rec, 'response not written to the database');
        assert(rec.meta.durationSec >= 400, 'durationSec should come from the token');
        assert(!('cacheFriction' in rec.answers) && !('cacheTelemetryTop5' in rec.answers), 'hidden answers leaked');
        assert(!('unknownField' in rec.answers), 'unknown field stored');
        assert(rec.answers.buildNext3.length === 2, 'empty texts not removed');
        assert(rec.answers.routingMatrix.rpki_state === 3, 'matrix lost');
      },
    },
    {
      name: 'keeps cache answers for cache operators',
      async run(runner) {
        const id = newId();
        const res = await post(runner, {
          id, token: token(),
          answers: { ...BASE, operatesCache: 'yes', cacheFriction: ['shipping', 'customs'], cacheTelemetryTop5: ['hit_ratio'] },
        });
        assertHttpStatus(res, 200);
        const rec = await stored(id);
        assert(rec.answers.cacheFriction[0] === 'shipping' && rec.answers.cacheTelemetryTop5[0] === 'hit_ratio', 'cache answers missing');
      },
    },
    {
      name: 'validation errors are returned per field',
      async run(runner) {
        const res = await post(runner, {
          id: newId(), token: token(),
          answers: {
            networkType: 'isp_broadband', operatesCache: 'no',
            portalTop5: ['api', 'rpki', 'irr', 'communities', 'webhooks', 'export'], // 6 > max 5
            portalsUsed: ['none', 'google_ggc'],                                    // exclusive
            asn: 'AS99999999999',
          },
        });
        assertHttpStatus(res, 422);
        const { fields } = assertHttpJson(res);
        for (const f of ['role', 'portalTop5', 'portalsUsed', 'asn']) assert(fields[f], `expected error on ${f}: ${res.body}`);
      },
    },
    {
      name: 'contact details are stored separately from the analysis record',
      async run(runner) {
        const id = newId();
        const res = await post(runner, {
          id, token: token(),
          answers: { ...BASE, followUp: ['call'], contactName: 'Ada', contactEmail: 'ada@example.net', contactAsn: 'AS64500' },
        });
        assertHttpStatus(res, 200);
        const rec = await stored(id);
        const contact = await contactOf(id);
        assert(!('contactEmail' in rec.answers), 'email leaked into analysis record');
        assert(contact?.contactEmail === 'ada@example.net' && contact.contactAsn === '64500' && contact.contactName === 'Ada', 'contact not stored');
      },
    },
    {
      name: 'contact fields are dropped when follow-up is declined',
      async run(runner) {
        const id = newId();
        await post(runner, { id, token: token(), answers: { ...BASE, contactEmail: 'x@example.net' } });
        assert((await stored(id)) && !(await contactOf(id)), 'contact stored without consent');
      },
    },
    {
      name: 'honeypot submissions are accepted but not stored',
      async run(runner) {
        const id = newId();
        const res = await post(runner, { id, token: token(), website: 'http://spam', answers: BASE });
        assertHttpStatus(res, 200);
        assert(!(await stored(id)), 'honeypot submission was stored');
      },
    },
    {
      name: 'resubmitting the same id is an idempotent no-op',
      async run(runner) {
        const id = newId();
        await post(runner, { id, token: token(), answers: BASE });
        const retry = await post(runner, { id, token: token(), answers: { ...BASE, role: 'noc' } });
        assertHttpStatus(retry, 200);
        assert((await stored(id)).answers.role === 'peering', 'retry overwrote the stored response');
      },
    },
    {
      name: 'one submission per IP per 5 minutes; retries and failed forms do not use it up',
      async run(runner) {
        // Tests without an x-real-ip header have no client IP and are not limited.
        const ip = `198.51.100.${1 + randomBytes(1)[0] % 250}`;
        const as = (body) => runHttpRequest(runner, {
          path: '/api/submit', method: 'POST',
          headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(body),
        });
        const bad = await as({ id: newId(), token: token(), answers: { ...BASE, role: undefined } });
        assertHttpStatus(bad, 422); // invalid form: must not consume the window
        const first = newId();
        assertHttpStatus(await as({ id: first, token: token(), answers: BASE }), 200);
        const second = await as({ id: newId(), token: token(), answers: BASE });
        assertHttpStatus(second, 429);
        const { error, retryAfter } = assertHttpJson(second);
        assert(error === 'rate_limited' && retryAfter > 0 && retryAfter <= 300, second.body);
        assertHttpStatus(await as({ id: first, token: token(), answers: BASE }), 200); // retry of the same response
        const other = await runHttpRequest(runner, {
          path: '/api/submit', method: 'POST',
          headers: { 'content-type': 'application/json', 'x-real-ip': `203.0.113.${1 + randomBytes(1)[0] % 250}` },
          body: JSON.stringify({ id: newId(), token: token(), answers: BASE }),
        });
        assertHttpStatus(other, 200);
      },
    },
    {
      name: 'admin API requires the admin token',
      async run(runner) {
        const denied = await runHttpRequest(runner, { path: '/admin/api/entries' });
        assertHttpStatus(denied, 401);
        const wrong = await runHttpRequest(runner, { path: '/admin/api/entries', headers: { authorization: 'Bearer nope' } });
        assertHttpStatus(wrong, 401);
        const ok = await runHttpRequest(runner, { path: '/admin/api/entries?kind=resp', headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
        assertHttpStatus(ok, 200);
        const data = assertHttpJson(ok);
        assert(data.count > 0 && data.items.every((r) => r.id && r.answers && r.meta), `unexpected: ${ok.body.slice(0, 200)}`);
        const contacts = assertHttpJson(await runHttpRequest(runner, { path: '/admin/api/entries?kind=contact', headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }));
        assert(contacts.items.some((c) => c.contactEmail === 'ada@example.net'), 'contacts not returned');
      },
    },
    {
      name: 'storage outage returns 503 so the browser keeps its copy',
      async run(runner) {
        const dir = mkdtempSync(join(tmpdir(), 'tucker-survey-outage-'));
        writeFileSync(join(dir, '.env'), readFileSync('.env', 'utf8').replace(/^FASTEDGE_VAR_ENV_SUPABASE_URL=.*$/m, 'FASTEDGE_VAR_ENV_SUPABASE_URL=http://127.0.0.1:9'));
        const broken = await createRunner('./dist/tucker-survey.wasm', { dotenv: { enabled: true, path: dir } });
        let res;
        try {
          res = await post(broken, { id: newId(), token: token(), answers: BASE });
        } finally {
          await broken.cleanup();
        }
        assertHttpStatus(res, 503);
        assert(assertHttpJson(res).error === 'storage_unavailable', res.body);
      },
    },
  ],
});

const result = await runTestSuite(suite);
for (const t of result.results) {
  console.log(`  ${t.passed ? '✓' : '✗'} ${t.name} (${t.durationMs}ms)${t.error ? `\n      ${t.error}` : ''}`);
}
const deleted = await rpc('admin_delete_responses', { p_ids: created });
console.log(`\n  ${result.passed}/${result.total} passed; cleaned up ${deleted} test responses`);
process.exit(result.failed ? 1 : 0);

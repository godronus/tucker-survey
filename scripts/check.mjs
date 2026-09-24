#!/usr/bin/env node
// Verifies .env and the Supabase project are wired up correctly. Read-only.
//   npm run check
import { createHash } from 'node:crypto';
import { loadEnv, rpc } from './env.mjs';

const env = loadEnv();
let ok = true;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m, fix) => { ok = false; console.log(`  ✗ ${m}\n      → ${fix}`); };

console.log('\nChecking configuration\n');
env.supabaseUrl ? pass(`Supabase URL: ${env.supabaseUrl}`) : fail('Supabase URL missing', 'run `npm run setup`');
env.publishableKey ? pass('publishable key present') : fail('publishable key missing', 'run `npm run setup`');
/^[0-9a-f]{64}$/.test(env.formSecret) ? pass('FORM_SECRET present') : fail('FORM_SECRET missing', 'run `npm run setup`');
if (!env.adminToken) fail('ADMIN_TOKEN missing', 'run `npm run setup`');
else if (env.adminToken.length < 32) { pass('ADMIN_TOKEN present'); console.log('  ⚠ ADMIN_TOKEN is short; anyone who guesses it can read every response. `npm run setup -- --rotate-admin-token` makes a strong one.'); }
else pass('ADMIN_TOKEN present');
if (!ok) process.exit(1);

console.log('\nChecking Supabase\n');
let r;
try {
  r = await rpc(env, 'admin_responses', { p_token: 'wrong-token', p_limit: 1 });
} catch (err) {
  fail(`cannot reach ${env.supabaseUrl} (${err.message})`, 'check the URL in .env and that the project is not paused');
  process.exit(1);
}
if (r.status === 401 && r.body?.message === 'unauthorized') pass('schema installed (0001_survey.sql)');
else {
  if (r.status === 401 || r.status === 403) fail(`Supabase rejected the publishable key (${r.body?.message ?? r.status})`, 'copy the publishable key again from Project Settings -> API Keys into .env');
  else if (r.status === 404) fail('survey functions not found', 'run supabase/migrations/0001_survey.sql in the SQL Editor');
  else fail(`unexpected response ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`, 'see quickstart.md, troubleshooting');
  console.log('\nFix the item above and run `npm run check` again.\n');
  process.exit(1);
}

const a = await rpc(env, 'admin_responses', { p_token: env.adminToken, p_limit: 1 });
if (a.status === 200) pass(`admin token registered (${a.body.count} responses stored)`);
else if (a.status === 401) {
  const hash = createHash('sha256').update(env.adminToken).digest('hex');
  fail('admin token not registered in Supabase', `run in the SQL Editor:\n        delete from survey.settings;\n        insert into survey.settings (admin_token_sha256) values ('${hash}');`);
}

const d = await rpc(env, 'admin_delete_responses', { p_token: env.adminToken, p_ids: [] });
if (d.status === 200) pass('admin delete function installed (0002_admin_delete.sql)');
else if (d.status === 404) fail('admin_delete_responses not found', 'run supabase/migrations/0002_admin_delete.sql in the SQL Editor');

console.log(ok ? '\nAll good. Next: npm test, then npm run dev.\n' : '\nFix the items above and run `npm run check` again.\n');
process.exit(ok ? 0 : 1);

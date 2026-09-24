#!/usr/bin/env node
// Creates .env: asks for the Supabase URL + publishable key, generates
// FORM_SECRET and ADMIN_TOKEN, and prints the SQL that registers the admin token.
//
//   npm run setup
//   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... npm run setup   (non-interactive)
//
// Re-running keeps existing secrets unless you pass --rotate-admin-token.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { loadEnv } from './env.mjs';

const env = loadEnv();
const rotate = process.argv.includes('--rotate-admin-token');
const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(label, current, valid, hint) {
  if (current && valid(current)) return current;
  if (!process.stdin.isTTY) {
    console.error(`Missing or invalid ${label}. ${hint}`);
    process.exit(1);
  }
  for (;;) {
    const v = (await rl.question(`${label}: `)).trim().replace(/\/$/, '');
    if (valid(v)) return v;
    console.log(`  That doesn't look right. ${hint}`);
  }
}

console.log('\nSupabase values are under Project Settings -> API Keys in the Supabase dashboard.\n');
const supabaseUrl = await ask('Supabase project URL', env.supabaseUrl,
  (v) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v), 'Expected https://<project-ref>.supabase.co');
const publishableKey = await ask('Supabase publishable key', env.publishableKey,
  (v) => /^sb_publishable_\S+$/.test(v) || /^eyJ\S+$/.test(v), 'Expected sb_publishable_... (or a legacy anon key starting eyJ). Never use a secret/service_role key.');
rl.close();

const formSecret = /^[0-9a-f]{64}$/.test(env.formSecret) ? env.formSecret : randomBytes(32).toString('hex');
const newAdmin = rotate || !env.adminToken; // keep a token someone chose by hand
const adminToken = newAdmin ? randomBytes(32).toString('hex') : env.adminToken;

writeFileSync('.env', `# Written by \`npm run setup\`. Never commit this file.
FASTEDGE_VAR_ENV_SUPABASE_URL=${supabaseUrl}
FASTEDGE_VAR_ENV_SUPABASE_PUBLISHABLE_KEY=${publishableKey}
FASTEDGE_VAR_SECRET_FORM_SECRET=${formSecret}
ADMIN_TOKEN=${adminToken}
`);
chmodSync('.env', 0o600);

const hash = createHash('sha256').update(adminToken).digest('hex');
console.log(`
Wrote .env (${existsSync('.env') ? 'ok' : 'failed'}).${newAdmin ? ' A new ADMIN_TOKEN was generated.' : ''}

Now register the admin token in Supabase. In the SQL Editor, run:

  delete from survey.settings;
  insert into survey.settings (admin_token_sha256)
  values ('${hash}');

Your admin token (the /admin password) is the ADMIN_TOKEN line in .env.
Then run:  npm run check
`);

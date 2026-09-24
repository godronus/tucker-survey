#!/usr/bin/env node
// Export all survey responses from Supabase to JSON + CSV, through the same
// admin functions the /admin page uses (works whether or not the app is deployed).
//
//   npm run export [-- outDir]
// Reads SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and ADMIN_TOKEN from the
// environment, falling back to .env (FASTEDGE_VAR_ENV_* names work too).
//
// Writes: responses.json, responses.csv (one row per response),
//         picks.csv (one row per ranked/multi pick), contacts.csv
// For ad-hoc analysis, querying the `survey` schema directly in SQL is usually easier.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { wideRows, pickRows, contactRows, toCsv } from '../shared/report.js';
import { loadEnv } from './env.mjs';

const { supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, adminToken: ADMIN_TOKEN } = loadEnv();
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !ADMIN_TOKEN) {
  console.error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and ADMIN_TOKEN.');
  process.exit(1);
}

async function fetchAll(fn) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: ADMIN_TOKEN, p_offset: offset, p_limit: 1000 }),
    });
    if (!res.ok) throw new Error(`${fn} offset ${offset}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    items.push(...page.items);
    if (offset + 1000 >= page.count || page.items.length === 0) return items;
  }
}

const outDir = process.argv[2] || join('exports', new Date().toISOString().replace(/[:.]/g, '-'));
const [responses, contacts] = await Promise.all([fetchAll('admin_responses'), fetchAll('admin_contacts')]);
responses.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

await mkdir(outDir, { recursive: true });
await Promise.all([
  writeFile(join(outDir, 'responses.json'), JSON.stringify({ responses, contacts }, null, 2)),
  writeFile(join(outDir, 'responses.csv'), toCsv(wideRows(responses))),
  writeFile(join(outDir, 'picks.csv'), toCsv(pickRows(responses))),
  writeFile(join(outDir, 'contacts.csv'), toCsv(contactRows(contacts))),
]);
console.log(`Exported ${responses.length} responses and ${contacts.length} contacts to ${outDir}/`);

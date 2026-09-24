// Shared by the setup/check/deploy/export scripts: read .env and call Supabase.
import { existsSync } from 'node:fs';

export function loadEnv() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const e = process.env;
  return {
    supabaseUrl: (e.SUPABASE_URL || e.FASTEDGE_VAR_ENV_SUPABASE_URL || '').replace(/\/$/, ''),
    publishableKey: e.SUPABASE_PUBLISHABLE_KEY || e.FASTEDGE_VAR_ENV_SUPABASE_PUBLISHABLE_KEY || '',
    formSecret: e.FORM_SECRET || e.FASTEDGE_VAR_SECRET_FORM_SECRET || '',
    adminToken: e.ADMIN_TOKEN || '',
  };
}

/** POST /rest/v1/rpc/<fn>. Returns { status, body }. */
export async function rpc(env, fn, args) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body };
}

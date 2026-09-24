// Supabase (PostgREST) client. The app only ever calls the SECURITY DEFINER
// functions in supabase/migrations; the survey tables are not exposed over REST.

import { getEnv } from 'fastedge::env';

export class DbError extends Error {}
export class Unauthorized extends DbError {}

/** Call a Postgres function via PostgREST RPC. Returns parsed JSON (or null for void). */
export async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const base = getEnv('SUPABASE_URL');
  const key = getEnv('SUPABASE_PUBLISHABLE_KEY');
  if (!base || !key) throw new DbError('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not configured');

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      // Only `apikey`: works for both new publishable keys and legacy anon JWTs.
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch (err) {
    throw new DbError(`Supabase unreachable: ${err}`);
  }
  if (res.status === 401 || res.status === 403) throw new Unauthorized();
  if (!res.ok) throw new DbError(`Supabase ${fn} failed: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

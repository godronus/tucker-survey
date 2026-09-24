/// <reference types="@gcoredev/fastedge-sdk-js" />
import { readFileSync } from "fastedge::fs";
import { getSecret } from "fastedge::secret";
import { Cache } from "fastedge::cache";
import { SURVEY, validateAnswers, relationalRows } from "../shared/survey.js";
import { rpc, DbError, Unauthorized } from "./supabase";

// Static files are embedded into the wasm at build time.
const FILES: Record<string, { body: Uint8Array; type: string }> = {};
function embed(path: string, file: string, type: string) {
  FILES[path] = { body: readFileSync(file), type };
}
embed("/", "./public/index.html", "text/html; charset=utf-8");
embed("/admin", "./public/admin.html", "text/html; charset=utf-8");
embed("/app.js", "./public/app.js", "text/javascript; charset=utf-8");
embed("/admin.js", "./public/admin.js", "text/javascript; charset=utf-8");
embed("/styles.css", "./public/styles.css", "text/css; charset=utf-8");
embed(
  "/shared/survey.js",
  "./shared/survey.js",
  "text/javascript; charset=utf-8",
);
embed(
  "/shared/report.js",
  "./shared/report.js",
  "text/javascript; charset=utf-8",
);

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const MAX_BODY = 100_000; // bytes; a full response is typically 3–10 KB
const TOKEN_MIN_AGE_S = 15; // nobody finishes 10 sections faster than this
const TOKEN_MAX_AGE_S = 7 * 24 * 3600;
const SUBMITS_PER_IP_PER_HOUR = 20;
const ID_RE = /^[0-9a-z]{6,12}-[0-9a-f]{16,32}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

// --- form tokens: HMAC(FORM_SECRET, issued-at). Proves the page was loaded
// from us at least TOKEN_MIN_AGE_S ago; defeats naive POST-only bots.

async function hmacKey(): Promise<CryptoKey> {
  const secret = getSecret("FORM_SECRET");
  if (!secret) throw new Error("FORM_SECRET not configured");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );

async function issueToken(): Promise<string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    new TextEncoder().encode(ts),
  );
  return `${ts}.${hex(sig)}`;
}

/** Returns token age in seconds, or an error code. */
async function checkToken(
  token: unknown,
): Promise<number | "invalid" | "expired"> {
  if (typeof token !== "string") return "invalid";
  const [ts, sig] = token.split(".");
  if (!/^\d+$/.test(ts ?? "") || !/^[0-9a-f]{64}$/.test(sig ?? ""))
    return "invalid";
  const sigBytes = new Uint8Array(
    sig.match(/../g)!.map((h) => parseInt(h, 16)),
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    sigBytes,
    new TextEncoder().encode(ts),
  );
  if (!ok) return "invalid";
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  if (age > TOKEN_MAX_AGE_S) return "expired";
  return age;
}

/** Per-PoP, per-IP hourly submit limit. Fails open: a cache hiccup must not lose a response. */
async function rateLimited(ip: string): Promise<boolean> {
  if (!ip) return false;
  const key = `rl:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  try {
    const n = await Cache.incr(key);
    await Cache.expire(key, { ttl: 3600 }); // time-bucketed key, so expiring every call is safe
    return n > SUBMITS_PER_IP_PER_HOUR;
  } catch (err) {
    console.log(`rate-limit cache error (failing open): ${err}`);
    return false;
  }
}

async function submit(event: FetchEvent): Promise<Response> {
  const req = event.request;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY)
    return json({ error: "too_large" }, 413);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  if (!body || typeof body !== "object")
    return json({ error: "bad_json" }, 400);

  // Honeypot: humans never see this field. Pretend success, store nothing.
  if (body.website) {
    console.log("honeypot tripped; dropping submission");
    return json({ ok: true });
  }
  if (typeof body.id !== "string" || !ID_RE.test(body.id))
    return json({ error: "bad_id" }, 400);

  const age = await checkToken(body.token);
  if (typeof age !== "number") return json({ error: `token_${age}` }, 400);
  if (age < TOKEN_MIN_AGE_S)
    return json(
      { error: "token_too_fast", retryAfter: TOKEN_MIN_AGE_S - age },
      400,
    );

  if (await rateLimited(event.client.address))
    return json({ error: "rate_limited" }, 429);

  const { errors, answers, contact } = validateAnswers(body.answers) as {
    errors: Record<string, string>;
    answers: Record<string, unknown>;
    contact: Record<string, string>;
  };
  if (Object.keys(errors).length)
    return json({ error: "invalid", fields: errors }, 422);

  // One call, one transaction. Keyed by the client-generated id: a retry after
  // a timeout is a no-op in the database rather than a duplicate.
  await rpc("submit_response", {
    p: {
      response: {
        id: body.id,
        version: SURVEY.version,
        // Country only: client IP and ASN would de-anonymise an operator survey.
        country: event.client.geo.countryCode || null,
        durationSec: age,
        answers,
      },
      ...relationalRows(answers),
      contact: Object.keys(contact).length
        ? {
            name: contact.contactName,
            email: contact.contactEmail,
            organization: contact.contactOrg,
            asn: contact.contactAsn,
          }
        : null,
    },
  });
  console.log(`stored response ${body.id}`);
  return json({ ok: true, id: body.id });
}

// --- admin: the bearer token is checked by the database (survey.check_admin),
// so the app holds no read credentials of its own.

async function adminEntries(req: Request, url: URL): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!token) return json({ error: "unauthorized" }, 401);
  const fn =
    url.searchParams.get("kind") === "contact"
      ? "admin_contacts"
      : "admin_responses";
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit")) || 200),
  );
  try {
    const page = (await rpc(fn, {
      p_token: token,
      p_offset: offset,
      p_limit: limit,
    })) as { count: number; items: unknown[] };
    return json({ ...page, offset });
  } catch (err) {
    if (err instanceof Unauthorized)
      return json({ error: "unauthorized" }, 401);
    throw err;
  }
}

async function handle(event: FetchEvent): Promise<Response> {
  const req = event.request;
  const url = new URL(req.url);
  const path =
    url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;

  try {
    if (req.method === "GET") {
      const file = FILES[path];
      if (file) {
        return new Response(file.body, {
          headers: {
            "content-type": file.type,
            "cache-control": "public, max-age=300",
            ...SECURITY_HEADERS,
          },
        });
      }
      if (path === "/api/token") return json({ token: await issueToken() });
      if (path === "/admin/api/entries") return await adminEntries(req, url);
    }
    if (req.method === "POST" && path === "/api/submit")
      return await submit(event);
    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.log(`error on ${req.method} ${path}: ${err}`);
    return err instanceof DbError
      ? json({ error: "storage_unavailable" }, 503)
      : json({ error: "internal" }, 500);
  }
}

addEventListener("fetch", (event: FetchEvent) => {
  event.respondWith(handle(event));
});

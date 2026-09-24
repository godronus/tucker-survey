// Local dev: runs the built wasm under fastedge-run on http://localhost:8080,
// against the Supabase project configured in .env.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunner } from '@gcoredev/fastedge-test';

const PORT = Number(process.env.PORT || 8080);

if (!existsSync('.env')) {
  console.error('Missing .env. Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

// Locally nothing sets the client IP (on the edge the PoP does), so the per-IP
// submit limit would be skipped. Give every local request one, via a copy of .env.
const dotenvDir = mkdtempSync(join(tmpdir(), 'tucker-survey-dev-'));
writeFileSync(join(dotenvDir, '.env'), `${readFileSync('.env', 'utf8')}\nFASTEDGE_VAR_REQ_HEADER_x-real-ip=127.0.0.1\n`);

const runner = await createRunner('./dist/tucker-survey.wasm', { dotenv: { enabled: true, path: dotenvDir }, httpPort: PORT });

console.log(`
  Survey:  http://localhost:${PORT}/
  Admin:   http://localhost:${PORT}/admin   (ADMIN_TOKEN from .env)
  Data is written to the Supabase project in .env.
  Rate limit is active: one submission per 5 minutes (all local requests share one IP).

  Ctrl+C to stop. Rebuild with \`npm run build\` and restart to pick up changes.
`);

const stop = async () => { await runner.cleanup(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

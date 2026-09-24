// Local dev: runs the built wasm under fastedge-run on http://localhost:8080,
// against the Supabase project configured in .env.
import { existsSync } from 'node:fs';
import { createRunner } from '@gcoredev/fastedge-test';

const PORT = Number(process.env.PORT || 8080);

if (!existsSync('.env')) {
  console.error('Missing .env. Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

const runner = await createRunner('./dist/tucker-survey.wasm', { dotenv: { enabled: true }, httpPort: PORT });

console.log(`
  Survey:  http://localhost:${PORT}/
  Admin:   http://localhost:${PORT}/admin   (ADMIN_TOKEN from .env)
  Data is written to the Supabase project in .env.

  Ctrl+C to stop. Rebuild with \`npm run build\` and restart to pick up changes.
`);

const stop = async () => { await runner.cleanup(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

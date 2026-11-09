import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads the repo-root .env into process.env (already set variables win). For local scripts. */
export function loadRootEnv(): void {
  const envFile = join(__dirname, '..', '..', '..', '.env');
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

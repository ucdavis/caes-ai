import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const release = JSON.parse(await readFile(new URL('../../release.json', import.meta.url), 'utf8'));
assert.match(release.commit, /^[a-f0-9]{40}$/, 'The deployment must identify its source commit.');
const keys = process.env.CAES_AI_CALLBACK_SIGNING_KEYS_JSON;
assert.ok(keys, 'CAES_AI_CALLBACK_SIGNING_KEYS_JSON must be configured before startup.');

// App Service protects and persists the setting. Use a private temporary file only
// to load the existing signer; never generate a replacement key during deployment.
try {
  JSON.parse(keys);
} catch {
  throw new Error('CAES_AI_CALLBACK_SIGNING_KEYS_JSON is not valid JSON.');
}
const directory = await mkdtemp(join(tmpdir(), 'caes-ai-signing-'));
try {
  const path = join(directory, 'keys.json');
  await writeFile(path, keys, { mode: 0o600 });
  process.env.CAES_AI_CALLBACK_SIGNING_KEYS_PATH = path;
  process.env.CAES_AI_RELEASE_SHA = release.commit;
  process.env.CAES_AI_PORT = process.env.PORT || process.env.CAES_AI_PORT || '8080';
  delete process.env.CAES_AI_CALLBACK_SIGNING_KEYS_JSON;
  await import('../../apps/ai-server/dist/server.js');
} finally {
  // The signer has loaded the keys into memory, or startup failed.
  await rm(directory, { recursive: true, force: true });
}

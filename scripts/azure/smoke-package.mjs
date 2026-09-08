/* global fetch, AbortSignal */
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';

const databaseUrl = process.env.CAES_AI_TEST_DATABASE_URL;
assert.ok(databaseUrl, 'Set an isolated CAES_AI_TEST_DATABASE_URL.');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname),
  'This smoke check only permits a local test database.');
const archive = resolve('artifacts/caes-ai-server.zip');
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.ok(!/^(apps\/todo-app\/|apps\/ai-server\/src\/|packages\/assistant-react\/|\.env|\.data\/)/m.test(entries));
const directory = await mkdtemp(join(tmpdir(), 'caes-ai-deployment-smoke-'));
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const kid = randomUUID();
const keyRing = JSON.stringify({ version: 1, activeKid: kid, keys: [{
  kid, createdAt: new Date().toISOString(), privateJwk: privateKey.export({ format: 'jwk' }),
}] });
let child;
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timeout = setTimeout(10_000, 'timeout', { ref: false });
  if (await Promise.race([exited, timeout]) === 'timeout') {
    child.kill('SIGKILL');
    await exited;
    throw new Error('The packaged server did not stop after SIGTERM.');
  }
}
async function start(keys = keyRing) {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolveClose) => listener.close(resolveClose));
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['scripts/azure/start-server.mjs'], {
    cwd: directory,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'production',
      DATABASE_URL: databaseUrl, OPENAI_API_KEY: 'unused-isolated-smoke-key',
      CAES_AI_CALLBACK_SIGNING_KEYS_JSON: keys,
      PORT: String(port), CAES_AI_PUBLIC_BASE_URL: origin, CAES_AI_CALLBACK_ISSUER: origin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stdout.on('data', (data) => { errors = (errors + String(data)).slice(-32_000); });
  child.stderr.on('data', (data) => { errors = (errors + String(data)).slice(-32_000); });
  for (let attempt = 0; attempt < 600; attempt++) {
    assert.equal(child.exitCode, null, `Packaged server exited during startup: ${errors}`);
    try {
      const response = await fetch(`${origin}/ready`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return origin;
    } catch { /* Wait for the listener and startup migrations. */ }
    await setTimeout(100);
  }
  throw new Error(`Packaged server did not become ready: ${errors}`);
}
try {
  execFileSync('unzip', ['-q', archive, '-d', directory]);
  const release = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
  const origin = await start();
  const health = await (await fetch(`${origin}/health`)).json();
  assert.equal(health.releaseSha, release.commit);
  const firstKeys = await (await fetch(`${origin}/.well-known/jwks.json`)).json();
  assert.equal(firstKeys.keys[0].kid, kid);
  assert.equal(firstKeys.keys[0].d, undefined);
  const unauthorized = await fetch(`${origin}/v1/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(unauthorized.status, 401);
  await stop();
  const restarted = await start();
  assert.deepEqual(await (await fetch(`${restarted}/.well-known/jwks.json`)).json(), firstKeys);
  await stop();
  const malformed = 'private-material-must-not-appear-in-errors';
  const failed = spawn(process.execPath, ['scripts/azure/start-server.mjs'], {
    cwd: directory, env: { CAES_AI_CALLBACK_SIGNING_KEYS_JSON: malformed },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  failed.stdout.on('data', (data) => { output += String(data); });
  failed.stderr.on('data', (data) => { output += String(data); });
  const [exitCode] = await once(failed, 'exit');
  assert.notEqual(exitCode, 0);
  assert.ok(output.includes('is not valid JSON'));
  assert.ok(!output.includes(malformed));
  process.stdout.write('Server ZIP passed startup, migrations, commit identity, authentication, stable JWKS after restart and secret-safe startup failure.\n');
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}

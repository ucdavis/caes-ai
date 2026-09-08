/* global fetch, AbortSignal */
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';

const origin = new URL(process.env.APP_URL);
assert.equal(origin.protocol, 'https:');
assert.match(process.env.RELEASE_SHA || '', /^[a-f0-9]{40}$/);
async function request(path, options = {}) {
  return fetch(new URL(path, origin), { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) });
}
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const health = await request('/health');
    const data = health.ok ? await health.json() : {};
    const database = await request('/ready');
    if (health.ok && data.releaseSha === process.env.RELEASE_SHA && database.ok) {
      ready = true;
      break;
    }
  } catch {
    // A restarted App Service may temporarily close connections or serve 503.
  }
  await setTimeout(5_000);
}
assert.ok(ready, 'The requested commit did not become healthy with PostgreSQL ready.');
const unauthenticated = await request('/v1/sessions', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
});
assert.equal(unauthenticated.status, 401, 'Unauthenticated session creation must be rejected.');
const response = await request('/.well-known/jwks.json');
assert.ok(response.ok, 'JWKS must be available.');
const { keys } = await response.json();
assert.ok(Array.isArray(keys) && keys.length > 0, 'JWKS must contain a signing key.');
for (const key of keys) {
  assert.ok(key.kid && key.x && key.y && key.kty === 'EC' && key.crv === 'P-256' && key.alg === 'ES256');
  assert.equal(key.d, undefined, 'JWKS must never expose private signing material.');
}
process.stdout.write(`Verified ${origin.origin}: commit ${process.env.RELEASE_SHA}, PostgreSQL readiness, session authentication and public JWKS.\n`);

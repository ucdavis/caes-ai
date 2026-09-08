import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';

const repo = 'ucdavis/caes-ai';
const existing = new Set(JSON.parse(execFileSync('gh', [
  'secret', 'list', '--repo', repo, '--env', 'test', '--json', 'name',
], { encoding: 'utf8' })).map((secret) => secret.name));
function save(name, value) {
  if (existing.has(name)) return;
  // Values go directly to gh's stdin. Never print or persist them locally.
  execFileSync('gh', ['secret', 'set', name, '--repo', repo, '--env', 'test'], {
    input: value, stdio: ['pipe', 'pipe', 'pipe'],
  });
  process.stdout.write(`Created test environment secret ${name}.\n`);
}
save('POSTGRES_ADMIN_PASSWORD', 'Aa1!' + randomBytes(36).toString('base64url'));
if (!existing.has('CALLBACK_SIGNING_KEYS_JSON')) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = randomUUID();
  save('CALLBACK_SIGNING_KEYS_JSON', JSON.stringify({
    version: 1, activeKid: kid, keys: [{
      kid, createdAt: new Date().toISOString(), privateJwk: privateKey.export({ format: 'jwk' }),
    }],
  }));
}
process.stdout.write('Existing secrets were preserved. Supply OPENAI_API_KEY separately.\n');

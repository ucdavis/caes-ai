import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const script = fileURLToPath(new URL('./bootstrap.mjs', import.meta.url));
const clientId = '12345678-1234-1234-1234-123456789abc';

// Exercise the real CLI boundary without granting the tests access to Azure or GitHub.
function run(args, scenario = '') {
  const dir = mkdtempSync(path.join(tmpdir(), 'caes-ai-bootstrap-test-'));
  const log = path.join(dir, 'calls.jsonl');
  const fakeCli = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const command = path.basename(process.argv[1]);
appendFileSync(process.env.CALL_LOG, JSON.stringify({command, args}) + '\\n');
const scenario = process.env.SCENARIO;
if (args[0] === 'account') {
  console.log(JSON.stringify({id: '105dede4-4731-492e-8c28-5121226319b0',
    tenantId: scenario === 'wrong-tenant' ? 'wrong' : 'a8046f64-66c0-4f00-9046-c8daf92ff62b', state: 'Enabled'}));
} else if (args[0] === 'api') {
  if (scenario === 'missing-environment') process.exit(1);
  console.log('{}');
} else if (args[2] === 'create') {
  if (scenario === 'azure-failure') process.exit(1);
  console.log(JSON.stringify({deploymentGuardPassed: {value: scenario !== 'guard-failure'},
    resourceGroup: {value: 'rg-caes-ai-test'}, clientId: {value: '${clientId}'}}));
} else if (args[0] === 'variable' && scenario === 'github-failure') process.exit(1);
`;
  for (const command of ['az', 'gh']) writeFileSync(path.join(dir, command), fakeCli, { mode: 0o700 });
  let status = 0;
  let output;
  try {
    try {
      output = execFileSync(process.execPath, [script, ...args], {
        cwd: dir, env: { ...process.env, PATH: dir, CALL_LOG: log, SCENARIO: scenario },
        encoding: 'utf8', stdio: 'pipe',
      });
    } catch (error) {
      status = error.status;
      output = `${error.stdout}${error.stderr}`;
    }
    let calls = [];
    try { calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { status, output, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('help and invalid targets never invoke a CLI', () => {
  assert.equal(run(['--help']).status, 0);
  for (const args of [[], ['production', '--apply'], ['test'], ['test', '--apply', '--what-if']]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.deepEqual(result.calls, []);
  }
});

test('preview only inspects the configured account and runs what-if', () => {
  const result = run(['test', '--what-if']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls.map(({ args }) => args.slice(0, 3)), [
    ['account', 'show', '--subscription'], ['deployment', 'sub', 'what-if'],
  ]);
  assert.ok(result.calls[1].args.includes(fileURLToPath(new URL('../../infrastructure/azure/bootstrap.bicep', import.meta.url))));
});

test('wrong tenant and inaccessible GitHub environment stop before deployment', () => {
  for (const scenario of ['wrong-tenant', 'missing-environment']) {
    const result = run(['test', '--apply'], scenario);
    assert.equal(result.status, 1);
    assert.ok(result.calls.every(({ args }) => args[0] !== 'deployment'));
  }
});

test('failed deployment or rejected outputs never update GitHub', () => {
  for (const scenario of ['azure-failure', 'guard-failure']) {
    const result = run(['test', '--apply'], scenario);
    assert.equal(result.status, 1);
    assert.ok(result.calls.every(({ args }) => args[0] !== 'variable'));
  }
});

test('apply stores only the validated deployment client ID in the target environment', () => {
  const result = run(['test', '--apply']);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.calls[2].args[2], 'create');
  assert.deepEqual(result.calls[3], { command: 'gh', args: [
    'variable', 'set', 'AZURE_CLIENT_ID', '--repo', 'ucdavis/caes-ai', '--env', 'test', '--body', clientId,
  ] });
});

test('GitHub failure after Azure success reports recovery information', () => {
  const result = run(['test', '--apply'], 'github-failure');
  assert.equal(result.status, 1);
  assert.match(result.output, /Azure is ready, but saving AZURE_CLIENT_ID failed/);
  assert.ok(result.output.includes(clientId));
});

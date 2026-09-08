import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const commit = process.env.RELEASE_SHA;
assert.match(commit || '', /^[a-f0-9]{40}$/, 'Set RELEASE_SHA to the source commit being packaged.');
const stage = mkdtempSync(join(tmpdir(), 'caes-ai-server-package-'));
const artifacts = join(root, 'artifacts');
const archive = join(artifacts, 'caes-ai-server.zip');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: stage, stdio: 'inherit' });
  assert.equal(result.status, 0, `${command} failed while packaging the server.`);
}
function copy(path) {
  mkdirSync(resolve(stage, path, '..'), { recursive: true });
  cpSync(join(root, path), join(stage, path), { recursive: true });
}
try {
  copy('package.json');
  copy('package-lock.json');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const workspace of manifest.workspaces) copy(`${workspace}/package.json`);
  // Install the lockfile's Linux runtime dependencies without development tools
  // or dependency lifecycle scripts. CI builds TypeScript before this step.
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
    '--workspace', '@ucdavis/caes-ai-server', '--workspace', '@ucdavis/caes-ai-protocol']);
  for (const workspace of manifest.workspaces) {
    if (!['apps/ai-server', 'packages/protocol'].includes(workspace)) {
      rmSync(join(stage, workspace), { recursive: true, force: true });
    }
  }
  rmSync(join(stage, 'apps/todo-app'), { recursive: true, force: true });
  rmSync(join(stage, 'tests'), { recursive: true, force: true });
  for (const path of ['apps/ai-server/dist', 'apps/ai-server/drizzle',
    'packages/protocol/dist', 'scripts/azure/start-server.mjs']) copy(path);
  rmSync(join(stage, 'package-lock.json'));
  writeFileSync(join(stage, 'package.json'), JSON.stringify({
    name: 'caes-ai-server-deployment', private: true, engines: { node: '>=22' },
    scripts: { start: 'node scripts/azure/start-server.mjs' },
  }, null, 2));
  writeFileSync(join(stage, 'release.json'), JSON.stringify({ commit }) + '\n');
  mkdirSync(artifacts, { recursive: true });
  rmSync(archive, { force: true });
  // zip dereferences workspace links so the deployed package is self-contained.
  run('zip', ['-qr', archive, '.']);
  process.stdout.write(`Created ${archive} for ${commit}\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}

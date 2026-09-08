/* global fetch, AbortSignal */

import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
if (!dryRun) {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Publish through GitHub Actions");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "Publish from main");
}

// Publish the dependency first, and compare immutable contents before skipping
// an upload that succeeded during an earlier attempt at this release.
for (const directory of ["protocol", "assistant-react"]) {
  const pkg = JSON.parse(readFileSync(`packages/${directory}/package.json`, "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+-beta\.\d+$/);
  if (process.env.RELEASE_VERSION) {
    assert.equal(pkg.version, process.env.RELEASE_VERSION, `${pkg.name} version`);
  }
  const tarball = resolve(`artifacts/${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`);
  const integrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (response.ok) {
    const published = await response.json();
    assert.equal(published.dist?.integrity, integrity,
      `${pkg.name}@${pkg.version} already exists with different package contents`);
    console.log(`${pkg.name}@${pkg.version} already published with matching contents`);
    continue;
  }
  assert.equal(response.status, 404, `Registry lookup failed for ${pkg.name}`);
  const result = spawnSync("npm", [
    "publish", tarball,
    "--registry=https://registry.npmjs.org",
    "--tag=beta", "--access=public", "--provenance",
    ...(dryRun ? ["--dry-run"] : []),
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Publishing ${pkg.name} failed`);
}

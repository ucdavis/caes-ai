# Package releases

CAES AI distributes two public npm packages and one public NuGet package. The
first release is prepared as `0.2.0-beta.0`. Server deployment is separate.

| Registry | Package | Beta installation |
| --- | --- | --- |
| npmjs.org | `@ucdavis/caes-ai-protocol` | `npm install @ucdavis/caes-ai-protocol@beta` |
| npmjs.org | `@ucdavis/caes-ai-assistant-react` | `npm install @ucdavis/caes-ai-assistant-react@beta` |
| NuGet.org | `UCDavis.CaesAi.AppSdk` | `dotnet add package UCDavis.CaesAi.AppSdk --version 0.2.0-beta.0` |

The .NET SDK requires .NET 10. The React package declares React, React DOM and the
compatible TanStack AI packages as peers. The protocol package is also available
separately for applications that only need the wire contracts.

## First npm publish

npm requires a package to exist before a trusted publisher can be configured.
An account with publishing access to the `@ucdavis` scope must authorize the first
versions. Create a short-lived granular token on npm with package read/write
access to the `@ucdavis` scope and publishing 2FA bypass. Store it as the GitHub
Actions secret `NPM_BOOTSTRAP_TOKEN`, then select `bootstrap` for `npm_auth` when
dispatching the publishing workflow. No local npm login is needed.

The workflow publishes the protocol before the React package and sets `beta`
explicitly. After the first publish, configure the trusted publishers below,
revoke the bootstrap token and remove its GitHub secret. Subsequent runs use the
default `trusted` authentication option.

## Configure trusted publishing

The workflow is `.github/workflows/publish-packages.yml`. It runs only from `main`
and uses the GitHub environment `package-publishing`.

For each npm package, add a GitHub Actions trusted publisher in its npm settings:

- Organization/user: `ucdavis`
- Repository: `caes-ai`
- Workflow filename: `publish-packages.yml`
- Environment: `package-publishing`

On NuGet.org, create a GitHub Actions trusted publishing policy with the same
repository, workflow filename and environment. Choose the intended package owner
(your account or the team's organization). Scope it to `UCDavis.CaesAi.AppSdk`,
allowing both new packages and new versions. Set the GitHub repository or
environment variable `NUGET_USER` to the NuGet username used for that policy.
For this repository, `NUGET_USER` is `ucdotnetadmin`. NuGet trusted publishing can
create the first package; no initial API key is required.

These connections let GitHub obtain short-lived publishing credentials. npm also
attaches provenance when publishing from this workflow. Neither registry needs a
long-lived publishing token stored in GitHub.

References: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/), and
[NuGet trusted publishing](https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing).

## Publish a reviewed beta

1. Record package changes with `npm run changeset`, then run
   `npm run release:version`. Changesets is in `beta` prerelease mode. Update the
   .NET project's `VersionPrefix` and `VersionSuffix` to the same release version.
2. Review and merge the release changes into `main`.
3. Run **Publish beta packages** from GitHub Actions on `main`. Select `all`, `npm`
   or `nuget`, and enter the exact version from the manifests. Use the default
   `trusted` npm authentication after the first upload.
4. The workflow runs the existing builds, JavaScript/PostgreSQL tests, .NET tests
   and static checks before packing and publishing. Its artifact upload retains
   the three package files even if a later registry upload fails.
5. Verify the versions and npm tag in the registries, then install the published
   packages in a fresh consumer project. A successful upload alone does not prove
   dependency resolution or package usability.

The workflow is only for beta releases and rejects stable version strings. A
stable release should explicitly leave Changesets prerelease mode and update the
publishing workflow and documentation at that time.

Package name/version pairs are immutable. A repeated npm run skips an existing
version only when the registry's integrity matches the local tarball; a mismatch
fails. NuGet uses `--skip-duplicate`. Retry the same commit and version after a
partial failure, selecting just the affected registry. Do not bump versions solely
to retry a failed upload.

For a local packaging check, build and pack the npm packages, then run
`npm run release:publish -- --dry-run`. Actual publishing is restricted to Actions
on `main`.

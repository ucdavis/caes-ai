# Azure test deployment

The central server runs as one Node 22 process on the existing Linux
`DefaultPlan2` in `Default-Web-WestUS`, West US 2. The plan is referenced, not
created or resized. All CAES AI resources belong to `rg-caes-ai-test` in the
CAES Test subscription `105dede4-4731-492e-8c28-5121226319b0`.
There is no production workflow or production template parameter.

Infrastructure and App Service settings are applied by Bicep from GitHub Actions.
The Actions workflow then uploads a prebuilt ZIP with Azure's deployment action.
Normal package deployments leave app settings and infrastructure alone, following
the separation used by Leaves. The one-time identity bootstrap runs locally through
Bicep using an administrator's Azure CLI login. Application infrastructure, settings
and package deployments run only through GitHub Actions.

## Resources

| Resource | Test configuration |
| --- | --- |
| Existing App Service plan | `DefaultPlan2`, Linux B1, one instance, unchanged |
| App Service | `web-caes-ai-test-<suffix>`, Node 22, HTTPS, Always On, `/ready` health check |
| PostgreSQL Flexible Server | `pg-caes-ai-test-<suffix>`, PostgreSQL 17, `Standard_B1ms`, 1 vCPU, 2 GiB RAM |
| Database storage | 32 GiB, seven-day backups, no HA, no geo-redundant backup, no automatic storage growth |
| Database | `caesai`, startup-managed Drizzle migrations |
| Deployment identity | `id-caes-ai-github-test`, GitHub OIDC, Contributor on the test resource group and Web Plan Contributor on DefaultPlan2 only |

PostgreSQL uses TLS with certificate verification. Its public endpoint permits
only the App Service's possible outbound IP addresses. It does not enable the
all-Azure-services firewall exception or laptop/GitHub runner database access.
The central service applies migrations from inside App Service before listening.
Rerun Bicep if the app's possible outbound addresses change. Full changes to the
firewall address set may leave old rules under incremental ARM deployment; review
and retire obsolete rules through Bicep before any network/topology migration.

The shared B1 plan has limited memory. CAES AI starts one process with a 256 MiB
JavaScript heap ceiling. This is not a cap on total process memory. Check the
shared plan's capacity before load testing; this deployment does not resize it.

## First-run identity setup

Run bootstrap once per environment using Node 22+, Azure CLI with Bicep, and the
GitHub CLI. Sign in with `az login` and `gh auth login`. Your Azure account needs
permission to create the resource group, managed identity, federated credential
and role assignments in the target subscription, including a role assignment on
DefaultPlan2. Contributor plus Role Based Access Control Administrator at the
necessary scopes, or Owner, can perform this setup. Your GitHub account needs
access to set environment variables in `ucdavis/caes-ai`.

Create the `test` GitHub environment and restrict it to `main` before applying.
From the repository root, preview the changes and then apply them:

```bash
npm run azure:bootstrap -- test --what-if
npm run azure:bootstrap -- test --apply
```

The [bootstrap script](../../scripts/azure/bootstrap.mjs) selects an explicit
subscription and checks its tenant without changing your default Azure account.
Preview runs Azure what-if without modifying Azure or GitHub. Apply runs
[bootstrap.bicep](bootstrap.bicep), validates its outputs and saves `AZURE_CLIENT_ID`
in the `test` GitHub environment. It creates `rg-caes-ai-test`, the permanent
managed identity, GitHub OIDC trust and scoped permissions. It does not create the
web app or database, generate secrets, or start the deployment workflow.

Rerunning apply uses the same resource and role assignment identities. If Azure
succeeds but saving the GitHub variable fails, the script reports the client ID;
fix GitHub access and rerun, or save that ID in the environment manually. Do not
run bootstrap concurrently with another bootstrap or deployment to that environment.
Azure what-if may mark the plan role assignment as unsupported because its
principal ID depends on the identity module. Preview is not a permission check.

The command accepts an environment name, but only `test` is configured. Unknown
environments are rejected before any CLI call. To add another environment, review
its Bicep target, subscription, tenant, resource group, plan and GitHub OIDC subject,
then add a target entry in the script and a corresponding deployment workflow.
There is no production target today.

The permanent deployment identity is a user-assigned managed identity. Bootstrap
uses Azure Resource Manager Bicep and needs no Microsoft Graph app registration
permissions. Its federation is bound to
`repo:ucdavis@573450/caes-ai@1357492545:environment:test`, matching the owner and
repository IDs in GitHub's actual token. Check `sub_claim_prefix` from
`gh api repos/ucdavis/caes-ai/actions/oidc/customization/sub` and the Azure login
step's subject claim when diagnosing a trust mismatch. The API's
`use_immutable_subject: false` does not imply the older name-only format for new
repositories. See [GitHub's OIDC reference](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims).
If GitHub's OIDC subject customization or deployment permissions change, update
the bootstrap Bicep and rerun the script. Ordinary infrastructure and server
changes use **Deploy Azure test**. No separate bootstrap workflow or
`azure-bootstrap` GitHub environment is needed.

## GitHub test configuration

Create the `test` environment and restrict it to `main`. Generate the two
CAES AI-owned secrets without printing them:

```bash
node scripts/azure/initialize-secrets.mjs
```

The helper requires `gh` access to `ucdavis/caes-ai`, writes directly to GitHub
Secrets and preserves existing values. It does not deploy Azure resources.

| Name | Kind | Purpose |
| --- | --- | --- |
| `AZURE_CLIENT_ID` | Variable | Permanent test deployment identity from bootstrap |
| `POSTGRES_ADMIN_PASSWORD` | Secret | Generated database credential. Keep stable across configuration runs. |
| `CALLBACK_SIGNING_KEYS_JSON` | Secret | Generated version 1 key ring. Keep stable across deployments. |
| `OPENAI_API_KEY` | Secret | Required provider credential, supplied by the service owner |
| `OPENAI_DEFAULT_MODEL` | Optional variable | Defaults to the server's `gpt-5.6-luna` model |
| `OPENAI_ALLOWED_MODELS` | Optional variable | Comma-separated allowlist, defaults to the default model |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional variable | Trusted OTLP HTTP/protobuf collector |
| `OTEL_EXPORTER_OTLP_HEADERS` | Optional secret | Collector authorization headers |

Providing an OTLP endpoint enables `CAES_AI_OTEL_ENABLED`; leaving it empty keeps
telemetry export disabled. The server uses HTTP/protobuf for traces and metrics.

The subscription, tenant, resource group and plan are fixed in the workflow and
templates. They do not accept production targets. Secure Bicep parameters protect
secret values in deployment history. Parameter files are created with mode 0600
in the runner temporary directory, removed after use and never uploaded.

App Service stores the provider key, database URL and callback key ring as protected
app settings. The startup wrapper loads signing material through a mode-0600
temporary file, removes the environment value before loading telemetry, and deletes
the file once the existing signer has loaded it into memory. Every deployment
receives the same configured key ring, so JWKS and callback verification survive
process and container replacement. This is protected deployment secret storage,
not managed Key Vault signing. Do not regenerate the key ring on each deploy.
Automatic signing-key rotation remains deferred. For a planned rotation, preserve
old keys for verification overlap and update the configured ring through Bicep.

## Deploy

Merge the reviewed deployment changes to `main` first. For the initial deployment
or an intentional configuration change:

```bash
gh workflow run deploy-azure-test.yml --repo ucdavis/caes-ai --ref main \
  -f configure_infrastructure=true
```

For later application-only deployments, leave the input false:

```bash
gh workflow run deploy-azure-test.yml --repo ucdavis/caes-ai --ref main \
  -f configure_infrastructure=false
```

The workflow runs the full CI suite, builds a ZIP from the checked-out server and
protocol, installs locked production dependencies, and retains the artifact. It
optionally applies Bicep, verifies that the target app uses DefaultPlan2, waits for
SCM, uploads the ZIP using Azure OIDC, restarts the app after package activation
and then verifies:

- `/health` reports the exact deployed commit.
- `/ready` can query PostgreSQL after startup migrations.
- Unauthenticated session creation returns 401.
- JWKS is available and contains only public ES256 key material.

The explicit restart handles a first upload racing the empty site's cold start.
App Service can fail to remount the new package into that starting container even
when OneDeploy reports success. Restart runs after package activation, through
Actions, so the new process starts with the complete package already present.

These checks do not call OpenAI or prove an application callback. Register a real
application and perform a complete chat/tool request separately. The Todo example
is not included in this deployment. There is no browser UI in the central service.
An OTLP destination is optional for the test deployment but required before the
first application beta acceptance described in `docs/beta-milestone.md`.

## Local verification and recovery

`npm run pack:server` requires `RELEASE_SHA` and prebuilt server/protocol packages.
Its ZIP contains compiled code, migrations, runtime dependencies and release
metadata. CI unpacks it into an isolated directory and verifies real PostgreSQL
startup, authentication, a stable JWKS after restart and a secret-safe failure
for malformed signing configuration. It also compiles both Bicep templates.

The database tests and package smoke test require the isolated local database
from the root README. They do not read the development `.env` or use a provider key.

A failed package upload can be retried through the workflow without rewriting
configuration. Deploying an older package is only safe if its database schema is
compatible with migrations already applied. PostgreSQL backups do not back up
GitHub secrets. Preserve access to the deployment secrets before deleting an app
or replacing its configuration. No automatic rollback or resource deletion runs.

# GitHub automation

[ci.yml](workflows/ci.yml) runs on pull requests, pushes to `main`, and manual
dispatch. It installs Node.js, npm 11.19.1 and .NET, verifies dependency compatibility, then runs application builds,
type, migration, lint and formatting checks, tests and all three local package
commands. These are the same checks available through `npm run check` and
`npm run build`, with separate CI steps so failures are easy to find. It neither
publishes packages nor deploys the service.

The **Test JavaScript packages and PostgreSQL persistence** step runs
`npm run test:js`. Its AI server suite uses the job's PostgreSQL service for four tests in
[application-registry.database.test.ts](../apps/ai-server/test/application-registry.database.test.ts):

- Application registration and hashed API-key persistence.
- Key rotation/revocation and application disablement.
- Rejection of conflicting bootstrap key identities.
- Durable session reload and run/tool operational records.

`CAES_AI_TEST_DATABASE_URL` connects those tests to the job's temporary database.
The tests apply the checked-in migrations and write/read real rows. Other suites
use in-memory dependencies, SQLite or local test servers. No live OpenAI credential
or demo bootstrap is needed. See the [test overview](../tests/README.md) for details.

[publish-packages.yml](workflows/publish-packages.yml) is a separate, manually
dispatched workflow restricted to `main`. It calls the same CI workflow before
publishing, checks the requested beta version, retains package artifacts, and uses
registry trusted publishing in the `package-publishing` environment. npm and NuGet
can be selected separately. See [registry setup](../docs/package-releases.md).

CI also compiles the Azure Bicep templates and runs **Verify the App Service package
against PostgreSQL**. That check unpacks the server ZIP, starts its production
entry point, verifies authentication and commit metadata, and restarts it to
confirm that the configured signing key stays stable.

**Test Azure bootstrap CLI without cloud access** checks preview, target validation,
deployment failures and GitHub variable updates using fake Azure and GitHub CLIs.

[deploy-azure-test.yml](workflows/deploy-azure-test.yml) is a manual, `main`-only
workflow. A local `npm run azure:bootstrap -- test --apply` first creates the
deployment identity through Bicep and saves its client ID in GitHub. Subsequent
deployment uses Actions for Bicep infrastructure and app settings, then uploads
the prebuilt ZIP and checks the deployed service. Only test is configured.
See the [Azure guide](../infrastructure/azure/README.md).

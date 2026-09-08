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

# GitHub automation

[ci.yml](workflows/ci.yml) runs on pull requests, pushes to `main`, and manual
dispatch. It installs Node.js, pnpm and .NET, then runs `pnpm check`, application
builds and all three local package commands. It neither publishes packages nor
deploys the service.

The job's PostgreSQL service is used by four tests in
[application-registry.database.test.ts](../apps/ai-server/test/application-registry.database.test.ts):

- Application registration and hashed API-key persistence.
- Key rotation/revocation and application disablement.
- Rejection of conflicting bootstrap key identities.
- Durable session reload and run/tool operational records.

`CAES_AI_TEST_DATABASE_URL` connects those tests to the job's temporary database.
The tests apply the checked-in migrations and write/read real rows. Other suites
use in-memory dependencies, SQLite or local test servers. No live OpenAI credential
or demo bootstrap is needed. See the [test overview](../tests/README.md) for details.

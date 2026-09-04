# Shared packages

| Package | Purpose |
| --- | --- |
| [protocol](protocol/README.md) | CAES AI's TypeScript runtime schemas and public wire types. |
| [assistant-react](assistant-react/README.md) | Headless React integration, optional accessible UI and starter theme. |
| [UCDavis.CaesAi.AppSdk](UCDavis.CaesAi.AppSdk/README.md) | .NET session client, context tokens, callback verification and ASP.NET Core integration. |
| [UCDavis.CaesAi.AppSdk.Tests](UCDavis.CaesAi.AppSdk.Tests/README.md) | Contract and security tests for the .NET SDK. |

The packages contain no Todo business logic. Hosts provide tools, authorization,
renderers and business services. The [versioned contracts](../contracts/README.md)
are shared between TypeScript and .NET.

From the repository root, `npm run build:packages` builds both JavaScript packages.
`npm run pack:protocol`, `npm run pack:assistant` and `npm run pack:dotnet` write local package
artifacts without publishing. [Changesets](../.changeset/README.md) manages version
bumps and changelogs for the JavaScript packages; the .NET version is defined in its
project file.

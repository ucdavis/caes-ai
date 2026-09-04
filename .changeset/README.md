# Changesets

Changesets records release notes and requested version bumps for the publishable
JavaScript packages, `@ucdavis/caes-ai-protocol` and
`@ucdavis/caes-ai-assistant-react`. Each pending Markdown file names the affected
packages and a `patch`, `minor` or `major` bump, followed by a human-readable note.
The generated filenames are just identifiers.

Run these commands from the repository root:

- `npm run changeset` creates a release note to commit with a package change.
- `npm run release:version` consumes pending notes, updates package versions and internal dependency ranges, and writes changelogs.
- `npm run release:publish` builds and publishes package versions that have not yet been published. This is a separate, explicit release operation.

CI only builds, tests and packs packages. It does not run either release command.
The private applications are excluded by `config.json`; NuGet versioning remains in
the .NET project file. Changesets uses the same npm workspaces as the rest of the repository.

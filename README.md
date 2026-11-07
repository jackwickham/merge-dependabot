# Merge dependabot
Automatically merges dependabot PRs with at least one check where all checks are passing.

The build uses TypeScript 7 through the `typescript-compiler` npm alias.
The `typescript` dependency stays on version 6 for the JavaScript compiler API
required by typescript-eslint and ts-jest until those tools support TypeScript 7.

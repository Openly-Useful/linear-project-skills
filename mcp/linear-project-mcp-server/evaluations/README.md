# Read-only evaluation set

`read-only.xml` contains 10 independent, stable questions whose answers come from the repository's synthetic test fixtures and registered MCP protocol surface. It is designed for tool-selection and result-extraction evaluation without credentials or external writes.

Run `pnpm test` before using the set so the in-memory fixture and protocol contract have been verified. The evaluation set intentionally excludes mutating requests; mutation authority is covered by deterministic workflow and protocol tests.

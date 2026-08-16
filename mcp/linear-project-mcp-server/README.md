# Linear Project MCP Server

A scope-gated Model Context Protocol server for administering Linear project workflows, with optional read-only GitHub evidence and local Obsidian note adapters.

The server complements the three skills in this repository. It supplies the integration capabilities those workflows need when an existing connector cannot create teams, enforce exact scope labels, or link local evidence safely.

## What it supports

| Linear arrangement | Project scope | Issue identifier behavior |
| --- | --- | --- |
| Existing team | Exact project plus `ACQI` issue and project labels | Keeps the existing team key, such as `OPEN-42` |
| New dedicated team with key `ACQI` | Exact project plus `ACQI` labels | Starts at `ACQI-1` only when the team is verified empty |
| New `ACQI` subteam under an existing parent | Exact project plus `ACQI` labels | Starts at `ACQI-1` only when the subteam is verified empty |

Linear identifiers belong to teams, not projects or labels. The server rejects a request that expects `ACQI-1` on an existing `OPEN` team before creating a project, label, note, or issue. A first-identifier readback is an immediate safety check, not a concurrency lock; avoid simultaneous writers while bootstrapping the first issue.

Historical captures are separate from active work. They receive an exact `[HISTORICAL]` title prefix, the scope and `HISTORICAL` labels, `Historical only: true`, `Actionability: none`, and a deterministic source marker for replay safety.

## Tools

| Tool | Mode | Purpose |
| --- | --- | --- |
| `linear_project_capabilities` | Read | Report adapters, reachability, allowlists, and write state |
| `linear_project_resolve_scope` | Read | Resolve one exact team/project/label scope |
| `linear_project_create_team` | Write | Create or reuse a dedicated team or subteam with the scope key |
| `linear_project_bootstrap` | Write | Create or reuse a team, project, labels, optional links, and first issue |
| `linear_project_list_scoped_issues` | Read | List only issues in the exact project carrying the scope label |
| `linear_project_upsert_scoped_issue` | Write | Idempotently create or update active or historical work |
| `linear_project_find_candidates` | Read | Find allowlisted reconciliation candidates without moving them |
| `linear_project_move_candidate` | Write | Move one reviewed candidate with exact source-state and identifier safeguards |
| `linear_project_link_evidence` | Write | Add a verified GitHub or Obsidian link to an in-scope issue |
| `github_get_project_evidence` | Read | Normalize an allowlisted repository, commit, PR, or issue |
| `obsidian_search_project_notes` | Read | Search allowlisted local Markdown notes |
| `obsidian_read_project_note` | Read | Read one allowlisted local Markdown note |
| `obsidian_upsert_project_note` | Write | Replace only the server-managed section of a note |

All tools use strict input schemas and structured output. Mutating tools require a literal confirmation field, and global writes must also be enabled.

## Install and build

Requirements: Node.js 20 or newer and pnpm 11.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm check
pnpm build
```

The npm package name is `@openly-useful/linear-project-mcp-server`. It installs the `linear-project-mcp-server` protocol server and the bounded `linear-project-mcp-write-window` safety helper. The package can be run with `npx @openly-useful/linear-project-mcp-server` only after the first successful npm release. Until then, build and run it from a source checkout as shown below.

The official MCP Registry name is `org.openlyuseful/linear-project`. [`server.json`](server.json), `package.json.mcpName`, the npm package version, and the registry package version must agree. External publication is intentionally blocked while the repo-local Openly Useful publisher projection remains `formation-pending`; builds, tests, and `pnpm pack --dry-run` do not activate or publish the record.

## Configure

Copy [`.env.example`](.env.example) and provide only the adapters you need.

Linear accepts either `LINEAR_API_KEY` or `LINEAR_ACCESS_TOKEN`. Every scoped Linear read and mutation requires an exact `LINEAR_ALLOWED_ORGANIZATION_ID`; every mutation additionally requires:

- `MCP_WRITES_ENABLED=true`;
- a future `MCP_WRITE_WINDOW_EXPIRES_AT` no more than 60 minutes away;
- a safe, writable `MCP_AUDIT_LOG_PATH` when using the bundled write-window helper;
- the exact code in `LINEAR_ALLOWED_SCOPE_CODES`, such as `ACQI`;
- the destination team's ID in `LINEAR_ALLOWED_TEAM_IDS`, unless it is a dedicated team whose key exactly equals the scope code;
- the project ID in `LINEAR_ALLOWED_PROJECT_IDS` when that optional allowlist is non-empty;
- the mutating tool's literal confirmation field set to `true`.

For a new `ACQI` subteam, allowlist the parent team ID, select `team_mode: "subteam"`, pass `parent_team_id`, and use `team_key: "ACQI"`. The authenticated Linear identity must have permission to create teams in the workspace.

Leave `LINEAR_ALLOWED_PROJECT_IDS` empty only for the initial project bootstrap, because a new project's ID does not exist yet. After readback, add that exact ID before ongoing operation. Existing projects must already be allowlisted when the project-ID allowlist is non-empty, and all scoped operations require the exact scope project label.

GitHub is optional. Configure `GITHUB_TOKEN` and exact `owner/name` entries in `GITHUB_ALLOWED_REPOSITORIES`. The adapter makes GET requests only; use a fine-grained token with read-only metadata and contents, pull-request, or issue access required by the references you plan to inspect.

Obsidian is optional and local. `OBSIDIAN_VAULT_PATH` must be absolute, `OBSIDIAN_ALLOWED_DIRECTORIES` contains vault-relative directories, and `OBSIDIAN_VAULT_NAME` enables `obsidian://` links. Only `.md` files under those directories are accessible. Traversal, symlinks, non-Markdown paths, and files over 200,000 bytes are rejected. Linking a note to Linear sends only its Obsidian URI and title, not its contents.

For operation auditing, set `MCP_AUDIT_LOG_PATH` to a normalized absolute path outside the repository. Its parent directory must already exist, belong to the current user, and not be group- or world-writable. The server appends compact NDJSON attempt/outcome records with operation IDs, tool names, modes, durations, outcomes, and safe error classes; it never logs tool arguments, result bodies, descriptions, credentials, or error messages. Once auditing is configured, an unavailable audit sink blocks writes before workflow execution and marks reads as audit-degraded.

## Connect Codex

Use `linear_project` as the canonical Codex registration alias. This alias is a local client configuration key; it is intentionally different from the npm package and executable names.

From the server directory in a source checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
MCP_ENTRYPOINT="$(pwd)/dist/index.js"
codex mcp add linear_project -- node "$MCP_ENTRYPOINT"
codex mcp get linear_project --json
codex mcp list --json
```

After the first npm release is available, a version-pinned registry installation can instead be registered with:

```sh
codex mcp add linear_project -- npx --yes @openly-useful/linear-project-mcp-server@0.1.0
codex mcp get linear_project --json
codex mcp list --json
```

Do not add API tokens with `codex mcp add --env`, because that stores the supplied value in the local Codex configuration. Use a protected launcher or operating-system secret store that exports credentials only to the child process. Non-secret allowlist settings may be stored in client configuration, but the repository must never contain real organization, team, project, repository, or vault values.

After registration, start a new Codex task if the current task's tool registry does not refresh. In that new task:

1. Confirm the `linear_project` tools are visible.
2. Call `linear_project_capabilities` and confirm `writesEnabled` is `false`, Linear is reachable, and the organization is allowed.
3. Call `linear_project_resolve_scope` for the intended scope code and confirm the exact team, project, issue label, and project label all resolve.

Keep the package names distinct when troubleshooting:

| Name | Use |
| --- | --- |
| `linear_project` | `codex mcp add`, `codex mcp get`, and `codex mcp list` registration alias. |
| `@openly-useful/linear-project-mcp-server` | npm package specifier used by `npx` and package managers. |
| `org.openlyuseful/linear-project` | Official MCP Registry server name and npm `mcpName`. |
| `linear-project-mcp-server` | Installed executable and MCP protocol server artifact name. |
| `linear-project-mcp-write-window` | Installed helper for bounded, explicit changes to write-window settings. |

## Connect another MCP client

Build the server, then configure a local stdio process in the client. The exact configuration key varies by client; a typical shape is:

```json
{
  "mcpServers": {
    "linear_project": {
      "command": "/path/to/protected/linear-project-mcp-launcher",
      "args": []
    }
  }
}
```

The protected launcher should load credentials from the client's secret store or protected process environment and then replace itself with the `linear-project-mcp-server` process. Do not commit the launcher, `.env`, or client configuration containing secrets.

## Recommended operating sequence

1. Start with writes disabled and call `linear_project_capabilities`.
2. Resolve or inspect the exact destination with read-only tools.
3. Configure the narrowest organization, team, project, scope, repository, and note-directory allowlists.
4. Enable writes only for the intended operation.
5. Bootstrap or upsert using deterministic source markers.
6. Read back results and replay the operation; a completed import should create zero additional records.
7. Disable writes again.

Configuration is read when a server process starts. Enabling or disabling `MCP_WRITES_ENABLED` therefore requires reconnecting or restarting the relevant MCP client session before checking capabilities or invoking a write. A safe write window is:

1. Resolve and inspect the exact scope with writes disabled.
2. Stop the connected server process, use the bounded helper against the protected runtime environment, and reconnect.
3. Call `linear_project_capabilities` and confirm the expected write state and allowlists before one explicitly confirmed mutation.
4. Read the mutated record back and replay the same deterministic operation; the replay must report zero additional changes.
5. Stop the server process, disable the window with the helper, reconnect, and confirm the disabled state through `linear_project_capabilities`.

If any scope readback, replay, or disabled-state check fails, stop and leave writes disabled.

The helper accepts a 1–60 minute window, requires the scope code twice on enable, requires nonempty organization/team/project/scope allowlists plus `MCP_AUDIT_LOG_PATH`, and never extends a window implicitly. Use a protected environment file outside the repository:

```sh
linear-project-mcp-write-window status --env-file /path/to/protected.env
linear-project-mcp-write-window enable --env-file /path/to/protected.env --scope ACQI --minutes 15 --confirm ACQI
# Reconnect or restart the MCP client, verify capabilities, perform one scoped operation, read back, and replay.
linear-project-mcp-write-window disable --env-file /path/to/protected.env
# Reconnect or restart again, then verify writesEnabled is false.
```

`enable` writes `MCP_WRITES_ENABLED=true` and a bounded RFC 3339 `MCP_WRITE_WINDOW_EXPIRES_AT`. `disable` restores `MCP_WRITES_ENABLED=false` and clears the expiry. Every settings change requires reconnecting or restarting the server process; expiry is an additional fail-closed limit, not a substitute for disabling and reconnecting after the operation.

This server does not run a daemon, watch files, move reconciliation candidates automatically, or mark issues Done based only on repository evidence. The separate move tool requires exact source-state input and explicit confirmation; cross-team moves additionally require acknowledgement of identifier change and source-label replacement. Ongoing updates happen only when an MCP client explicitly invokes a tool.

## Transport and deployment

The current release supports local stdio. That is intentional for the Obsidian adapter, which reads a local vault. A future remote deployment should use the MCP SDK's Streamable HTTP transport, omit local filesystem access, add server-side authentication, and preserve the same allowlist and confirmation gates.

## Development

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run
```

Tests use in-memory Linear and MCP transports plus temporary Obsidian fixtures. They do not contact live services. Read-only evaluation questions are in [`evaluations/read-only.xml`](evaluations/read-only.xml).

Implementation references: [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), [Linear TypeScript SDK](https://linear.app/developers/sdk), [Linear teams](https://linear.app/docs/teams), [GitHub REST authentication](https://docs.github.com/en/rest/authentication), and [Obsidian URI](https://help.obsidian.md/Extending%2BObsidian/Obsidian%2BURI).

## License

MIT

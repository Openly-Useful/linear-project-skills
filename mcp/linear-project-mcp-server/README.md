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

The published package can also be run with `npx @openly-useful/linear-project-mcp-server` after a release exists.

## Configure

Copy [`.env.example`](.env.example) and provide only the adapters you need.

Linear accepts either `LINEAR_API_KEY` or `LINEAR_ACCESS_TOKEN`. Every scoped Linear read and mutation requires an exact `LINEAR_ALLOWED_ORGANIZATION_ID`; every mutation additionally requires:

- `MCP_WRITES_ENABLED=true`;
- the exact code in `LINEAR_ALLOWED_SCOPE_CODES`, such as `ACQI`;
- the destination team's ID in `LINEAR_ALLOWED_TEAM_IDS`, unless it is a dedicated team whose key exactly equals the scope code;
- the project ID in `LINEAR_ALLOWED_PROJECT_IDS` when that optional allowlist is non-empty;
- the mutating tool's literal confirmation field set to `true`.

For a new `ACQI` subteam, allowlist the parent team ID, select `team_mode: "subteam"`, pass `parent_team_id`, and use `team_key: "ACQI"`. The authenticated Linear identity must have permission to create teams in the workspace.

Leave `LINEAR_ALLOWED_PROJECT_IDS` empty only for the initial project bootstrap, because a new project's ID does not exist yet. After readback, add that exact ID before ongoing operation. Existing projects must already be allowlisted when the project-ID allowlist is non-empty, and all scoped operations require the exact scope project label.

GitHub is optional. Configure `GITHUB_TOKEN` and exact `owner/name` entries in `GITHUB_ALLOWED_REPOSITORIES`. The adapter makes GET requests only; use a fine-grained token with read-only metadata and contents, pull-request, or issue access required by the references you plan to inspect.

Obsidian is optional and local. `OBSIDIAN_VAULT_PATH` must be absolute, `OBSIDIAN_ALLOWED_DIRECTORIES` contains vault-relative directories, and `OBSIDIAN_VAULT_NAME` enables `obsidian://` links. Only `.md` files under those directories are accessible. Traversal, symlinks, non-Markdown paths, and files over 200,000 bytes are rejected. Linking a note to Linear sends only its Obsidian URI and title, not its contents.

## Connect an MCP client

Build the server, then configure a local stdio process in your MCP client. The exact configuration key varies by client; a typical shape is:

```json
{
  "mcpServers": {
    "linear-projects": {
      "command": "node",
      "args": ["/path/to/linear-project-mcp-server/dist/index.js"],
      "env": {
        "LINEAR_API_KEY": "set-this-in-your-secret-store",
        "LINEAR_ALLOWED_ORGANIZATION_ID": "workspace-id",
        "LINEAR_ALLOWED_TEAM_IDS": "parent-team-id",
        "LINEAR_ALLOWED_SCOPE_CODES": "ACQI",
        "MCP_WRITES_ENABLED": "false"
      }
    }
  }
}
```

Keep credentials in the client's secret store or process environment. Do not commit `.env` or client configuration containing secrets.

## Recommended operating sequence

1. Start with writes disabled and call `linear_project_capabilities`.
2. Resolve or inspect the exact destination with read-only tools.
3. Configure the narrowest organization, team, project, scope, repository, and note-directory allowlists.
4. Enable writes only for the intended operation.
5. Bootstrap or upsert using deterministic source markers.
6. Read back results and replay the operation; a completed import should create zero additional records.
7. Disable writes again.

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

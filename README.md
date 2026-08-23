# Linear Project Skills

Three interoperable Agent Skills and an optional MCP server for creating, maintaining, and reconciling Linear projects without pulling unrelated work into scope.

This collection is an [Openly Useful](https://openlyuseful.org) project: practical infrastructure people can inspect, adapt, and improve.

Openly Useful LLC is the planned legal entity and remains `formation-pending`. Openly Useful is currently operated by its founder as an individual, and this repository does not claim that the LLC is formed, active, or the current operator. [`publisher.json`](publisher.json) is a repo-local projection of the [public publisher authority](https://openlyuseful.org/publisher/manifest.json). The founder-owner has authorized external source and registry publication while formation proceeds; namespace verification, provider authentication, and provider review remain provider-specific steps.

## Included skills

| Skill | Use it to |
| --- | --- |
| [`linear-bootstrap-scoped-project`](skills/linear-bootstrap-scoped-project/SKILL.md) | Create a net-new project, establish the key-bearing team, link canonical sources, and import legacy work safely. |
| [`linear-sync-project-work`](skills/linear-sync-project-work/SKILL.md) | Keep implementation evidence, backlog gaps, blockers, and status current while work proceeds. |
| [`linear-reconcile-project-history`](skills/linear-reconcile-project-history/SKILL.md) | Find an existing project, move high-confidence related issues, and capture legacy evidence as `[HISTORICAL]`. |

The skills hand work to one another rather than duplicating responsibilities:

```text
new project ──> bootstrap ──> sync
                    ▲
                    │ no canonical project
existing work ─> reconcile ──> sync
```

## Optional MCP server

[`@openly-useful/linear-project-mcp-server`](mcp/linear-project-mcp-server/README.md) turns the workflows into 13 typed MCP tools. It can create a dedicated Linear team or subteam, bootstrap a scope-labeled project, capture active or `[HISTORICAL]` issues idempotently, find and explicitly move reviewed reconciliation candidates, and link verified evidence.

The server calls Linear directly through its official TypeScript SDK. GitHub evidence is optional and read-only. Obsidian support is optional, local, restricted to allowlisted Markdown directories, and never copies note contents into Linear when adding a link.

All mutations are disabled by default and require an exact organization allowlist, a scope-code allowlist, team/project gates, and a literal per-tool confirmation. See the [server setup and security guide](mcp/linear-project-mcp-server/README.md) for installation and client configuration.

The MCP integration has four intentionally distinct names:

| Name | Meaning |
| --- | --- |
| `linear_project` | Canonical Codex MCP registration alias and the name used with `codex mcp` commands. |
| `@openly-useful/linear-project-mcp-server` | npm package name. It becomes installable from npm after the first successful package release. |
| `linear-project-mcp-server` | Package executable and MCP protocol server artifact name. |
| `linear-project-mcp-write-window` | Package helper for explicitly opening, inspecting, and closing a bounded write window. |

For a source checkout, build the package and register the local executable with Codex:

```sh
cd mcp/linear-project-mcp-server
pnpm install --frozen-lockfile
pnpm build
MCP_ENTRYPOINT="$(pwd)/dist/index.js"
codex mcp add linear_project -- node "$MCP_ENTRYPOINT"
codex mcp get linear_project --json
codex mcp list --json
```

These commands contain no credentials. Supply adapter credentials through a protected launcher or secret store rather than command arguments or committed client configuration. See the [MCP client guide](mcp/linear-project-mcp-server/README.md#connect-codex) for the npm command that applies after the first release and for the expected read-only acceptance checks.

## The key rule

Linear issue identifiers inherit their prefix from a **team**, not a project or label. A workflow that must begin at `XY-1` therefore needs a new team with key `XY`, a verified empty issue history, and immediate readback of the first created issue. These skills stop instead of pretending that a project label can provide that guarantee.

## Install

Clone the repository, then copy the skills you want into the user-level skills directory supported by your agent.

For Codex:

```sh
git clone https://github.com/Openly-Useful/linear-project-skills.git
cp -R linear-project-skills/skills/linear-bootstrap-scoped-project ~/.codex/skills/
cp -R linear-project-skills/skills/linear-sync-project-work ~/.codex/skills/
cp -R linear-project-skills/skills/linear-reconcile-project-history ~/.codex/skills/
```

Start a new task or restart the agent if its skill catalog does not refresh automatically.

## Provider registration artifacts

The repository root is one aggregate plugin containing all three canonical skill directories. [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json) and [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) both point to `./skills/` and [`.mcp.json`](.mcp.json); no provider-specific skill copies or symlinks are maintained. The MCP config uses `npx`/`npm exec` to install the immutable `@openly-useful/linear-project-mcp-server@0.1.0` package and launch its server entry explicitly. This avoids ever selecting the package's separate write-window helper and remains portable across host shells. Repo-local Codex and Claude marketplace catalogs point back to the repository root for the same reason.

Registration files are generated from [`manifest.json`](manifest.json), [`publisher.json`](publisher.json), and the MCP package metadata:

```sh
python3 scripts/sync_registration.py --check
python3 scripts/sync_registration.py --write
```

The write form changes only repo-local registration files. It does not install a plugin, add a marketplace to a host, authenticate, publish a package, submit an MCP Registry record, or change the founder-authorization gate.

After installing or upgrading the plugin, start a new Codex task or restart Claude Code so the host discovers the newly registered MCP tools. The plugin never embeds credentials or scope values. Supply `LINEAR_API_KEY` or `LINEAR_ACCESS_TOKEN` and the exact `LINEAR_ALLOWED_*` settings through the host environment or a protected launcher. Without them the server still starts, writes remain disabled, and Linear tools fail closed with configuration guidance.

The MCP Registry record is [`mcp/linear-project-mcp-server/server.json`](mcp/linear-project-mcp-server/server.json). Its registry identity is `org.openlyuseful/linear-project`, while its npm package remains `@openly-useful/linear-project-mcp-server`. The official Registry requires `server.json.name` and `package.json.mcpName` to match; the repository validator enforces that equality together with package and version alignment.

## Requirements

- An agent runtime that supports the Agent Skills directory format.
- A connected Linear integration with permission to read the target workspace and perform the requested writes.
- Access to linked repositories or local project sources when those sources are part of the requested scope.
- A workspace administrator when a new Linear team or team key must be provisioned and the integration cannot create one.
- Node.js 20 or newer only when using the optional MCP server.

The skills do not include credentials, a background daemon, or permission to monitor or mutate unrelated projects.

## Example prompts

Create a project with a dedicated issue sequence:

```text
Use $linear-bootstrap-scoped-project to create the Atlas project, link its repository,
use a new team key ATLS, make the charter ATLS-1, and import the allowlisted legacy work.
```

Keep current implementation synchronized:

```text
Use $linear-sync-project-work while implementing this change. Update only the canonical
project and label, attach verified evidence, and keep incomplete work out of Done.
```

Reconcile an existing project:

```text
Use $linear-reconcile-project-history to find the canonical Atlas project, move only
exact-identity matches, and capture non-Linear legacy evidence as [HISTORICAL].
```

## Historical records

Historical capture is deliberately separate from active work. A historical issue:

- begins with `[HISTORICAL]`;
- carries the project-code and `HISTORICAL` labels;
- records stable source identity and capture time;
- states `Historical only: true` and `Actionability: none`;
- does not claim current completion, ownership, authorization, or validity;
- is deduplicated by a deterministic source marker.

## Safety model

Every workflow is read-first and scope-gated:

- resolve one canonical destination before writing;
- use allowlisted teams, labels, repositories, and source containers;
- treat fuzzy matches as evidence for review, not authority to move work;
- preserve team identifiers unless an identifier-changing move is explicitly authorized;
- never infer Done from a commit, closed source item, or agent assertion alone;
- read back every mutation and reconcile expected versus actual counts;
- require a zero-write second pass after a historical sweep.

## Validate

The repository validator uses only the Python standard library:

```sh
python3 scripts/test_validate.py
python3 scripts/validate.py
python3 scripts/sync_registration.py --check
```

To validate the MCP server too:

```sh
cd mcp/linear-project-mcp-server
pnpm install --frozen-lockfile
pnpm check
pnpm pack --dry-run
```

The repository validator checks skill structure, metadata, references, manifest entries, MCP package metadata, evaluations, placeholder text, and common private-data leaks. Pull requests run both validation paths in GitHub Actions. The MCP compatibility job runs the full server check on Node.js 20, 22, and 24; distribution validation runs once, and package-content inspection runs only on Node.js 24.

`python3 scripts/validate.py --external-publication --publication-target npm-package` checks the founder-owner authorization plus the exact publisher identity, policy URLs, namespace, repository provenance, package identity, and registry metadata used by the npm artifact. The MCP package runs that fail-closed gate from `prepublishOnly`. Formation-pending is not itself an npm package blocker because the current operator is the founder-individual and the founder-owner authorization is explicitly effective during formation. Generic provider requirements remain blocking for MCP Registry and provider submissions until their separate workflows are completed.

## Public-data boundary

Do not contribute credentials, private repository content, customer data, local absolute paths, raw conversations, or organization-specific source inventories. Examples must use synthetic names and identifiers. Public source markers should be sanitized and should reveal no secret or personal data.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository-specific workflow. Openly Useful's organization-wide [Code of Conduct](https://github.com/Openly-Useful/.github/blob/main/CODE_OF_CONDUCT.md) and [Security Policy](https://github.com/Openly-Useful/.github/blob/main/SECURITY.md) apply.

## License

Released under the [MIT License](LICENSE).

# Linear Project Skills

Three interoperable Agent Skills for creating, maintaining, and reconciling Linear projects without pulling unrelated work into scope.

This collection is an [Openly Useful](https://openlyuseful.org) project: practical infrastructure people can inspect, adapt, and improve.

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

## Requirements

- An agent runtime that supports the Agent Skills directory format.
- A connected Linear integration with permission to read the target workspace and perform the requested writes.
- Access to linked repositories or local project sources when those sources are part of the requested scope.
- A workspace administrator when a new Linear team or team key must be provisioned and the integration cannot create one.

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
python3 scripts/validate.py
```

It checks skill structure, metadata, references, manifest entries, UI prompts, placeholder text, and common private-data leaks. Pull requests run the same command in GitHub Actions.

## Public-data boundary

Do not contribute credentials, private repository content, customer data, local absolute paths, raw conversations, or organization-specific source inventories. Examples must use synthetic names and identifiers. Public source markers should be sanitized and should reveal no secret or personal data.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository-specific workflow. Openly Useful's organization-wide [Code of Conduct](https://github.com/Openly-Useful/.github/blob/main/CODE_OF_CONDUCT.md) and [Security Policy](https://github.com/Openly-Useful/.github/blob/main/SECURITY.md) apply.

## License

Released under the [MIT License](LICENSE).

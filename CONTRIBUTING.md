# Contributing

Openly Useful's [organization contribution guide](https://github.com/Openly-Useful/.github/blob/main/CONTRIBUTING.md) applies. This repository adds the requirements below.

## Propose focused changes

Open an issue before changing workflow authority, issue classification, team-key behavior, historical capture, or completion rules. Keep each pull request focused on one concern.

## Preserve the skill format

- Keep each distributable skill under `skills/<skill-name>/`.
- Keep `SKILL.md` frontmatter limited to `name` and `description`.
- Keep the folder name equal to the frontmatter name.
- Keep `SKILL.md` concise and put detailed contracts one level below it in `references/`.
- Keep `agents/openai.yaml` aligned with the skill and mention `$<skill-name>` in its default prompt.
- Update `manifest.json` when adding, removing, or renaming a skill.

## Preserve workflow boundaries

- Treat Linear issue prefixes as team keys, never project keys.
- Do not weaken read-first discovery, allowlists, deduplication, or readback.
- Do not convert historical evidence into active work automatically.
- Do not mark work Done without evidence for its full definition of done.
- Do not change an issue's team implicitly; that can change its identifier.
- Keep automatic synchronization event-driven and limited to the current authorized task.

## Preserve the MCP security boundary

- Keep mutations disabled by default and gated by exact organization and scope allowlists.
- Require literal confirmation fields on every mutating tool.
- Keep GitHub access read-only and repository-allowlisted.
- Confine Obsidian access to vault-relative Markdown under explicit directory allowlists; reject traversal and symlinks.
- Never expose credentials, SDK clients, raw database handles, or unrestricted filesystem paths through tool results.
- Add a protocol or workflow regression test whenever tool behavior or authority changes.

## Keep examples public-safe

Use synthetic names, repositories, source markers, and identifiers. Do not include secrets, customer data, private repository content, raw conversations, personal information, or local absolute paths.

## Validate

Run:

```sh
python3 scripts/validate.py
cd mcp/linear-project-mcp-server
pnpm install --frozen-lockfile
pnpm check
pnpm pack --dry-run
```

For workflow changes, also perform a dry-run against a synthetic scenario with external writes disabled. Describe the scenario and result in the pull request. Live Linear, GitHub, or Obsidian writes are never required for contribution validation.

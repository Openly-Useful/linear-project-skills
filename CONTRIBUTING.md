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
python3 scripts/test_validate.py
python3 scripts/validate.py
cd mcp/linear-project-mcp-server
pnpm install --frozen-lockfile
pnpm check
pnpm pack --dry-run
```

For workflow changes, also perform a dry-run against a synthetic scenario with external writes disabled. Describe the scenario and result in the pull request. Live Linear, GitHub, or Obsidian writes are never required for contribution validation.

## Release the MCP package

The npm package is not available until its first successful publication. Releases are fail-closed and use [`.github/workflows/release-mcp.yml`](.github/workflows/release-mcp.yml):

1. Update `mcp/linear-project-mcp-server/package.json` to a version that has never been published and merge the validated change to `main`.
2. Create a non-prerelease GitHub release whose tag is exactly `linear-project-mcp-server-v<package-version>`, for example `linear-project-mcp-server-v0.1.0`, and target the reviewed commit on `main`.
3. Publish the GitHub release. The workflow verifies the tag/version match and that the commit belongs to `main`, validates the public distribution, installs from the frozen lockfile, runs the full MCP check, inspects the package contents, and only then runs `npm publish --access public --provenance`.
4. Verify the npm package page, provenance, executable, and version-pinned `npx` command before announcing availability.

The workflow has only `contents: read` and `id-token: write` permissions. Configure npm trusted publishing for the `Openly-Useful/linear-project-skills` repository and workflow filename `release-mcp.yml`; use a GitHub-hosted runner and permit `npm publish`. Trusted publishing requires npm 11.5.1 or newer and Node.js 22.14.0 or newer.

The release workflow also enforces the fail-closed publication policy in `publisher.json`. External publication must be explicitly allowed, publisher authorization must be granted, the recorded legal entity must be active, and every blocking requirement must be resolved. Normal validation can remain green while this external-publication gate is closed; a release cannot publish through it.

For the first publication, npm may require an authenticated maintainer to establish the scoped package before its trusted publisher can be configured. If so, add a short-lived, least-privilege granular npm token as the repository secret `NPM_TOKEN`, publish the first GitHub release, configure the trusted publisher immediately, and then delete the secret. The workflow does not contain or print a credential and fails closed when neither OIDC nor an authorized token is available.

Do not reuse a published version, publish from an unreviewed branch, bypass the tag/version check, or put an npm token in repository files, workflow arguments, logs, or release notes.

import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { GitHubEvidence, GitHubEvidenceAdapter, GitHubReferenceKind } from "../types.js";
import { ScopeError } from "../security.js";

type FetchLike = typeof fetch;

const RepositorySchema = z
  .object({
    full_name: z.string(),
    html_url: z.url(),
    description: z.string().nullable(),
    updated_at: z.string(),
  })
  .passthrough();

const CommitSchema = z
  .object({
    sha: z.string(),
    html_url: z.url(),
    commit: z.object({ message: z.string() }),
  })
  .passthrough();

const WorkItemSchema = z
  .object({
    number: z.number(),
    title: z.string(),
    html_url: z.url(),
    state: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

export class GitHubRestAdapter implements GitHubEvidenceAdapter {
  readonly #token: string | undefined;
  readonly #allowedRepositories: ReadonlySet<string>;
  readonly #fetch: FetchLike;
  public readonly configured: boolean;

  public constructor(config: ServerConfig["github"], fetchImplementation: FetchLike = fetch) {
    this.#token = config.token;
    this.#allowedRepositories = config.allowedRepositories;
    this.#fetch = fetchImplementation;
    this.configured = Boolean(config.token && config.allowedRepositories.size > 0);
  }

  public async getReference(input: {
    repository: string;
    kind: GitHubReferenceKind;
    reference?: string;
  }): Promise<GitHubEvidence> {
    if (!this.#token) throw new ScopeError("GITHUB_TOKEN is not configured");
    if (!this.#allowedRepositories.has(input.repository)) {
      throw new ScopeError(`GitHub repository ${input.repository} is not allowlisted`);
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) {
      throw new ScopeError("GitHub repository must use owner/name format");
    }

    const reference = input.reference?.trim();
    let endpoint = `/repos/${input.repository}`;
    if (input.kind === "commit") {
      if (!reference || !/^[A-Fa-f0-9]{7,64}$/.test(reference)) {
        throw new ScopeError("A 7–64 character hexadecimal commit reference is required");
      }
      endpoint += `/commits/${reference}`;
    } else if (input.kind === "pull_request" || input.kind === "issue") {
      if (!reference || !/^[1-9][0-9]*$/.test(reference)) {
        throw new ScopeError("A positive pull-request or issue number is required");
      }
      endpoint += input.kind === "pull_request" ? `/pulls/${reference}` : `/issues/${reference}`;
    }

    const response = await this.#fetch(`https://api.github.com${endpoint}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.#token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "openly-useful-linear-project-mcp-server",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed with status ${response.status}; verify the repository allowlist and token permissions`);
    }
    const body: unknown = await response.json();

    if (input.kind === "repository") {
      const repository = RepositorySchema.parse(body);
      return {
        repository: input.repository,
        kind: input.kind,
        canonicalUrl: repository.html_url,
        title: repository.full_name,
        ...(repository.description ? { state: repository.description } : {}),
        updatedAt: repository.updated_at,
      };
    }
    if (input.kind === "commit") {
      const commit = CommitSchema.parse(body);
      return {
        repository: input.repository,
        kind: input.kind,
        canonicalUrl: commit.html_url,
        title: commit.commit.message.split("\n", 1)[0] ?? commit.sha,
        sha: commit.sha,
      };
    }
    const item = WorkItemSchema.parse(body);
    return {
      repository: input.repository,
      kind: input.kind,
      canonicalUrl: item.html_url,
      title: `#${item.number} ${item.title}`,
      state: item.state,
      updatedAt: item.updated_at,
    };
  }
}

import type { ServerConfig } from "../src/config.js";
import type {
  CreateIssueInput,
  CreateProjectInput,
  CreateTeamInput,
  IssuePage,
  IssueRef,
  LabelRef,
  LinearGateway,
  ProjectRef,
  TeamRef,
  UpdateIssueInput,
  UpdateProjectInput,
} from "../src/types.js";

export function testConfig(input: {
  organizationId?: string;
  writesEnabled?: boolean;
  teamIds?: readonly string[];
  projectIds?: readonly string[];
  scopeCodes?: readonly string[];
  githubRepositories?: readonly string[];
  vaultPath?: string;
  vaultName?: string;
  obsidianDirectories?: readonly string[];
} = {}): ServerConfig {
  return {
    linear: {
      apiKey: "test-key",
      accessToken: undefined,
      allowedOrganizationId: input.organizationId ?? "org-1",
      allowedTeamIds: new Set(input.teamIds ?? ["team-parent"]),
      allowedProjectIds: new Set(input.projectIds ?? []),
      allowedScopeCodes: new Set(input.scopeCodes ?? ["ACQI"]),
    },
    github: {
      token: "test-token",
      allowedRepositories: new Set(input.githubRepositories ?? ["Openly-Useful/example"]),
    },
    obsidian: {
      vaultPath: input.vaultPath,
      vaultName: input.vaultName,
      allowedDirectories: input.obsidianDirectories ?? [],
    },
    writesEnabled: input.writesEnabled ?? true,
  };
}

export class MemoryLinearGateway implements LinearGateway {
  public readonly teams: TeamRef[] = [
    { id: "team-parent", name: "Openly Helpful", key: "OPEN", issueCount: 3 },
  ];
  public readonly projects: ProjectRef[] = [];
  public readonly issueLabels: LabelRef[] = [];
  public readonly projectLabels: LabelRef[] = [];
  public readonly issues: IssueRef[] = [];
  public readonly attachments: Array<{ id: string; issueId: string; url: string; title: string }> = [];
  public readonly calls: string[] = [];
  readonly #nextIssueNumber = new Map<string, number>([["team-parent", 4]]);

  public async getOrganization(): Promise<{ id: string; name: string; urlKey: string }> {
    this.calls.push("getOrganization");
    return { id: "org-1", name: "Test Workspace", urlKey: "test" };
  }

  public async listTeams(): Promise<readonly TeamRef[]> {
    this.calls.push("listTeams");
    return structuredClone(this.teams);
  }

  public async getTeam(id: string): Promise<TeamRef> {
    this.calls.push(`getTeam:${id}`);
    return structuredClone(required(this.teams.find((team) => team.id === id), `Unknown team ${id}`));
  }

  public async createTeam(input: CreateTeamInput): Promise<TeamRef> {
    this.calls.push(`createTeam:${input.key}`);
    const team: TeamRef = {
      id: `team-${this.teams.length + 1}`,
      name: input.name,
      key: input.key,
      issueCount: 0,
      ...(input.parentId ? { parentId: input.parentId } : {}),
    };
    this.teams.push(team);
    this.#nextIssueNumber.set(team.id, 1);
    return structuredClone(team);
  }

  public async listProjectsForTeam(teamId: string): Promise<readonly ProjectRef[]> {
    this.calls.push(`listProjectsForTeam:${teamId}`);
    return structuredClone(this.projects.filter((project) => project.teamIds.includes(teamId)));
  }

  public async getProject(id: string): Promise<ProjectRef> {
    this.calls.push(`getProject:${id}`);
    return structuredClone(required(this.projects.find((project) => project.id === id), `Unknown project ${id}`));
  }

  public async createProject(input: CreateProjectInput): Promise<ProjectRef> {
    this.calls.push(`createProject:${input.name}`);
    const project: ProjectRef = {
      id: `project-${this.projects.length + 1}`,
      name: input.name,
      url: `https://linear.example/project/${this.projects.length + 1}`,
      description: input.description,
      content: input.content ?? "",
      labelIds: [...input.labelIds],
      teamIds: [...input.teamIds],
    };
    this.projects.push(project);
    return structuredClone(project);
  }

  public async updateProject(id: string, input: UpdateProjectInput): Promise<ProjectRef> {
    this.calls.push(`updateProject:${id}`);
    const index = this.projects.findIndex((project) => project.id === id);
    const existing = required(this.projects[index], `Unknown project ${id}`);
    const project: ProjectRef = {
      ...existing,
      ...(input.labelIds ? { labelIds: [...input.labelIds] } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
    };
    this.projects[index] = project;
    return structuredClone(project);
  }

  public async listIssueLabels(teamId: string): Promise<readonly LabelRef[]> {
    this.calls.push(`listIssueLabels:${teamId}`);
    return structuredClone(this.issueLabels.filter((label) => label.teamId === teamId));
  }

  public async createIssueLabel(input: {
    name: string;
    color: string;
    description: string;
    teamId: string;
  }): Promise<LabelRef> {
    this.calls.push(`createIssueLabel:${input.name}`);
    const label = { id: `issue-label-${this.issueLabels.length + 1}`, ...input };
    this.issueLabels.push(label);
    return structuredClone(label);
  }

  public async listProjectLabels(): Promise<readonly LabelRef[]> {
    this.calls.push("listProjectLabels");
    return structuredClone(this.projectLabels);
  }

  public async createProjectLabel(input: {
    name: string;
    color: string;
    description: string;
  }): Promise<LabelRef> {
    this.calls.push(`createProjectLabel:${input.name}`);
    const label = { id: `project-label-${this.projectLabels.length + 1}`, ...input };
    this.projectLabels.push(label);
    return structuredClone(label);
  }

  public async listProjectIssues(
    projectId: string,
    input: { limit: number; cursor?: string },
  ): Promise<IssuePage> {
    this.calls.push(`listProjectIssues:${projectId}`);
    const items = this.issues.filter((issue) => issue.projectId === projectId);
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const page = items.slice(offset, offset + input.limit);
    const next = offset + page.length;
    return {
      items: structuredClone(page),
      hasMore: next < items.length,
      ...(next < items.length ? { nextCursor: String(next) } : {}),
    };
  }

  public async searchIssues(query: string, limit: number): Promise<readonly IssueRef[]> {
    this.calls.push(`searchIssues:${query}`);
    const needle = query.toLowerCase();
    return structuredClone(
      this.issues.filter((issue) => `${issue.title}\n${issue.description}`.toLowerCase().includes(needle)).slice(0, limit),
    );
  }

  public async getIssue(id: string): Promise<IssueRef> {
    this.calls.push(`getIssue:${id}`);
    return structuredClone(required(this.issues.find((issue) => issue.id === id), `Unknown issue ${id}`));
  }

  public async listIssueAttachments(issueId: string): Promise<readonly { id: string; url: string; title: string }[]> {
    this.calls.push(`listIssueAttachments:${issueId}`);
    return structuredClone(this.attachments.filter((attachment) => attachment.issueId === issueId));
  }

  public async createIssue(input: CreateIssueInput): Promise<IssueRef> {
    this.calls.push(`createIssue:${input.title}`);
    const team = required(this.teams.find((candidate) => candidate.id === input.teamId), "Unknown issue team");
    const number = this.#nextIssueNumber.get(team.id) ?? 1;
    this.#nextIssueNumber.set(team.id, number + 1);
    team.issueCount += 1;
    const issue: IssueRef = {
      id: `issue-${this.issues.length + 1}`,
      identifier: `${team.key}-${number}`,
      title: input.title,
      description: input.description,
      url: `https://linear.example/issue/${team.key}-${number}`,
      teamId: team.id,
      projectId: input.projectId,
      labelIds: [...input.labelIds],
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    this.issues.push(issue);
    return structuredClone(issue);
  }

  public async updateIssue(id: string, input: UpdateIssueInput): Promise<IssueRef> {
    this.calls.push(`updateIssue:${id}`);
    const index = this.issues.findIndex((issue) => issue.id === id);
    const existing = required(this.issues[index], `Unknown issue ${id}`);
    let nextIdentifier = existing.identifier;
    if (input.teamId && input.teamId !== existing.teamId) {
      const sourceTeam = required(this.teams.find((team) => team.id === existing.teamId), "Unknown source team");
      const destinationTeam = required(this.teams.find((team) => team.id === input.teamId), "Unknown destination team");
      const number = this.#nextIssueNumber.get(destinationTeam.id) ?? 1;
      this.#nextIssueNumber.set(destinationTeam.id, number + 1);
      sourceTeam.issueCount -= 1;
      destinationTeam.issueCount += 1;
      nextIdentifier = `${destinationTeam.key}-${number}`;
    }
    const issue: IssueRef = {
      ...existing,
      identifier: nextIdentifier,
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.labelIds ? { labelIds: [...input.labelIds] } : {}),
      updatedAt: "2026-08-15T01:00:00.000Z",
    };
    this.issues[index] = issue;
    return structuredClone(issue);
  }

  public async attachIssueLink(input: {
    issueId: string;
    url: string;
    title: string;
    subtitle?: string;
  }): Promise<{ id: string; url: string }> {
    this.calls.push(`attachIssueLink:${input.issueId}`);
    const attachment = { id: `attachment-${this.attachments.length + 1}`, issueId: input.issueId, url: input.url, title: input.title };
    this.attachments.push(attachment);
    return { id: attachment.id, url: attachment.url };
  }
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

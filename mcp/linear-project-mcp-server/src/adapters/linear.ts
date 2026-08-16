import { LinearClient } from "@linear/sdk";
import type { ServerConfig } from "../config.js";
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
  AttachmentRef,
} from "../types.js";

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

export class LinearSdkGateway implements LinearGateway {
  readonly #client: LinearClient;

  public constructor(config: ServerConfig["linear"]) {
    if (config.apiKey) {
      this.#client = new LinearClient({ apiKey: config.apiKey });
    } else if (config.accessToken) {
      this.#client = new LinearClient({ accessToken: config.accessToken });
    } else {
      throw new Error("LINEAR_API_KEY or LINEAR_ACCESS_TOKEN is required for Linear tools");
    }
  }

  public async getOrganization(): Promise<{ id: string; name: string; urlKey: string }> {
    const organization = await this.#client.organization;
    return { id: organization.id, name: organization.name, urlKey: organization.urlKey };
  }

  public async listTeams(): Promise<readonly TeamRef[]> {
    const connection = await this.#client.teams({ first: 250, includeArchived: true });
    return (await fetchAll(connection)).map((team) => this.#mapTeam(team));
  }

  public async getTeam(id: string): Promise<TeamRef> {
    return this.#mapTeam(await this.#client.team(id));
  }

  public async createTeam(input: CreateTeamInput): Promise<TeamRef> {
    const payload = await this.#client.createTeam({
      name: input.name,
      key: input.key,
      cyclesEnabled: false,
      ...(input.description ? { description: input.description } : {}),
      ...(input.parentId ? { parentId: input.parentId, inheritWorkflowStatuses: true } : {}),
    });
    if (!payload.success) throw new Error("Linear reported that team creation failed");
    return this.#mapTeam(await required(payload.team, "Linear team payload omitted the created team"));
  }

  public async listProjectsForTeam(teamId: string): Promise<readonly ProjectRef[]> {
    const team = await this.#client.team(teamId);
    const connection = await team.projects({ first: 250, includeArchived: true });
    return Promise.all((await fetchAll(connection)).map((project) => this.#mapProject(project, [teamId])));
  }

  public async getProject(id: string): Promise<ProjectRef> {
    const project = await this.#client.project(id);
    const teams = await project.teams({ first: 250, includeArchived: true });
    return this.#mapProject(project, (await fetchAll(teams)).map((team) => team.id));
  }

  public async createProject(input: CreateProjectInput): Promise<ProjectRef> {
    const payload = await this.#client.createProject({
      name: input.name,
      teamIds: [...input.teamIds],
      labelIds: [...input.labelIds],
      description: input.description,
      ...(input.content ? { content: input.content } : {}),
    });
    if (!payload.success) throw new Error("Linear reported that project creation failed");
    const project = await required(payload.project, "Linear project payload omitted the created project");
    return this.#mapProject(project, input.teamIds);
  }

  public async updateProject(id: string, input: UpdateProjectInput): Promise<ProjectRef> {
    const payload = await this.#client.updateProject(id, {
      ...(input.labelIds ? { labelIds: [...input.labelIds] } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
    });
    if (!payload.success) throw new Error("Linear reported that project update failed");
    return this.getProject(id);
  }

  public async listIssueLabels(teamId: string): Promise<readonly LabelRef[]> {
    const team = await this.#client.team(teamId);
    const connection = await team.labels({ first: 250, includeArchived: true });
    return (await fetchAll(connection)).map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      ...(label.teamId ? { teamId: label.teamId } : {}),
    }));
  }

  public async createIssueLabel(input: {
    name: string;
    color: string;
    description: string;
    teamId: string;
  }): Promise<LabelRef> {
    const payload = await this.#client.createIssueLabel(input);
    if (!payload.success) throw new Error("Linear reported that issue-label creation failed");
    const label = await required(payload.issueLabel, "Linear label payload omitted the created label");
    return { id: label.id, name: label.name, color: label.color, ...(label.teamId ? { teamId: label.teamId } : {}) };
  }

  public async listProjectLabels(): Promise<readonly LabelRef[]> {
    const connection = await this.#client.projectLabels({ first: 250, includeArchived: true });
    return (await fetchAll(connection)).map((label) => ({ id: label.id, name: label.name, color: label.color }));
  }

  public async createProjectLabel(input: {
    name: string;
    color: string;
    description: string;
  }): Promise<LabelRef> {
    const payload = await this.#client.createProjectLabel(input);
    if (!payload.success) throw new Error("Linear reported that project-label creation failed");
    const label = await required(payload.projectLabel, "Linear project-label payload omitted the created label");
    return { id: label.id, name: label.name, color: label.color };
  }

  public async listProjectIssues(
    projectId: string,
    input: { limit: number; cursor?: string },
  ): Promise<IssuePage> {
    const project = await this.#client.project(projectId);
    const connection = await project.issues({
      first: input.limit,
      includeArchived: true,
      ...(input.cursor ? { after: input.cursor } : {}),
    });
    const nextCursor = connection.pageInfo.endCursor ?? undefined;
    return {
      items: connection.nodes.map((issue) => this.#mapIssue(issue)),
      hasMore: connection.pageInfo.hasNextPage,
      ...(connection.pageInfo.hasNextPage && nextCursor ? { nextCursor } : {}),
    };
  }

  public async searchIssues(query: string, limit: number): Promise<readonly IssueRef[]> {
    const payload = await this.#client.searchIssues(query, { first: limit, includeArchived: true });
    return payload.nodes.map((result) => this.#mapIssue(result));
  }

  public async getIssue(id: string): Promise<IssueRef> {
    return this.#mapIssue(await this.#client.issue(id));
  }

  public async listIssueAttachments(issueId: string): Promise<readonly AttachmentRef[]> {
    const issue = await this.#client.issue(issueId);
    const connection = await issue.attachments({ first: 250, includeArchived: true });
    return (await fetchAll(connection)).map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      title: attachment.title,
    }));
  }

  public async createIssue(input: CreateIssueInput): Promise<IssueRef> {
    const payload = await this.#client.createIssue({
      teamId: input.teamId,
      projectId: input.projectId,
      labelIds: [...input.labelIds],
      title: input.title,
      description: input.description,
    });
    if (!payload.success) throw new Error("Linear reported that issue creation failed");
    return this.#mapIssue(await required(payload.issue, "Linear issue payload omitted the created issue"));
  }

  public async updateIssue(id: string, input: UpdateIssueInput): Promise<IssueRef> {
    const payload = await this.#client.updateIssue(id, {
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.labelIds ? { labelIds: [...input.labelIds] } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
    if (!payload.success) throw new Error("Linear reported that issue update failed");
    return this.#mapIssue(await required(payload.issue, "Linear issue payload omitted the updated issue"));
  }

  public async attachIssueLink(input: {
    issueId: string;
    url: string;
    title: string;
    subtitle?: string;
  }): Promise<{ id: string; url: string }> {
    const payload = await this.#client.createAttachment({
      issueId: input.issueId,
      url: input.url,
      title: input.title,
      ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    });
    if (!payload.success) throw new Error("Linear reported that attachment creation failed");
    const attachment = await required(payload.attachment, "Linear attachment payload omitted the attachment");
    return { id: attachment.id, url: attachment.url };
  }

  #mapTeam(team: {
    id: string;
    name: string;
    key: string;
    parentId?: string | undefined;
    issueCount: number;
  }): TeamRef {
    return {
      id: team.id,
      name: team.name,
      key: team.key,
      issueCount: team.issueCount,
      ...(team.parentId ? { parentId: team.parentId } : {}),
    };
  }

  async #mapProject(
    project: {
      id: string;
      name: string;
      url: string;
      description: string;
      content?: string | null | undefined;
      labelIds: string[];
    },
    teamIds: readonly string[],
  ): Promise<ProjectRef> {
    return {
      id: project.id,
      name: project.name,
      url: project.url,
      description: project.description,
      content: project.content ?? "",
      labelIds: [...project.labelIds],
      teamIds: [...teamIds],
    };
  }

  #mapIssue(issue: {
    id: string;
    identifier: string;
    title: string;
    description?: string | null | undefined;
    url: string;
    teamId?: string | undefined;
    projectId?: string | undefined;
    labelIds: string[];
    updatedAt: Date;
  }): IssueRef {
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      url: issue.url,
      teamId: required(issue.teamId, `Issue ${issue.identifier} has no team ID`),
      ...(issue.projectId ? { projectId: issue.projectId } : {}),
      labelIds: [...issue.labelIds],
      updatedAt: issue.updatedAt.toISOString(),
    };
  }
}

async function fetchAll<T>(connection: {
  nodes: T[];
  pageInfo: { hasNextPage: boolean };
  fetchNext(): Promise<unknown>;
}): Promise<readonly T[]> {
  for (let page = 1; connection.pageInfo.hasNextPage; page += 1) {
    if (page >= 20) throw new Error("Linear collection exceeded the 5,000-record pagination safety limit");
    await connection.fetchNext();
  }
  return connection.nodes;
}

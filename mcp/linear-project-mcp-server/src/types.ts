export interface OrganizationRef {
  id: string;
  name: string;
  urlKey: string;
}

export interface TeamRef {
  id: string;
  name: string;
  key: string;
  parentId?: string;
  issueCount: number;
}

export interface ProjectRef {
  id: string;
  name: string;
  url: string;
  description: string;
  content: string;
  labelIds: readonly string[];
  teamIds: readonly string[];
}

export interface LabelRef {
  id: string;
  name: string;
  color: string;
  teamId?: string;
}

export interface IssueRef {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  teamId: string;
  projectId?: string;
  labelIds: readonly string[];
  updatedAt: string;
}

export interface IssuePage {
  items: readonly IssueRef[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface AttachmentRef {
  id: string;
  url: string;
  title: string;
}

export interface CreateTeamInput {
  name: string;
  key: string;
  description?: string;
  parentId?: string;
}

export interface CreateProjectInput {
  name: string;
  teamIds: readonly string[];
  labelIds: readonly string[];
  description: string;
  content?: string;
}

export interface UpdateProjectInput {
  labelIds?: readonly string[];
  description?: string;
  content?: string;
}

export interface CreateIssueInput {
  teamId: string;
  projectId: string;
  labelIds: readonly string[];
  title: string;
  description: string;
}

export interface UpdateIssueInput {
  teamId?: string;
  projectId?: string;
  labelIds?: readonly string[];
  title?: string;
  description?: string;
}

export interface LinearGateway {
  getOrganization(): Promise<OrganizationRef>;
  listTeams(): Promise<readonly TeamRef[]>;
  getTeam(id: string): Promise<TeamRef>;
  createTeam(input: CreateTeamInput): Promise<TeamRef>;
  listProjectsForTeam(teamId: string): Promise<readonly ProjectRef[]>;
  getProject(id: string): Promise<ProjectRef>;
  createProject(input: CreateProjectInput): Promise<ProjectRef>;
  updateProject(id: string, input: UpdateProjectInput): Promise<ProjectRef>;
  listIssueLabels(teamId: string): Promise<readonly LabelRef[]>;
  createIssueLabel(input: { name: string; color: string; description: string; teamId: string }): Promise<LabelRef>;
  listProjectLabels(): Promise<readonly LabelRef[]>;
  createProjectLabel(input: { name: string; color: string; description: string }): Promise<LabelRef>;
  listProjectIssues(projectId: string, input: { limit: number; cursor?: string }): Promise<IssuePage>;
  searchIssues(query: string, limit: number): Promise<readonly IssueRef[]>;
  getIssue(id: string): Promise<IssueRef>;
  listIssueAttachments(issueId: string): Promise<readonly AttachmentRef[]>;
  createIssue(input: CreateIssueInput): Promise<IssueRef>;
  updateIssue(id: string, input: UpdateIssueInput): Promise<IssueRef>;
  attachIssueLink(input: { issueId: string; url: string; title: string; subtitle?: string }): Promise<{ id: string; url: string }>;
}

export type GitHubReferenceKind = "repository" | "commit" | "pull_request" | "issue";

export interface GitHubEvidence {
  repository: string;
  kind: GitHubReferenceKind;
  canonicalUrl: string;
  title: string;
  state?: string;
  sha?: string;
  updatedAt?: string;
}

export interface GitHubEvidenceAdapter {
  readonly configured: boolean;
  getReference(input: {
    repository: string;
    kind: GitHubReferenceKind;
    reference?: string;
  }): Promise<GitHubEvidence>;
}

export interface ObsidianNote {
  relativePath: string;
  title: string;
  content: string;
  obsidianUri?: string;
}

export interface ObsidianAdapter {
  readonly configured: boolean;
  search(query: string, limit: number): Promise<readonly Omit<ObsidianNote, "content">[]>;
  read(relativePath: string): Promise<ObsidianNote>;
  upsertManagedSection(input: {
    relativePath: string;
    scopeCode: string;
    title: string;
    markdown: string;
  }): Promise<ObsidianNote & { changed: boolean }>;
}

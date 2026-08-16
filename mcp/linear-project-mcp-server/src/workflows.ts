import type { ServerConfig } from "./config.js";
import {
  appendUniqueBlock,
  assertOrganizationAccess,
  assertProjectAllowed,
  assertTeamAllowed,
  assertWriteAccess,
  normalizeScopeCode,
  scopeMarker,
  sourceMarker,
  ScopeError,
} from "./security.js";
import type {
  GitHubEvidenceAdapter,
  GitHubReferenceKind,
  IssueRef,
  LabelRef,
  LinearGateway,
  ObsidianAdapter,
  ProjectRef,
  TeamRef,
} from "./types.js";

const SCOPE_COLOR = "#5E6AD2";
const HISTORICAL_COLOR = "#8A8F98";

export interface WorkflowDependencies {
  config: ServerConfig;
  linear?: LinearGateway;
  github?: GitHubEvidenceAdapter;
  obsidian?: ObsidianAdapter;
}

export interface ScopeResolution {
  organization: { id: string; name: string; urlKey: string };
  scopeCode: string;
  team: TeamRef;
  project: ProjectRef;
  issueLabel?: LabelRef;
  projectLabel: LabelRef;
}

export class TrackerWorkflows {
  readonly #config: ServerConfig;
  readonly #linear: LinearGateway | undefined;
  readonly #github: GitHubEvidenceAdapter | undefined;
  readonly #obsidian: ObsidianAdapter | undefined;

  public constructor(dependencies: WorkflowDependencies) {
    this.#config = dependencies.config;
    this.#linear = dependencies.linear;
    this.#github = dependencies.github;
    this.#obsidian = dependencies.obsidian;
  }

  public async capabilities(): Promise<Record<string, unknown>> {
    let linearConnection: Record<string, unknown> = { configured: Boolean(this.#linear), reachable: false };
    if (this.#linear) {
      try {
        const organization = await this.#linear.getOrganization();
        linearConnection = {
          configured: true,
          reachable: true,
          organization: { id: organization.id, name: organization.name },
          organizationAllowed: organization.id === this.#config.linear.allowedOrganizationId,
        };
      } catch (error) {
        linearConnection = {
          configured: true,
          reachable: false,
          error: safeMessage(error),
        };
      }
    }
    return {
      server: "linear-project-mcp-server",
      protocolSdk: "@modelcontextprotocol/server@2",
      writesEnabled: this.#config.writesEnabled,
      linear: {
        ...linearConnection,
        teamAdministration: true,
        teamKeyCreation: true,
        subteamCreation: true,
        projectLabels: true,
        issueLabels: true,
        scopedIssueWrites: true,
      },
      github: {
        configured: this.#github?.configured ?? false,
        mode: "read-only evidence",
        allowedRepositoryCount: this.#config.github.allowedRepositories.size,
      },
      obsidian: {
        configured: this.#obsidian?.configured ?? false,
        mode: "allowlisted local Markdown",
        allowedDirectoryCount: this.#config.obsidian.allowedDirectories.length,
        uriLinking: Boolean(this.#config.obsidian.vaultName),
      },
      allowlists: {
        organization: Boolean(this.#config.linear.allowedOrganizationId),
        teamCount: this.#config.linear.allowedTeamIds.size,
        projectCount: this.#config.linear.allowedProjectIds.size,
        scopeCodes: [...this.#config.linear.allowedScopeCodes].sort(),
      },
    };
  }

  public async ensureTeam(input: {
    scopeCode: string;
    name: string;
    key?: string;
    description?: string;
    parentTeamId?: string;
  }): Promise<{ team: TeamRef; created: boolean }> {
    const linear = this.#requireLinear();
    const organization = await linear.getOrganization();
    const scopeCode = assertWriteAccess(this.#config, organization.id, input.scopeCode);
    const key = normalizeScopeCode(input.key ?? scopeCode);
    if (key !== scopeCode) {
      throw new ScopeError(`New team key ${key} must equal the allowlisted scope code ${scopeCode}`);
    }
    if (input.parentTeamId) {
      const parent = await linear.getTeam(input.parentTeamId);
      assertTeamAllowed(this.#config, parent, scopeCode);
    }
    const matches = (await linear.listTeams()).filter((team) => team.key.toUpperCase() === key);
    if (matches.length > 1) throw new ScopeError(`Multiple teams unexpectedly use key ${key}`);
    const existing = matches[0];
    if (existing) {
      if (existing.name !== input.name || (existing.parentId ?? undefined) !== (input.parentTeamId ?? undefined)) {
        throw new ScopeError(`Team key ${key} already belongs to a different team or parent`);
      }
      assertTeamAllowed(this.#config, existing, scopeCode);
      return { team: existing, created: false };
    }
    const team = await linear.createTeam({
      name: input.name,
      key,
      ...(input.description ? { description: input.description } : {}),
      ...(input.parentTeamId ? { parentId: input.parentTeamId } : {}),
    });
    const readback = await linear.getTeam(team.id);
    if (readback.key.toUpperCase() !== key || readback.name !== input.name) {
      throw new Error("Linear team readback did not match the requested name and key");
    }
    if (readback.issueCount !== 0) {
      throw new Error("New Linear team unexpectedly has issue history; first-identifier guarantees are unavailable");
    }
    return { team: readback, created: true };
  }

  public async resolveScope(input: {
    scopeCode: string;
    teamId?: string;
    teamKey?: string;
    projectId?: string;
    projectName?: string;
  }): Promise<ScopeResolution> {
    const linear = this.#requireLinear();
    const scopeCode = this.#assertReadableScope(input.scopeCode);
    const organization = await linear.getOrganization();
    assertOrganizationAccess(this.#config, organization.id);
    const team = input.teamId
      ? await linear.getTeam(input.teamId)
      : exactOne(
          (await linear.listTeams()).filter(
            (candidate) => candidate.key.toUpperCase() === input.teamKey?.trim().toUpperCase(),
          ),
          `team key ${input.teamKey ?? "<missing>"}`,
        );
    assertTeamAllowed(this.#config, team, scopeCode);
    const project = input.projectId
      ? await linear.getProject(input.projectId)
      : exactOne(
          (await linear.listProjectsForTeam(team.id)).filter((candidate) => candidate.name === input.projectName?.trim()),
          `project name ${input.projectName ?? "<missing>"}`,
        );
    assertProjectAllowed(this.#config, project, team, scopeCode);
    const issueLabel = uniqueOptional(
      (await linear.listIssueLabels(team.id)).filter((label) => label.name.toUpperCase() === scopeCode),
      `issue label ${scopeCode}`,
    );
    const projectLabel = uniqueOptional(
      (await linear.listProjectLabels()).filter((label) => label.name.toUpperCase() === scopeCode),
      `project label ${scopeCode}`,
    );
    if (!projectLabel || !project.labelIds.includes(projectLabel.id)) {
      throw new ScopeError(`Project ${project.name} does not carry the required ${scopeCode} project label`);
    }
    return {
      organization,
      scopeCode,
      team,
      project,
      ...(issueLabel ? { issueLabel } : {}),
      projectLabel,
    };
  }

  public async bootstrap(input: {
    scopeCode: string;
    projectName: string;
    projectDescription?: string;
    teamMode: "existing" | "dedicated" | "subteam";
    existingTeamId?: string;
    teamName?: string;
    teamKey?: string;
    parentTeamId?: string;
    githubRepository?: string;
    obsidianNotePath?: string;
    createObsidianNote?: boolean;
    firstIssue?: {
      title: string;
      description?: string;
      sourceMarker: string;
      historical?: boolean;
      expectedIdentifier?: string;
    };
  }): Promise<Record<string, unknown>> {
    const linear = this.#requireLinear();
    const organization = await linear.getOrganization();
    const scopeCode = assertWriteAccess(this.#config, organization.id, input.scopeCode);
    const mutations: string[] = [];
    const warnings: string[] = [];

    let team: TeamRef;
    let teamCreated = false;
    if (input.teamMode === "existing") {
      if (!input.existingTeamId) throw new ScopeError("existingTeamId is required when teamMode is existing");
      team = await linear.getTeam(input.existingTeamId);
      assertTeamAllowed(this.#config, team, scopeCode);
    } else {
      if (!input.teamName) throw new ScopeError("teamName is required when creating a dedicated team or subteam");
      if (input.teamMode === "subteam" && !input.parentTeamId) {
        throw new ScopeError("parentTeamId is required when teamMode is subteam");
      }
      const ensured = await this.ensureTeam({
        scopeCode,
        name: input.teamName,
        key: input.teamKey ?? scopeCode,
        description: `Dedicated tracking team for scope ${scopeCode}.`,
        ...(input.teamMode === "subteam" && input.parentTeamId ? { parentTeamId: input.parentTeamId } : {}),
      });
      team = ensured.team;
      teamCreated = ensured.created;
      if (teamCreated) mutations.push(`created team ${team.key}`);
    }

    // Validate first-identifier expectations before creating labels, notes, or a
    // project. Existing teams keep their own key and cannot manufacture a
    // project-scoped identifier such as ACQI-1.
    if (input.firstIssue?.expectedIdentifier) {
      const expected = input.firstIssue.expectedIdentifier.trim().toUpperCase();
      const actualFirstIdentifier = `${team.key.toUpperCase()}-1`;
      if (expected !== actualFirstIdentifier) {
        throw new ScopeError(`Expected first identifier must be ${actualFirstIdentifier} for this team`);
      }
    }

    const projectMatches = (await linear.listProjectsForTeam(team.id)).filter(
      (candidate) => candidate.name === input.projectName.trim(),
    );
    if (projectMatches.length > 1) throw new ScopeError(`Multiple projects match exact name ${input.projectName}`);
    let project = projectMatches[0];
    if (!project && this.#config.linear.allowedProjectIds.size > 0) {
      throw new ScopeError(
        "Cannot create a project while LINEAR_ALLOWED_PROJECT_IDS is non-empty because the new project ID is not known yet",
      );
    }
    if (project) assertProjectAllowed(this.#config, project, team, scopeCode);

    if (input.firstIssue?.expectedIdentifier) {
      const expected = input.firstIssue.expectedIdentifier.trim().toUpperCase();
      if (teamCreated) {
        if (team.issueCount !== 0) {
          throw new ScopeError(`New team ${team.key} unexpectedly has issues; ${expected} cannot be guaranteed`);
        }
      } else if (project) {
        const existingFirstIssue = await this.#findIssueByMarker(
          project.id,
          sourceMarker(input.firstIssue.sourceMarker),
        );
        if (
          !existingFirstIssue ||
          existingFirstIssue.identifier !== expected ||
          existingFirstIssue.teamId !== team.id ||
          existingFirstIssue.projectId !== project.id
        ) {
          throw new ScopeError(
            `${expected} can be guaranteed only on a team created in this bootstrap or replayed from an exact verified issue`,
          );
        }
      } else {
        throw new ScopeError(
          `${expected} can be guaranteed only on a team created in this bootstrap or replayed from an exact verified issue`,
        );
      }
    }

    const githubEvidence = input.githubRepository
      ? await this.#requireGitHub().getReference({ repository: input.githubRepository, kind: "repository" })
      : undefined;
    let obsidianNote:
      | { relativePath: string; title: string; obsidianUri?: string }
      | undefined;
    if (input.obsidianNotePath) {
      const obsidian = this.#requireObsidian();
      if (input.createObsidianNote) {
        const note = await obsidian.upsertManagedSection({
          relativePath: input.obsidianNotePath,
          scopeCode,
          title: input.projectName,
          markdown: `Linear scope: ${scopeCode}\n\nProject: ${input.projectName}`,
        });
        mutations.push(`upserted Obsidian note ${note.relativePath}`);
        obsidianNote = note;
      } else {
        obsidianNote = await obsidian.read(input.obsidianNotePath);
      }
      if (!obsidianNote.obsidianUri) warnings.push("Obsidian note was verified but OBSIDIAN_VAULT_NAME is absent, so no URI was linked");
    }

    const issueLabel = await this.#ensureIssueLabel(team.id, scopeCode, mutations);
    const projectLabel = await this.#ensureProjectLabel(scopeCode, mutations);
    const projectBlock = [
      scopeMarker(scopeCode),
      `Scope code: ${scopeCode}`,
      githubEvidence ? `Repository: ${githubEvidence.canonicalUrl}` : undefined,
      obsidianNote?.obsidianUri ? `Notes: ${obsidianNote.obsidianUri}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    if (!project) {
      project = await linear.createProject({
        name: input.projectName.trim(),
        teamIds: [team.id],
        labelIds: [projectLabel.id],
        description: appendUniqueBlock(input.projectDescription ?? "", projectBlock, scopeMarker(scopeCode)),
      });
      mutations.push(`created project ${project.name}`);
    } else {
      assertProjectAllowed(this.#config, project, team, scopeCode);
      const nextLabels = unique([...project.labelIds, projectLabel.id]);
      const nextDescription = appendUniqueBlock(project.description, projectBlock, scopeMarker(scopeCode));
      if (!sameValues(nextLabels, project.labelIds) || nextDescription !== project.description) {
        project = await linear.updateProject(project.id, { labelIds: nextLabels, description: nextDescription });
        mutations.push(`applied ${scopeCode} project scope`);
      }
    }
    assertProjectAllowed(this.#config, project, team, scopeCode);

    let firstIssue: IssueRef | undefined;
    if (input.firstIssue) {
      const upsert = await this.#upsertIssueResolved({
        scopeCode,
        team,
        project,
        issueLabel,
        title: input.firstIssue.title,
        description: input.firstIssue.description ?? "",
        stableSourceMarker: input.firstIssue.sourceMarker,
        historical: input.firstIssue.historical ?? false,
        updateExisting: false,
        ...(input.firstIssue.expectedIdentifier ? { expectedIdentifier: input.firstIssue.expectedIdentifier } : {}),
        mutations,
      });
      firstIssue = upsert.issue;
      if (input.firstIssue.expectedIdentifier && firstIssue.identifier !== input.firstIssue.expectedIdentifier) {
        throw new Error(
          `Linear created ${firstIssue.identifier}, not expected ${input.firstIssue.expectedIdentifier}; stop further issue creation`,
        );
      }
    }

    const readbackProject = await linear.getProject(project.id);
    const readbackTeam = await linear.getTeam(team.id);
    return {
      organization: { id: organization.id, name: organization.name },
      scopeCode,
      team: readbackTeam,
      project: readbackProject,
      issueLabel,
      projectLabel,
      ...(firstIssue ? { firstIssue } : {}),
      links: {
        ...(githubEvidence ? { github: githubEvidence.canonicalUrl } : {}),
        ...(obsidianNote?.obsidianUri ? { obsidian: obsidianNote.obsidianUri } : {}),
      },
      mutations,
      warnings,
    };
  }

  public async listScopedIssues(input: {
    scopeCode: string;
    teamId: string;
    projectId: string;
    limit: number;
    cursor?: string;
  }): Promise<unknown> {
    const resolved = await this.resolveScope({
      scopeCode: input.scopeCode,
      teamId: input.teamId,
      projectId: input.projectId,
    });
    if (!resolved.issueLabel) {
      return { scopeCode: resolved.scopeCode, project: resolved.project, items: [], hasMore: false };
    }
    const page = await this.#requireLinear().listProjectIssues(resolved.project.id, {
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    const items = page.items.filter((issue) => issue.labelIds.includes(resolved.issueLabel!.id));
    return {
      scopeCode: resolved.scopeCode,
      project: { id: resolved.project.id, name: resolved.project.name },
      count: items.length,
      items,
      hasMore: page.hasMore,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  public async upsertScopedIssue(input: {
    scopeCode: string;
    teamId: string;
    projectId: string;
    title: string;
    description?: string;
    stableSourceMarker: string;
    historical?: boolean;
    updateExisting?: boolean;
  }): Promise<Record<string, unknown>> {
    const linear = this.#requireLinear();
    const organization = await linear.getOrganization();
    const scopeCode = assertWriteAccess(this.#config, organization.id, input.scopeCode);
    const resolved = await this.resolveScope({ scopeCode, teamId: input.teamId, projectId: input.projectId });
    const team = resolved.team;
    const project = resolved.project;
    const mutations: string[] = [];
    const issueLabel = resolved.issueLabel ?? await this.#ensureIssueLabel(team.id, scopeCode, mutations);
    const result = await this.#upsertIssueResolved({
      scopeCode,
      team,
      project,
      issueLabel,
      title: input.title,
      description: input.description ?? "",
      stableSourceMarker: input.stableSourceMarker,
      historical: input.historical ?? false,
      updateExisting: input.updateExisting ?? true,
      mutations,
    });
    return { ...result, mutations };
  }

  public async findCandidates(input: {
    scopeCode: string;
    destinationTeamId: string;
    destinationProjectId: string;
    query: string;
    limit: number;
  }): Promise<Record<string, unknown>> {
    const resolved = await this.resolveScope({
      scopeCode: input.scopeCode,
      teamId: input.destinationTeamId,
      projectId: input.destinationProjectId,
    });
    const candidates = await this.#requireLinear().searchIssues(input.query, input.limit);
    const scoped: Array<Record<string, unknown>> = [];
    for (const issue of candidates) {
      const team = await this.#requireLinear().getTeam(issue.teamId);
      try {
        assertTeamAllowed(this.#config, team, resolved.scopeCode);
      } catch {
        continue;
      }
      scoped.push({
        ...issue,
        alreadyInDestinationProject: issue.projectId === resolved.project.id,
        hasScopeLabel: resolved.issueLabel ? issue.labelIds.includes(resolved.issueLabel.id) : false,
        historicalTitle: issue.title.startsWith("[HISTORICAL] "),
      });
    }
    return {
      destination: { team: resolved.team, project: resolved.project, scopeCode: resolved.scopeCode },
      count: scoped.length,
      candidates: scoped,
      note: "Results are candidates only. Moving issues requires separate explicit authorization and exact-identity evidence.",
    };
  }

  public async moveCandidate(input: {
    scopeCode: string;
    issueId: string;
    expectedSourceTeamId: string;
    expectedSourceProjectId: string | null;
    destinationTeamId: string;
    destinationProjectId: string;
    reason: string;
    allowTeamChange: boolean;
    confirmIdentifierChange: boolean;
    confirmLabelReplacement: boolean;
  }): Promise<Record<string, unknown>> {
    const linear = this.#requireLinear();
    const organization = await linear.getOrganization();
    const scopeCode = assertWriteAccess(this.#config, organization.id, input.scopeCode);
    const destination = await this.resolveScope({
      scopeCode,
      teamId: input.destinationTeamId,
      projectId: input.destinationProjectId,
    });
    const issue = await linear.getIssue(input.issueId);

    if (
      issue.teamId === destination.team.id &&
      issue.projectId === destination.project.id &&
      destination.issueLabel &&
      issue.labelIds.includes(destination.issueLabel.id)
    ) {
      return { issue, moved: false, replayed: true, identifierChanged: false };
    }

    if (issue.teamId !== input.expectedSourceTeamId) {
      throw new ScopeError("Issue team changed after candidate review; rerun discovery before moving it");
    }
    if ((issue.projectId ?? null) !== input.expectedSourceProjectId) {
      throw new ScopeError("Issue project changed after candidate review; rerun discovery before moving it");
    }
    const sourceTeam = await linear.getTeam(issue.teamId);
    assertTeamAllowed(this.#config, sourceTeam, scopeCode);
    const teamChange = sourceTeam.id !== destination.team.id;
    if (teamChange && !input.allowTeamChange) {
      throw new ScopeError(
        `Moving ${issue.identifier} to team ${destination.team.key} changes its identifier; explicit team-change authorization is required`,
      );
    }
    if (teamChange && (!input.confirmIdentifierChange || !input.confirmLabelReplacement)) {
      throw new ScopeError("Cross-team moves require confirmation of both identifier change and source-label replacement");
    }

    const mutations: string[] = [];
    const issueLabel = destination.issueLabel ?? await this.#ensureIssueLabel(destination.team.id, scopeCode, mutations);
    const originalIdentifier = issue.identifier;
    const originalLabelIds = [...issue.labelIds];
    const moveIdentity = `<!-- openly-useful-linear:move ${scopeCode}:${issue.id} -->`;
    const moveBlock = [
      moveIdentity,
      scopeMarker(scopeCode),
      `Move reason: ${input.reason.trim()}`,
      `Original identifier: ${originalIdentifier}`,
      `Original team ID: ${sourceTeam.id}`,
      `Original project ID: ${issue.projectId ?? "none"}`,
      teamChange ? `Original label IDs: ${originalLabelIds.join(",") || "none"}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
    await linear.updateIssue(issue.id, {
      ...(teamChange ? { teamId: destination.team.id } : {}),
      projectId: destination.project.id,
      labelIds: teamChange ? [issueLabel.id] : unique([...issue.labelIds, issueLabel.id]),
      description: appendUniqueBlock(issue.description, moveBlock, moveIdentity),
    });
    const readback = await linear.getIssue(issue.id);
    if (readback.teamId !== destination.team.id || readback.projectId !== destination.project.id) {
      throw new Error("Linear issue readback did not match the authorized destination");
    }
    if (!readback.labelIds.includes(issueLabel.id)) {
      throw new Error(`Linear issue readback is missing the ${scopeCode} scope label`);
    }
    if (!teamChange && readback.identifier !== originalIdentifier) {
      throw new Error("Same-team project move unexpectedly changed the issue identifier");
    }
    mutations.push(`moved issue ${originalIdentifier} to ${destination.project.name}`);
    return {
      issue: readback,
      previous: {
        identifier: originalIdentifier,
        teamId: sourceTeam.id,
        projectId: issue.projectId ?? null,
        labelIds: originalLabelIds,
      },
      moved: true,
      replayed: false,
      identifierChanged: readback.identifier !== originalIdentifier,
      mutations,
    };
  }

  public async linkEvidence(input: {
    scopeCode: string;
    teamId: string;
    projectId: string;
    issueId: string;
    source: "github" | "obsidian";
    title: string;
    githubRepository?: string;
    githubKind?: GitHubReferenceKind;
    githubReference?: string;
    obsidianNotePath?: string;
  }): Promise<Record<string, unknown>> {
    const linear = this.#requireLinear();
    const organization = await linear.getOrganization();
    const scopeCode = assertWriteAccess(this.#config, organization.id, input.scopeCode);
    const resolved = await this.resolveScope({ scopeCode, teamId: input.teamId, projectId: input.projectId });
    const issue = await linear.getIssue(input.issueId);
    if (issue.teamId !== resolved.team.id || issue.projectId !== resolved.project.id) {
      throw new ScopeError("Issue is outside the exact destination team and project");
    }
    if (!resolved.issueLabel || !issue.labelIds.includes(resolved.issueLabel.id)) {
      throw new ScopeError(`Issue does not carry the required ${scopeCode} scope label`);
    }

    if (input.source === "github") {
      if (!input.githubRepository || !input.githubKind) {
        throw new ScopeError("githubRepository and githubKind are required for GitHub evidence");
      }
      const evidence = await this.#requireGitHub().getReference({
        repository: input.githubRepository,
        kind: input.githubKind,
        ...(input.githubReference ? { reference: input.githubReference } : {}),
      });
      const existingAttachment = (await linear.listIssueAttachments(issue.id)).find(
        (attachment) => attachment.url === evidence.canonicalUrl,
      );
      if (existingAttachment) {
        return {
          source: "github",
          evidence,
          attachment: existingAttachment,
          issue,
          replayed: true,
        };
      }
      const attachment = await linear.attachIssueLink({
        issueId: issue.id,
        url: evidence.canonicalUrl,
        title: input.title,
        subtitle: `${evidence.kind} evidence from ${evidence.repository}`,
      });
      const readback = await linear.getIssue(issue.id);
      return { source: "github", evidence, attachment, issue: readback, replayed: false };
    }

    if (!input.obsidianNotePath) throw new ScopeError("obsidianNotePath is required for Obsidian evidence");
    const note = await this.#requireObsidian().read(input.obsidianNotePath);
    if (!note.obsidianUri) {
      throw new ScopeError("OBSIDIAN_VAULT_NAME is required to create a portable Obsidian link");
    }
    const identity = `<!-- obsidian-evidence:${note.relativePath} -->`;
    const block = `${identity}\n- [${input.title}](${note.obsidianUri})`;
    const updated = await linear.updateIssue(issue.id, {
      description: appendUniqueBlock(issue.description, block, identity),
    });
    return {
      source: "obsidian",
      note: { relativePath: note.relativePath, title: note.title, obsidianUri: note.obsidianUri },
      issue: updated,
    };
  }

  public async githubReference(input: {
    repository: string;
    kind: GitHubReferenceKind;
    reference?: string;
  }): Promise<unknown> {
    return this.#requireGitHub().getReference(input);
  }

  public async obsidianSearch(query: string, limit: number): Promise<Record<string, unknown>> {
    const items = await this.#requireObsidian().search(query, limit);
    return { count: items.length, items };
  }

  public async obsidianRead(relativePath: string): Promise<unknown> {
    return this.#requireObsidian().read(relativePath);
  }

  public async obsidianUpsert(input: {
    relativePath: string;
    scopeCode: string;
    title: string;
    markdown: string;
  }): Promise<Record<string, unknown>> {
    const linear = this.#requireLinear();
    const organization = await linear.getOrganization();
    const scopeCode = assertWriteAccess(this.#config, organization.id, input.scopeCode);
    const note = await this.#requireObsidian().upsertManagedSection({ ...input, scopeCode });
    return {
      relativePath: note.relativePath,
      title: note.title,
      ...(note.obsidianUri ? { obsidianUri: note.obsidianUri } : {}),
    };
  }

  async #upsertIssueResolved(input: {
    scopeCode: string;
    team: TeamRef;
    project: ProjectRef;
    issueLabel: LabelRef;
    title: string;
    description: string;
    stableSourceMarker: string;
    historical: boolean;
    updateExisting: boolean;
    expectedIdentifier?: string;
    mutations: string[];
  }): Promise<{ issue: IssueRef; created: boolean; replayed: boolean }> {
    const linear = this.#requireLinear();
    const marker = sourceMarker(input.stableSourceMarker);
    const existing = await this.#findIssueByMarker(input.project.id, marker);
    const labels = [input.issueLabel.id];
    if (input.historical) {
      const historicalLabel = await this.#ensureIssueLabel(input.team.id, "HISTORICAL", input.mutations, false);
      labels.push(historicalLabel.id);
    }
    const title = input.historical && !input.title.startsWith("[HISTORICAL] ")
      ? `[HISTORICAL] ${input.title.trim()}`
      : input.title.trim();
    const metadata = [
      scopeMarker(input.scopeCode),
      marker,
      input.historical ? "Historical only: true" : "Historical only: false",
      input.historical ? "Actionability: none" : "Actionability: active",
    ].join("\n");
    const description = appendUniqueBlock(input.description, metadata, marker);

    if (existing) {
      if (existing.teamId !== input.team.id || existing.projectId !== input.project.id) {
        throw new ScopeError("Stable source marker already exists outside the exact destination scope");
      }
      if (!input.updateExisting) return { issue: existing, created: false, replayed: true };
      const nextLabels = unique([...existing.labelIds, ...labels]);
      if (existing.title === title && existing.description === description && sameValues(existing.labelIds, nextLabels)) {
        return { issue: existing, created: false, replayed: true };
      }
      const updated = await linear.updateIssue(existing.id, {
        title,
        description,
        labelIds: nextLabels,
      });
      input.mutations.push(`updated issue ${updated.identifier}`);
      return { issue: updated, created: false, replayed: false };
    }

    if (input.expectedIdentifier) {
      const expected = input.expectedIdentifier.trim().toUpperCase();
      if (expected !== `${input.team.key.toUpperCase()}-1`) {
        throw new ScopeError(`Expected first identifier must be ${input.team.key.toUpperCase()}-1 for this team`);
      }
      const readbackTeam = await linear.getTeam(input.team.id);
      if (readbackTeam.issueCount !== 0) {
        throw new ScopeError(`Team ${readbackTeam.key} already has issues; ${expected} cannot be guaranteed`);
      }
    }
    const created = await linear.createIssue({
      teamId: input.team.id,
      projectId: input.project.id,
      labelIds: unique(labels),
      title,
      description,
    });
    input.mutations.push(`created issue ${created.identifier}`);
    const readback = await linear.getIssue(created.id);
    if (readback.projectId !== input.project.id || readback.teamId !== input.team.id) {
      throw new Error("Linear issue readback escaped the requested project or team");
    }
    if (!readback.labelIds.includes(input.issueLabel.id)) {
      throw new Error(`Linear issue readback is missing the ${input.scopeCode} label`);
    }
    return { issue: readback, created: true, replayed: false };
  }

  async #findIssueByMarker(projectId: string, marker: string): Promise<IssueRef | undefined> {
    const linear = this.#requireLinear();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await linear.listProjectIssues(projectId, { limit: 100, ...(cursor ? { cursor } : {}) });
      const matches = page.items.filter((issue) => issue.description.includes(marker));
      if (matches.length > 1) throw new ScopeError(`Multiple issues contain stable marker ${marker}`);
      if (matches[0]) return matches[0];
      if (!page.hasMore || !page.nextCursor) return undefined;
      cursor = page.nextCursor;
    }
    throw new ScopeError("Marker search exceeded 1,000 project issues; narrow or repair the project before writing");
  }

  async #ensureIssueLabel(
    teamId: string,
    nameInput: string,
    mutations: string[],
    enforceScope = true,
  ): Promise<LabelRef> {
    const name = enforceScope ? normalizeScopeCode(nameInput) : nameInput.trim().toUpperCase();
    const matches = (await this.#requireLinear().listIssueLabels(teamId)).filter(
      (label) => label.name.toUpperCase() === name,
    );
    const existing = uniqueOptional(matches, `issue label ${name}`);
    if (existing) return existing;
    const label = await this.#requireLinear().createIssueLabel({
      name,
      color: name === "HISTORICAL" ? HISTORICAL_COLOR : SCOPE_COLOR,
      description:
        name === "HISTORICAL"
          ? "Legacy evidence captured for reference; not active work."
          : `Exact project scope marker for ${name}.`,
      teamId,
    });
    mutations.push(`created issue label ${name}`);
    return label;
  }

  async #ensureProjectLabel(scopeCodeInput: string, mutations: string[]): Promise<LabelRef> {
    const scopeCode = normalizeScopeCode(scopeCodeInput);
    const matches = (await this.#requireLinear().listProjectLabels()).filter(
      (label) => label.name.toUpperCase() === scopeCode,
    );
    const existing = uniqueOptional(matches, `project label ${scopeCode}`);
    if (existing) return existing;
    const label = await this.#requireLinear().createProjectLabel({
      name: scopeCode,
      color: SCOPE_COLOR,
      description: `Exact project scope marker for ${scopeCode}.`,
    });
    mutations.push(`created project label ${scopeCode}`);
    return label;
  }

  #assertReadableScope(scopeCodeInput: string): string {
    const scopeCode = normalizeScopeCode(scopeCodeInput);
    if (!this.#config.linear.allowedScopeCodes.has(scopeCode)) {
      throw new ScopeError(`Scope code ${scopeCode} is not allowlisted`);
    }
    return scopeCode;
  }

  #requireLinear(): LinearGateway {
    if (!this.#linear) throw new ScopeError("Linear is not configured; set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN");
    return this.#linear;
  }

  #requireGitHub(): GitHubEvidenceAdapter {
    if (!this.#github?.configured) {
      throw new ScopeError("GitHub adapter requires GITHUB_TOKEN and GITHUB_ALLOWED_REPOSITORIES");
    }
    return this.#github;
  }

  #requireObsidian(): ObsidianAdapter {
    if (!this.#obsidian?.configured) {
      throw new ScopeError("Obsidian adapter requires OBSIDIAN_VAULT_PATH and OBSIDIAN_ALLOWED_DIRECTORIES");
    }
    return this.#obsidian;
  }
}

function exactOne<T>(items: readonly T[], description: string): T {
  if (items.length !== 1) throw new ScopeError(`Expected exactly one ${description}; found ${items.length}`);
  return items[0]!;
}

function uniqueOptional<T>(items: readonly T[], description: string): T | undefined {
  if (items.length > 1) throw new ScopeError(`Expected at most one ${description}; found ${items.length}`);
  return items[0];
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

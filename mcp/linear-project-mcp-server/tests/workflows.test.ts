import { describe, expect, it } from "vitest";
import { TrackerWorkflows } from "../src/workflows.js";
import { MemoryLinearGateway, testConfig } from "./helpers.js";

describe("TrackerWorkflows", () => {
  it("fails closed when writes are disabled", async () => {
    const linear = new MemoryLinearGateway();
    const workflows = new TrackerWorkflows({ config: testConfig({ writesEnabled: false }), linear });

    await expect(
      workflows.ensureTeam({ scopeCode: "ACQI", name: "Acquisition Intelligence" }),
    ).rejects.toThrow("Mutations are disabled");
    expect(linear.calls.some((call) => call.startsWith("createTeam"))).toBe(false);
  });

  it("fails scoped reads when the authenticated workspace is not allowlisted", async () => {
    const linear = new MemoryLinearGateway();
    const workflows = new TrackerWorkflows({ config: testConfig({ organizationId: "org-other" }), linear });

    await expect(
      workflows.resolveScope({
        scopeCode: "ACQI",
        teamId: "team-parent",
        projectId: "project-missing",
      }),
    ).rejects.toThrow("does not match LINEAR_ALLOWED_ORGANIZATION_ID");
    expect(linear.calls).toEqual(["getOrganization"]);
  });

  it("does not treat an unlabeled project on an allowed team as ACQI scope", async () => {
    const linear = new MemoryLinearGateway();
    const project = await linear.createProject({
      name: "Unrelated",
      teamIds: ["team-parent"],
      labelIds: [],
      description: "",
    });
    const workflows = new TrackerWorkflows({ config: testConfig(), linear });

    await expect(
      workflows.resolveScope({ scopeCode: "ACQI", teamId: "team-parent", projectId: project.id }),
    ).rejects.toThrow("does not carry the required ACQI project label");
  });

  it("preflights project-ID allowlists before creating a new project", async () => {
    const linear = new MemoryLinearGateway();
    const workflows = new TrackerWorkflows({ config: testConfig({ projectIds: ["project-existing"] }), linear });

    await expect(
      workflows.bootstrap({
        scopeCode: "ACQI",
        projectName: "Acquisition Intelligence",
        teamMode: "existing",
        existingTeamId: "team-parent",
      }),
    ).rejects.toThrow("Cannot create a project while LINEAR_ALLOWED_PROJECT_IDS is non-empty");
    expect(linear.projects).toHaveLength(0);
    expect(linear.issueLabels).toHaveLength(0);
    expect(linear.projectLabels).toHaveLength(0);
  });

  it("creates an ACQI subteam, project labels, and ACQI-1 with readback", async () => {
    const linear = new MemoryLinearGateway();
    const workflows = new TrackerWorkflows({ config: testConfig(), linear });

    const output = await workflows.bootstrap({
      scopeCode: "ACQI",
      projectName: "Acquisition Intelligence",
      teamMode: "subteam",
      teamName: "Acquisition Intelligence",
      parentTeamId: "team-parent",
      firstIssue: {
        title: "Project charter",
        sourceMarker: "bootstrap:charter:v1",
        expectedIdentifier: "ACQI-1",
      },
    });

    expect(output).toMatchObject({
      scopeCode: "ACQI",
      team: { key: "ACQI", parentId: "team-parent" },
      project: { name: "Acquisition Intelligence" },
      firstIssue: { identifier: "ACQI-1" },
    });
    expect(linear.projectLabels.map((label) => label.name)).toEqual(["ACQI"]);
    expect(linear.issueLabels.map((label) => label.name)).toEqual(["ACQI"]);
    expect(linear.issues[0]?.description).toContain("[scope:ACQI]");
  });

  it("replays a bootstrap without creating duplicate teams, projects, labels, or issues", async () => {
    const linear = new MemoryLinearGateway();
    const workflows = new TrackerWorkflows({ config: testConfig(), linear });
    const request = {
      scopeCode: "ACQI",
      projectName: "Acquisition Intelligence",
      teamMode: "subteam" as const,
      teamName: "Acquisition Intelligence",
      parentTeamId: "team-parent",
      firstIssue: {
        title: "Project charter",
        sourceMarker: "bootstrap:charter:v1",
        expectedIdentifier: "ACQI-1",
      },
    };

    await workflows.bootstrap(request);
    const replay = await workflows.bootstrap(request);

    expect(linear.teams).toHaveLength(2);
    expect(linear.projects).toHaveLength(1);
    expect(linear.projectLabels).toHaveLength(1);
    expect(linear.issueLabels).toHaveLength(1);
    expect(linear.issues).toHaveLength(1);
    expect(replay).toMatchObject({ firstIssue: { identifier: "ACQI-1" } });
  });

  it("stores project scope in long content without changing the short description", async () => {
    const linear = new MemoryLinearGateway();
    const existing = await linear.createProject({
      name: "Acquisition Intelligence",
      teamIds: ["team-parent"],
      labelIds: [],
      description: "Short project summary",
      content: "## Overview\n\nHuman-authored project details.\n",
    });
    const workflows = new TrackerWorkflows({ config: testConfig(), linear });

    await workflows.bootstrap({
      scopeCode: "ACQI",
      projectName: "Acquisition Intelligence",
      teamMode: "existing",
      existingTeamId: "team-parent",
    });

    const updated = await linear.getProject(existing.id);
    expect(updated.description).toBe("Short project summary");
    expect(updated.content).toContain("Human-authored project details.");
    expect(updated.content).toContain("[scope:ACQI]");
  });

  it("does not report an unchanged Obsidian replay as a mutation", async () => {
    const linear = new MemoryLinearGateway();
    let noteWrites = 0;
    const obsidian = {
      configured: true,
      async search() {
        return [];
      },
      async read() {
        return { relativePath: "Projects/ACQI/Overview.md", title: "Overview", content: "" };
      },
      async upsertManagedSection() {
        noteWrites += 1;
        return {
          relativePath: "Projects/ACQI/Overview.md",
          title: "Overview",
          content: "",
          changed: noteWrites === 1,
        };
      },
    };
    const workflows = new TrackerWorkflows({ config: testConfig(), linear, obsidian });
    const request = {
      scopeCode: "ACQI",
      projectName: "Acquisition Intelligence",
      teamMode: "existing" as const,
      existingTeamId: "team-parent",
      obsidianNotePath: "Projects/ACQI/Overview.md",
      createObsidianNote: true,
    };

    await workflows.bootstrap(request);
    const replay = await workflows.bootstrap(request);

    expect(replay).toMatchObject({ mutations: [] });
  });

  it("does not pretend an existing parent-team project can produce ACQI-1", async () => {
    const linear = new MemoryLinearGateway();
    const workflows = new TrackerWorkflows({ config: testConfig(), linear });

    await expect(
      workflows.bootstrap({
        scopeCode: "ACQI",
        projectName: "Acquisition Intelligence",
        teamMode: "existing",
        existingTeamId: "team-parent",
        firstIssue: {
          title: "Project charter",
          sourceMarker: "bootstrap:charter:v1",
          expectedIdentifier: "ACQI-1",
        },
      }),
    ).rejects.toThrow("Expected first identifier must be OPEN-1");
    expect(linear.issues).toHaveLength(0);
    expect(linear.projects).toHaveLength(0);
    expect(linear.issueLabels).toHaveLength(0);
    expect(linear.projectLabels).toHaveLength(0);
  });

  it("creates historical records with title, label, and non-actionability metadata", async () => {
    const linear = new MemoryLinearGateway();
    const workflows = new TrackerWorkflows({ config: testConfig(), linear });
    const bootstrap = await workflows.bootstrap({
      scopeCode: "ACQI",
      projectName: "Acquisition Intelligence",
      teamMode: "subteam",
      teamName: "Acquisition Intelligence",
      parentTeamId: "team-parent",
    });
    const teamId = (bootstrap.team as { id: string }).id;
    const projectId = (bootstrap.project as { id: string }).id;

    const result = await workflows.upsertScopedIssue({
      scopeCode: "ACQI",
      teamId,
      projectId,
      title: "Legacy launch notes",
      stableSourceMarker: "legacy:launch:2024",
      historical: true,
    });

    expect(result).toMatchObject({ issue: { title: "[HISTORICAL] Legacy launch notes" }, created: true });
    expect(linear.issues.at(-1)?.description).toContain("Historical only: true");
    expect(linear.issues.at(-1)?.description).toContain("Actionability: none");
    expect(linear.issueLabels.map((label) => label.name).sort()).toEqual(["ACQI", "HISTORICAL"]);

    const updateCalls = linear.calls.filter((call) => call.startsWith("updateIssue:")).length;
    const replay = await workflows.upsertScopedIssue({
      scopeCode: "ACQI",
      teamId,
      projectId,
      title: "Legacy launch notes",
      stableSourceMarker: "legacy:launch:2024",
      historical: true,
    });
    expect(replay).toMatchObject({ created: false, replayed: true });
    expect(linear.calls.filter((call) => call.startsWith("updateIssue:")).length).toBe(updateCalls);
  });

  it("replays an exact GitHub evidence link without creating a duplicate attachment", async () => {
    const linear = new MemoryLinearGateway();
    const github = {
      configured: true,
      async getReference() {
        return {
          repository: "Openly-Useful/example",
          kind: "repository" as const,
          canonicalUrl: "https://github.com/Openly-Useful/example",
          title: "Openly-Useful/example",
        };
      },
    };
    const workflows = new TrackerWorkflows({ config: testConfig(), linear, github });
    const bootstrap = await workflows.bootstrap({
      scopeCode: "ACQI",
      projectName: "Acquisition Intelligence",
      teamMode: "existing",
      existingTeamId: "team-parent",
      firstIssue: { title: "Project charter", sourceMarker: "bootstrap:charter:v1" },
    });
    const request = {
      scopeCode: "ACQI",
      teamId: (bootstrap.team as { id: string }).id,
      projectId: (bootstrap.project as { id: string }).id,
      issueId: (bootstrap.firstIssue as { id: string }).id,
      source: "github" as const,
      title: "Repository",
      githubRepository: "Openly-Useful/example",
      githubKind: "repository" as const,
    };

    expect(await workflows.linkEvidence(request)).toMatchObject({ replayed: false });
    expect(await workflows.linkEvidence(request)).toMatchObject({ replayed: true });
    expect(linear.attachments).toHaveLength(1);
  });

  it("moves a reviewed same-team issue without changing its OPEN identifier", async () => {
    const linear = new MemoryLinearGateway();
    const workflows = new TrackerWorkflows({ config: testConfig(), linear });
    const destination = await workflows.bootstrap({
      scopeCode: "ACQI",
      projectName: "Acquisition Intelligence",
      teamMode: "existing",
      existingTeamId: "team-parent",
    });
    const sourceProject = await linear.createProject({
      name: "Inbox",
      teamIds: ["team-parent"],
      labelIds: [],
      description: "",
    });
    const source = await linear.createIssue({
      teamId: "team-parent",
      projectId: sourceProject.id,
      labelIds: [],
      title: "Reviewed candidate",
      description: "Verified exact identity.",
    });

    const result = await workflows.moveCandidate({
      scopeCode: "ACQI",
      issueId: source.id,
      expectedSourceTeamId: "team-parent",
      expectedSourceProjectId: sourceProject.id,
      destinationTeamId: "team-parent",
      destinationProjectId: (destination.project as { id: string }).id,
      reason: "Exact project identity was verified",
      allowTeamChange: false,
      confirmIdentifierChange: false,
      confirmLabelReplacement: false,
    });

    expect(result).toMatchObject({ moved: true, identifierChanged: false, issue: { identifier: source.identifier } });
    expect(linear.issues.at(-1)?.description).toContain("Original identifier: OPEN-4");
    expect(linear.issues.at(-1)?.labelIds).toContain(linear.issueLabels.find((label) => label.name === "ACQI")?.id);
  });

  it("requires explicit identifier and label acknowledgements for a cross-team move", async () => {
    const linear = new MemoryLinearGateway();
    const workflows = new TrackerWorkflows({ config: testConfig(), linear });
    const destination = await workflows.bootstrap({
      scopeCode: "ACQI",
      projectName: "Acquisition Intelligence",
      teamMode: "subteam",
      teamName: "Acquisition Intelligence",
      parentTeamId: "team-parent",
    });
    const sourceProject = await linear.createProject({
      name: "Inbox",
      teamIds: ["team-parent"],
      labelIds: [],
      description: "",
    });
    const source = await linear.createIssue({
      teamId: "team-parent",
      projectId: sourceProject.id,
      labelIds: [],
      title: "Reviewed candidate",
      description: "Verified exact identity.",
    });
    const request = {
      scopeCode: "ACQI",
      issueId: source.id,
      expectedSourceTeamId: "team-parent",
      expectedSourceProjectId: sourceProject.id,
      destinationTeamId: (destination.team as { id: string }).id,
      destinationProjectId: (destination.project as { id: string }).id,
      reason: "Exact project identity was verified",
      allowTeamChange: false,
      confirmIdentifierChange: false,
      confirmLabelReplacement: false,
    };

    await expect(workflows.moveCandidate(request)).rejects.toThrow("explicit team-change authorization");
    expect((await linear.getIssue(source.id)).identifier).toBe("OPEN-4");

    const moved = await workflows.moveCandidate({
      ...request,
      allowTeamChange: true,
      confirmIdentifierChange: true,
      confirmLabelReplacement: true,
    });
    expect(moved).toMatchObject({
      moved: true,
      identifierChanged: true,
      previous: { identifier: "OPEN-4" },
      issue: { identifier: "ACQI-1" },
    });
  });
});

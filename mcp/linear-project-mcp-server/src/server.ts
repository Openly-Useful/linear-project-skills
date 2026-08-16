import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  classifyAuditError,
  classifyAuditOutcome,
  createAuditLogger,
  type AuditLogger,
  type AuditMode,
  type AuditOperation,
} from "./audit.js";
import type { WorkflowDependencies } from "./workflows.js";
import { TrackerWorkflows } from "./workflows.js";

const ScopeCode = z
  .string()
  .min(2)
  .max(10)
  .regex(/^[A-Za-z][A-Za-z0-9]*$/)
  .describe("Exact allowlisted project scope code, for example ACQI");
const Id = z.string().min(1).max(200).describe("Exact Linear UUID or stable entity ID");
const Title = z.string().trim().min(1).max(255);
const Description = z.string().max(20_000);
const SourceMarker = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]+$/)
  .describe("Deterministic source identity used to make creates idempotent");
const ConfirmWrite = z.literal(true).describe("Must be true to acknowledge an external mutation");

const ToolOutput = z.object({
  ok: z.boolean(),
  summary: z.string(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  audit: z
    .object({
      status: z.enum(["degraded", "unavailable"]),
      errorClass: z.literal("audit_unavailable"),
    })
    .optional(),
});

export function createLinearProjectMcpServer(dependencies: WorkflowDependencies): McpServer {
  const workflows = new TrackerWorkflows(dependencies);
  const audit = createAuditLogger(dependencies.config.auditLogPath);
  const server = new McpServer({ name: "linear-project-mcp-server", version: "0.1.0" });

  server.registerTool(
    "linear_project_capabilities",
    {
      title: "Inspect Linear Project MCP Capabilities",
      description:
        "Report configured Linear, GitHub, and Obsidian adapters, exact allowlist coverage, workspace reachability, team-admin support, and whether mutations are enabled. Never writes.",
      inputSchema: z.object({}).strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (): Promise<CallToolResult> =>
      toolResult(audit, "linear_project_capabilities", "read", "Capability inspection complete", () =>
        workflows.capabilities(),
      ),
  );

  server.registerTool(
    "linear_project_resolve_scope",
    {
      title: "Resolve Exact Linear Project Scope",
      description:
        "Resolve one allowlisted team, project, issue label, and project label by exact IDs or exact names. Fails on ambiguity and never mutates Linear.",
      inputSchema: z
        .object({
          scope_code: ScopeCode,
          team_id: Id.optional(),
          team_key: z.string().min(2).max(10).optional(),
          project_id: Id.optional(),
          project_name: Title.optional(),
        })
        .strict()
        .refine((value) => Boolean(value.team_id || value.team_key), "Provide team_id or team_key")
        .refine((value) => Boolean(value.project_id || value.project_name), "Provide project_id or project_name"),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "linear_project_resolve_scope", "read", "Exact scope resolved", () =>
        workflows.resolveScope({
          scopeCode: input.scope_code,
          ...(input.team_id ? { teamId: input.team_id } : {}),
          ...(input.team_key ? { teamKey: input.team_key } : {}),
          ...(input.project_id ? { projectId: input.project_id } : {}),
          ...(input.project_name ? { projectName: input.project_name } : {}),
        }),
      ),
  );

  server.registerTool(
    "linear_project_create_team",
    {
      title: "Create or Resolve a Dedicated Linear Team",
      description:
        "Idempotently create a dedicated Linear team whose key exactly equals an allowlisted scope code. Optionally create it as a subteam of an allowlisted parent. Verifies empty issue history on new teams so CODE-1 can be attempted safely.",
      inputSchema: z
        .object({
          scope_code: ScopeCode,
          name: Title,
          key: ScopeCode.optional(),
          description: Description.optional(),
          parent_team_id: Id.optional(),
          confirm_workspace_administration: ConfirmWrite,
        })
        .strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "linear_project_create_team", "write", "Dedicated team ensured and read back", () =>
        workflows.ensureTeam({
          scopeCode: input.scope_code,
          name: input.name,
          ...(input.key ? { key: input.key } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.parent_team_id ? { parentTeamId: input.parent_team_id } : {}),
        }),
      ),
  );

  const FirstIssue = z
    .object({
      title: Title,
      description: Description.optional(),
      source_marker: SourceMarker,
      historical: z.boolean().default(false),
      expected_identifier: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,9}-1$/).optional(),
    })
    .strict();

  server.registerTool(
    "linear_project_bootstrap",
    {
      title: "Bootstrap a Scope-Gated Linear Project",
      description:
        "Create or reuse the exact team, project, ACQI-style issue label, and matching project label. Supports an existing team, a dedicated key-bearing team, or a key-bearing subteam. Optionally verifies and links an allowlisted GitHub repository and Obsidian project note, then creates an idempotent first issue with immediate readback.",
      inputSchema: z
        .object({
          scope_code: ScopeCode,
          project_name: Title,
          project_description: Description.optional(),
          team_mode: z.enum(["existing", "dedicated", "subteam"]),
          existing_team_id: Id.optional(),
          team_name: Title.optional(),
          team_key: ScopeCode.optional(),
          parent_team_id: Id.optional(),
          github_repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).optional(),
          obsidian_note_path: z.string().min(4).max(500).optional(),
          create_obsidian_note: z.boolean().default(false),
          first_issue: FirstIssue.optional(),
          confirm_writes: ConfirmWrite,
        })
        .strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "linear_project_bootstrap", "write", "Project bootstrap completed with readback", () =>
        workflows.bootstrap({
          scopeCode: input.scope_code,
          projectName: input.project_name,
          teamMode: input.team_mode,
          ...(input.project_description ? { projectDescription: input.project_description } : {}),
          ...(input.existing_team_id ? { existingTeamId: input.existing_team_id } : {}),
          ...(input.team_name ? { teamName: input.team_name } : {}),
          ...(input.team_key ? { teamKey: input.team_key } : {}),
          ...(input.parent_team_id ? { parentTeamId: input.parent_team_id } : {}),
          ...(input.github_repository ? { githubRepository: input.github_repository } : {}),
          ...(input.obsidian_note_path ? { obsidianNotePath: input.obsidian_note_path } : {}),
          createObsidianNote: input.create_obsidian_note,
          ...(input.first_issue
            ? {
                firstIssue: {
                  title: input.first_issue.title,
                  sourceMarker: input.first_issue.source_marker,
                  historical: input.first_issue.historical,
                  ...(input.first_issue.description ? { description: input.first_issue.description } : {}),
                  ...(input.first_issue.expected_identifier
                    ? { expectedIdentifier: input.first_issue.expected_identifier.toUpperCase() }
                    : {}),
                },
              }
            : {}),
        }),
      ),
  );

  server.registerTool(
    "linear_project_list_scoped_issues",
    {
      title: "List Only Scope-Labeled Project Issues",
      description:
        "List issues only when they belong to the exact allowlisted Linear project and carry its exact scope-code issue label. Supports cursor pagination and never writes.",
      inputSchema: z
        .object({
          scope_code: ScopeCode,
          team_id: Id,
          project_id: Id,
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().min(1).max(500).optional(),
        })
        .strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "linear_project_list_scoped_issues", "read", "Scoped issues listed", () =>
        workflows.listScopedIssues({
          scopeCode: input.scope_code,
          teamId: input.team_id,
          projectId: input.project_id,
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
        }),
      ),
  );

  server.registerTool(
    "linear_project_upsert_scoped_issue",
    {
      title: "Upsert an Idempotent Scope-Gated Issue",
      description:
        "Create or update exactly one issue inside an allowlisted team and project using a deterministic source marker. Always applies the scope label. Historical records receive the exact [HISTORICAL] title prefix, a HISTORICAL label, and non-actionability metadata.",
      inputSchema: z
        .object({
          scope_code: ScopeCode,
          team_id: Id,
          project_id: Id,
          title: Title,
          description: Description.optional(),
          stable_source_marker: SourceMarker,
          historical: z.boolean().default(false),
          update_existing: z.boolean().default(true),
          confirm_writes: ConfirmWrite,
        })
        .strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "linear_project_upsert_scoped_issue", "write", "Scoped issue upsert completed with readback", () =>
        workflows.upsertScopedIssue({
          scopeCode: input.scope_code,
          teamId: input.team_id,
          projectId: input.project_id,
          title: input.title,
          stableSourceMarker: input.stable_source_marker,
          historical: input.historical,
          updateExisting: input.update_existing,
          ...(input.description ? { description: input.description } : {}),
        }),
      ),
  );

  server.registerTool(
    "linear_project_find_candidates",
    {
      title: "Find Allowlisted Linear Reconciliation Candidates",
      description:
        "Search for potentially related Linear issues, discard results from non-allowlisted teams, and classify whether each candidate is already in the destination project, carries the scope label, or is historical. Never moves or mutates issues.",
      inputSchema: z
        .object({
          scope_code: ScopeCode,
          destination_team_id: Id,
          destination_project_id: Id,
          query: z.string().trim().min(2).max(200),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "linear_project_find_candidates", "read", "Reconciliation candidates classified without mutation", () =>
        workflows.findCandidates({
          scopeCode: input.scope_code,
          destinationTeamId: input.destination_team_id,
          destinationProjectId: input.destination_project_id,
          query: input.query,
          limit: input.limit,
        }),
      ),
  );

  server.registerTool(
    "linear_project_move_candidate",
    {
      title: "Move a Reviewed Issue into the Scoped Project",
      description:
        "Move one previously reviewed, allowlisted issue into the exact destination project and apply its scope label. Same-team moves preserve the issue identifier and existing labels. Cross-team moves replace source-team labels and require explicit acknowledgement that the identifier changes. Never changes status or completion.",
      inputSchema: z
        .object({
          scope_code: ScopeCode,
          issue_id: Id,
          expected_source_team_id: Id,
          expected_source_project_id: Id.nullable(),
          destination_team_id: Id,
          destination_project_id: Id,
          reason: z.string().trim().min(3).max(500),
          allow_team_change: z.boolean().default(false),
          confirm_identifier_change: z.literal(true).optional(),
          confirm_label_replacement: z.literal(true).optional(),
          confirm_writes: ConfirmWrite,
        })
        .strict()
        .superRefine((value, context) => {
          if (value.allow_team_change && (!value.confirm_identifier_change || !value.confirm_label_replacement)) {
            context.addIssue({
              code: "custom",
              message: "Cross-team moves require confirm_identifier_change and confirm_label_replacement",
            });
          }
        }),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "linear_project_move_candidate", "write", "Reviewed issue move completed with readback", () =>
        workflows.moveCandidate({
          scopeCode: input.scope_code,
          issueId: input.issue_id,
          expectedSourceTeamId: input.expected_source_team_id,
          expectedSourceProjectId: input.expected_source_project_id,
          destinationTeamId: input.destination_team_id,
          destinationProjectId: input.destination_project_id,
          reason: input.reason,
          allowTeamChange: input.allow_team_change,
          confirmIdentifierChange: input.confirm_identifier_change ?? false,
          confirmLabelReplacement: input.confirm_label_replacement ?? false,
        }),
      ),
  );

  server.registerTool(
    "linear_project_link_evidence",
    {
      title: "Link Verified GitHub or Obsidian Evidence",
      description:
        "Verify an allowlisted GitHub reference or allowlisted Obsidian note, confirm the destination issue is inside the exact project and carries the scope label, then add an idempotent evidence link. Does not copy Obsidian note contents into Linear.",
      inputSchema: z
        .object({
          scope_code: ScopeCode,
          team_id: Id,
          project_id: Id,
          issue_id: Id,
          source: z.enum(["github", "obsidian"]),
          title: Title,
          github_repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).optional(),
          github_kind: z.enum(["repository", "commit", "pull_request", "issue"]).optional(),
          github_reference: z.string().min(1).max(100).optional(),
          obsidian_note_path: z.string().min(4).max(500).optional(),
          confirm_writes: ConfirmWrite,
        })
        .strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "linear_project_link_evidence", "write", "Verified evidence linked and destination read back", () =>
        workflows.linkEvidence({
          scopeCode: input.scope_code,
          teamId: input.team_id,
          projectId: input.project_id,
          issueId: input.issue_id,
          source: input.source,
          title: input.title,
          ...(input.github_repository ? { githubRepository: input.github_repository } : {}),
          ...(input.github_kind ? { githubKind: input.github_kind } : {}),
          ...(input.github_reference ? { githubReference: input.github_reference } : {}),
          ...(input.obsidian_note_path ? { obsidianNotePath: input.obsidian_note_path } : {}),
        }),
      ),
  );

  server.registerTool(
    "github_get_project_evidence",
    {
      title: "Read an Allowlisted GitHub Reference",
      description:
        "Read and normalize one allowlisted GitHub repository, commit, pull request, or issue as canonical project evidence. GitHub access is always read-only.",
      inputSchema: z
        .object({
          repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
          kind: z.enum(["repository", "commit", "pull_request", "issue"]),
          reference: z.string().min(1).max(100).optional(),
        })
        .strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "github_get_project_evidence", "read", "GitHub evidence verified", () =>
        workflows.githubReference({
          repository: input.repository,
          kind: input.kind,
          ...(input.reference ? { reference: input.reference } : {}),
        }),
      ),
  );

  server.registerTool(
    "obsidian_search_project_notes",
    {
      title: "Search Allowlisted Obsidian Project Notes",
      description:
        "Search Markdown notes only inside configured Obsidian directories. Symlinks, traversal, oversized files, and non-Markdown files are excluded. Never writes.",
      inputSchema: z
        .object({ query: z.string().trim().min(2).max(200), limit: z.number().int().min(1).max(50).default(20) })
        .strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "obsidian_search_project_notes", "read", "Obsidian note search complete", () =>
        workflows.obsidianSearch(input.query, input.limit),
      ),
  );

  server.registerTool(
    "obsidian_read_project_note",
    {
      title: "Read an Allowlisted Obsidian Project Note",
      description:
        "Read one size-limited Markdown note by safe vault-relative path inside the configured Obsidian directory allowlist. Never writes.",
      inputSchema: z.object({ relative_path: z.string().min(4).max(500) }).strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "obsidian_read_project_note", "read", "Obsidian note read", () =>
        workflows.obsidianRead(input.relative_path),
      ),
  );

  server.registerTool(
    "obsidian_upsert_project_note",
    {
      title: "Upsert a Managed Obsidian Project Section",
      description:
        "Create or replace only the Openly Useful managed section of an allowlisted Obsidian Markdown note. Preserves all content outside the marker block and requires global writes to be enabled.",
      inputSchema: z
        .object({
          relative_path: z.string().min(4).max(500),
          scope_code: ScopeCode,
          title: Title,
          markdown: Description,
          confirm_writes: ConfirmWrite,
        })
        .strict(),
      outputSchema: ToolOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input): Promise<CallToolResult> =>
      toolResult(audit, "obsidian_upsert_project_note", "write", "Managed Obsidian project section upserted", () =>
        workflows.obsidianUpsert({
          relativePath: input.relative_path,
          scopeCode: input.scope_code,
          title: input.title,
          markdown: input.markdown,
        }),
      ),
  );

  return server;
}

async function toolResult(
  audit: AuditLogger | undefined,
  tool: string,
  mode: AuditMode,
  summary: string,
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  let auditOperation: AuditOperation | undefined;
  let auditDegraded = false;
  if (audit) {
    try {
      auditOperation = await audit.attempt(tool, mode);
    } catch {
      if (mode === "write") return auditUnavailableResult("write");
      auditDegraded = true;
    }
  }

  try {
    const data = await operation();
    if (auditOperation) {
      try {
        await audit?.complete(auditOperation, classifyAuditOutcome(mode, data));
      } catch {
        if (mode === "write") return auditUnavailableResult("write", true);
        auditDegraded = true;
      }
    }
    const payload = {
      ok: true,
      summary,
      data,
      ...(auditDegraded ? { audit: { status: "degraded" as const, errorClass: "audit_unavailable" as const } } : {}),
    };
    return {
      content: [
        {
          type: "text",
          text: `${summary}${auditDegraded ? " (audit unavailable)" : ""}\n\n${JSON.stringify(data, null, 2)}`,
        },
      ],
      structuredContent: payload,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (auditOperation) {
      const classification = classifyAuditError(error);
      try {
        await audit?.complete(auditOperation, classification.outcome, classification.errorClass);
      } catch {
        return auditUnavailableResult(mode, mode === "write");
      }
    }
    const payload = {
      ok: false,
      summary: "Operation failed",
      error: message,
      ...(auditDegraded ? { audit: { status: "degraded" as const, errorClass: "audit_unavailable" as const } } : {}),
    };
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Operation failed: ${message}${auditDegraded ? " (audit unavailable)" : ""}`,
        },
      ],
      structuredContent: payload,
    };
  }
}

function auditUnavailableResult(mode: AuditMode, operationMayHaveCompleted = false): CallToolResult {
  const message =
    mode === "read"
      ? "Read operation failed and its terminal audit outcome could not be recorded; verify the audit sink before retrying"
      : operationMayHaveCompleted
        ? "Operation audit could not record the terminal outcome; verify external state before retrying"
        : "Operation audit is configured but unavailable; write operation was not started";
  const payload = {
    ok: false,
    summary: "Operation blocked",
    error: message,
    audit: { status: "unavailable" as const, errorClass: "audit_unavailable" as const },
  };
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: payload,
  };
}

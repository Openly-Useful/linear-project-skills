import type { ProjectRef, TeamRef } from "./types.js";
import type { ServerConfig } from "./config.js";

export class ScopeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

export function normalizeScopeCode(input: string): string {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(code)) {
    throw new ScopeError("Scope code must be 2–10 uppercase letters or digits and start with a letter");
  }
  return code;
}

export function scopeMarker(scopeCode: string): string {
  return `[scope:${normalizeScopeCode(scopeCode)}]`;
}

export function normalizeSourceMarker(input: string): string {
  const marker = input.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(marker)) {
    throw new ScopeError("Source marker must be 3–160 safe identifier characters");
  }
  return marker;
}

export function sourceMarker(input: string): string {
  return `[source:${normalizeSourceMarker(input)}]`;
}

export function assertWriteAccess(config: ServerConfig, organizationId: string, scopeCodeInput: string): string {
  if (!config.writesEnabled) {
    throw new ScopeError("Mutations are disabled. Set MCP_WRITES_ENABLED=true only after configuring exact allowlists.");
  }
  assertOrganizationAccess(config, organizationId);
  const scopeCode = normalizeScopeCode(scopeCodeInput);
  if (!config.linear.allowedScopeCodes.has(scopeCode)) {
    throw new ScopeError(`Scope code ${scopeCode} is not allowlisted`);
  }
  return scopeCode;
}

export function assertOrganizationAccess(config: ServerConfig, organizationId: string): void {
  if (!config.linear.allowedOrganizationId) {
    throw new ScopeError("LINEAR_ALLOWED_ORGANIZATION_ID is required for scoped Linear access");
  }
  if (config.linear.allowedOrganizationId !== organizationId) {
    throw new ScopeError("Authenticated Linear workspace does not match LINEAR_ALLOWED_ORGANIZATION_ID");
  }
}

export function assertTeamAllowed(config: ServerConfig, team: TeamRef, scopeCodeInput: string): void {
  const scopeCode = normalizeScopeCode(scopeCodeInput);
  if (config.linear.allowedTeamIds.has(team.id) || team.key.toUpperCase() === scopeCode) {
    return;
  }
  throw new ScopeError(
    `Team ${team.name} (${team.key}) is outside scope. Allowlist its exact ID or use a dedicated ${scopeCode} team.`,
  );
}

export function assertProjectAllowed(config: ServerConfig, project: ProjectRef, team: TeamRef, scopeCodeInput: string): void {
  assertTeamAllowed(config, team, scopeCodeInput);
  if (config.linear.allowedProjectIds.size > 0 && !config.linear.allowedProjectIds.has(project.id)) {
    throw new ScopeError(`Project ${project.name} is not in LINEAR_ALLOWED_PROJECT_IDS`);
  }
  if (!project.teamIds.includes(team.id)) {
    throw new ScopeError(`Project ${project.name} is not associated with team ${team.name}`);
  }
}

export function appendUniqueBlock(existing: string, block: string, identity: string): string {
  if (existing.includes(identity)) {
    return existing;
  }
  return [existing.trimEnd(), block.trim()].filter(Boolean).join("\n\n") + "\n";
}

import path from "node:path";

export interface ServerConfig {
  linear: {
    apiKey: string | undefined;
    accessToken: string | undefined;
    allowedOrganizationId: string | undefined;
    allowedTeamIds: ReadonlySet<string>;
    allowedProjectIds: ReadonlySet<string>;
    allowedScopeCodes: ReadonlySet<string>;
  };
  github: {
    token: string | undefined;
    allowedRepositories: ReadonlySet<string>;
  };
  obsidian: {
    vaultPath: string | undefined;
    vaultName: string | undefined;
    allowedDirectories: readonly string[];
  };
  writesEnabled: boolean;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function csv(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function directories(value: string | undefined): readonly string[] {
  return [...csv(value)].map((directory) => {
    const normalized = directory.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error(`Invalid OBSIDIAN_ALLOWED_DIRECTORIES entry: ${directory}`);
    }
    return normalized;
  });
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const vaultPath = optional(environment.OBSIDIAN_VAULT_PATH);
  const apiKey = optional(environment.LINEAR_API_KEY);
  const accessToken = optional(environment.LINEAR_ACCESS_TOKEN);
  const allowedOrganizationId = optional(environment.LINEAR_ALLOWED_ORGANIZATION_ID);
  const githubToken = optional(environment.GITHUB_TOKEN);
  const vaultName = optional(environment.OBSIDIAN_VAULT_NAME);
  if (vaultPath && !path.isAbsolute(vaultPath)) {
    throw new Error("OBSIDIAN_VAULT_PATH must be an absolute path");
  }

  return {
    linear: {
      apiKey,
      accessToken,
      allowedOrganizationId,
      allowedTeamIds: csv(environment.LINEAR_ALLOWED_TEAM_IDS),
      allowedProjectIds: csv(environment.LINEAR_ALLOWED_PROJECT_IDS),
      allowedScopeCodes: new Set([...csv(environment.LINEAR_ALLOWED_SCOPE_CODES)].map((code) => code.toUpperCase())),
    },
    github: {
      token: githubToken,
      allowedRepositories: csv(environment.GITHUB_ALLOWED_REPOSITORIES),
    },
    obsidian: {
      vaultPath: vaultPath ? path.resolve(vaultPath) : undefined,
      vaultName,
      allowedDirectories: directories(environment.OBSIDIAN_ALLOWED_DIRECTORIES),
    },
    writesEnabled: environment.MCP_WRITES_ENABLED?.toLowerCase() === "true",
  };
}

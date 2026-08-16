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
  writeWindowExpiresAt: string | undefined;
  auditLogPath: string | undefined;
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

function absoluteFilePath(value: string | undefined, name: string): string | undefined {
  const configured = optional(value);
  if (!configured) return undefined;
  if (!path.isAbsolute(configured) || path.normalize(configured) !== configured) {
    throw new Error(`${name} must be a normalized absolute path`);
  }
  return configured;
}

function rfc3339(value: string | undefined): string | undefined {
  const configured = optional(value);
  if (!configured) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
    configured,
  );
  if (!match) {
    throw new Error("MCP_WRITE_WINDOW_EXPIRES_AT must be an RFC3339 timestamp");
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetSign, offsetHourText, offsetMinuteText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetSign ? Number(offsetHourText) : 0;
  const offsetMinute = offsetSign ? Number(offsetMinuteText) : 0;
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new Error("MCP_WRITE_WINDOW_EXPIRES_AT must contain a valid RFC3339 calendar timestamp");
  }
  const timestamp = Date.parse(configured);
  if (!Number.isFinite(timestamp)) {
    throw new Error("MCP_WRITE_WINDOW_EXPIRES_AT must be a valid timestamp");
  }
  return new Date(timestamp).toISOString();
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const vaultPath = optional(environment.OBSIDIAN_VAULT_PATH);
  const apiKey = optional(environment.LINEAR_API_KEY);
  const accessToken = optional(environment.LINEAR_ACCESS_TOKEN);
  const allowedOrganizationId = optional(environment.LINEAR_ALLOWED_ORGANIZATION_ID);
  const githubToken = optional(environment.GITHUB_TOKEN);
  const vaultName = optional(environment.OBSIDIAN_VAULT_NAME);
  const auditLogPath = absoluteFilePath(environment.MCP_AUDIT_LOG_PATH, "MCP_AUDIT_LOG_PATH");
  const writeWindowExpiresAt = rfc3339(environment.MCP_WRITE_WINDOW_EXPIRES_AT);
  const writesEnabled = environment.MCP_WRITES_ENABLED?.toLowerCase() === "true";
  if (writesEnabled && writeWindowExpiresAt && Date.parse(writeWindowExpiresAt) - Date.now() > 60 * 60_000) {
    throw new Error("MCP_WRITE_WINDOW_EXPIRES_AT may be no more than 60 minutes in the future");
  }
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
    writesEnabled,
    writeWindowExpiresAt,
    auditLogPath,
  };
}

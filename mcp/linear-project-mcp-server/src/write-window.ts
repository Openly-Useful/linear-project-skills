#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MANAGED_KEYS = ["MCP_WRITES_ENABLED", "MCP_WRITE_WINDOW_EXPIRES_AT"] as const;
const REQUIRED_ENABLE_KEYS = [
  "LINEAR_ALLOWED_ORGANIZATION_ID",
  "LINEAR_ALLOWED_TEAM_IDS",
  "LINEAR_ALLOWED_PROJECT_IDS",
  "LINEAR_ALLOWED_SCOPE_CODES",
  "MCP_AUDIT_LOG_PATH",
] as const;

export interface WriteWindowResult {
  readonly command: "status" | "enable" | "disable";
  readonly writesEnabled: boolean;
  readonly active: boolean;
  readonly expiresAt?: string;
  readonly scope?: string;
  readonly reconnectRequired: boolean;
}

export async function manageWriteWindow(input: {
  command: "status" | "enable" | "disable";
  envFile: string;
  scope?: string;
  confirm?: string;
  minutes?: number;
  now?: Date;
}): Promise<WriteWindowResult> {
  const envFile = await validateEnvFile(input.envFile);
  const original = await readProtectedFile(envFile);
  const parsed = parseEnvironment(original);
  const now = input.now ?? new Date();

  if (input.command === "status") return statusResult(parsed.values, now);

  if (input.command === "disable") {
    const updated = updateEnvironment(parsed.lines, {
      MCP_WRITES_ENABLED: "false",
      MCP_WRITE_WINDOW_EXPIRES_AT: "",
    });
    if (updated !== original) await replaceProtectedFile(envFile, updated);
    return {
      command: "disable",
      writesEnabled: false,
      active: false,
      reconnectRequired: updated !== original,
    };
  }

  const scope = normalizeScope(input.scope);
  if (input.confirm !== scope) throw new Error(`--confirm must exactly match --scope (${scope})`);
  const minutes = input.minutes;
  if (!Number.isInteger(minutes) || minutes === undefined || minutes < 1 || minutes > 60) {
    throw new Error("--minutes must be an integer from 1 through 60");
  }
  for (const key of REQUIRED_ENABLE_KEYS) {
    if (!parsed.values.get(key)?.trim()) throw new Error(`${key} must be configured before enabling writes`);
  }
  const allowedScopes = new Set(
    (parsed.values.get("LINEAR_ALLOWED_SCOPE_CODES") ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
  if (!allowedScopes.has(scope)) throw new Error(`Scope ${scope} is not in LINEAR_ALLOWED_SCOPE_CODES`);

  const expiresAt = new Date(now.getTime() + minutes * 60_000).toISOString();
  const updated = updateEnvironment(parsed.lines, {
    MCP_WRITES_ENABLED: "true",
    MCP_WRITE_WINDOW_EXPIRES_AT: expiresAt,
  });
  await replaceProtectedFile(envFile, updated);
  return {
    command: "enable",
    writesEnabled: true,
    active: true,
    expiresAt,
    scope,
    reconnectRequired: true,
  };
}

async function validateEnvFile(configuredPath: string): Promise<string> {
  if (!path.isAbsolute(configuredPath) || path.normalize(configuredPath) !== configuredPath) {
    throw new Error("--env-file must be a normalized absolute path");
  }
  const parent = path.dirname(configuredPath);
  const canonicalParent = await realpath(parent);
  const parentStats = await lstat(canonicalParent);
  if (!parentStats.isDirectory() || (parentStats.mode & 0o022) !== 0) {
    throw new Error("The environment file parent must not be group- or world-writable");
  }
  const canonicalPath = path.join(canonicalParent, path.basename(configuredPath));
  const stats = await lstat(canonicalPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error("The environment file must be one regular, non-symlink file");
  }
  if ((stats.mode & 0o077) !== 0) throw new Error("The environment file must not be accessible by group or world");
  if (typeof process.getuid === "function" && (stats.uid !== process.getuid() || parentStats.uid !== process.getuid())) {
    throw new Error("The environment file and parent must belong to the current user");
  }
  return canonicalPath;
}

async function readProtectedFile(envFile: string): Promise<string> {
  const handle = await open(envFile, constants.O_RDONLY | noFollowFlag());
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.nlink !== 1 || stats.size > 65_536) {
      throw new Error("The environment file must be a single regular file no larger than 64 KiB");
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function parseEnvironment(source: string): { lines: readonly string[]; values: ReadonlyMap<string, string> } {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    if (values.has(key)) throw new Error(`Duplicate environment key: ${key}`);
    values.set(key, match[2] ?? "");
  }
  for (const key of MANAGED_KEYS) if (!values.has(key)) values.set(key, "");
  return { lines, values };
}

function updateEnvironment(lines: readonly string[], replacements: Readonly<Record<string, string>>): string {
  const remaining = new Map(Object.entries(replacements));
  const updated = lines.map((line) => {
    const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
    if (!key || !remaining.has(key)) return line;
    const value = remaining.get(key) ?? "";
    remaining.delete(key);
    return `${key}=${value}`;
  });
  if (updated.at(-1) === "") updated.pop();
  for (const [key, value] of remaining) updated.push(`${key}=${value}`);
  return `${updated.join("\n")}\n`;
}

async function replaceProtectedFile(destination: string, contents: string): Promise<void> {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(), 0o600);
    created = true;
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
    created = false;
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
  }
}

function statusResult(values: ReadonlyMap<string, string>, now: Date): WriteWindowResult {
  const writesEnabled = values.get("MCP_WRITES_ENABLED")?.trim().toLowerCase() === "true";
  const configuredExpiry = values.get("MCP_WRITE_WINDOW_EXPIRES_AT")?.trim();
  const expiry = configuredExpiry ? Date.parse(configuredExpiry) : Number.NaN;
  return {
    command: "status",
    writesEnabled,
    active: writesEnabled && Number.isFinite(expiry) && expiry > now.getTime(),
    ...(configuredExpiry ? { expiresAt: configuredExpiry } : {}),
    reconnectRequired: false,
  };
}

function normalizeScope(value: string | undefined): string {
  const scope = value?.trim().toUpperCase() ?? "";
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(scope)) throw new Error("--scope must be 2–10 uppercase letters or digits");
  return scope;
}

function noFollowFlag(): number {
  return "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
}

function parseCli(argv: readonly string[]): {
  command: "status" | "enable" | "disable";
  envFile: string;
  scope?: string;
  confirm?: string;
  minutes?: number;
} {
  const [command, ...rest] = argv;
  if (command !== "status" && command !== "enable" && command !== "disable") {
    throw new Error("Usage: linear-project-mcp-write-window <status|enable|disable> --env-file PATH [--scope CODE --minutes 1-60 --confirm CODE]");
  }
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    }
    if (flags.has(key)) throw new Error(`Duplicate argument: ${key}`);
    flags.set(key, value);
  }
  const allowed = new Set(["--env-file", "--scope", "--minutes", "--confirm"]);
  for (const key of flags.keys()) if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}`);
  const envFile = flags.get("--env-file");
  if (!envFile) throw new Error("--env-file is required");
  const scope = flags.get("--scope");
  const confirm = flags.get("--confirm");
  return {
    command,
    envFile,
    ...(scope !== undefined ? { scope } : {}),
    ...(confirm !== undefined ? { confirm } : {}),
    ...(flags.has("--minutes") ? { minutes: Number(flags.get("--minutes")) } : {}),
  };
}

async function main(): Promise<void> {
  try {
    const result = await manageWriteWindow(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Write-window operation failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();

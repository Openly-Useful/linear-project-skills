import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ScopeError } from "./security.js";

export type AuditMode = "read" | "write";
export type AuditOutcome = "success" | "error" | "blocked" | "noop" | "replay";
export type AuditErrorClass = "scope" | "configuration" | "audit_unavailable" | "external" | "internal";

export interface AuditOperation {
  readonly operationId: string;
  readonly tool: string;
  readonly mode: AuditMode;
  readonly startedAt: number;
}

interface AuditEventBase {
  schemaVersion: 1;
  timestamp: string;
  operationId: string;
  tool: string;
  mode: AuditMode;
}

interface AuditAttemptEvent extends AuditEventBase {
  phase: "attempt";
}

interface AuditOutcomeEvent extends AuditEventBase {
  phase: "outcome";
  durationMs: number;
  outcome: AuditOutcome;
  errorClass?: AuditErrorClass;
}

export class AuditUnavailableError extends Error {
  public constructor() {
    super("The configured operation audit log is unavailable");
    this.name = "AuditUnavailableError";
  }
}

export interface AuditLogger {
  attempt(tool: string, mode: AuditMode): Promise<AuditOperation>;
  complete(operation: AuditOperation, outcome: AuditOutcome, errorClass?: AuditErrorClass): Promise<void>;
}

export class FileAuditLogger implements AuditLogger {
  readonly #configuredPath: string;
  #tail: Promise<void> = Promise.resolve();

  public constructor(configuredPath: string) {
    if (!path.isAbsolute(configuredPath) || path.normalize(configuredPath) !== configuredPath) {
      throw new AuditUnavailableError();
    }
    this.#configuredPath = configuredPath;
  }

  public async attempt(tool: string, mode: AuditMode): Promise<AuditOperation> {
    const operation: AuditOperation = {
      operationId: randomUUID(),
      tool,
      mode,
      startedAt: Date.now(),
    };
    const event: AuditAttemptEvent = {
      schemaVersion: 1,
      timestamp: new Date(operation.startedAt).toISOString(),
      operationId: operation.operationId,
      tool,
      mode,
      phase: "attempt",
    };
    await this.#append(event);
    return operation;
  }

  public async complete(
    operation: AuditOperation,
    outcome: AuditOutcome,
    errorClass?: AuditErrorClass,
  ): Promise<void> {
    const completedAt = Date.now();
    const event: AuditOutcomeEvent = {
      schemaVersion: 1,
      timestamp: new Date(completedAt).toISOString(),
      operationId: operation.operationId,
      tool: operation.tool,
      mode: operation.mode,
      phase: "outcome",
      durationMs: Math.max(0, completedAt - operation.startedAt),
      outcome,
      ...(errorClass ? { errorClass } : {}),
    };
    await this.#append(event);
  }

  async #append(event: AuditAttemptEvent | AuditOutcomeEvent): Promise<void> {
    const pending = this.#tail.then(async () => {
      try {
        await appendSafely(this.#configuredPath, `${JSON.stringify(event)}\n`);
      } catch {
        throw new AuditUnavailableError();
      }
    });
    this.#tail = pending.catch(() => undefined);
    return pending;
  }
}

export function createAuditLogger(configuredPath: string | undefined): AuditLogger | undefined {
  return configuredPath ? new FileAuditLogger(configuredPath) : undefined;
}

export function classifyAuditOutcome(mode: AuditMode, data: unknown): AuditOutcome {
  if (mode === "read" || !isRecord(data)) return "success";
  if (Array.isArray(data.mutations) && data.mutations.length > 0) return "success";
  if (data.replayed === true) return "replay";
  if (data.changed === false) return "noop";
  if (data.created === false) return "noop";
  if (Array.isArray(data.mutations) && data.mutations.length === 0) return "noop";
  return "success";
}

export function classifyAuditError(error: unknown): {
  outcome: "blocked" | "error";
  errorClass: AuditErrorClass;
} {
  if (error instanceof AuditUnavailableError) return { outcome: "blocked", errorClass: "audit_unavailable" };
  if (error instanceof ScopeError) return { outcome: "blocked", errorClass: "scope" };
  if (
    error instanceof Error &&
    /(?:github|linear|obsidian).*(?:api|request|response|status|failed)|fetch|network|http|econn|enotfound|timeout/i.test(
      `${error.name} ${error.message}`,
    )
  ) {
    return { outcome: "error", errorClass: "external" };
  }
  if (error instanceof Error && /not configured|required|allowlist/i.test(error.message)) {
    return { outcome: "error", errorClass: "configuration" };
  }
  return { outcome: "error", errorClass: "internal" };
}

async function appendSafely(configuredPath: string, line: string): Promise<void> {
  const parent = await realpath(path.dirname(configuredPath));
  const parentStats = await lstat(parent);
  if (!parentStats.isDirectory() || (parentStats.mode & 0o022) !== 0) throw new AuditUnavailableError();
  if (typeof process.getuid === "function" && parentStats.uid !== process.getuid()) throw new AuditUnavailableError();
  const destination = path.join(parent, path.basename(configuredPath));
  try {
    const destinationStats = await lstat(destination);
    if (!destinationStats.isFile() || destinationStats.isSymbolicLink() || destinationStats.nlink !== 1) {
      throw new AuditUnavailableError();
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(
    destination,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NONBLOCK | noFollow,
    0o600,
  );
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.nlink !== 1) throw new AuditUnavailableError();
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) throw new AuditUnavailableError();
    await handle.chmod(0o600);
    await handle.writeFile(line, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

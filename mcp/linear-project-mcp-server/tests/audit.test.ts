import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { FileAuditLogger, classifyAuditError, classifyAuditOutcome } from "../src/audit.js";
import { LocalObsidianAdapter } from "../src/adapters/obsidian.js";
import { loadConfig } from "../src/config.js";
import { createLinearProjectMcpServer } from "../src/server.js";
import { MemoryLinearGateway, testConfig } from "./helpers.js";

describe("operation audit logging", () => {
  const execFileAsync = promisify(execFile);
  const closeCallbacks: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  });

  it("records a safe attempt and terminal outcome without arguments or result bodies", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linear-project-audit-"));
    const logPath = path.join(directory, "operations.ndjson");
    const sensitiveQuery = "never-log-this-query";
    const config = { ...testConfig({ writesEnabled: false }), auditLogPath: logPath };
    const server = createLinearProjectMcpServer({ config, linear: new MemoryLinearGateway() });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(() => client.close(), () => server.close());

    await client.callTool({
      name: "obsidian_search_project_notes",
      arguments: { query: sensitiveQuery, limit: 1 },
    });

    const raw = await readFile(logPath, "utf8");
    const events = raw.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.phase)).toEqual(["attempt", "outcome"]);
    expect(events[0]).toMatchObject({
      schemaVersion: 1,
      tool: "obsidian_search_project_notes",
      mode: "read",
    });
    expect(events[1]).toMatchObject({
      operationId: events[0]?.operationId,
      phase: "outcome",
      outcome: "blocked",
      errorClass: "scope",
    });
    expect(events[1]?.durationMs).toEqual(expect.any(Number));
    expect(new Date(String(events[0]?.timestamp)).toISOString()).toBe(events[0]?.timestamp);
    expect(raw).not.toContain(sensitiveQuery);
    expect(raw).not.toContain("test-key");
    expect((await lstat(logPath)).mode & 0o777).toBe(0o600);
  });

  it("records disabled mutations as blocked without invoking a mutation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linear-project-audit-"));
    const logPath = path.join(directory, "operations.ndjson");
    const linear = new MemoryLinearGateway();
    const config = { ...testConfig({ writesEnabled: false }), auditLogPath: logPath };
    const server = createLinearProjectMcpServer({ config, linear });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(() => client.close(), () => server.close());

    const result = await client.callTool({
      name: "linear_project_create_team",
      arguments: {
        scope_code: "ACQI",
        name: "Acquisition Intelligence",
        confirm_workspace_administration: true,
      },
    });

    expect(result.isError).toBe(true);
    expect(linear.teams).toHaveLength(1);
    const events = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(events[1]).toMatchObject({ phase: "outcome", mode: "write", outcome: "blocked", errorClass: "scope" });
  });

  it("records a proven idempotent replay as a noop", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linear-project-audit-"));
    const vaultPath = path.join(directory, "vault");
    await mkdir(path.join(vaultPath, "Projects", "ACQI"), { recursive: true });
    const logPath = path.join(directory, "operations.ndjson");
    const config = {
      ...testConfig({
        writesEnabled: true,
        vaultPath,
        vaultName: "Test Vault",
        obsidianDirectories: ["Projects/ACQI"],
      }),
      auditLogPath: logPath,
    };
    const server = createLinearProjectMcpServer({
      config,
      linear: new MemoryLinearGateway(),
      obsidian: new LocalObsidianAdapter(config.obsidian),
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(() => client.close(), () => server.close());
    const invocation = {
      name: "obsidian_upsert_project_note",
      arguments: {
        relative_path: "Projects/ACQI/Overview.md",
        scope_code: "ACQI",
        title: "Overview",
        markdown: "sensitive-note-body",
        confirm_writes: true,
      },
    };

    expect((await client.callTool(invocation)).isError).not.toBe(true);
    expect((await client.callTool(invocation)).isError).not.toBe(true);

    const raw = await readFile(logPath, "utf8");
    const events = raw.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.filter((event) => event.phase === "outcome").map((event) => event.outcome)).toEqual([
      "success",
      "noop",
    ]);
    expect(raw).not.toContain("sensitive-note-body");
  });

  it("fails closed before writes and degrades reads when a configured log is unsafe", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linear-project-audit-"));
    const target = path.join(directory, "target.ndjson");
    const logPath = path.join(directory, "operations.ndjson");
    await chmod(directory, 0o700);
    await symlink(target, logPath);
    const linear = new MemoryLinearGateway();
    const config = { ...testConfig({ writesEnabled: true }), auditLogPath: logPath };
    const server = createLinearProjectMcpServer({ config, linear });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(() => client.close(), () => server.close());

    const read = await client.callTool({ name: "linear_project_capabilities", arguments: {} });
    expect(read.isError).not.toBe(true);
    expect(read.structuredContent).toMatchObject({ audit: { status: "degraded", errorClass: "audit_unavailable" } });

    const write = await client.callTool({
      name: "linear_project_create_team",
      arguments: {
        scope_code: "ACQI",
        name: "Acquisition Intelligence",
        confirm_workspace_administration: true,
      },
    });
    expect(write.isError).toBe(true);
    expect(write.structuredContent).toMatchObject({ ok: false, audit: { status: "unavailable" } });
    expect(linear.calls).toEqual(["getOrganization"]);
  });

  it("rejects symlinks and classifies proven replays and noops", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linear-project-audit-"));
    const nested = path.join(directory, "nested");
    await mkdir(nested);
    const target = path.join(directory, "target.ndjson");
    const link = path.join(nested, "operations.ndjson");
    await symlink(target, link);
    const logger = new FileAuditLogger(link);
    await expect(logger.attempt("tool", "write")).rejects.toThrow(/audit/i);
    expect(classifyAuditOutcome("write", { replayed: true, mutations: [] })).toBe("replay");
    expect(classifyAuditOutcome("write", { replayed: true, mutations: ["created required label"] })).toBe("success");
    expect(classifyAuditOutcome("write", { changed: false })).toBe("noop");
    expect(classifyAuditOutcome("write", { mutations: [] })).toBe("noop");
    expect(classifyAuditOutcome("read", { replayed: true })).toBe("success");
    expect(
      classifyAuditError(
        new Error("GitHub API request failed with status 500; verify the repository allowlist and token permissions"),
      ),
    ).toEqual({
      outcome: "error",
      errorClass: "external",
    });
    expect(constants.O_APPEND).toEqual(expect.any(Number));
  });

  it("rejects an existing FIFO audit target without blocking", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linear-project-audit-"));
    const fifo = path.join(directory, "operations.ndjson");
    await execFileAsync("mkfifo", [fifo]);
    const logger = new FileAuditLogger(fifo);
    await expect(logger.attempt("tool", "write")).rejects.toThrow(/audit/i);
  });

  it("validates audit paths and normalizes an RFC3339 write-window expiry", () => {
    expect(() => loadConfig({ MCP_AUDIT_LOG_PATH: "relative/audit.ndjson" })).toThrow(/normalized absolute path/);
    expect(() => loadConfig({ MCP_WRITE_WINDOW_EXPIRES_AT: "tomorrow" })).toThrow(/RFC3339/);
    expect(() => loadConfig({ MCP_WRITE_WINDOW_EXPIRES_AT: "2026-02-31T00:00:00Z" })).toThrow(/calendar/);
    expect(() => loadConfig({ MCP_WRITE_WINDOW_EXPIRES_AT: "2027-02-29T00:00:00Z" })).toThrow(/calendar/);
    expect(loadConfig({ MCP_WRITE_WINDOW_EXPIRES_AT: "2028-02-29T00:00:00Z" })).toMatchObject({
      writeWindowExpiresAt: "2028-02-29T00:00:00.000Z",
    });
    expect(() =>
      loadConfig({
        MCP_WRITES_ENABLED: "true",
        MCP_WRITE_WINDOW_EXPIRES_AT: new Date(Date.now() + 61 * 60_000).toISOString(),
      }),
    ).toThrow(/60 minutes/);
    expect(loadConfig({ MCP_WRITE_WINDOW_EXPIRES_AT: "2020-01-01T00:00:00Z" })).toMatchObject({
      writeWindowExpiresAt: "2020-01-01T00:00:00.000Z",
    });

    const future = new Date(Date.now() + 60_000).toISOString();
    expect(loadConfig({ MCP_WRITE_WINDOW_EXPIRES_AT: future })).toMatchObject({ writeWindowExpiresAt: future });
  });
});

import { chmod, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertWriteAccess, isWriteWindowActive } from "../src/security.js";
import { manageWriteWindow } from "../src/write-window.js";
import { testConfig } from "./helpers.js";

const BASE_ENV = [
  "LINEAR_API_KEY=never-print-this",
  "LINEAR_ALLOWED_ORGANIZATION_ID=org-1",
  "LINEAR_ALLOWED_TEAM_IDS=team-1",
  "LINEAR_ALLOWED_PROJECT_IDS=project-1",
  "LINEAR_ALLOWED_SCOPE_CODES=ACQI",
  "MCP_AUDIT_LOG_PATH=/private/audit/operations.ndjson",
  "MCP_WRITES_ENABLED=false",
  "MCP_WRITE_WINDOW_EXPIRES_AT=",
  "",
].join("\n");

describe("bounded MCP write-window control", () => {
  it("atomically enables a bounded allowlisted window and disables it again", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linear-project-window-"));
    await chmod(directory, 0o700);
    const envFile = path.join(directory, "server.env");
    await writeFile(envFile, BASE_ENV, { encoding: "utf8", mode: 0o600 });
    const now = new Date("2026-08-16T15:00:00.000Z");

    const enabled = await manageWriteWindow({
      command: "enable",
      envFile,
      scope: "ACQI",
      confirm: "ACQI",
      minutes: 15,
      now,
    });
    expect(enabled).toMatchObject({
      writesEnabled: true,
      active: true,
      expiresAt: "2026-08-16T15:15:00.000Z",
      reconnectRequired: true,
    });
    const enabledSource = await readFile(envFile, "utf8");
    expect(enabledSource).toContain("MCP_WRITES_ENABLED=true");
    expect(enabledSource).toContain("MCP_WRITE_WINDOW_EXPIRES_AT=2026-08-16T15:15:00.000Z");
    expect(enabledSource).toContain("LINEAR_API_KEY=never-print-this");

    const status = await manageWriteWindow({ command: "status", envFile, now });
    expect(status).toMatchObject({ writesEnabled: true, active: true, reconnectRequired: false });

    const disabled = await manageWriteWindow({ command: "disable", envFile, now });
    expect(disabled).toMatchObject({ writesEnabled: false, active: false, reconnectRequired: true });
    const disabledSource = await readFile(envFile, "utf8");
    expect(disabledSource).toContain("MCP_WRITES_ENABLED=false");
    expect(disabledSource).toContain("MCP_WRITE_WINDOW_EXPIRES_AT=\n");
  });

  it("rejects unconfirmed, unallowlisted, unaudited, and unsafe environments", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linear-project-window-"));
    await chmod(directory, 0o700);
    const envFile = path.join(directory, "server.env");
    await writeFile(envFile, BASE_ENV, { encoding: "utf8", mode: 0o600 });
    await expect(
      manageWriteWindow({ command: "enable", envFile, scope: "ACQI", confirm: "WRONG", minutes: 15 }),
    ).rejects.toThrow(/confirm/);
    await expect(
      manageWriteWindow({ command: "enable", envFile, scope: "OTHER", confirm: "OTHER", minutes: 15 }),
    ).rejects.toThrow(/LINEAR_ALLOWED_SCOPE_CODES/);

    await writeFile(envFile, BASE_ENV.replace("MCP_AUDIT_LOG_PATH=/private/audit/operations.ndjson", "MCP_AUDIT_LOG_PATH="), {
      encoding: "utf8",
      mode: 0o600,
    });
    await expect(
      manageWriteWindow({ command: "enable", envFile, scope: "ACQI", confirm: "ACQI", minutes: 15 }),
    ).rejects.toThrow(/MCP_AUDIT_LOG_PATH/);

    const target = path.join(directory, "target.env");
    const link = path.join(directory, "link.env");
    await writeFile(target, BASE_ENV, { encoding: "utf8", mode: 0o600 });
    await symlink(target, link);
    await expect(manageWriteWindow({ command: "status", envFile: link })).rejects.toThrow(/non-symlink/);
  });

  it("requires an active expiry at every write authorization check", () => {
    const noExpiry = testConfig({ writesEnabled: true, writeWindowExpiresAt: "" });
    expect(() => assertWriteAccess(noExpiry, "org-1", "ACQI")).toThrow(/bounded/);

    const expired = testConfig({ writesEnabled: true, writeWindowExpiresAt: "2020-01-01T00:00:00.000Z" });
    expect(isWriteWindowActive(expired)).toBe(false);
    expect(() => assertWriteAccess(expired, "org-1", "ACQI")).toThrow(/expired/);

    const active = testConfig({
      writesEnabled: true,
      writeWindowExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    expect(isWriteWindowActive(active)).toBe(true);
    expect(assertWriteAccess(active, "org-1", "ACQI")).toBe("ACQI");
  });
});

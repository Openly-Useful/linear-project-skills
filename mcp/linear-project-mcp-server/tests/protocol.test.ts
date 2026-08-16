import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { createLinearProjectMcpServer } from "../src/server.js";
import { MemoryLinearGateway, testConfig } from "./helpers.js";

describe("MCP protocol surface", () => {
  const closeCallbacks: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  });

  it("lists the complete tool suite with annotations and returns structured capability data", async () => {
    const server = createLinearProjectMcpServer({ config: testConfig({ writesEnabled: false }), linear: new MemoryLinearGateway() });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(() => client.close(), () => server.close());

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "github_get_project_evidence",
      "linear_project_bootstrap",
      "linear_project_capabilities",
      "linear_project_create_team",
      "linear_project_find_candidates",
      "linear_project_link_evidence",
      "linear_project_list_scoped_issues",
      "linear_project_move_candidate",
      "linear_project_resolve_scope",
      "linear_project_upsert_scoped_issue",
      "obsidian_read_project_note",
      "obsidian_search_project_notes",
      "obsidian_upsert_project_note",
    ]);
    expect(tools.tools.every((tool) => tool.annotations)).toBe(true);

    const result = await client.callTool({ name: "linear_project_capabilities", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { writesEnabled: false, linear: { teamAdministration: true, teamKeyCreation: true } },
    });
  });

  it("returns an MCP tool error without mutation when writes are disabled", async () => {
    const linear = new MemoryLinearGateway();
    const server = createLinearProjectMcpServer({ config: testConfig({ writesEnabled: false }), linear });
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
    expect(result.structuredContent).toMatchObject({ ok: false, error: expect.stringContaining("Mutations are disabled") });
    expect(linear.teams).toHaveLength(1);
  });
});

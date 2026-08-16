import { mkdtemp, readFile, writeFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GitHubRestAdapter } from "../src/adapters/github.js";
import { LocalObsidianAdapter } from "../src/adapters/obsidian.js";
import { testConfig } from "./helpers.js";

describe("GitHubRestAdapter", () => {
  it("reads only allowlisted repositories and never sends credentials in output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          full_name: "Openly-Useful/example",
          html_url: "https://github.com/Openly-Useful/example",
          description: "Example repository",
          updated_at: "2026-08-15T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const adapter = new GitHubRestAdapter(testConfig().github, fetchMock);

    const evidence = await adapter.getReference({ repository: "Openly-Useful/example", kind: "repository" });

    expect(evidence.canonicalUrl).toBe("https://github.com/Openly-Useful/example");
    expect(JSON.stringify(evidence)).not.toContain("test-token");
    await expect(
      adapter.getReference({ repository: "Someone-Else/private", kind: "repository" }),
    ).rejects.toThrow("not allowlisted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("LocalObsidianAdapter", () => {
  it("confines reads and managed writes to allowlisted Markdown paths", async () => {
    const vaultPath = await mkdtemp(path.join(os.tmpdir(), "linear-mcp-vault-"));
    await mkdir(path.join(vaultPath, "Projects", "ACQI"), { recursive: true });
    await writeFile(path.join(vaultPath, "Projects", "ACQI", "Overview.md"), "# Overview\n\nHuman notes.\n", "utf8");
    const adapter = new LocalObsidianAdapter(
      testConfig({ vaultPath, vaultName: "Work", obsidianDirectories: ["Projects/ACQI"] }).obsidian,
    );

    const note = await adapter.read("Projects/ACQI/Overview.md");
    expect(note.obsidianUri).toContain("vault=Work");
    await adapter.upsertManagedSection({
      relativePath: "Projects/ACQI/Overview.md",
      scopeCode: "ACQI",
      title: "Overview",
      markdown: "Linear project: linked",
    });
    await adapter.upsertManagedSection({
      relativePath: "Projects/ACQI/Overview.md",
      scopeCode: "ACQI",
      title: "Overview",
      markdown: "Linear project: refreshed",
    });
    const content = await readFile(path.join(vaultPath, "Projects", "ACQI", "Overview.md"), "utf8");
    expect(content).toContain("Human notes.");
    expect(content.match(/openly-useful-linear:start ACQI/g)).toHaveLength(1);
    expect(content).toContain("Linear project: refreshed");
    await expect(adapter.read("../Secrets.md")).rejects.toThrow("safe vault-relative");
    await expect(adapter.read("Projects/Other/Notes.md")).rejects.toThrow("outside the configured directory allowlist");

    const outsidePath = `${vaultPath}-outside.md`;
    await writeFile(outsidePath, "# Private\n", "utf8");
    await symlink(outsidePath, path.join(vaultPath, "Projects", "ACQI", "Linked.md"));
    await expect(adapter.read("Projects/ACQI/Linked.md")).rejects.toThrow("symbolic links");
    await expect(
      adapter.upsertManagedSection({
        relativePath: "Projects/ACQI/Linked.md",
        scopeCode: "ACQI",
        title: "Linked",
        markdown: "Must not escape",
      }),
    ).rejects.toThrow("symbolic links");
    expect(await readFile(outsidePath, "utf8")).toBe("# Private\n");

    await writeFile(path.join(vaultPath, "Projects", "ACQI", "Oversized.md"), "x".repeat(200_001), "utf8");
    await expect(adapter.search("overview", 20)).resolves.toMatchObject([{ relativePath: "Projects/ACQI/Overview.md" }]);
    await expect(
      adapter.upsertManagedSection({
        relativePath: "Projects/ACQI/Too-Large.md",
        scopeCode: "ACQI",
        title: "Too Large",
        markdown: "x".repeat(200_000),
      }),
    ).rejects.toThrow("would exceed the 200000-byte safety limit");
  });
});

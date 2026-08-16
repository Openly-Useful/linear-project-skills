import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import type { ObsidianAdapter, ObsidianNote } from "../types.js";
import { ScopeError, normalizeScopeCode } from "../security.js";

const MAX_NOTE_BYTES = 200_000;
const MAX_SEARCH_FILES = 10_000;

export class LocalObsidianAdapter implements ObsidianAdapter {
  readonly #vaultPath: string | undefined;
  readonly #vaultName: string | undefined;
  readonly #allowedDirectories: readonly string[];
  public readonly configured: boolean;

  public constructor(config: ServerConfig["obsidian"]) {
    this.#vaultPath = config.vaultPath;
    this.#vaultName = config.vaultName;
    this.#allowedDirectories = config.allowedDirectories;
    this.configured = Boolean(config.vaultPath && config.allowedDirectories.length > 0);
  }

  public async search(query: string, limit: number): Promise<readonly Omit<ObsidianNote, "content">[]> {
    this.#requireVault();
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) throw new ScopeError("Obsidian search query must contain at least two characters");
    const results: Omit<ObsidianNote, "content">[] = [];
    let inspectedFiles = 0;
    for (const directory of this.#allowedDirectories) {
      const base = this.#resolve(directory, false);
      await this.#assertNoSymlinks(base, true);
      const completed = await this.#walk(base, async (absolutePath) => {
        inspectedFiles += 1;
        if (inspectedFiles > MAX_SEARCH_FILES) {
          throw new ScopeError(`Obsidian search exceeded the ${MAX_SEARCH_FILES}-file safety limit`);
        }
        const relativePath = this.#toRelative(absolutePath);
        let content: string;
        try {
          content = await this.#readLimited(absolutePath);
        } catch (error) {
          if (error instanceof ScopeError && error.message.includes("byte safety limit")) return true;
          throw error;
        }
        if (`${relativePath}\n${content}`.toLowerCase().includes(needle)) {
          results.push(this.#metadata(relativePath, content));
        }
        return results.length < limit;
      });
      if (!completed || results.length >= limit) break;
    }
    return results;
  }

  public async read(relativePath: string): Promise<ObsidianNote> {
    this.#requireVault();
    const absolutePath = this.#resolve(relativePath, true);
    const content = await this.#readLimited(absolutePath);
    return { ...this.#metadata(this.#toRelative(absolutePath), content), content };
  }

  public async upsertManagedSection(input: {
    relativePath: string;
    scopeCode: string;
    title: string;
    markdown: string;
  }): Promise<ObsidianNote> {
    this.#requireVault();
    const scopeCode = normalizeScopeCode(input.scopeCode);
    const absolutePath = this.#resolve(input.relativePath, true);
    await this.#assertNoSymlinks(absolutePath, true);
    const start = `<!-- openly-useful-linear:start ${scopeCode} -->`;
    const end = `<!-- openly-useful-linear:end ${scopeCode} -->`;
    const block = `${start}\n${input.markdown.trim()}\n${end}`;
    let existing = "";
    try {
      existing = await this.#readLimited(absolutePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "m");
    const next = pattern.test(existing)
      ? existing.replace(pattern, block)
      : `${existing.trimEnd()}${existing.trim() ? "\n\n" : `# ${input.title.trim()}\n\n`}${block}\n`;
    if (Buffer.byteLength(next, "utf8") > MAX_NOTE_BYTES) {
      throw new ScopeError(`Obsidian note would exceed the ${MAX_NOTE_BYTES}-byte safety limit`);
    }
    if (next === existing) return this.read(input.relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await this.#assertNoSymlinks(path.dirname(absolutePath), false);
    await this.#writeNoFollow(absolutePath, next);
    return this.read(input.relativePath);
  }

  #requireVault(): string {
    if (!this.#vaultPath || this.#allowedDirectories.length === 0) {
      throw new ScopeError("Obsidian adapter requires OBSIDIAN_VAULT_PATH and OBSIDIAN_ALLOWED_DIRECTORIES");
    }
    return this.#vaultPath;
  }

  #resolve(relativePath: string, requireMarkdown: boolean): string {
    const vaultPath = this.#requireVault();
    const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").includes("..")) {
      throw new ScopeError("Obsidian paths must be safe vault-relative paths");
    }
    if (requireMarkdown && path.posix.extname(normalized).toLowerCase() !== ".md") {
      throw new ScopeError("Obsidian note paths must end in .md");
    }
    const allowed = this.#allowedDirectories.some(
      (directory) => normalized === directory || normalized.startsWith(`${directory}/`),
    );
    if (!allowed) throw new ScopeError(`Obsidian path ${normalized} is outside the configured directory allowlist`);
    const resolved = path.resolve(vaultPath, normalized);
    const prefix = `${path.resolve(vaultPath)}${path.sep}`;
    if (!resolved.startsWith(prefix)) throw new ScopeError("Resolved Obsidian path escaped the configured vault");
    return resolved;
  }

  async #walk(directory: string, visit: (absolutePath: string) => Promise<boolean>): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!(await this.#walk(absolutePath, visit))) return false;
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        if (!(await visit(absolutePath))) return false;
      }
    }
    return true;
  }

  async #readLimited(absolutePath: string): Promise<string> {
    await this.#assertNoSymlinks(absolutePath, false);
    const handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new ScopeError("Obsidian note path must resolve to a regular file");
      if (metadata.size > MAX_NOTE_BYTES) {
        throw new ScopeError(`Obsidian note exceeds the ${MAX_NOTE_BYTES}-byte safety limit`);
      }
      return await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
  }

  async #writeNoFollow(absolutePath: string, content: string): Promise<void> {
    const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW;
    const handle = await open(absolutePath, flags, 0o600);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new ScopeError("Obsidian note path must resolve to a regular file");
      await handle.writeFile(content, { encoding: "utf8" });
    } finally {
      await handle.close();
    }
  }

  async #assertNoSymlinks(absolutePath: string, allowMissing: boolean): Promise<void> {
    const vaultPath = this.#requireVault();
    const relative = path.relative(vaultPath, absolutePath);
    const segments = relative ? relative.split(path.sep) : [];
    let current = vaultPath;
    for (let index = -1; index < segments.length; index += 1) {
      if (index >= 0) current = path.join(current, segments[index]!);
      try {
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink()) {
          throw new ScopeError("Obsidian paths may not contain symbolic links");
        }
        if (index === -1 && !metadata.isDirectory()) {
          throw new ScopeError("OBSIDIAN_VAULT_PATH must resolve to a directory");
        }
      } catch (error) {
        if (allowMissing && index >= 0 && error instanceof Error && "code" in error && error.code === "ENOENT") {
          return;
        }
        throw error;
      }
    }
  }

  #toRelative(absolutePath: string): string {
    const vaultPath = this.#requireVault();
    return path.relative(vaultPath, absolutePath).split(path.sep).join("/");
  }

  #metadata(relativePath: string, content: string): Omit<ObsidianNote, "content"> {
    const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const title = firstHeading || path.posix.basename(relativePath, ".md");
    const obsidianUri = this.#vaultName
      ? `obsidian://open?vault=${encodeURIComponent(this.#vaultName)}&file=${encodeURIComponent(relativePath)}`
      : undefined;
    return { relativePath, title, ...(obsidianUri ? { obsidianUri } : {}) };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

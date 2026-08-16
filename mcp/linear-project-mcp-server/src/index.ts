#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import { GitHubRestAdapter } from "./adapters/github.js";
import { LinearSdkGateway } from "./adapters/linear.js";
import { LocalObsidianAdapter } from "./adapters/obsidian.js";
import { loadConfig } from "./config.js";
import { createLinearProjectMcpServer } from "./server.js";

export { createLinearProjectMcpServer } from "./server.js";
export { TrackerWorkflows } from "./workflows.js";
export { loadConfig } from "./config.js";
export type * from "./types.js";

export function createServerFromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(environment);
  const linear = config.linear.apiKey || config.linear.accessToken ? new LinearSdkGateway(config.linear) : undefined;
  const github = new GitHubRestAdapter(config.github);
  const obsidian = new LocalObsidianAdapter(config.obsidian);
  return createLinearProjectMcpServer({
    config,
    ...(linear ? { linear } : {}),
    github,
    obsidian,
  });
}

function main(): void {
  serveStdio(() => createServerFromEnvironment(), {
    onerror(error) {
      console.error(`linear-project-mcp-server: ${error.message}`);
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

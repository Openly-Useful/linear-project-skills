#!/usr/bin/env python3
"""Generate or check provider registration files from repo-local canonical metadata."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MCP_DIR = ROOT / "mcp" / "linear-project-mcp-server"
REPOSITORY = "https://github.com/Openly-Useful/linear-project-skills"
REGISTRY_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"
REGISTRY_NAME = "org.openlyuseful/linear-project"


def read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return payload


def encoded(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def registration_outputs() -> dict[Path, dict[str, Any]]:
    catalog = read_json(ROOT / "manifest.json")
    publisher = read_json(ROOT / "publisher.json")
    package = read_json(MCP_DIR / "package.json")
    plugin_version = catalog["version"]
    mcp_version = package["version"]
    contact = publisher["contacts"]["public"]
    policies = publisher["policies"]
    author = {
        "email": contact,
        "name": publisher["displayName"],
        "url": publisher["domains"]["openSource"],
    }
    description = (
        "Three interoperable skills for bootstrapping, synchronizing, and reconciling "
        "tightly scoped Linear projects."
    )
    mcp_config_path = "./.mcp.json"
    # The published package exposes both the server and write-window binaries.
    # npm exec installs the exact package, and this portable Node launcher
    # selects its server entry without relying on a platform shell.
    mcp_launcher = (
        'const{delimiter,resolve}=require("node:path"),{pathToFileURL}=require("node:url");'
        'const bin=process.env.PATH?.split(delimiter)[0];'
        'if(!bin)throw new Error("npm exec PATH is missing");'
        'const entry=resolve(bin,"..","@openly-useful","linear-project-mcp-server","dist","index.js");'
        'process.argv[1]=entry;import(pathToFileURL(entry).href);'
    )
    mcp_config = {
        "mcpServers": {
            "linear_project": {
                "args": [
                    "--yes",
                    "--package",
                    f"{package['name']}@{mcp_version}",
                    "--",
                    "node",
                    "-e",
                    mcp_launcher,
                ],
                "command": "npx",
            }
        }
    }
    codex_plugin = {
        "author": author,
        "description": description,
        "homepage": REPOSITORY,
        "interface": {
            "capabilities": ["Read", "Write"],
            "category": "Productivity",
            "defaultPrompt": [
                "Bootstrap a scoped Linear project with a dedicated team key.",
                "Synchronize implementation evidence with a Linear project.",
                "Reconcile related Linear issues and historical work safely.",
            ],
            "developerName": publisher["displayName"],
            "displayName": "Linear Project Skills",
            "longDescription": (
                "Create or recover one canonical Linear project, preserve team-key identity, "
                "synchronize evidence-backed work, and capture historical records without "
                "turning them into active commitments."
            ),
            "privacyPolicyURL": policies["privacy"],
            "shortDescription": "Scoped Linear project lifecycle workflows",
            "termsOfServiceURL": policies["terms"],
            "websiteURL": REPOSITORY,
        },
        "license": catalog["license"],
        "mcpServers": mcp_config_path,
        "name": catalog["name"],
        "repository": REPOSITORY,
        "skills": "./skills/",
        "version": plugin_version,
    }
    claude_plugin = {
        "author": author,
        "description": description,
        "homepage": REPOSITORY,
        "license": catalog["license"],
        "mcpServers": mcp_config_path,
        "name": catalog["name"],
        "repository": REPOSITORY,
        "skills": "./skills/",
        "version": plugin_version,
    }
    codex_marketplace = {
        "interface": {"displayName": publisher["displayName"]},
        "name": catalog["name"],
        "plugins": [
            {
                "category": "Productivity",
                "name": catalog["name"],
                "policy": {"authentication": "ON_INSTALL", "installation": "AVAILABLE"},
                "source": {"path": ".", "source": "local"},
            }
        ],
    }
    claude_marketplace = {
        "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
        "description": description,
        "name": catalog["name"],
        "owner": author,
        "plugins": [
            {
                "author": author,
                "category": "productivity",
                "description": description,
                "name": catalog["name"],
                "source": ".",
                "strict": True,
                "version": plugin_version,
            }
        ],
        "version": plugin_version,
    }
    server = {
        "$schema": REGISTRY_SCHEMA,
        "description": "Scope-gated Linear project administration with optional GitHub and Obsidian evidence adapters",
        "name": REGISTRY_NAME,
        "packages": [
            {
                "environmentVariables": [
                    {
                        "description": "Linear API key. Configure this or LINEAR_ACCESS_TOKEN through a protected secret store.",
                        "isRequired": False,
                        "isSecret": True,
                        "name": "LINEAR_API_KEY",
                    },
                    {
                        "description": "Linear OAuth access token. Configure this or LINEAR_API_KEY through a protected secret store.",
                        "isRequired": False,
                        "isSecret": True,
                        "name": "LINEAR_ACCESS_TOKEN",
                    },
                    {
                        "description": "Exact Linear organization ID allowed for scoped operations.",
                        "isRequired": True,
                        "isSecret": False,
                        "name": "LINEAR_ALLOWED_ORGANIZATION_ID",
                    },
                    {
                        "description": "Comma-separated exact Linear team IDs. Required when reusing an existing team; leave empty only while bootstrapping a new dedicated team.",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "LINEAR_ALLOWED_TEAM_IDS",
                    },
                    {
                        "description": "Comma-separated exact Linear project IDs. Required after project discovery; leave empty only during initial bootstrap.",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "LINEAR_ALLOWED_PROJECT_IDS",
                    },
                    {
                        "description": "Comma-separated exact scope codes. Leave empty for read-only capability inspection.",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "LINEAR_ALLOWED_SCOPE_CODES",
                    },
                    {
                        "description": "Optional GitHub token used only by the read-only evidence adapter.",
                        "isRequired": False,
                        "isSecret": True,
                        "name": "GITHUB_TOKEN",
                    },
                    {
                        "description": "Comma-separated owner/repository allowlist for GitHub evidence reads.",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "GITHUB_ALLOWED_REPOSITORIES",
                    },
                    {
                        "description": "Optional normalized absolute path to an Obsidian vault.",
                        "format": "filepath",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "OBSIDIAN_VAULT_PATH",
                    },
                    {
                        "description": "Optional expected Obsidian vault directory name.",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "OBSIDIAN_VAULT_NAME",
                    },
                    {
                        "description": "Comma-separated vault-relative directories allowed for Obsidian operations.",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "OBSIDIAN_ALLOWED_DIRECTORIES",
                    },
                    {
                        "default": "false",
                        "description": "Global mutation gate. Keep false unless opening a separately bounded write window.",
                        "format": "boolean",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "MCP_WRITES_ENABLED",
                    },
                    {
                        "description": "Future RFC3339 expiry for a write window; enabled windows may last at most 60 minutes.",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "MCP_WRITE_WINDOW_EXPIRES_AT",
                    },
                    {
                        "description": "Optional normalized absolute path for the append-only NDJSON operation audit.",
                        "format": "filepath",
                        "isRequired": False,
                        "isSecret": False,
                        "name": "MCP_AUDIT_LOG_PATH",
                    },
                ],
                "identifier": package["name"],
                "registryBaseUrl": "https://registry.npmjs.org",
                "registryType": "npm",
                "transport": {"type": "stdio"},
                "version": mcp_version,
            }
        ],
        "repository": {
            "source": "github",
            "subfolder": "mcp/linear-project-mcp-server",
            "url": REPOSITORY,
        },
        "title": "Linear Project",
        "version": mcp_version,
        "websiteUrl": f"{REPOSITORY}/tree/main/mcp/linear-project-mcp-server",
    }
    return {
        ROOT / ".codex-plugin" / "plugin.json": codex_plugin,
        ROOT / ".claude-plugin" / "plugin.json": claude_plugin,
        ROOT / ".agents" / "plugins" / "marketplace.json": codex_marketplace,
        ROOT / ".claude-plugin" / "marketplace.json": claude_marketplace,
        ROOT / ".mcp.json": mcp_config,
        MCP_DIR / "server.json": server,
    }


def registration_drift() -> list[str]:
    errors: list[str] = []
    for path, payload in registration_outputs().items():
        if not path.is_file():
            errors.append(f"missing generated registration file: {path.relative_to(ROOT)}")
        elif path.read_text(encoding="utf-8") != encoded(payload):
            errors.append(f"generated registration file is stale: {path.relative_to(ROOT)}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="check generated files without writing")
    mode.add_argument("--write", action="store_true", help="write generated files")
    args = parser.parse_args()
    if args.write:
        for path, payload in registration_outputs().items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(encoded(payload), encoding="utf-8")
        print("generated provider and MCP registration files")
        return 0
    errors = registration_drift()
    if errors:
        for error in errors:
            print(f"- {error}")
        return 1
    print("provider and MCP registration files are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate the public Linear Project Skills distribution without dependencies."""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

from sync_registration import REGISTRY_NAME, REGISTRY_SCHEMA, registration_drift


ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    "linear-bootstrap-scoped-project": "references/legacy-capture-contract.md",
    "linear-sync-project-work": "references/evidence-update-contract.md",
    "linear-reconcile-project-history": "references/matching-and-history-contract.md",
}
MCP_DIR = ROOT / "mcp" / "linear-project-mcp-server"
PUBLISHER_PATH = ROOT / "publisher.json"
EXPECTED_MCP_TOOLS = {
    "linear_project_capabilities",
    "linear_project_resolve_scope",
    "linear_project_create_team",
    "linear_project_bootstrap",
    "linear_project_list_scoped_issues",
    "linear_project_upsert_scoped_issue",
    "linear_project_find_candidates",
    "linear_project_move_candidate",
    "linear_project_link_evidence",
    "github_get_project_evidence",
    "obsidian_search_project_notes",
    "obsidian_read_project_note",
    "obsidian_upsert_project_note",
}
EXPECTED_REGISTRATION_ENV = {
    "LINEAR_API_KEY": (False, True, None),
    "LINEAR_ACCESS_TOKEN": (False, True, None),
    "LINEAR_ALLOWED_ORGANIZATION_ID": (True, False, None),
    "LINEAR_ALLOWED_TEAM_IDS": (False, False, None),
    "LINEAR_ALLOWED_PROJECT_IDS": (False, False, None),
    "LINEAR_ALLOWED_SCOPE_CODES": (False, False, None),
    "GITHUB_TOKEN": (False, True, None),
    "GITHUB_ALLOWED_REPOSITORIES": (False, False, None),
    "OBSIDIAN_VAULT_PATH": (False, False, None),
    "OBSIDIAN_VAULT_NAME": (False, False, None),
    "OBSIDIAN_ALLOWED_DIRECTORIES": (False, False, None),
    "MCP_WRITES_ENABLED": (False, False, "false"),
    "MCP_WRITE_WINDOW_EXPIRES_AT": (False, False, None),
    "MCP_AUDIT_LOG_PATH": (False, False, None),
}
PRIVATE_PATTERNS = {
    "user absolute path": re.compile(r"/Users/", re.IGNORECASE),
    "private account": re.compile(r"MeekPhills", re.IGNORECASE),
    "private product": re.compile(r"Acqari", re.IGNORECASE),
    "workspace-specific Linear URL": re.compile(r"linear\.app/lgam", re.IGNORECASE),
    "attachment path": re.compile(r"\.codex/attachments", re.IGNORECASE),
    "private key material": re.compile(r"BEGIN [A-Z ]*PRIVATE KEY"),
    "OpenAI-style secret": re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
}


class ValidationError(Exception):
    """Raised when the public distribution violates an invariant."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def parse_frontmatter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    require(text.startswith("---\n"), f"{path}: missing opening frontmatter delimiter")
    parts = text.split("\n---\n", 1)
    require(len(parts) == 2, f"{path}: missing closing frontmatter delimiter")

    metadata: dict[str, str] = {}
    for line in parts[0].splitlines()[1:]:
        require(":" in line, f"{path}: invalid frontmatter line {line!r}")
        key, value = line.split(":", 1)
        key = key.strip()
        require(key not in metadata, f"{path}: duplicate frontmatter key {key!r}")
        metadata[key] = value.strip()

    require(set(metadata) == {"name", "description"}, f"{path}: frontmatter must contain only name and description")
    require(bool(metadata["description"]), f"{path}: description is empty")
    return metadata, text


def validate_openai_yaml(path: Path, skill_name: str) -> None:
    text = path.read_text(encoding="utf-8")
    require(re.search(r'^\s*display_name:\s*"[^"]+"\s*$', text, re.MULTILINE) is not None, f"{path}: missing display_name")
    require(re.search(r'^\s*short_description:\s*"[^"]{25,64}"\s*$', text, re.MULTILINE) is not None, f"{path}: short_description must be 25–64 characters")
    prompt = re.search(r'^\s*default_prompt:\s*"([^"]+)"\s*$', text, re.MULTILINE)
    require(prompt is not None, f"{path}: missing default_prompt")
    require(f"${skill_name}" in prompt.group(1), f"{path}: default_prompt must mention ${skill_name}")


def validate_public_text(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    require("TODO" not in text and "[TODO" not in text, f"{path}: contains placeholder text")
    for label, pattern in PRIVATE_PATTERNS.items():
        require(pattern.search(text) is None, f"{path}: contains {label}")


def validate_skill(name: str, required_reference: str) -> None:
    skill_dir = ROOT / "skills" / name
    require(skill_dir.is_dir(), f"missing skill directory: {skill_dir}")

    skill_file = skill_dir / "SKILL.md"
    reference_file = skill_dir / required_reference
    agent_file = skill_dir / "agents" / "openai.yaml"
    for path in (skill_file, reference_file, agent_file):
        require(path.is_file(), f"missing required file: {path}")

    metadata, skill_text = parse_frontmatter(skill_file)
    require(metadata["name"] == name, f"{skill_file}: name does not match folder")
    require(len(skill_text.splitlines()) < 500, f"{skill_file}: must remain below 500 lines")

    references = re.findall(r"\((references/[^)]+)\)", skill_text)
    require(required_reference in references, f"{skill_file}: required reference is not linked")
    for relative in references:
        require((skill_dir / relative).is_file(), f"{skill_file}: broken reference {relative}")

    validate_openai_yaml(agent_file, name)
    for path in skill_dir.rglob("*"):
        if path.is_file():
            validate_public_text(path)


def validate_manifest() -> None:
    path = ROOT / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    require(manifest.get("schemaVersion") == 1, "manifest.json: unsupported schemaVersion")
    require(manifest.get("name") == "linear-project-skills", "manifest.json: incorrect name")
    require(re.fullmatch(r"\d+\.\d+\.\d+", manifest.get("version", "")) is not None, "manifest.json: version must be semver")
    require(manifest.get("license") == "MIT", "manifest.json: license must be MIT")
    require(manifest.get("publisher") == "Openly Useful", "manifest.json: incorrect publisher")
    require(manifest.get("publisherMetadata") == "publisher.json", "manifest.json: incorrect publisher metadata path")
    require(
        manifest.get("providerArtifacts")
        == {
            "codexPlugin": ".codex-plugin/plugin.json",
            "codexMarketplace": ".agents/plugins/marketplace.json",
            "claudePlugin": ".claude-plugin/plugin.json",
            "claudeMarketplace": ".claude-plugin/marketplace.json",
            "mcpConfig": ".mcp.json",
        },
        "manifest.json: incorrect provider artifact map",
    )

    entries = manifest.get("skills")
    require(isinstance(entries, list), "manifest.json: skills must be a list")
    names = {entry.get("name") for entry in entries}
    require(names == set(EXPECTED), "manifest.json: skill set does not match distribution")
    for entry in entries:
        expected_path = f"skills/{entry['name']}"
        require(entry.get("path") == expected_path, f"manifest.json: incorrect path for {entry['name']}")
        handoffs = entry.get("handoffTo")
        require(isinstance(handoffs, list), f"manifest.json: handoffTo must be a list for {entry['name']}")
        require(set(handoffs) <= set(EXPECTED) - {entry["name"]}, f"manifest.json: invalid handoff for {entry['name']}")

    mcp_servers = manifest.get("mcpServers")
    require(isinstance(mcp_servers, list) and len(mcp_servers) == 1, "manifest.json: expected one MCP server")
    server = mcp_servers[0]
    require(server.get("name") == "linear-project-mcp-server", "manifest.json: incorrect MCP server name")
    require(server.get("path") == "mcp/linear-project-mcp-server", "manifest.json: incorrect MCP server path")
    require(server.get("package") == "@openly-useful/linear-project-mcp-server", "manifest.json: incorrect MCP package")
    require(server.get("registryName") == REGISTRY_NAME, "manifest.json: incorrect MCP registry name")
    require(
        server.get("registryRecord") == "mcp/linear-project-mcp-server/server.json",
        "manifest.json: incorrect MCP registry record path",
    )
    require(server.get("version") == "0.1.0", "manifest.json: incorrect MCP package version")
    require(server.get("transports") == ["stdio"], "manifest.json: MCP transport must be stdio")
    require(server.get("optionalAdapters") == ["github", "obsidian"], "manifest.json: incorrect optional adapters")


def validate_publisher_record(
    publisher: dict[str, object],
    *,
    external_publication: bool,
    publication_target: Optional[str] = None,
) -> None:
    require(publisher.get("schemaVersion") == 1, "publisher.json: unsupported schemaVersion")
    require(publisher.get("id") == "openly-useful", "publisher.json: incorrect publisher ID")
    require(publisher.get("displayName") == "Openly Useful", "publisher.json: incorrect display name")
    require(
        publisher.get("authorityManifest") == "https://openlyuseful.org/publisher/manifest.json",
        "publisher.json: incorrect authority manifest",
    )
    legal = publisher.get("legal")
    require(isinstance(legal, dict), "publisher.json: legal status is missing")
    require(legal.get("plannedName") == "Openly Useful LLC", "publisher.json: incorrect planned legal name")
    require(
        legal.get("plannedRoles") == ["publisher", "operator", "licensee"],
        "publisher.json: incorrect planned legal roles",
    )
    require(legal.get("status") == "formation-pending", "publisher.json: legal status must remain formation-pending")
    require(legal.get("activeName") is None, "publisher.json: pending entity cannot claim an active legal name")
    require(
        legal.get("currentOperator")
        == {
            "type": "founder-individual",
            "displayName": "Founder of Openly Useful",
            "operatingAs": "Openly Useful",
        },
        "publisher.json: current operator must be the founder-individual operating as Openly Useful",
    )
    require(
        publisher.get("domains")
        == {
            "studio": "https://openlyuseful.com",
            "openSource": "https://openlyuseful.org",
            "publicAuthority": "openlyuseful.org",
        },
        "publisher.json: incorrect domain roles",
    )
    require(
        publisher.get("organization") == {"github": "https://github.com/Openly-Useful"},
        "publisher.json: incorrect source organization",
    )
    require(
        publisher.get("namespaces")
        == {
            "npm": "@openly-useful",
            "openSourceMcp": "org.openlyuseful",
            "reservedStudioMcp": "com.openlyuseful",
        },
        "publisher.json: incorrect namespaces",
    )
    require(
        publisher.get("contacts", {}).get("public") == "hello@openlyuseful.org",
        "publisher.json: incorrect public contact",
    )
    require(
        publisher.get("policies")
        == {
            "privacy": "https://openlyuseful.org/legal/privacy",
            "terms": "https://openlyuseful.org/legal/terms",
            "security": "https://openlyuseful.org/security",
            "support": "https://openlyuseful.org/support",
        },
        "publisher.json: incorrect policy URLs",
    )
    require(
        publisher.get("policyMirrors")
        == {
            "privacy": "https://github.com/Openly-Useful/openlyuseful.org/blob/main/legal/privacy.html",
            "terms": "https://github.com/Openly-Useful/openlyuseful.org/blob/main/legal/terms.html",
            "security": "https://github.com/Openly-Useful/openlyuseful.org/blob/main/security.html",
            "support": "https://github.com/Openly-Useful/openlyuseful.org/blob/main/support.html",
        },
        "publisher.json: incorrect policy mirror URLs",
    )
    require(
        publisher.get("authorityManifestMirror")
        == "https://github.com/Openly-Useful/openlyuseful.org/blob/main/publisher/manifest.json",
        "publisher.json: incorrect authority manifest mirror",
    )
    publication = publisher.get("publication", {})
    require(isinstance(publication, dict), "publisher.json: publication policy is missing")
    require(publication.get("localGenerationAllowed") is True, "publisher.json: local generation must be allowed")
    require(publication.get("localTestingAllowed") is True, "publisher.json: local testing must be allowed")
    external_allowed = publication.get("externalPublicationAllowed")
    authorization = publication.get("authorization")
    blockers = publication.get("blockingRequirements")
    require(external_allowed is True, "publisher.json: external publication must be founder-authorized")
    require(authorization == "granted", "publisher.json: founder publication authorization must be granted")
    require(
        publication.get("authorizationBasis") == "founder-owner-direct",
        "publisher.json: publication authorization basis must be founder-owner-direct",
    )
    require(
        publication.get("effectiveWhileFormationPending") is True,
        "publisher.json: founder authorization must be effective while formation is pending",
    )
    require(
        blockers == ["namespace-verification", "provider-account-authentication", "provider-review"],
        "publisher.json: generic provider requirements differ from the public authority",
    )
    if external_publication:
        require(publication_target is not None, "external publication target is required")
        if publication_target == "npm-package":
            # Provider authentication and review are tracked for registry/submission
            # workflows; they are not npm artifact readiness requirements.
            pass
        else:
            require(not blockers, f"{publication_target} publication still has generic provider requirements")
    else:
        require(publication_target is None, "publication target requires --external-publication")


def validate_publisher(*, external_publication: bool, publication_target: Optional[str] = None) -> None:
    publisher = json.loads(PUBLISHER_PATH.read_text(encoding="utf-8"))
    validate_publisher_record(
        publisher,
        external_publication=external_publication,
        publication_target=publication_target,
    )
    require(
        publisher.get("artifactPolicy")
        == {
            "authorityEndpoint": "This manifest is the published authority endpoint for Openly Useful publisher and marketplace verification. It is projected from the governed editable publisher source.",
            "derivation": "Provider-specific skills, MCP manifests, packages, and marketplace listings must derive publisher identity, domains, policy URLs, contacts, and namespaces from this published authority endpoint.",
            "activation": "Openly Useful is founder-operated while Openly Useful LLC formation is pending. External source and registry publication is authorized by the founder-owner. The planned LLC must not be represented as formed, active, or the operator until formation is accepted; later LLC operation does not require a transfer of RunGlance ownership.",
        },
        "publisher.json: artifact policy differs from the canonical projection",
    )
    require(publisher.get("lastUpdated") == "2026-08-23", "publisher.json: canonical projection date mismatch")


def validate_mcp_server() -> None:
    required_files = (
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.json",
        "tsconfig.test.json",
        "vitest.config.ts",
        ".env.example",
        "README.md",
        "LICENSE",
        "server.json",
        "src/index.ts",
        "src/server.ts",
        "src/security.ts",
        "tests/protocol.test.ts",
        "tests/workflows.test.ts",
        "tests/adapters.test.ts",
        "evaluations/read-only.xml",
        "evaluations/README.md",
    )
    for relative in required_files:
        require((MCP_DIR / relative).is_file(), f"missing MCP file: {relative}")

    package = json.loads((MCP_DIR / "package.json").read_text(encoding="utf-8"))
    require(package.get("name") == "@openly-useful/linear-project-mcp-server", "MCP package: incorrect name")
    require(package.get("mcpName") == REGISTRY_NAME, "MCP package: incorrect mcpName")
    require(package.get("version") == "0.1.0", "MCP package: incorrect version")
    require(package.get("license") == "MIT", "MCP package: license must be MIT")
    require(package.get("type") == "module", "MCP package: expected ESM")
    require(package.get("packageManager") == "pnpm@10.34.0", "MCP package: pnpm must support the Node.js 20 floor")
    require(package.get("engines", {}).get("node") == ">=20", "MCP package: expected Node.js >=20")
    require(package.get("bin", {}).get("linear-project-mcp-server") == "dist/index.js", "MCP package: missing bin")
    require("LICENSE" in package.get("files", []), "MCP package: LICENSE must be published")
    require("server.json" in package.get("files", []), "MCP package: server.json must be published")
    require("evaluations" in package.get("files", []), "MCP package: evaluations must be published")
    require(
        "validate.py --external-publication --publication-target npm-package"
        in package.get("scripts", {}).get("prepublishOnly", ""),
        "MCP package: prepublishOnly must enforce the npm publication gate",
    )
    for section in ("dependencies", "devDependencies"):
        dependencies = package.get(section)
        require(isinstance(dependencies, dict) and dependencies, f"MCP package: missing {section}")
        for name, version in dependencies.items():
            require(
                re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version or "") is not None,
                f"MCP package: {name} must use an exact version",
            )

    server_source = (MCP_DIR / "src" / "server.ts").read_text(encoding="utf-8")
    registered = set(re.findall(r'server\.registerTool\(\s*\n?\s*"([a-z0-9_]+)"', server_source))
    require(registered == EXPECTED_MCP_TOOLS, "MCP server: registered tool set does not match the public contract")
    require("const ConfirmWrite = z.literal(true)" in server_source, "MCP server: literal mutation confirmation is missing")

    environment = (MCP_DIR / ".env.example").read_text(encoding="utf-8")
    require("MCP_WRITES_ENABLED=false" in environment, "MCP example: writes must default to false")
    for secret_name in ("LINEAR_API_KEY", "LINEAR_ACCESS_TOKEN", "GITHUB_TOKEN"):
        match = re.search(rf"^#?\s*{secret_name}=(.*)$", environment, re.MULTILINE)
        require(match is not None and not match.group(1).strip(), f"MCP example: {secret_name} must be empty")

    registry = json.loads((MCP_DIR / "server.json").read_text(encoding="utf-8"))
    require(registry.get("$schema") == REGISTRY_SCHEMA, "MCP Registry: incorrect official schema URL")
    require(registry.get("name") == package["mcpName"] == REGISTRY_NAME, "MCP Registry: server/package name mismatch")
    require(1 <= len(registry.get("description", "")) <= 100, "MCP Registry: description must satisfy schema length")
    require(registry.get("version") == package["version"], "MCP Registry: server/package version mismatch")
    require(
        registry.get("repository")
        == {
            "source": "github",
            "subfolder": "mcp/linear-project-mcp-server",
            "url": "https://github.com/Openly-Useful/linear-project-skills",
        },
        "MCP Registry: incorrect repository provenance",
    )
    packages = registry.get("packages")
    require(isinstance(packages, list) and len(packages) == 1, "MCP Registry: expected one npm package")
    registry_package = packages[0]
    require(registry_package.get("registryType") == "npm", "MCP Registry: package type must be npm")
    require(registry_package.get("registryBaseUrl") == "https://registry.npmjs.org", "MCP Registry: incorrect npm base URL")
    require(registry_package.get("identifier") == package["name"], "MCP Registry: package identifier mismatch")
    require(registry_package.get("version") == package["version"], "MCP Registry: package version mismatch")
    require(registry_package.get("transport") == {"type": "stdio"}, "MCP Registry: transport must be stdio")
    variables = registry_package.get("environmentVariables")
    require(isinstance(variables, list), "MCP Registry: environmentVariables must be a list")
    metadata = {
        variable.get("name"): (variable.get("isRequired"), variable.get("isSecret"), variable.get("default"))
        for variable in variables
    }
    require(metadata == EXPECTED_REGISTRATION_ENV, "MCP Registry: configuration metadata does not match the runtime contract")

    evaluation_path = MCP_DIR / "evaluations" / "read-only.xml"
    evaluation = ET.parse(evaluation_path).getroot()
    pairs = evaluation.findall("qa_pair")
    require(len(pairs) == 10, "MCP evaluations: expected exactly 10 read-only question/answer pairs")
    questions: list[str] = []
    for pair in pairs:
        question = (pair.findtext("question") or "").strip()
        answer = (pair.findtext("answer") or "").strip()
        require(bool(question) and bool(answer), "MCP evaluations: every pair needs a question and answer")
        questions.append(question)
    require(len(set(questions)) == len(questions), "MCP evaluations: questions must be unique")

    excluded_parts = {"node_modules", "dist", "coverage"}
    for path in MCP_DIR.rglob("*"):
        if not path.is_file() or excluded_parts.intersection(path.parts) or path.name == "pnpm-lock.yaml":
            continue
        validate_public_text(path)


def validate_repository(*, external_publication: bool = False, publication_target: Optional[str] = None) -> None:
    validate_publisher(
        external_publication=external_publication,
        publication_target=publication_target,
    )
    validate_manifest()
    validate_mcp_server()
    drift = registration_drift()
    require(not drift, "; ".join(drift))
    for name, required_reference in EXPECTED.items():
        validate_skill(name, required_reference)

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for name in EXPECTED:
        require(f"skills/{name}/SKILL.md" in readme, f"README.md: missing link for {name}")
    require("mcp/linear-project-mcp-server/README.md" in readme, "README.md: missing MCP server link")

    for path in (
        ROOT / "README.md",
        ROOT / "CONTRIBUTING.md",
        ROOT / "AGENTS.md",
        ROOT / "manifest.json",
        ROOT / "publisher.json",
        ROOT / ".codex-plugin" / "plugin.json",
        ROOT / ".claude-plugin" / "plugin.json",
        ROOT / ".agents" / "plugins" / "marketplace.json",
        ROOT / ".claude-plugin" / "marketplace.json",
        ROOT / ".mcp.json",
    ):
        validate_public_text(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--external-publication",
        action="store_true",
        help="require founder-owner authorization before an external publish",
    )
    parser.add_argument(
        "--publication-target",
        choices=("npm-package", "mcp-registry", "provider-submission"),
        help="external publication boundary to validate",
    )
    args = parser.parse_args()
    try:
        validate_repository(
            external_publication=args.external_publication,
            publication_target=args.publication_target,
        )
    except (OSError, json.JSONDecodeError, ValidationError) as error:
        print(f"validation failed: {error}", file=sys.stderr)
        return 1

    print(f"validated {len(EXPECTED)} skills and {len(EXPECTED_MCP_TOOLS)} MCP tools; public distribution is consistent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

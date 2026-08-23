#!/usr/bin/env python3
"""Focused tests for the fail-closed publisher release policy."""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from validate import ValidationError, validate_publisher_record  # noqa: E402


class PublisherPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pending = json.loads((ROOT / "publisher.json").read_text(encoding="utf-8"))

    def test_founder_authorized_projection_can_publish_the_npm_package(self) -> None:
        validate_publisher_record(self.pending, external_publication=False)
        validate_publisher_record(
            self.pending,
            external_publication=True,
            publication_target="npm-package",
        )

    def test_generic_provider_requirements_still_block_other_targets(self) -> None:
        with self.assertRaisesRegex(ValidationError, "generic provider requirements"):
            validate_publisher_record(
                self.pending,
                external_publication=True,
                publication_target="mcp-registry",
            )

    def test_publication_target_requires_the_external_gate(self) -> None:
        with self.assertRaisesRegex(ValidationError, "requires --external-publication"):
            validate_publisher_record(
                self.pending,
                external_publication=False,
                publication_target="npm-package",
            )

    def test_exact_founder_authorization_identity_and_policy_mismatches_fail_closed(self) -> None:
        cases = (
            (("legal", "currentOperator", "type"), "llc", "current operator"),
            (("publication", "authorization"), "withheld", "must be granted"),
            (("publication", "authorizationBasis"), "future-assignment", "founder-owner-direct"),
            (("publication", "effectiveWhileFormationPending"), False, "effective while formation"),
            (("organization", "github"), "https://github.com/not-openly-useful", "source organization"),
            (("policies", "privacy"), "https://example.invalid/privacy", "policy URLs"),
        )
        for path, value, expected_error in cases:
            with self.subTest(path=path):
                changed = copy.deepcopy(self.pending)
                target = changed
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                with self.assertRaisesRegex(ValidationError, expected_error):
                    validate_publisher_record(
                        changed,
                        external_publication=True,
                        publication_target="npm-package",
                    )


class PluginRegistrationTests(unittest.TestCase):
    def test_codex_and_claude_plugins_pin_the_same_stdio_mcp_package(self) -> None:
        catalog = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        package = json.loads(
            (ROOT / "mcp" / "linear-project-mcp-server" / "package.json").read_text(encoding="utf-8")
        )
        codex = json.loads((ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        claude = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
        claude_marketplace = json.loads(
            (ROOT / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8")
        )
        mcp = json.loads((ROOT / ".mcp.json").read_text(encoding="utf-8"))

        self.assertEqual(catalog["version"], "0.2.1")
        self.assertEqual(package["version"], "0.1.0")
        self.assertEqual(codex["version"], catalog["version"])
        self.assertEqual(claude["version"], catalog["version"])
        self.assertEqual(claude_marketplace["version"], catalog["version"])
        self.assertEqual(claude_marketplace["plugins"][0]["version"], catalog["version"])
        self.assertEqual(codex["mcpServers"], "./.mcp.json")
        self.assertEqual(claude["mcpServers"], "./.mcp.json")
        self.assertEqual(
            mcp,
            {
                "mcpServers": {
                    "linear_project": {
                        "args": [
                            "--yes",
                            "--package",
                            "@openly-useful/linear-project-mcp-server@0.1.0",
                            "--",
                            "node",
                            "-e",
                            'const{delimiter,resolve}=require("node:path"),{pathToFileURL}=require("node:url");const bin=process.env.PATH?.split(delimiter)[0];if(!bin)throw new Error("npm exec PATH is missing");const entry=resolve(bin,"..","@openly-useful","linear-project-mcp-server","dist","index.js");process.argv[1]=entry;import(pathToFileURL(entry).href);',
                        ],
                        "command": "npx",
                    }
                }
            },
        )
        self.assertNotIn("env", mcp["mcpServers"]["linear_project"])


if __name__ == "__main__":
    unittest.main()

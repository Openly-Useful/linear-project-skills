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


if __name__ == "__main__":
    unittest.main()

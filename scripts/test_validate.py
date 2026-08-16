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

    def test_pending_projection_validates_locally_but_cannot_publish(self) -> None:
        validate_publisher_record(self.pending, external_publication=False)
        with self.assertRaisesRegex(ValidationError, "entity is not active"):
            validate_publisher_record(self.pending, external_publication=True)

    def test_active_authorized_projection_can_publish(self) -> None:
        active = copy.deepcopy(self.pending)
        active["legal"]["activeName"] = "Openly Useful LLC"
        active["legal"]["status"] = "active"
        active["publication"]["externalPublicationAllowed"] = True
        active["publication"]["authorization"] = "granted"
        active["publication"]["blockingRequirements"] = []

        validate_publisher_record(active, external_publication=False)
        validate_publisher_record(active, external_publication=True)


if __name__ == "__main__":
    unittest.main()

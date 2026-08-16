# Repository guidance

This repository publishes portable Agent Skills for Linear project lifecycle work.

Before claiming completion, run:

```sh
python3 scripts/validate.py
cd mcp/linear-project-mcp-server
pnpm check
pnpm pack --dry-run
```

Preserve these boundaries:

- Linear issue prefixes come from team keys, not project labels.
- `XY-1` requires a new empty team with key `XY` and first-issue readback.
- Historical captures begin with `[HISTORICAL]`, remain non-actionable, and use deterministic source markers.
- Reconciliation moves only exact-identity matches and preserves team identifiers by default.
- Ongoing sync is event-driven, evidence-backed, and scoped to one canonical project and label.
- Never include secrets, private source material, real customer data, raw conversations, or user-specific absolute paths.
- Forward-test with synthetic data and external writes disabled unless live mutation is explicitly authorized.
- Do not publish, push, release, or merge without explicit authorization.

---
name: linear-bootstrap-scoped-project
description: Create a net-new, tightly scoped Linear project linked to its canonical repository and local project, provision or select the dedicated team whose key controls issue identifiers, and import legacy work with explicit provenance. Use when starting a new Linear project, requiring a custom team key such as XY with the first issue expected to be XY-1, consolidating prior work into a clean project, or establishing an idempotent active-versus-historical backlog.
---

# Linear Bootstrap Scoped Project

Create the destination project, key-bearing team, active backlog, and legacy ledger without absorbing unrelated work.

## Required inputs

Resolve these values from the request and available evidence before writing:

- working product and Linear project name;
- canonical repository, local folder, project brief, and related project links;
- legacy source allowlist and capture cutoff;
- desired team name and 2–5 character uppercase key, or authority to choose them;
- initial active work and the item that must become the first issue;
- explicit exclusions and mutation/safety boundaries.

Ask only for a missing choice that would materially change scope. Otherwise infer from authoritative local and linked sources and state the inference.

## Non-negotiable key rule

Treat the Linear issue prefix as a **team key**, never a project key or label.

- To guarantee a sequence beginning at `XY-1`, create or select a net-new team with key `XY` and verify it has no issues before creating the first issue.
- Create the designated first issue before any other issue and read it back as `XY-1`.
- If the key is unavailable, the team already has issues, team creation is unavailable, or Linear cannot guarantee the next number, stop before issue creation and report the exact blocker.
- Never simulate a custom key with a project name, label, or title prefix.

## Workflow

1. Read the installed Linear workflow skill when available. Confirm the Linear connection and relevant workspace.
2. Inventory before mutation:
   - list exact and alias-matching teams, projects, labels, and issues;
   - inspect canonical repository issues, pull requests, project files, and legacy sources read-only;
   - record exact source IDs, URLs or paths, states, timestamps, relations, and stable fingerprints.
3. Publish a compact scope plan containing destination, allowlisted sources, exclusions, team/key plan, first issue, active count, historical count, and ambiguous items. Do not write ambiguous items.
4. Classify every gathered record as `active`, `historical`, `reference-only`, or `excluded`. Read [references/legacy-capture-contract.md](references/legacy-capture-contract.md) whenever legacy records will be imported.
5. Create in this order:
   1. dedicated team and verified empty key sequence;
   2. project attached only to the designated team;
   3. project-code issue label and `HISTORICAL` issue label;
   4. project summary and description with canonical links, scope boundary, source ledger, and safety boundary;
   5. designated first active issue, verified as `<KEY>-1`;
   6. remaining active issues in dependency order;
   7. historical capture issues and relations.
6. Preserve one source unit per issue when the source has independent identity. Aggregate only evidence fragments that never represented independent work.
7. Add stable source markers before creating issues. Search those markers first on every rerun so the workflow is idempotent.
8. Apply milestones, dependencies, priorities, and statuses only when supported by source evidence. Do not infer completion from a commit, closed source item, or historical mention alone.
9. Read back the project, team, labels, every created issue, relations, and links. Reconcile expected versus actual counts and verify that excluded work was untouched.

## Handoff

- Invoke `$linear-sync-project-work` for ongoing implementation and evidence updates.
- Invoke `$linear-reconcile-project-history` when a project may already exist or when related Linear issues may live outside the destination.

## Completion report

Return the project URL, team and key, first issue identifier, active/historical counts, source reconciliation, unresolved ambiguities, and explicit confirmation that no out-of-scope items changed.

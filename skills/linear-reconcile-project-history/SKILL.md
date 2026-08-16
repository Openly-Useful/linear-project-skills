---
name: linear-reconcile-project-history
description: Find an existing canonical Linear project, audit related issues that may live outside it, move only high-confidence matches into that project, and capture non-Linear legacy work as provenance-rich issues prefixed [HISTORICAL]. Use for tracker sweeps, project consolidation, orphaned or misfiled issue discovery, legacy migration into an existing project, or separating historical evidence from actively created and tracked work.
---

# Linear Reconcile Project History

Perform a read-first sweep, preserve identity and relations, and keep historical evidence visibly non-active.

## Resolve the destination

1. Read the installed Linear workflow skill when available.
2. Search projects by exact name, ID, code, repository URL, and known aliases.
3. Read candidate project descriptions, teams, labels, resources, milestones, and issues.
4. Select one destination only when the evidence is unique. If none exists, hand off to `$linear-bootstrap-scoped-project`. If multiple candidates remain, request the destination choice before any write.
5. Freeze a scope allowlist: destination project ID, allowed product aliases, repository URLs, work-stream IDs, project-code labels, source containers, and time bounds.

## Discover related work

Search workspace-wide for:

- exact project-code labels or source markers;
- canonical repository, pull-request, and document URLs;
- exact work-stream IDs and stable external issue IDs;
- product aliases combined with matching objective or component evidence;
- unassigned or misfiled issues whose descriptions identify the canonical project.

Also inspect allowlisted local, GitHub, and legacy project sources read-only. Do not treat a fuzzy title match alone as related work.

Read [references/matching-and-history-contract.md](references/matching-and-history-contract.md) before classifying or mutating candidates.

## Classify and plan

Classify each candidate as:

- `move-existing`: an existing Linear issue that is provably part of the destination project;
- `historical-capture`: legacy evidence not represented by an existing Linear issue;
- `already-correct`: already linked and classified properly;
- `duplicate-or-conflict`: requires reconciliation without another issue;
- `ambiguous`: report only;
- `unrelated`: exclude.

Present a compact mutation plan with exact IDs and evidence. Restrict writes to high-confidence `move-existing` and deterministic `historical-capture` items.

## Apply changes

1. For `move-existing`, set the destination project while preserving status, priority, assignee, milestone, relations, comments, and source identity.
2. Add the destination project-code label without dropping unrelated valid labels.
3. Do not change the issue’s team merely to match the destination. A team change alters its identifier; require explicit authorization and a readback plan when that is truly necessary.
4. Add a concise provenance comment explaining why the issue moved, its previous project, capture timestamp, and matching evidence.
5. For `historical-capture`, create an issue titled exactly `[HISTORICAL] <concise source title>`, apply project-code and `HISTORICAL` labels, and record non-actionability and source provenance.
6. Search deterministic source markers before every create so reruns replay rather than duplicate.
7. Rebuild dependencies only from explicit source relations. Never infer completion, ownership, or authority from legacy artifacts.

## Verify the sweep

Read back the destination and every mutated issue. Verify:

- project assignment, labels, titles, states, milestones, and relations;
- no unrelated issue changed;
- every historical title begins with `[HISTORICAL]` and is excluded from active tracking;
- source counts reconcile across moved, captured, already-correct, duplicate, ambiguous, and unrelated classes;
- a second sweep would produce zero additional mutations.

Hand ongoing project maintenance to `$linear-sync-project-work`.

## Completion report

Return the destination URL, discovery queries, moved IDs, historical IDs, unchanged correct items, duplicates, ambiguous candidates, exclusions, reconciliation totals, and explicit confirmation that team keys and out-of-scope work were preserved.

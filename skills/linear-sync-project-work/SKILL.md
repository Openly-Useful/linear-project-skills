---
name: linear-sync-project-work
description: Keep a linked Linear project accurate while implementation progresses by mapping work to scoped issues, attaching fresh evidence, creating only genuine backlog gaps, and applying evidence-backed status or project updates. Use whenever working in a repository or local project that has a canonical Linear project, when asked to keep Linear updated automatically, or when commits, tests, reviews, blockers, decisions, and newly discovered work need synchronized tracking.
---

# Linear Sync Project Work

Synchronize material implementation evidence without turning routine activity into tracker noise.

## Establish the scope anchor

Before any Linear write, resolve and read back:

- one canonical Linear project ID;
- its allowed team IDs and required project-code label;
- canonical repository and local root;
- active issue mapping, milestones, dependencies, and status definitions;
- project-specific completion and safety gates.

Derive the anchor from project metadata, repository handoff files, or explicit user input. If multiple projects match, stop and ask which is canonical. Do not update by product-name similarity alone.

## Session workflow

1. Read the installed Linear workflow skill when available.
2. At work start, read the project and relevant scoped issues. Confirm each candidate issue belongs to the project and carries the required label.
3. Map the requested implementation to the smallest existing issue whose objective and paths cover it.
4. If no issue covers the work:
   - search the project and team for semantic and source-marker duplicates;
   - create a new issue only for a durable, independently actionable gap;
   - assign the canonical project, allowed team, project-code label, milestone, and evidence-supported dependencies.
5. During work, update Linear after material events only: validated design decisions, commits, pull requests, test or review results, confirmed blockers, scope changes, or completed definitions of done.
6. Prefer append-only evidence comments for progress. Edit canonical issue fields only when the underlying title, objective, acceptance criteria, priority, milestone, dependency, or state truly changed.
7. Read [references/evidence-update-contract.md](references/evidence-update-contract.md) before changing status, declaring completion, or publishing a project status update.
8. At work end, attach the freshest evidence, state what remains, update blockers and dependencies if needed, and read back all mutated records.

## Automatic-update boundary

Interpret “automatically” as **event-driven within the current authorized work**, not as permission for background monitoring or unrelated tracker changes.

- Never touch items outside the canonical project and required label scope.
- Never close or mark Done from a commit, PR, elapsed time, or agent assertion alone.
- Never copy secrets, credentials, raw private data, or excessive logs into Linear.
- Never create status spam for unchanged state.
- Never rewrite historical issues as active work.
- Preserve user-authored descriptions and comments unless a field change is necessary.

## Drift handling

If the project mapping is missing or related work appears outside the project, run `$linear-reconcile-project-history` before moving anything. If no canonical project exists, hand off to `$linear-bootstrap-scoped-project`.

## Completion report

Return mutated issue IDs, evidence added, state changes with their proof, newly created gaps, blockers, and confirmation that all writes passed fresh readback and stayed within scope.

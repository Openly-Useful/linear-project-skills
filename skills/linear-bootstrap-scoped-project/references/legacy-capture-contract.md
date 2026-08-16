# Legacy capture contract

Use this contract for every imported legacy record.

## Classification

- `active`: unfinished work intentionally adopted into the new execution backlog.
- `historical`: completed, abandoned, superseded, or evidentiary work captured for context without reactivation.
- `reference-only`: a source linked from the project but not represented as an issue.
- `excluded`: outside the allowlist or insufficiently related.

Never convert historical evidence into active work merely because it appears relevant.

## Stable identity and deduplication

Build a deterministic source marker from:

`source-system | source-container | source-item-id | source-revision-or-fingerprint`

Place a sanitized marker in the issue description. Search destination and candidate projects for the marker before creating or moving anything. Exact marker matches are replays, not new issues. Conflicting matches require review.

## Historical issue format

Title:

`[HISTORICAL] <original concise title>`

Required description fields:

- project code;
- source system and container;
- source item ID and URL or local relative path;
- source state and observed timestamp;
- capture timestamp;
- stable source marker;
- concise evidence summary;
- `Historical only: true`;
- `Actionability: none`;
- statement that capture does not prove completion, ownership, authorization, or current validity.

Apply both the project-code issue label and `HISTORICAL`. Preserve the source state as text. Use a non-active Linear state when one is available and accurate; otherwise keep the item in Backlog with the historical exclusions explicit. Never mark Done without independent completion evidence.

## Reconciliation

Report:

- source units discovered;
- active issues created or replayed;
- historical issues created or replayed;
- reference-only and excluded units;
- ambiguous or conflicting units;
- total destination issues before and after.

The category totals must reconcile to the discovered source-unit count.

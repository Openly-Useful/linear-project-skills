# Matching and history contract

## Confidence rules

Classify a candidate as high confidence when at least one exact identity signal exists and no contradictory signal exists:

- project-code label plus matching repository or work-stream ID;
- canonical repository URL plus matching component/objective;
- exact external source marker or source issue ID;
- explicit destination project reference in the description;
- authoritative local mapping from work-stream ID to Linear issue.

Treat aliases, fuzzy title similarity, shared technology, same assignee, or chronological proximity as supporting evidence only. Do not mutate on those signals alone.

Contradictory repository, product, customer, or explicit exclusion evidence forces `ambiguous` or `unrelated` regardless of title similarity.

## Move versus historical capture

Use `move-existing` when a Linear issue already represents the work and belongs in the destination. Preserve its title unless the user requests normalization.

Use `historical-capture` when the source is legacy evidence without a canonical Linear issue, or when creating an active task would falsely reactivate old work. Historical titles must begin with `[HISTORICAL]`.

Do not create a historical duplicate of a moved or already-correct Linear issue. Add provenance to the existing issue instead.

## Historical description fields

Include:

- project code and `Historical only: true`;
- original source title, system, container, ID, and stable URL/path;
- source state and observed timestamp;
- capture timestamp and deterministic source marker;
- concise facts, anomalies, and confidence limits;
- `Actionability: none`;
- statement that the record does not prove completion, ownership, authorization, or current validity.

## Reconciliation table

Maintain mutually exclusive counts for:

`discovered = moved + historical + already-correct + duplicate/conflict + ambiguous + unrelated`

Record before/after destination counts and verify an immediate second-pass plan contains zero writes.

# Evidence update contract

## Material evidence

Accept evidence such as:

- commit or pull-request URL with exact revision;
- test, build, migration, security, or review result with command and outcome;
- artifact or document URL with version or timestamp;
- confirmed decision with owner and scope;
- reproducible blocker with current external condition;
- deployment or runtime observation from an authorized environment.

Do not treat issue state, prose claims, unverified generated output, or a commit alone as proof of the full definition of done.

## Progress comment

Use a compact structure:

```markdown
### Evidence update

- Scope: <what changed>
- Revision/artifact: <stable link or identifier>
- Verification: <command/check and result>
- Safety boundary: <what remains disabled or excluded>
- Remaining: <unfinished acceptance criteria>
- Captured at: <RFC3339 timestamp>
```

Avoid duplicating an existing comment with the same revision and verification result.

## State transitions

- Move to an active state only when implementation has actually started.
- Move to a review state only when the reviewable artifact exists.
- Move to Done only when every definition-of-done item has fresh evidence and all required blockers are resolved.
- Reopen when current evidence invalidates completion.
- Preserve historical items in their historical/non-active state.

For every transition, record the evidence and read the resulting state back from Linear.

## Project status

Publish a project status update only for a material milestone, risk change, blocker, or verified completion. Include completed scope, evidence, risks, next gated action, and the timestamp. Do not publish unchanged periodic noise.

# Delivery labels enabled by default

Historical plan: display names and metadata authority are superseded by [reference-driven renames](label-rename.md). Old names below describe that historical snapshot, not the current runner contract; the default-on policy still applies.

## Proposal

Make base-label synchronization and closed-pull-request Under review cleanup the default behavior of the shared delivery workflow, without per-repository setup. Retain a single explicit opt-out and all existing safety boundaries from the implementation merged in #25.

This plan was approved for implementation. This repository has no OpenSpec directory. The historical `base-labels.md` plan describes the previous default-disabled policy; this plan supersedes only that rollout policy. No live labels, assignments, variables, credentials, permissions or consumer files are changed by this task.

## Exact policy

- Both automatic writers are enabled when the calling repository's `DELIVERY_LABELS_ENABLED` variable is unset, empty, `true`, or any value other than `false`.
- `false` disables both automatic writers, case-insensitively (`false`, `False` and `FALSE` all opt out). Do not trim whitespace: ` false ` is not an opt-out. This matches GitHub Actions' case-insensitive string comparisons; the JavaScript runner must use the same semantics.
- Use `vars.DELIVERY_LABELS_ENABLED != 'false'` for both token-mint conditions, retaining sync's existing manual dry-run exclusion. The runner must reject automatic writes on the same opt-out before any label API call, and report that explicit opt-out rather than pending enablement.
- Existing `true` consumers remain enabled. No variable must be set to adopt this behavior. A repository that must not receive automatic label writes must set its explicit opt-out before using the updated workflow/tooling.
- The existing explicitly requested manual `workflow_dispatch` dry run remains a read-only diff even when opted out, without minting an App token. The local report-only CLI remains read-only. Explicit manual apply remains separately authorized and is not changed by this policy.

## Safety boundaries retained

Keep separate repository-scoped App tokens with existing Pull requests write permission. Missing secrets, inadequate App rights, denied APIs and rate limits remain visible warnings/summaries, without write fallback to the caller token. Preserve job-level failure isolation and the absence of dependency edges into promotion, finalization or required checks.

Sync may create or update managed definitions but never delete labels or assignments. Closed-event cleanup removes only the manifest's Under review assignment on the validated closed PR, including merged and unmerged closures, retaining reopen/idempotency guards. No historical sweep or crew implementation is added. Default-label pruning remains a separate, explicitly authorized manual command that neither automatic job can import or invoke. No caller inputs, permissions, schedules, events, protection rules or palette definitions change.

## Consumer adoption and version pins

Read-only checks of each known consumer's current default-branch caller found:

| Consumer | Current workflow reference | Action after this policy merges |
| --- | --- | --- |
| MyWorkflows | Local reusable workflow on the default branch | None; the next forwarded delivery event uses the merged policy |
| a1 | Shared workflow at `main`, default `tools_ref: main` | None; the next forwarded delivery event picks it up |
| crew | Shared workflow at `main`, default `tools_ref: main` | None; the next forwarded delivery event picks it up |
| herdr-app | Shared workflow at `main`, default `tools_ref: main` | None; the next forwarded delivery event picks it up |
| xrbuild | Shared workflow at `main`, default `tools_ref: main` | None; the next forwarded delivery event picks it up |
| xrbuild private workspace | Shared workflow at `main`, default `tools_ref: main` | None; the next forwarded delivery event picks it up |

No audited caller is version-pinned. Do not publish the private workspace's repository identity or raw API response. This table is a read-only snapshot, not a maintained inventory or fan-out mechanism.

A consumer pinned to a tag or commit does not acquire updated workflow YAML until its caller pin is advanced to a reviewed revision containing this change. Set `with.tools_ref` to that same revision: the reusable workflow's existing default is `main`, so an old workflow pin alone does not pin its scripts and could otherwise mix the old token gate with the new runner policy. For an existing old pin with omitted `tools_ref`, pin tooling to the same old revision to retain old behavior until upgrading, or update both references together. Do not change the input default or any consumer as part of this task. Moving `main` callers need no edit. Idle repositories wait for their next forwarded event; no immediate central write or historical replay is promised.

## Ordered implementation outcomes

These outcomes match the draft PR's Implementation checklist, in order.

### 1. Both isolated automatic label jobs default on with a shared explicit opt-out and regression coverage

Status: implemented; targeted sync/cleanup tests pass (73 tests).

- Update the runner gate, disabled message, both App-token conditions and workflow step names/comments without changing unrelated delivery jobs.
- Replace disabled-by-default assertions in `test/repository-labels.test.ts` and `test/review-label-cleanup.test.ts`; cover unset, empty, true and arbitrary values enabling both operations, case-insensitive false opt-out, and whitespace behavior.
- Cover opt-out with zero label API calls and no App token mint, read-only dry runs even when opted out, missing/incorrect App tokens, visible missing-rights warnings, isolation from required checks, safe cleanup and no pruning/deletion regressions.
- Keep workflow-contract tests aligned with exact conditions and identical policy in JavaScript and Actions, rather than merely dropping the old assertions.

### 2. Adoption and review guidance describe default-on labels, opt-out and version-aligned consumer updates

Status: implemented; documentation/skill contracts pass (4 tests).

- Update `README.md`, `docs/delivery-labels.md` and `skills/change-delivery/SKILL.md` to remove pending per-repository enablement instructions and document the exact opt-out semantics.
- Keep the signed-in review-runner ownership contract, advisory status, separate crew integration, permission warnings, event cadence, historical cleanup limitation and separate pruning consent intact.
- Explain moving versus pinned callers and matching `tools_ref`; record the read-only consumer findings without exposing private repository identity.
- Update `test/label-contract.test.ts` to assert default-on/opt-out and consumer guidance, while preserving permissions, read-only and no-pruner contracts.

## Validation and handoff

The plan's PR body validated before approval. The unmodified CI-equivalent baseline had 336 passing tests and one unchanged bootstrap test exceeding its 5000 ms timeout. Both approved outcomes now have passing targeted checks. Run CI's full commands under Node 24: `npm ci --ignore-scripts` followed by `npm test`, once before reporting implementation; record the result in the task report. No live write is needed for any validation. Do not manually mark the PR ready or merge it; readiness belongs to the delivery bot.

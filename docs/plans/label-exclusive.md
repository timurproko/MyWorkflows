# Mutually exclusive managed review-label assignments

Status: approved for implementation; outcomes tracked below.

## Problem and scope

An open pull request can retain multiple managed review labels when independent writers add them. The shared delivery workflow will reconcile additions of the three stable roles `under-review`, `review-approved` and `review-changes-needed`, resolving current names and `previousNames` from one validated manifest snapshot. Under the coordinator's revised policy, each currently assigned managed name is ranked by its own latest exact-name `labeled` event (timestamp, then event id); `unlabeled` events never rank survivors. One missing addition is oldest; two or more missing additions fail closed with a warning and no writes. This supersedes role-wide rename-history inference. Bot and person additions follow the same rule. Only conflicting managed assignments are removed; unrelated assignments and repository label definitions are never changed.

This repository has no `openspec/` directory. This committed plan and its draft PR carry the proposal without an Automation block. Implementation begins only after plan approval. No live label writes, consumer edits, sweeps, variable changes or permission changes are authorized by this proposal.

## Event delivery and consumer impact

MyWorkflows #36 removed assignment events from delivery callers. Preserve that exclusion: a job-level skip still publishes a successful-for-protection skipped check and could overwrite a failed Delivery check. The coordinator's third-review decision explicitly supersedes the earlier proposal to append `labeled` to delivery.

Use a separate reusable `.github/workflows/review-labels.yml`, containing only the advisory reconciliation job and no delivery/test jobs. External consumers add `templates/review-labels-caller.yml` as `.github/workflows/review-labels.yml`, triggered only by `pull_request_target: [labeled]`. MyWorkflows adds `.github/workflows/self-review-labels.yml` with a trusted local reusable reference. Revert label subscriptions in delivery template/self-callers. No consumer repositories are edited. Pinned consumers align the new workflow reference and matching `tools_ref`.

The new check is distinctly named `review-labels / Reconcile managed review labels (advisory)` and is never required. Label-triggered workflow graphs must not contain or call any required check, including jobs with false guards. Retain concurrency, scoped App token, best-effort warnings, opt-out and the exact-name additions-only survivor policy. Keep consumer TEST triggers unchanged and label-free; the documented xrbuild exception remains a separately owned fix. Public Actions-policy allowlists must authorize the new caller path explicitly; MyWorkflows declares its self-caller in its own override without applying live policy. Built-in delivery protection defaults and required gates remain unchanged. Unmanaged additions are no-ops after manifest resolution.

## Implementation outcomes

### 1. Reconciliation keeps only the latest managed review-label addition on open pull requests

Status: implemented; 49 focused fake-API unit tests pass, including ordering, aliases, actor parity, closure, opt-out, pagination, stale events, API failures and bounded churn.

- Add a reconciliation module using the existing validated manifest, repository validation and label API conventions; resolve all current/historical names by stable key rather than emoji or display-name literals.
- Validate event/repository/PR identity and require a managed `labeled` event. Read current PR state and paginate current assignments at run time; never use the webhook's label array as current truth. Closed/merged PRs are no-ops owned by existing clear-on-close handling.
- Read paginated issue label-event history to identify the latest applicable managed `labeled` event by assignment `created_at`, not label-definition timestamps, webhook arrival, run creation or execution order. For equal timestamps use stable numeric event-id ordering as the deterministic tie-breaker. Use only exact-name `labeled` events for currently assigned names, ignoring all removal events; fresh assignments exclude removed names and nothing is resurrected.
- Preserve the winning exact current/historical assignment and remove only other managed names. Do not add a label, replace the complete label set or mutate definitions. Previous-name additions participate in the same policy.
- Recheck open state, assignments and the latest applicable addition before each removal; bound retries and report observed churn rather than silently claiming success. Confirm read access and exact assignment absence before treating a DELETE 404 as successful. Treat one assigned name missing a `labeled` event as oldest; fail closed before writes if at least two lack additions. Malformed ordering, API/pagination failures and denied reads remain errors rather than missing history.
- Treat bot and person events identically, including additions made with the delivery App. Removals do not trigger reconciliation. Document the remaining non-atomic read/DELETE window; serialization orders this workflow's jobs, not independent external writers.
- Add fake-API unit coverage for single additions, both queued execution orders for near-simultaneous additions, exact timestamp ties, delayed/stale events, current and previous names, bot/person parity, closed/merged/reopened state changes, opt-out, unrelated labels, pagination, repeat processing, removals, permission failures, confirmed 404 absence and bounded churn.

### 2. An isolated reusable label workflow handles additions without publishing delivery or test checks

Status: implemented and updated after the third review. The dedicated reusable and tiny caller publish only their own non-required check, not skipped required checks. Per-PR concurrency, token guards and opt-out are preserved; no test workflow is edited.

- Move the dedicated managed-review reconciliation job into its own reusable label workflow, retaining the existing guarded label-automation runner.
- Accept only open-PR labeled events and resolve managed membership in trusted scripts. The label caller never invokes the delivery workflow; even skipped required checks must not be published.
- Serialize per repository/PR using a dedicated concurrency group with `cancel-in-progress: false` and `queue: max`; do not depend on queue execution order for winner selection. Do not add caller-level concurrency or dependencies from required jobs.
- Use only trusted checked-out tooling and the existing separate repository-scoped App token with Pull requests write; no Issues grant, credential fallback or permission expansion. Keep job/token failures best effort with visible warnings and summaries, isolated from required checks.
- Honor the existing case-insensitive, untrimmed `DELIVERY_LABELS_ENABLED=false` opt-out before token minting or label API reads, including the new automatic writer.
- Restore label-free delivery template/self-callers and ship a separate label-only caller template/self-caller. Add executable contracts traversing all label-triggered reusable-workflow graphs, including skipped jobs, to reject required/test check namespaces. Preserve guarded runner coverage, scoped tokens, per-PR serialization, definition events and clear-on-close behavior. Declare only the new self-caller path in MyWorkflows' Actions-policy override; no required gate or live permission changes.

### 3. Published contracts explain exclusivity, ordering limits and the exact consumer rollout

Status: implemented; README, label documentation and the shared skill describe the third advisory writer, exact seven-consumer caller edits and honest test-isolation limits. Contract tests pass.

- Update `README.md`, `docs/delivery-labels.md` and the shared skill's label contract to describe the new advisory default-on writer, latest-event selection, aliases, bot/person parity, closed-PR no-op and unchanged closure ownership.
- Describe the distinct advisory workflow/check and the skipped-required-check vulnerability that makes job-level guards insufficient; delivery and test callers remain label-free.
- Publish exact new caller content for all seven consumers, optional public Actions-policy path authorization, aligned tooling pins and xrbuild's existing test-trigger exception. No consumer edits, live policy application or external writes are performed.
- State API/concurrency/race limitations honestly: event timestamps need an event-id tie-break for equal precision, jobs can be explicitly cancelled or overflow the bounded queue, webhook/history delays and API errors can postpone reconciliation, and GitHub offers no atomic delete-if-still-open-and-latest operation. No historical sweep, lease, timer, crash-expiry or cross-controller lock is added.
- Extend documentation/runner contract regressions for these guarantees without altering existing manifest, reference reconciliation, cleanup, opt-out or advisory semantics.

## Validation after approval

Use quick targeted reconciliation/runner/workflow-contract checks before each outcome push and tick that PR outcome as its code and tests land. After implementation run the whole `npm test` suite and `node test/generated-palettes.mjs` full-suite palette variants, preserving failure evidence without weakening assertions or timeouts. Bring the branch current with the default branch and validate the final PR body with `delivery check-body` before the last tick. Inspect required checks on the exact final head and report their state; no plan-stage suite or final-head implementation CI is claimed. Never manually mark ready, arm auto-merge or merge. No live writes to other repositories are part of validation.

## Initial implementation evidence and remaining limits

All three outcomes are implemented. The focused reconciliation, runner, cleanup, workflow and self-caller set passes 233 tests; label-documentation and workflow/reconciliation contracts pass 85 tests. With Node 24.22.0 and the pinned Vitest 5.1.1, the complete `npm test` run and both generated-palette full-suite runs each pass 643 of 644 tests across 35 files, failing only the already documented Windows bootstrap setup 5000 ms timeout. The unchanged bootstrap file passes all six tests in a focused rerun. No timeout or assertion is weakened; final-head Linux required checks remain the integration gate and their results go in the task report.

Historical rollout proposal (superseded by the third review): a read-only audit found all seven delivery callers omitted `labeled`; adding that event to delivery is no longer permitted. herdr-app, crew, a1, .xrbuild, MyConfigs and MyWorkflows exclude label actions from their inspected test triggers and do not run tests on Delivery completion. xrbuild's existing `.github/workflows/ci.yml` still includes both `labeled` and `unlabeled`; its tests already run independently on additions/removals. Test isolation there requires a separate authorized consumer fix to remove those two actions; it is not implemented or claimed here. No other repository was edited or written to. Read-only herdr-app #61 issue-event inspection confirmed the ordering fields and original conflicting additions, without changing its labels.

GitHub's final-read/DELETE window, external writers, history delays, API failures and bounded queue/churn remain documented best-effort limits. No open or historical PR sweep, timer or automatic restoration is introduced.

## First review repair: rename-cycle ordering (historical, superseded)

This role-wide policy and its old expectations are superseded by the coordinator's second-review decision below.

The review found that an older exact-name event could mask a later previous-name addition after a definition renamed away and back. For a role with a single currently assigned name, winner selection now always uses the newest event across that role's current name and every historical alias, not alias history only when exact history is absent. A latest alias removal or incomplete history fails closed with an advisory warning rather than deleting a potentially newer assignment. Coexisting aliases retain distinct assignment histories.

Four added regressions failed against the previous implementation and pass with the repair: the reported Review/Under-review rename cycle and its reverse, a cycle with an older exact-name removal and multiple aliases (including equal-timestamp event-id ordering), and zero-write/warning handling of an ambiguous latest alias removal. Direct selection and full reconciliation are covered. All 89 focused reconciliation, runner, workflow and label-contract tests pass. The first repair passed 648 tests and both generated-palette suites in Linux CI. These counts and expectations describe that historical head, not the current simplified rule.

## Second review: approved exact-name, additions-only policy (retained)

The reviewer found that ordinary DELETE-generated `unlabeled` events could make the role-wide policy stop after removing only one competing alias. The coordinator explicitly approved simplifying winner selection: find each currently assigned managed name's latest exact-name `labeled` event, rank by timestamp then event id, ignore all `unlabeled` events, and never infer renamed identities from another spelling. A single missing addition is oldest; at least two missing additions produce a warning with no writes. All competing aliases, including those of the winner's own role, are removed with fresh assignment reads before each deletion. Re-runs and resumed partial deletions are idempotent.

The fake API now records successful DELETEs as real `unlabeled` history entries. Regressions cover all six three-name addition orders and all six assignment-list orders, both two-alias-only orders followed by a verdict, rename cycles under the revised policy, one/two missing additions, resumption after partial deletion, ignored malformed removals, and every nonempty subset of seven managed names with every possible survivor. Each exhaustive case converges in one run and performs zero further writes on re-run. Published guidance and the PR acceptance text follow this revised policy. That head passed 658 Linux tests and both palette variants. Current full-suite and exact final-head required-check results belong in the task report.

## Third review: separate workflow/check namespace (approved and implemented)

The reviewer identified a required-check bypass: forwarding a label event to the delivery reusable still publishes a skipped `delivery / Delivery check`, which GitHub accepts for protection and can replace a failed same-head gate. The coordinator approved a separate reusable and separate tiny caller, with label subscriptions removed from delivery template/self-callers. This is now implemented; the additions-only survivor script is unchanged.

Workflow contracts parse the actual YAML and recursively traverse every label-triggered entrypoint and every reusable call, ignoring job guards. They reject required/test names, exercise mutations that reintroduce label events into either delivery caller, inject false-guarded gate/test jobs and nested test calls, and model preservation of an existing failed gate across label runs. The new caller publishes only the uniquely named advisory job; unresolved calls/dynamic names fail closed. YAML is pinned as a direct test dependency rather than relying on its transitive availability. Existing job security/concurrency/event guards remain covered.

README, the label docs, shared skill and PR outcomes/Acceptance now describe adding the separate caller file, not changing delivery triggers. The docs include exact external caller content and the local self-caller variant, public Actions-policy authorization requirements, and the unchanged xrbuild exception. MyWorkflows' local protection override includes the new self-caller path while preserving all required checks/events. No default protection policy or live policy is changed.

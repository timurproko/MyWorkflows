# Mutually exclusive managed review-label assignments

Status: approved for implementation; outcomes tracked below.

## Problem and scope

An open pull request can retain multiple managed review labels when independent writers add them. The shared delivery workflow will reconcile additions of the three stable roles `under-review`, `review-approved` and `review-changes-needed`, resolving current names and `previousNames` from one validated manifest snapshot. The most recent managed addition wins regardless of whether its actor is a bot or person. Only conflicting managed assignments are removed; unrelated assignments and repository label definitions are never changed.

This repository has no `openspec/` directory. This committed plan and its draft PR carry the proposal without an Automation block. Implementation begins only after plan approval. No live label writes, consumer edits, sweeps, variable changes or permission changes are authorized by this proposal.

## Event delivery and consumer impact

MyWorkflows #36 removed assignment events from `templates/delivery-caller.yml` and `.github/workflows/self-delivery.yml`. Both currently subscribe to `pull_request_target` actions `[opened, synchronize, ready_for_review, converted_to_draft, reopened, edited, closed]`. A reusable workflow cannot add subscriptions to its caller. Consequently a reliable zero-edit rollout to those consumers is not possible without a separate installation/dispatch mechanism, which this change will not introduce.

The narrowest change is to append **only `labeled`** to the delivery caller's existing action list. Do not add `unlabeled`. Update the template and this repository's self-caller; document the same one-line addition for consumers, without editing any other repository. Existing callers already forwarding `labeled` need no edit. Moving-main consumers get the implementation after merge but still need this event subscription; pinned consumers also align their workflow reference and `tools_ref` to the same reviewed revision.

Keep consumer TEST workflows unchanged and excluding `labeled`/`unlabeled`. On label events, the new advisory job is the only executable delivery job: promotion, finalization, Delivery check, definition sync, refresh and closure cleanup retain explicit exclusions. Support `pull_request` and `pull_request_target` labeled-event recognition in the reconciliation entry point and guard tests, while the shipped caller remains `pull_request_target` and runs only trusted tooling. Unmanaged additions are read-only no-ops after manifest resolution; editable names cannot safely be hard-coded in a YAML filter.

## Implementation outcomes

### 1. Reconciliation keeps only the latest managed review-label addition on open pull requests

Status: implemented; 49 focused fake-API unit tests pass, including ordering, aliases, actor parity, closure, opt-out, pagination, stale events, API failures and bounded churn.

- Add a reconciliation module using the existing validated manifest, repository validation and label API conventions; resolve all current/historical names by stable key rather than emoji or display-name literals.
- Validate event/repository/PR identity and require a managed `labeled` event. Read current PR state and paginate current assignments at run time; never use the webhook's label array as current truth. Closed/merged PRs are no-ops owned by existing clear-on-close handling.
- Read paginated issue label-event history to identify the latest applicable managed `labeled` event by assignment `created_at`, not label-definition timestamps, webhook arrival, run creation or execution order. For equal timestamps use stable numeric event-id ordering as the deterministic tie-breaker. Account for subsequent removals and current assignments so delayed events never resurrect removed labels or override a newer applicable addition.
- Preserve the winning exact current/historical assignment and remove only other managed names. Do not add a label, replace the complete label set or mutate definitions. Previous-name additions participate in the same policy.
- Recheck open state, assignments and the latest applicable addition before each removal; bound retries and report observed churn rather than silently claiming success. Confirm read access and exact assignment absence before treating a DELETE 404 as successful. Fail closed on malformed/incomplete history, missing ordering data or denied reads instead of guessing a winner.
- Treat bot and person events identically, including additions made with the delivery App. Removals do not trigger reconciliation. Document the remaining non-atomic read/DELETE window; serialization orders this workflow's jobs, not independent external writers.
- Add fake-API unit coverage for single additions, both queued execution orders for near-simultaneous additions, exact timestamp ties, delayed/stale events, current and previous names, bot/person parity, closed/merged/reopened state changes, opt-out, unrelated labels, pagination, repeat processing, removals, permission failures, confirmed 404 absence and bounded churn.

### 2. An isolated advisory delivery job handles label additions without restarting delivery or tests

- Add a dedicated managed-review reconciliation job to the shared workflow and integrate its operation with the existing guarded label-automation runner.
- Accept only open-PR labeled events, and resolve managed membership in the script from the manifest. Keep all other shared jobs skipped for assignment-only events under both supported PR event names.
- Serialize per repository/PR using a dedicated concurrency group with `cancel-in-progress: false` and `queue: max`; do not depend on queue execution order for winner selection. Do not add caller-level concurrency or dependencies from required jobs.
- Use only trusted checked-out tooling and the existing separate repository-scoped App token with Pull requests write; no Issues grant, credential fallback or permission expansion. Keep job/token failures best effort with visible warnings and summaries, isolated from required checks.
- Honor the existing case-insensitive, untrimmed `DELIVERY_LABELS_ENABLED=false` opt-out before token minting or label API reads, including the new automatic writer.
- Append only `labeled` to template/self-caller event types. Add executable workflow-contract coverage for label-only job isolation, event/state guards, unmanaged handling through the runner, token/opt-out guards, scoped permissions, per-PR multi-pending serialization and unchanged required-check protection. Preserve definition events and clear-on-close behavior.

### 3. Published contracts explain exclusivity, ordering limits and the exact consumer rollout

- Update `README.md`, `docs/delivery-labels.md` and the shared skill's label contract to describe the new advisory default-on writer, latest-event selection, aliases, bot/person parity, closed-PR no-op and unchanged closure ownership.
- Replace the blanket statement that assignment events run no delivery jobs with the precise exception: labeled additions run only the reconciliation job, while code-delivery jobs and consumer tests remain unaffected.
- Document the exact caller edit (append `labeled` only), why zero caller edits are impossible for callers omitting that event, moving-main versus pinned rollout, no consumer test-workflow edits, and no agent live writes to other repositories.
- State API/concurrency/race limitations honestly: event timestamps need an event-id tie-break for equal precision, jobs can be explicitly cancelled or overflow the bounded queue, webhook/history delays and API errors can postpone reconciliation, and GitHub offers no atomic delete-if-still-open-and-latest operation. No historical sweep, lease, timer, crash-expiry or cross-controller lock is added.
- Extend documentation/runner contract regressions for these guarantees without altering existing manifest, reference reconciliation, cleanup, opt-out or advisory semantics.

## Validation after approval

Use quick targeted reconciliation/runner/workflow-contract checks before each outcome push and tick that PR outcome as its code and tests land. After implementation run the whole `npm test` suite and `node test/generated-palettes.mjs` full-suite palette variants, preserving failure evidence without weakening assertions or timeouts. Bring the branch current with the default branch and validate the final PR body with `delivery check-body` before the last tick. Inspect required checks on the exact final head and report their state; no plan-stage suite or final-head implementation CI is claimed. Never manually mark ready, arm auto-merge or merge. No live writes to other repositories are part of validation.

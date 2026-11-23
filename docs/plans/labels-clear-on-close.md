# Clear managed review labels on closure

Status: approved for implementation; outcomes tracked below.

## Policy and scope

Closed and merged pull requests should retain no managed robot review-label assignments. Resolve the three stable keys `under-review`, `review-approved` and `review-changes-needed` from one validated manifest snapshot and remove each current name and every `previousNames` alias, regardless of display spelling or emoji. Preserve unrelated assignments and all repository label definitions. A reopened PR remains unlabeled until its next review; cleanup stops when it observes reopening and does not restore removed labels.

This proposal supersedes verdict persistence after closure in the historical verdict-labels and label-rename plans. It does not change open-PR runner verdict transitions, the manifest schema/palette, consumer permissions, caller events, protection, or crew source. This repository has no `openspec/` directory, so the committed plan and draft PR carry the proposal without an Automation block.

No live label writes, label sweep (including report mode), pruning, variable changes or permission changes will be performed by the agent. Implementation approval is not authorization for live operations.

## Implementation outcomes

### 1. Closed-event cleanup removes all managed review assignments while preserving its safety and isolation guards

Status: implemented; 49 targeted cleanup regressions pass, including all-role rename/reopen/404/churn guards.

- Expand `scripts/review-label-cleanup.mjs` from the in-progress role to all three stable keys, current and historical names, without hard-coded display names or a blanket label-set replacement.
- Retain repository/event/PR identity and current-state validation, paginated assignment reads, reopen checks before every deletion, confirmed-access and exact-absence handling for DELETE 404s, rescanning all managed names after removals/404s, bounded retries and final confirmed absence. Concurrent renames/churn must not become false success.
- Keep the isolated `review-label-cleanup` job, separate repository-scoped App token with existing Pull requests write permission, default-on behavior and case-insensitive untrimmed `DELIVERY_LABELS_ENABLED=false` opt-out. Failures remain visible and cannot gate promotion, finalization or required checks.
- Update automation/workflow messages where they incorrectly describe in-progress-only cleanup.
- Replace verdict-survival regressions with removal assertions for merged and unmerged closure, each verdict and both together, current/historical/future names, review label present/absent, direct and automated paths and repeated processing. Retain and extend reopen, rename, pagination, 404/access, bounded churn, unrelated-label and token/opt-out regressions across all roles.

### 2. A report-first labels-sweep command cleans only managed assignments on already-closed pull requests when explicitly applied

Status: implemented; 37 sweep regressions and all 49 cleanup regressions pass with fake APIs. Neither live sweep mode was executed.

- Add `delivery labels-sweep --repo owner/name` as a read-only report, with explicit `--apply` enabling assignment removals using the signed-in credential. Validate arguments and repository identity before requests; support both repo flag forms and reject unknown options.
- Fetch and validate one manifest snapshot, list closed pull requests with pagination, validate returned identities/states, and paginate their assigned labels. Report PR numbers and exact managed current/historical assignments without writes by default. Do not enumerate issues as pull requests or touch open PRs.
- Share the closed-PR cleanup core rather than weakening the event-only entry point or fabricating closure events. Apply freshly validates each PR and checks for reopen before every removal, uses the same rescans/bounds/404 confirmation, and reports skipped reopenings and failures honestly. A listing is not write authorization for an open PR.
- Remove assignments only, never create labels, add verdicts, delete definitions, prune defaults or replace unrelated labels. Propagate read/access/pagination failures rather than treating them as absence. Honor explicit opt-out for apply while keeping report mode read-only and available.
- Keep the command manual-only: no automatic job, schedule, dispatch, post-merge hook or consumer fan-out invokes it. Document separate named-repository authorization and a fresh report before apply. Do not execute either form during this task.
- Add fake-API and CLI regressions covering report/apply separation, pagination, merged/unmerged closures, arbitrary manifest names and aliases, open/reopened PR exclusion, malformed input/listings, API failures, confirmed absence, repeated apply, unrelated assignments and no definition writes.

### 3. Published guidance and runner contracts consistently describe clear-on-close and explicit historical recovery

- Update `README.md`, `docs/delivery-labels.md` and `skills/change-delivery/SKILL.md`: all three roles and every historical alias are cleared on closure; reopened PRs get no automatic replacement label; future events are best effort and do not backfill old closures.
- Document exact report-first `labels-sweep` usage, explicit apply consent, repository scope, signed-in credential, pagination/open-PR safety and failure/race limits. Distinguish the manual backfill from unchanged crew PR #7 lifecycle limits: no heartbeat, lease, crash-expiry guarantee or automatic historical sweep.
- Revise the published runner contract text that promises verdict persistence after closure. Mark conflicting historical plan sections as superseded without rewriting historical evidence. Add contract regressions preventing reintroduction of verdict-survival promises or accidental automatic sweep wiring.
- Preserve advisory semantics, open-PR lifecycle transitions, manifest-by-key resolution, warned runner fallback, separate crew ownership, event cadence and aligned workflow/tooling pin requirements.

## Validation and handoff after approval

Use quick targeted cleanup/sweep/CLI/documentation checks before each outcome push and tick its matching PR checkbox as delivered. Run the complete `npm test` suite and `node test/generated-palettes.mjs` (both generated-palette full-suite variants) after implementation; report failures without weakening tests or timeouts. Validate the final PR body, update from the default branch, let the bot handle readiness, and report required-check status on the final head after checks complete. Never manually mark ready, arm auto-merge or merge.

At this proposal stage no runtime behavior is changed, and implementation tests/checks are deferred until approval.

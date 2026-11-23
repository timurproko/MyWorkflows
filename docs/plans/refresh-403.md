# Isolate refresh refusals and avoid misleading advisory cancellations

Status: proposed; awaiting approval before implementation.

## Diagnosis

Both post-merge failure logs establish the cause, rather than merely suggesting it:

- Run 45252568059, after PR 35 merged, rejected `PUT /repos/timurproko/MyWorkflows/pulls/30/update-branch` with HTTP 403: `refusing to allow a GitHub App to create or update workflow .github/workflows/delivery.yml without workflows permission` (the original message quotes the path and permission with backticks).
- Run 45238657006, after PR 33 merged, rejected exactly the same request with the same message.
- PR 30 is authored by `dependabot[bot]` and changes `.github/workflows/delivery.yml`. This is a workflow-permission refusal, not evidence that all Dependabot branches categorically reject App updates.
- `scripts/refresh-ready-pull-requests.mjs` accepts only 202 and 422 for updates. Its requester throws for 403; `scripts/ready-pull-request-refresh.mjs` incorrectly treats every 403 as a globally rejected credential and aborts the entire pass. Earlier updates may have completed, but candidates after the refusal are never visited.

### Label-sync cancellation diagnosis

The coordinator added label-sync cancellation and label-only CI churn to this same change before the plan was published.

- MyWorkflows PR 32, run 45252643470, has a cancelled label-sync job (137966065290), no runner and no steps. Its check annotation says: `Canceling since a higher priority waiting request for delivery-label-sync exists`.
- Herdr-app PR 26 has the identical annotation on label-sync check 137895520052, run 45232514069. PR 33's current head no longer has a cancelled check; the coordinator's report concerns earlier checks.
- The actual shared workflow already has a repository-wide `delivery-label-sync` concurrency group with `cancel-in-progress: false`; there is no outer workflow concurrency in the audited callers. The defect is GitHub's default single pending slot: a third request replaces the already-pending second request even with cancellation of running work disabled. Merely setting false again does not fix it.
- GitHub's current concurrency documentation explicitly supports `queue: max` (up to 100 pending jobs), disallows combining it with `cancel-in-progress: true`, and explains the default pending replacement. Use this documented queue with the existing non-cancelling repository-wide group. Overflow beyond 100 pending jobs and explicit/manual cancellation remain platform limits, not a promise of never being cancelled.
- Herdr-app and crew `.github/workflows/tests.yml` explicitly subscribe to `labeled` and `unlabeled`, with workflow-level per-PR cancellation enabled. An advisory review-label assignment therefore creates a new CI run and can cancel an in-progress one on the same code. This is separate from the label-sync pending-slot defect.

Concurrency reference: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency

## Policy and limits

Do not refresh Dependabot-authored PRs: Dependabot owns rebasing its branches. Identify the author using fresh GitHub PR metadata, never title or branch-name heuristics. Other bot-authored PRs, including reference-label reconciliation, remain eligible under the existing guards.

Treat a recognized update-branch permission refusal as a per-PR skip, with a visible warning identifying the repository, PR number and GitHub reason; continue independent PRs and allow the job to succeed. Do not convert arbitrary 403 responses into success: rate/abuse limiting, unknown failures, malformed responses, rejected credentials and read/listing permission failures must remain visible failures. In particular, 401 is still a credential failure. Preserve expected-head SHA protection, target selection, fork/draft/closed guards, pagination, conflict/race handling and failure reporting.

Do not widen App permissions, add a token fallback, dispatch/rerun workflows, refresh live branches, change labels, or modify consumers. Only the task branch and draft PR are published. This repository has no `openspec/` directory; this plan and the draft PR carry the proposal without an Automation section.

## Implementation outcomes

### 1. Dependabot-owned pull requests are excluded from delivery branch refresh while other eligible authors remain supported

- Add fresh author-based Dependabot exclusion in the shared classifier, with an explicit skip reason explaining Dependabot's ownership of rebasing.
- Extend fake PR metadata and classification/reconciliation regressions: Dependabot is skipped before comparison/update, regardless of title; human and other bot authors remain eligible.
- Document the conservative ownership policy and shared-workflow rollout in the README.

### 2. Expected update permission refusals warn per pull request without preventing independent branch refreshes

- Admit expected mutation permission responses to the update interpreter rather than the global credential-abort path; retain enough response metadata to distinguish rate limits from permission refusals.
- Bound permission-refusal classification to recognized GitHub authorization messages, including the demonstrated missing-workflows-permission error and resource-not-accessible denial. Unknown 403 responses and rate-limit/abuse failures must not become successful skips.
- Emit a clear GitHub Actions warning and summary entry naming each denied PR and the reason, with safe annotation formatting for API-provided text. Preserve structured per-PR evidence.
- Add fake-API regressions with a denied PR between successful updates, more than one denial, workflow and general permission refusals, all-skipped passes, and command-level exit/warning assertions. Retain or extend failure coverage for 401, read/list 403, rate limits, unknown 403, server errors and malformed responses.
- Keep the reusable workflow's repository-scoped token and existing Contents/Pull requests write permissions unchanged. No consumer-specific bypasses or duplicated refresh implementation.

### 3. Advisory label synchronization queues normal bursts without replacing pending checks and label-only events do not restart delivery work

- Retain the isolated, non-required label-sync job, its existing repository-wide group `delivery-label-sync`, `continue-on-error: true` and `cancel-in-progress: false`; add `queue: max` so ordinary simultaneous PR events queue rather than cancel pending sync jobs.
- Keep label-sync independent of promotion/finalization and required checks, with unchanged permissions, default-on opt-out and read-only manual behavior. Do not add whole-workflow concurrency or label-sync dependencies to required jobs.
- Add explicit shared-job conditions excluding `pull_request_target` actions `labeled`/`unlabeled` from finalization, Delivery check and definition synchronization, even if a nonstandard caller forwards them. Refresh and cleanup retain their existing closed/merged/workflow-run conditions. Assignment changes do not change label definitions, implementation bodies, source code or delivery readiness; no existing delivery job needs these label-only events. The dedicated reference workflow's repository-level `label` events must remain supported, since definition edits are different from assignment events.
- Add workflow contract tests for the queue/group/cancellation/isolation settings, label-only exclusions, preserved reference-definition events, and the caller/self-caller event lists. The existing delivery template and self-caller already omit assignment events; preserve that behavior and document it rather than broadening subscriptions.
- Record the precise consumer CI proposal in repository guidance: in both `timurproko/herdr-app/.github/workflows/tests.yml` and `timurproko/crew/.github/workflows/tests.yml`, remove only `labeled` and `unlabeled` from `on.pull_request.types`. Retain opened, synchronize, reopened, ready_for_review, converted_to_draft and edited, plus push/manual triggers and code-change supersession. Their inspected readiness/required jobs do not depend on labels. Do not edit either repository in this task. A job-level skip alone is insufficient because workflow-level concurrency may already cancel an existing CI run before conditions are evaluated.
- MyWorkflows `.github/workflows/test.yml` uses GitHub's default PR actions (opened, synchronize, reopened), which do not include labels. A1's inspected development-validation CI and xrbuild workspace CI already explicitly omit labels. No change is proposed for those audited triggers. There is no consuming-repository test-workflow template here to fix those existing consumers centrally; the delivery caller template controls delivery only.
- Document rollout and limits: consumers tracking main receive the shared queue/guards after merge, but eliminating crew/herdr-app test restarts requires the two named consumer follow-up changes. Old cancelled checks are historical and are not repaired by this task; no live reruns or dispatches.

## Consumer audit (read-only)

All five other documented consumers (`a1`, `crew`, `herdr-app`, `xrbuild`, and the private xrbuild workspace) currently call `timurproko/MyWorkflows/.github/workflows/delivery.yml@main` without overriding `tools_ref`. They therefore use the same vulnerable refresh code and will receive the shared fix without caller edits after merge. A1 also forwards successful release-reopening `workflow_run` events, which use this same refresh job.

A read-only snapshot found no ready PRs in a1, crew, xrbuild or its private workspace. Herdr-app had three ready human-authored PRs; no consumer had a ready Dependabot PR in this snapshot. The most recent sampled failed delivery runs in a1 (44525947092), crew (45189499780), herdr-app (45246389089) and xrbuild (44539935293) failed promotion or Delivery check, not refresh. This is a current/sample audit, not a claim that their complete histories contain no refresh failures. No live update endpoint was called.

## Validation and handoff after approval

Implement one outcome at a time, with targeted tests before each push and the matching PR outcome ticked immediately afterwards. Run the complete `npm test` suite and the generated-palette full-suite variants (`node test/generated-palettes.mjs`) once implementation is complete, without weakening assertions or timeouts. Bring the branch up to date, add Acceptance, validate the final body and tick the last outcome; readiness belongs to the bot. Inspect required checks on the exact final head and report their completed status. Do not mark ready, arm auto-merge or merge.

At this planning handoff no implementation or test execution has occurred; full-suite execution and final implementation-head checks require approval first. The third outcome includes the coordinator's additional defect and its contract tests; all three outcomes are proposed together for approval.

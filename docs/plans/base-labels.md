# Base labels and the final-agent-review signal

## Proposal

Define the delivery workflow's base labels once in MyWorkflows and reconcile them automatically in consuming repositories. Add a leased, advisory agent-review signal so a mergeable pull request does not look finished while an agent is still reviewing it.

This is a plan only. No label definitions, assignments, permissions, protection rules or consuming repositories have been changed. This repository has no OpenSpec directory; this document is the planning artifact. Implementation waits for approval, including the maintainer decisions below.

## Read-only findings

Snapshot: 2026-11-23, obtained with `gh-axi` REST and GraphQL reads. Label usage counts include open and closed issues and pull requests, not just open work. All six label connections fit on one page; there was no omitted next page.

The exact existing label in `timurproko/herdr-app` is:

```json
{
  "name": "🤖 Under review",
  "color": "840479",
  "description": ""
}
```

The name contains U+1F916, one ordinary U+0020 space, and `Under review` with that capitalization; there is no variation selector. The empty description is intentional, not missing information. PR #14 carries this label and was already merged when checked: it is an example of the orphaned-label cleanup needed after rollout, not evidence of an active review.

Confirmed consumers on their remote default branches: MyWorkflows (`main`, self-delivery caller), a1 (`develop`), crew, herdr-app and xrbuild (`main`), plus xrbuild's private workspace (`main`). All use the shared delivery workflow. This is a rollout audit, **not** a new hard-coded repository registry. Private repository identity and raw audit output remain outside this public document.

Today the bot promotes a fully ticked valid draft before the ready-head CI runs; it does not wait for all required CI before promotion. This feature will not change that ordering or GitHub mergeability. Applying the review label before starting the reviewer, including on a draft or a PR with pending CI, covers the later ready-and-green interval without a race at promotion.

Crew's README and implementation entry points were inspected read-only in `D:/Git/crew`. `crew review` starts a separate read-only task, reports start with `APPROVE` or `CHANGES NEEDED`, and crew currently has no background watcher. No crew file is part of this change.

## Decisions requiring the maintainer

These are proposed defaults, not permission to perform live rollout during planning:

1. **Initial palette:** ship only the exact robot label above. Keep repository-specific and third-party labels. Any other base label, rename or description is a separate product decision; no invented replacement taxonomy.
2. **Default-label removal:** automatic synchronization never deletes labels. Recommend an explicit per-repository `--prune-unused-defaults` opt-in for the 51 currently unused defaults listed below, retaining used defaults. The maintainer must choose keep-all versus prune, and identify the repositories authorized for pruning. Approving implementation alone does not authorize live pruning. Deleting used defaults or replacing their historical classifications is out of scope.
3. **Bot authority:** approve expanding the delivery App to Issues read/write for label definitions and review-state comments, alongside its existing Contents and Pull requests permissions, and accepting the changed App installation permissions in each owner account. Central discovery needs App installation metadata and read access to default-branch workflow files. Missing rights are reported, not worked around with a maintainer PAT. Live App configuration is a maintainer action, outside this code-only plan.
4. **Advisory semantics and ownership:** a label is not a required check and never blocks or enables a merge. It means at least one live agent-review lease, not approval and not that a review was requested. Apply it from reviewer start even before readiness; reserve this exact label for the protocol, including removing manual orphan assignments such as herdr-app #14 after rollout. Human review requests do not create it.
5. **Failure policy:** recommend a five-minute heartbeat, a twenty-minute lease, and a ten-minute scheduled sweep. A lost reviewer/coordinator clears within roughly thirty minutes under normal Actions scheduling, not immediately; GitHub delays/outages can extend this. An expired lease is recorded as abandoned, never as approval. Accept this bounded-staleness tradeoff and the extra Actions usage, or choose different timings before implementation.
6. **Crew liveness architecture:** approve a small per-review supervisor that observes the actual reviewer process/Core state and renews the lease independently of `crew wait`. This deliberately changes crew's current no-background-service architecture, but is a short-lived child for one review, not a permanent daemon. A heartbeat only in `crew wait` is insufficient: an alive reviewer can outlive its coordinator. Crew implementation is a separately approved task, not included here.
7. **Rollout:** approve adding heartbeat/sweep dispatch inputs and schedule forwarding to consuming callers through separate repository tasks. This PR changes MyWorkflows, its self-caller and templates only; it cannot promise end-to-end crew signaling before those caller updates and the separate crew implementation land. Base-label sync still reaches existing consumers without waiting for those updates.

## 1. One definition and automatic synchronization

### Source and execution

- Add a versioned `labels/base.json` containing name, color and description; validate duplicate/case-colliding names, six-digit colors, string descriptions and GitHub field limits before writes. Code refers to the robot entry by a stable internal key rather than repeating its display name. The three GitHub fields have one source of truth.
- Add `scripts/repository-labels.mjs` with report/apply modes, deterministic diffs and an injectable API client. Expose `delivery labels --repo owner/name` (read only) and `--apply` for an explicitly requested sync. Local commands use the signed-in GitHub credential; they report required rights and never read or export the App private key.
- Add a label-sync job to the existing reusable delivery workflow. A consumer's first forwarded event after adoption reconciles its palette. Existing callers need no new inputs for this job. Isolate it from promotion, finalization and required delivery checks.
- Add a MyWorkflows-owned default-branch workflow that reconciles consumers on changes to `labels/base.json` or its sync tooling, on manual dispatch, and hourly. The hourly scan covers newly adopted but otherwise idle repositories and retries partial failures. Thus adoption has an hourly upper target, not an assumption that every repository immediately opens a PR.
- Discover repositories through the delivery App's installations and their accessible repositories, with pagination. Read each repository's default-branch workflows at a resolved commit and recognize an actual shared delivery `uses` reference (including MyWorkflows' self-caller), not arbitrary text or local/unmerged files. Do not register repository names or treat every App installation as adoption consent. Respect the centrally current label manifest independently of a consumer's tooling pin; document that automatic base-label updates are an adoption contract.
- Fetch default-branch policy and manifest only from trusted MyWorkflows code; do not execute consumer YAML or PR content. Public jobs must never print private repository names, workflow contents, issue data or raw API errors, including in logs/artifacts; emit only aggregate private success/failure counts. Private-target diagnostics run in the private repository or through a maintainer's local read-only command, not a supposedly restricted artifact in a public Actions run.

### Identity, permissions and errors

The central workflow uses the already configured delivery App id/private key to authenticate as the App, enumerate installations, and mint short-lived repository-scoped installation tokens. Request Contents read for discovery, Issues write for label-definition CRUD and comment state, and Pull requests read for review/PR reads. The review writer additionally uses Pull requests write where required for PR label assignments. Never widen the existing finalization publisher's narrowly validated token; use a separate token/client for these jobs. Revoke tokens in cleanup and never log them.

The exact installed App grants could not be verified with the current GitHub credential (`user/installations` was forbidden; repository installation lookup requires App JWT). Do not claim grants are already sufficient. Implementation must cover missing installation, unaccepted permission expansion, disabled Issues where relevant, private repository access, rate limits and partial discovery failures. Verify the chosen label/comment endpoints on a maintainer-authorized disposable repository before rollout.

A 403, 404 or missing capability produces an explicit blocked/skipped-with-reason result and remediation (install App, accept Issues write, or restore read access). Continue independent repositories, aggregate failures into a visible failing sync run/summary, and retry on the next scheduled run. No silent success, PAT fallback, protection relaxation, or new merge gate. Repositories the App cannot enumerate cannot be automatically inventoried; provide a read-only `delivery labels --repo ...` diagnostic for their maintainers and state this coverage limit.

Only upsert centrally managed names, and PATCH color/description in place so existing assignments survive. Never rename/delete labels removed from a later manifest automatically; de-manage and report them. Preserve every unrelated label and its metadata. An existing same-name label becomes centrally managed only under the approved adoption contract.

## 2. Safe policy for GitHub default labels

Automatic sync does **not** delete any default or custom label. An explicit `delivery labels --repo owner/name --apply --prune-unused-defaults` may delete only a known GitHub default with its unmodified default metadata, `isDefault` status, and zero issue **and** PR assignments across all states. The command reports candidates first, re-reads metadata and both usage counts immediately before each deletion, and skips anything changed, used, customized or unreadable. No bulk replace-label operation is allowed.

GitHub offers no atomic "delete only if unused" operation. There remains a race if someone assigns a label between the last read and DELETE. The pruning documentation must say so and recommend a quiet, explicitly authorized maintenance window; keep-all is the only policy with no deletion race. No automatic retry of a failed delete against a newly read used label.

The ten audited GitHub defaults are: `accessibility`, `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`.

| Repository | Unused defaults eligible only for opt-in pruning | Used defaults that must remain |
| --- | --- | --- |
| timurproko/MyWorkflows | All ten | None |
| timurproko/crew | All ten | None |
| timurproko/herdr-app | All ten | None |
| timurproko/xrbuild | All ten | None |
| xrbuild private workspace | All ten | None |
| timurproko/a1 | `question` only | `bug`: 1 issue + 1 PR; `enhancement`: 24 PRs |

That is 51 candidate removals, not a deletion instruction. Re-audit before any future pruning. The seven absent defaults in a1 are not recreated. Preserve a1's custom labels, MyWorkflows' Dependabot labels, xrbuild's automation labels and the private workspace's custom labels. These facts also explain why blindly replacing every repository's label set would be destructive.

The robot label would be created in five audited repositories and matched in place in herdr-app. Sync never copies its assignment from #14 to another PR. Assignment cleanup is the review lifecycle's job, not definition synchronization.

## 3. Leased review protocol offered by the workflows

### Command/API contract

Extend the existing caller's `workflow_dispatch` and reusable `workflow_call` inputs with an operation (`reconcile` remains the backward-compatible default), a review id, expected head and result. Operations are `review-start`, `review-renew`, `review-finish`, `review-cancel` and `review-sweep`. Only sweep may omit a PR number. Keep the existing finalization dry-run behavior separate and intact; review operations do not accidentally promote a PR or finalize a change.

Expose a documented machine-readable `delivery review start|renew|finish|cancel --repo owner/name --pr N --review-id ID --head SHA` command family. Finish requires `--result approve|changes-needed`; cancel accepts a reason. A sweep is a workflow/maintainer operation, not a reviewer-wide delete. These commands resolve the caller on the remote default branch, dispatch with the signed-in credential and wait only for a bounded protocol acknowledgement, not CI. Missing/migrating callers return an actionable unsupported result, never a successful local-only lease.

Crew's credential needs permission to dispatch Actions in the target repository (fine-grained tokens need Actions write, repository read access, and PR/state read access). The workflow validates the initiating actor's current repository write/maintain/admin permission before handling a start/renew/finish/cancel. A user-supplied run id or comment marker alone is not authentication. Do not give crew the App private key. A maintainer may cancel a stuck lease explicitly. For all currently audited repositories the maintainer already has repository authority, but token scopes must still be checked.

The trusted workflow mints the repository-scoped App token and owns all lease/label writes. Persist one bounded, versioned state record in an App-authored PR comment; verify the expected App identity, not just the marker text. State includes review ids, initiating actor, expected head, server-observed expiry, terminal results and request acknowledgement ids. Treat malformed/untrusted state as an error and avoid comment spam. Do not persist private report contents or tokens. State transitions, scheduled sweeping and PR-event cleanup share one repository-wide non-cancelling writer concurrency group; process batched sweep work within the job timeout. Do not depend on FIFO Actions concurrency: use idempotent ids, terminal tombstones, server timestamps and acknowledgements; heartbeat/end before start must not resurrect a finished lease.

### Lifecycle rules

1. Start validates an open PR, current expected head and unique id, writes the lease and applies the label, then acknowledges both. Crew starts the reviewer only after this acknowledgement. An API failure cannot be reported as a protected review start. Label all active reviews, including drafts; finalization and CI do not remove a valid lease.
2. Renewal is accepted only for a live matching owner/id/head, with server-defined expiry; it cannot revive an expired, cancelled or terminal lease. The five-minute heartbeat comes from actual reviewer liveness, not an indefinitely renewing coordinator task flag. If renewal cannot be acknowledged before expiry, crew must pause/stop the reviewer and report signaling failure rather than continue an unlabeled review. Duplicate requests are harmless.
3. `APPROVE` and `CHANGES NEEDED` both finish that review, record the verdict and remove only its lease. Remove the label when no active leases remain. A verdict is not a GitHub approval or a merge request. Invalid or missing report prefixes cancel as abandoned/failed rather than implying approval.
4. Spawn failure, stop, terminal death, finish without a valid report, lost ownership and replacement/relaunch terminate the matching lease. Replacement gets a new id. A late finish from the old reviewer cannot clear a newer review. Concurrent independent reviewers retain the label until the last one ends.
5. Bind reviews to the actual PR head, not a branch name. A head change supersedes old-head leases; crew must stop/restart the review on the new head before presenting a verdict for it. Re-read the PR before mutation so an obsolete queued dispatch cannot label a closed PR or approve a changed head. Finalization commits and automatic branch refreshes are head changes too.
6. Handle close/merge from the already forwarded `pull_request_target: closed` event, cancelling all leases and removing the label regardless of verdict. Handle synchronize, ready/draft transitions and reopen by reconciliation, never by inventing a lease. Preserve live leases through a draft transition, but do not resurrect closed/expired ones on reopen.
7. Updated callers forward a ten-minute schedule to the reusable sweep. Enumerate every labeled PR in all states with pagination (not just open PRs), plus active state records as needed. Remove expired/orphan assignments, including old manually labeled closed PRs. Inspect recorded labeled closed PRs on rollout, so #14 is not missed. Terminal comments can remain as bounded audit history; the label must not.
8. If a reviewer, supervisor or entire machine dies without a cancel, its heartbeat stops and the independent GitHub sweep expires its lease. On normal completion/cancellation, removal is part of the acknowledged operation, not deferred until TTL. Failures are surfaced to crew and the maintainer, with retries bounded by lease expiry. Delayed Actions are a documented stale-label risk, not an unlimited guarantee. An abandoned review is visible as abandoned in state, never silently approved.

The signal is deliberately advisory: no required review check, blocked merge, auto-approval, auto-merge, readiness change or automatic reviewer launch is introduced.

## 4. Rollout, documentation and separate crew task

### This MyWorkflows change

Update the README, detailed owner documentation and shared change-delivery skill with the palette contract, nonblocking signal, command/API, permission setup, failures, pruning risk and review start/end responsibilities. Update the reusable workflow, unchanged-copy caller template and MyWorkflows' self-caller with review dispatch inputs and schedule forwarding. Keep all PR-content handling data-only and preserve existing promotion/finalization/check behavior. Update protection declarations/documentation only where the actual allowed workflow events need to include the new schedule; do not apply live protection as part of this task.

Ship the manifest, sync workflow and protocol first. Gate automatic label writes (both central and reusable jobs) with an explicit maintainer-controlled rollout variable, initially disabled; disabled jobs report pending enablement rather than implying sync succeeded. Before enabling it, obtain the App permission acceptance and approved rollout decision. Use a disposable authorized repository for endpoint/lifecycle validation, then enable automatic sync. Once enabled, adoption and subsequent definition changes need no per-repository manual sync. Base labels in old consumers synchronize from the new reusable job and central hourly scan. Their existing closed-PR event forwarding also permits orphan cleanup, but autonomous expiry and the new review API require the caller migration below. Clearly report unsupported review signaling until that migration is complete.

### Separate consuming-repository tasks

For a1, crew, herdr-app, xrbuild and the private workspace, update the existing caller from the template, retaining a1's workflow-run refresh behavior and each repository's actual default branch. Forward all review inputs and the ten-minute sweep schedule, and reconcile any event-policy declarations. Obtain App permission acceptance from the owner, run read-only label diagnostics first and obtain independent consent before any optional prune. No consuming-repository file is edited by this PR.

### Exact separate crew implementation required

- Resolve the implementation PR/repository from the worker's `Implementation:` report; reject `Plan:` as a final code review target. Read the actual current PR head (including bot finalization commits), not an old local task commit. Detect the supported delivery protocol; fail visibly if workflow signaling is required but unavailable.
- Generate and persist a unique review id with parent task, PR, head and lease acknowledgement. Call `delivery review start` before launching the review terminal; cancel on launch failure.
- Implement the approved per-review supervisor: observe actual Core reviewer session/process liveness, renew every five minutes while that same reviewer is working, and stop renewing on death, loss of ownership or an uncertain observation. Store enough identity for coordinator restart without duplicate renewal or an old process clearing a replacement. A supervisor crash must not keep a lease alive; the separate crew design must also address stopping/pausing a surviving reviewer when its supervisor or lease is lost, since terminal closure does not always kill agent helper processes. This is an integration acceptance requirement, not something this workflow can infer remotely. No reliance on an agent remembering to type heartbeats.
- In `crew done`, parse the report's first line exactly: `APPROVE` finishes as approve; `CHANGES NEEDED` finishes as changes-needed. End the lease before reporting signaling success. Malformed/blocked/failed reports cancel, while preserving the report for the person.
- Integrate cancellation and bounded retries into `stop`, `finish`, spawn failure, relaunch/fallback, terminal-ended detection and ownership recovery. Stop/restart on a new PR head. Reconcile outstanding ids at `crew start`/recovery, and surface signaling failures in command output/status without claiming approval.
- Preserve concurrent reviewers, distinguish terminal and stale events, and test the race where an old review completes after its replacement starts. Do not clear a label directly from crew; use the protocol and its aggregate lease state.
- Add fake-Core/fake-delivery tests for both verdicts, missing reports, crash, quota fallback, coordinator loss, head changes, unsupported callers, dispatch failures and repeated/reordered calls; document the supervisor and credentials. No live GitHub calls in crew's unit suite.

Until that separate task lands, a human or other agent may use the documented command directly, but this MyWorkflows PR alone cannot observe `crew review` or parse a crew report. Do not claim the integrated feature is complete prematurely.

## Ordered implementation outcomes and targeted checks

These groups map one-to-one, in order, to the draft PR's Implementation checkboxes. All are unimplemented.

1. **A central base-label manifest synchronizes adopted repositories with explicit permission and failure reporting.**
   - Manifest/schema, report/apply CLI, App-scoped sync, reusable job, change-triggered/hourly discovery workflow and privacy-safe aggregate reporting.
   - Targeted fixtures: exact emoji/empty description; arbitrary/non-main consumers; pagination and newly adopted idle repo; same-name metadata upsert; custom-label preservation; untrusted workflow text; removed manifest entry; inaccessible installation/repo, denied scope, partial failures and private-summary redaction.
2. **Unused GitHub defaults can be pruned only by explicit per-repository opt-in without deleting used classifications.**
   - Named pruning flag, full-state usage queries, fresh checks, customized/used-label refusal and deterministic report mode with no mutations.
   - Targeted fixtures: all 51 snapshot candidates, a1 used defaults, closed-only usage, changed metadata, pagination, unreadable counts, concurrent-use recheck and absent defaults. Document the unavoidable final delete race.
3. **Leased agent-review signals reconcile start, verdict, cancellation, expiry and PR closure without becoming a merge gate.**
   - Review CLI and authenticated dispatch protocol, App-owned state, serialized idempotent lifecycle, label reconciliation, scheduled sweeps, caller inputs and self-caller integration.
   - Targeted fake-clock/API/workflow fixtures: pre-ready start, both verdicts, concurrent reviews, spawn/death/cancel, missed heartbeat, old/new head, out-of-order/duplicate start/end, spoofed actor/comment, close during start, merged labeled PR, orphan manual label, reopen, denied writes and delayed/error acknowledgements. Preserve existing promotion and finalization tests; no review check becomes required.
4. **Adoption guidance and the crew handoff document permissions, safe rollout and the separate integration contract.**
   - README, owner docs, shared skill and templates describe automatic sync, deletion opt-in, caller migrations, advisory semantics, heartbeat tradeoffs and the separate crew work above.
   - Targeted template/self-delivery contract tests protect forwarded inputs, scheduled sweeping, existing manual dry-run compatibility and a1's documented workflow-run exception. No crew or other consumer implementation in this PR.

Planning validation is limited to the draft body and the read-only audit. During implementation use quick outcome-specific checks; CI provides broad coverage after automatic readiness. No live label mutation, reviewer launch or prune has been performed for this plan.

# Base labels and the agent-review label

## Proposal

Define the delivery workflow's base labels once in MyWorkflows and synchronize them in the existing reusable workflow. The review runner sets and clears the advisory Under review label directly; an isolated shared-workflow job clears it when a pull request is closed or merged.

This revised plan supersedes the earlier lease design, following the person's scope decision. There are no leases, heartbeats, comment-state records, supervisors, consumer schedules, new dispatch operations or central repository-discovery workflow. This revised design was approved and is implemented in this PR, with rollout still disabled. No live labels, assignments, variables, permissions, protection rules or consuming repositories have changed. No OpenSpec directory exists here; this document records the approved design. Crew integration remains a separate task.

## Exact definition and read-only findings

The initial `labels/base.json` has this schema and stable key:

```json
{
  "version": 1,
  "labels": {
    "under-review": {
      "name": "🤖 Under review",
      "color": "840479",
      "description": ""
    }
  }
}
```

The three GitHub fields were read from `timurproko/herdr-app` with `gh-axi`. The name contains U+1F916, one U+0020 space, and `Under review` with that capitalization; there is no variation selector. The empty description is intentional. `under-review` is the manifest's stable key; `🤖 Under review` is the exact GitHub label name, not the key. Other code and documentation refer to that entry rather than defining another palette.

Read-only audit on 2026-11-23 confirmed consumers on their remote default branches: MyWorkflows (`main`, self-delivery caller), a1 (`develop`), crew, herdr-app and xrbuild (`main`), and xrbuild's private workspace (`main`). All forward `pull_request_target: closed` already. This is a rollout snapshot, not a new repository inventory. Private repository identity and raw audit data remain outside this public document.

Herdr-app PR #14 was already merged and still carried the robot label when audited. The new closed-event cleanup prevents that outcome for future successfully processed closures; it cannot retroactively receive #14's old event. After rollout the review owner/maintainer may explicitly remove that historical assignment using the same direct remove-label mechanism. This change does not run that operation, introduce a historical sweep or reopen any PR.

Today the bot promotes fully ticked valid drafts before ready-head CI finishes. This feature changes neither that ordering nor mergeability: applying the label when review starts, even on a draft or pending-CI PR, covers the later ready-and-green interval.

## 1. Small, event-driven base-label synchronization

- Add the manifest above and a small `scripts/repository-labels.mjs` report/apply implementation with an injectable API client. Validate schema, unique/case-distinct names, color and GitHub field limits before any writes.
- Add a separate label-sync job to `.github/workflows/delivery.yml`. Check out only trusted MyWorkflows tooling at the workflow's `tools_ref`, as existing jobs do; never execute consumer/PR code. Target `github.repository`, not an input-selected other repository.
- On existing forwarded delivery events, reconcile the calling repository's base palette: create missing managed labels and PATCH changed color/description in place. Existing assignments survive. Preserve all default and custom labels. Entries later removed from the manifest are left alone and reported, never automatically renamed or deleted.
- Gate **all automatic label writes**, including closed-PR cleanup, on the calling repository's variable `DELIVERY_LABELS_ENABLED` being exactly `true`. Unset/false means disabled with a clear pending-enablement summary. No variable is set by this change. Review-runner rollout is likewise held until the person enables labels for that repository.
- Use an independent App-token mint for these jobs; do not widen or change the finalization publisher's separately validated token. Scope it to this repository and `pull_requests: write`, then revoke it through the action's normal post-job cleanup. Never log credentials.
- Do not require new caller inputs, schedules, workflow files, repository registration, App-installation enumeration or caller permission increases. Existing consumers tracking `main` pick up the job automatically; explicitly pinned consumers pick it up when their pin is advanced.
- Manual `workflow_dispatch` with the existing `dry_run: true` reports the label diff without writing, regardless of enablement. It retains its current finalization meaning; no review-specific dispatch operation is added.
- Missing App secrets, an installation without write access, a denied API call or rate limit produce a visible warning and label-job summary, not a silent success or a PAT fallback. Keep the job isolated/non-required with no dependency into promotion, finalization or the Delivery check. The next forwarded event retries synchronization; an authorized maintainer can also request an existing manual reconcile or explicitly apply a reported CLI diff.

**Cadence is deliberately event-driven.** On adoption the first forwarded delivery event syncs labels; after a definition change, each consumer syncs on its next event. An idle repository does not update at the instant the central definition changes. This is the selected smallest mechanism: there is no central push/fan-out guarantee or hourly job. An immediate all-repository update would require a separate scope decision, not hidden discovery machinery.

Expose `delivery labels --repo owner/name` as a read-only diagnostic. Document `--apply` as an explicit, separately authorized manual write operation using the signed-in credential, never the App private key. Nothing invokes apply during this task. The person must enable automatic rollout separately from approving implementation; any manual write also requires their explicit authorization.

## 2. Permissions: no added Issues grant is required

GitHub's [Create a label](https://docs.github.com/en/rest/issues/labels#create-a-label), [Update a label](https://docs.github.com/en/rest/issues/labels#update-a-label), [Add labels to an issue](https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue) and [Remove a label from an issue](https://docs.github.com/en/rest/issues/labels#remove-a-label-from-an-issue) endpoints accept **either Issues write or Pull requests write** for fine-grained tokens, including App installation tokens. The Issues URL namespace also handles PR labels; its name does not imply an additional Issues permission is mandatory. The create/add/remove permission alternatives were checked in the official API documentation during this revision.

| Operation | Chosen identity and permission | Is added Issues permission needed? |
| --- | --- | --- |
| Automatic creation/update of base labels | Delivery App installation token, repository-scoped Pull requests write | No |
| Automatic removal of Under review on PR closure | Separate delivery App installation token, repository-scoped Pull requests write | No |
| Crew add/remove on its PR | Signed-in review runner's credential with repository access and Pull requests write, or another already sufficient label-write grant | No new App permission; crew does not use the App key |

Existing delivery code already requests App `pull_requests: write` for promotion/refresh. That existing grant is sufficient for both automatic operations; the previous plan's requested Issues expansion is withdrawn. Installed grants could not independently be enumerated with the current credential, so the implementation must still handle a misconfigured installation visibly. If an installation actually lacks Pull requests write, the owner must grant/accept that missing existing delivery capability or leave rollout disabled; do not ask them to accept Issues merely because these are Issues API endpoints.

The callers' existing `GITHUB_TOKEN` has Pull requests **read**, so it is **not** sufficient for label writes without caller changes. Use the App token instead; existing caller permissions and secrets remain unchanged. No Actions write, comment-state access or App installation-discovery permission is introduced. A signed-in crew token still needs real access to the target repository, including private repositories; a forbidden response is not successful cleanup.

## 3. Exact contract for the separate crew task

**Owner:** whoever starts the agent review owns normal label lifecycle. MyWorkflows does not observe a crew report, launch a reviewer, infer liveness or submit GitHub approvals.

**Label:** manifest key `under-review`; exact GitHub name `🤖 Under review`, color `840479`, empty description. Ensure the base label has been enabled/synced before activating crew integration. The runner uses its ordinary signed-in GitHub credential, not the delivery App key or an Actions dispatch.

**Mechanism:** plain add/remove of that one label on the PR. Equivalent `gh`/`gh-axi` PR-label editing is acceptable; the precise REST contract is:

| Action | Request |
| --- | --- |
| Add | `POST /repos/{owner}/{repo}/issues/{pr}/labels` with `{"labels":["🤖 Under review"]}` |
| Remove | `DELETE /repos/{owner}/{repo}/issues/{pr}/labels/%F0%9F%A4%96%20Under%20review` |

Do not replace the PR's whole label set or delete the repository label definition. Repeated add is harmless. Repeated remove is success when the label is already absent; distinguish confirmed absence from a 404 for an inaccessible repository/PR. Permission/network failures must be reported and cleanup retried through existing crew recovery, not silently treated as success.

The separate crew task must implement this lifecycle, using its existing task/Core observations rather than a new supervisor or timer:

1. Resolve the implementation PR from the worker's `Implementation:` report/current branch; a `Plan:` report is not a final implementation review target. Add the label when `crew review` starts, before launching the reviewer, including if the PR is still draft or CI is pending. If adding fails, report signaling failure instead of claiming the review was labeled; remove on a subsequent launch failure.
2. Remove when `crew done` receives either first-line verdict, `APPROVE` or `CHANGES NEEDED`. Both mean the reviewing activity ended, not that GitHub approved or rejected the PR. A malformed/failed report must not leave the activity label behind either.
3. Remove on reviewer stop, finish, failed launch, observed terminal/agent death or abandonment. Integrate removal with existing `wait`/recovery/start observations as appropriate. Replacement must finish old cleanup before adding for its new review, so stale completion does not clear a replacement's label.
4. Keep one review owner per PR at a time, or have that owner retain the label until its last local reviewer finishes. Plain labels do not provide ownership or cross-controller reference counting; do not promise safe overlapping independent review runners. This task adds no distributed coordination protocol.
5. Document and test direct add/remove, both verdicts, stopped/finished/dead reviewers, spawn failure, retry/idempotency, and lack of permissions with fake GitHub/Core calls. Keep crew's existing architecture; no heartbeats, lease state or new background process.

**Advisory only:** the person may merge while labeled. No required check, readiness gate, merge gate, auto-merge or auto-approval is introduced. Label absence is not proof that a review happened or passed.

**Failure boundary:** crew removes on deaths it observes. If the entire runner/coordinator machine is lost and no crew process observes recovery, an open PR's label may remain until crew resumes or a person removes it. There is intentionally no time-based expiry promise. The independent shared closed-event cleanup below is the final fallback when the PR closes. This is the explicit limitation of the simpler scope, not a hidden sweep or a claim of instantaneous crash detection.

No `D:/Git/crew` file is edited here; implementing and testing these hooks is a separate crew task.

## 4. Isolated cleanup on already-forwarded PR closure

Add an independent `review-label-cleanup` job to the existing reusable workflow, running on `pull_request_target` with action `closed`, whether merged or closed without merging. Do not restrict it to a particular PR author or the default target branch. Respect `DELIVERY_LABELS_ENABLED` before any writes.

The job checks out trusted tooling, reads the exact manifest entry, and mints a separate repository-scoped App token with Pull requests write. Remove only that label from the event's PR if present, leaving all other labels and the definition intact. A missing assignment is an idempotent no-op. Read the current PR state before removal to avoid removing a newly active review label after a rapid reopen; a currently reopened PR belongs to its runner again. Reject malformed/non-PR event data rather than accepting an arbitrary target.

Make this job independent of promotion/finalization, with no `needs` edge to or from them and job-level failure isolation (`continue-on-error`). Neither it nor sync is a required check. Emit an explicit warning/summary on missing secrets, inaccessible PRs or API failure; isolation is not silent error suppression. It must not fail promotion/finalization, change their ordering or alter the existing Delivery check. Do not change caller permissions or events.

Normal successfully processed close/merge events therefore leave no Under review assignment, even if crew never reports or dies. GitHub event delivery/API failures or disabled rollout can still prevent cleanup; report that limitation and allow a direct retry/removal, not an absolute availability guarantee. Historical closed PRs such as #14 are not automatically swept by this future-event handler.

## 5. Defaults: preserve automatically, prune only on explicit request

Sync never deletes GitHub defaults or custom labels. Keep a documented opt-in command, `delivery labels --repo owner/name --apply --prune-unused-defaults`, with a report-only counterpart omitting `--apply`. This command is not run by this change, by automatic jobs or merely because the implementation plan is approved.

Only unused, unmodified GitHub defaults are eligible: known default name and exact standard metadata, GitHub's default-label marker, and zero issue **and** PR assignments across open and closed states. Report candidates, then re-read metadata and both usage counts immediately before each explicit deletion. Skip used/customized/changed labels, and fail closed on unreadable counts. Paginate all reads. Never bulk-replace labels, recreate absent defaults or delete labels removed from the central manifest automatically.

Deleting a label removes all of its assignments, so GitHub's lack of an atomic delete-if-unused still leaves a last-read/DELETE race. Document this and require a separately authorized quiet maintenance window; preserving all labels remains the zero-deletion-risk default.

The original read-only snapshot counted all states and had no truncated label connections. The ten defaults are `accessibility`, `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`.

| Repository | Unused defaults eligible only for separately authorized pruning | Used defaults retained |
| --- | --- | --- |
| timurproko/MyWorkflows | All ten | None |
| timurproko/crew | All ten | None |
| timurproko/herdr-app | All ten | None |
| timurproko/xrbuild | All ten | None |
| xrbuild private workspace | All ten | None |
| timurproko/a1 | `question` only | `bug`: 1 issue + 1 PR; `enhancement`: 24 PRs |

There were 51 candidates, not 51 authorized deletions. Re-audit before any future pruning. Preserve a1's seven absent defaults as absent, and preserve its custom labels, MyWorkflows' Dependabot labels and xrbuild/workspace automation labels. The robot definition would be created in five audited repositories and matched in place in herdr-app; definition sync never copies an assignment from PR #14.

## Person's remaining actions and rollout

The scope decisions are settled: direct runner-owned labels, isolated close-event cleanup, existing reusable-workflow sync, preserve defaults automatically, and no added Issues grant. Implementation was approved; that approval is not permission for live rollout or pruning.

1. After implementation review/merge, the person enables `DELIVERY_LABELS_ENABLED=true` in each chosen consumer. Until then automatic sync and cleanup write nothing. This change does not set that variable or alter any GitHub permissions.
2. Existing `main` callers need no migration, schedule, new inputs or protection change. Pinned callers need their normal reviewed pin update. Label sync occurs on their next forwarded event; an idle adopter waits for such an event or an explicitly requested manual sync.
3. Activate the separately delivered crew hooks only once the base label is available and the person has enabled that repository. Do not claim this MyWorkflows PR alone updates `crew review`.
4. The person may separately authorize removal of the historical assignment on herdr-app #14. No historical mutation is included here.
5. Optional pruning requires new authorization identifying repositories and a fresh report. No pruning, label modification, App permission acceptance or protection apply occurs during this plan/change rollout automatically.

Update README/owner documentation and the shared change-delivery skill with the direct reviewer responsibility, advisory semantics, permission alternatives, enablement and event-driven cadence. Keep the caller template unchanged unless a documentation comment needs clarification; no consumer edits are required. Never place repository-specific delivery rules in consumer agent instructions.

## Ordered implementation outcomes and targeted checks

These delivered groups match the PR's Implementation outcomes, in order. Tests use fake GitHub/Core inputs; no label writes are performed against a real repository.

1. **A gated base-label manifest synchronizes calling repositories through the existing reusable workflow.**
   - Manifest/schema, report/apply CLI, repository-scoped App writer and isolated sync job; default-disabled variable and existing manual dry-run behavior.
   - Fixtures: exact emoji/empty description; create/update/no-op; custom/default preservation; removed manifest entry; denied rights/secrets; disabled rollout; pinned tools ref; no PR code execution or finalization dependency.
2. **Unused unmodified GitHub defaults have an explicit report-first pruning command that automatic sync never invokes.**
   - Documented opt-in CLI implementation and conservative fresh metadata/all-state usage checks; no live invocation.
   - Fixtures: 51 historical candidates, a1 used defaults, closed-only usage, absent defaults, customization, pagination, unreadable counts and usage added before final recheck; document the unavoidable final delete race.
3. **An isolated closed-PR job removes the Under review assignment with existing App permissions.**
   - Independent gated cleanup on existing `closed` events using Pull requests write, with idempotent removal and visible nonblocking failures.
   - Fixtures: merge and unmerged closure, missing assignment, exact URL encoding, unrelated labels preserved, non-default target, repeat delivery, reopened PR, denied token/API failures, disabled rollout and unchanged promotion/finalization/check behavior.
4. **Adoption guidance documents direct review-owner labeling and the separate crew lifecycle contract.**
   - README, owner docs and shared skill describe exact key/name, signed-in add/remove, verdict/stop/finish/death cleanup, recovery limits, no merge gate, event-driven sync, enablement and optional pruning.
   - Targeted workflow/template/permission contract checks ensure no new caller inputs/events/schedules, no Issues expansion and no review protocol or supervisor. Crew's own fake-Core/GitHub lifecycle tests belong to its separate task.

Planning validation used document/body checks and read-only permission/audit research. Implementation adds outcome-specific tests; the maintainer also requested the complete CI-equivalent suite before handoff. Broad CI remains the integration gate. No live label writes, rollout enablement or reviewer launches are part of this change.

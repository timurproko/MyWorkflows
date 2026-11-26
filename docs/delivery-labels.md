# Delivery labels

## Published palette and stable keys

`labels/base.json` publishes the accepted contract. Its version-1 `labels` object has these **permanently stable keys**; display names are editable data:

| Key | Initial GitHub name | Color | Previous names |
| --- | --- | --- | --- |
| `under-review` | 🤖 Review | `840479` | 🤖 Under review |
| `review-approved` | 🤖 Approved | `1a7f37` | none |
| `review-changes-needed` | 🤖 Build | `9a6700` | 🤖 Rework, 🤖 Changes needed |

The table and JSON example are fixed bootstrap examples, not a second current palette: routine UI edits update only the published manifest and do not require guidance edits. Initially each has an empty description. Initial names start with U+1F916 and one ordinary space, without a variation selector. Future valid UI edits **may remove the robot prefix**: never infer a role from spelling, colour or emoji. The reference is the managed labels on the **timurproko/MyWorkflows GitHub Labels page**, not labels with coincidentally matching names elsewhere.

Each entry has this shape (all three keys are present):

```json
{
  "version": 1,
  "labels": {
    "under-review": {
      "name": "🤖 Review",
      "color": "840479",
      "description": "",
      "previousNames": ["🤖 Under review"],
      "reference": {
        "id": 13190967182,
        "nodeId": "LA_kwDOVy9vAc8AAAADEj4vjg",
        "name": "🤖 Under review",
        "color": "840479",
        "description": ""
      }
    }
  }
}
```

`previousNames` is always an array, empty when there is no history. `reference.id` and the `nodeId` node id identify the source GitHub label across renames; they are **not ids of labels in consumers**. The remaining reference fields record the last accepted source observation. The initial manifest deliberately requests the shortened names while recording the observed old reference names; normal default-on sync after merge aligns those source labels in place. No agent runs a live label-write command for this change.

## Reference UI edits, reconciliation and protection

The MyWorkflows-only `Reference labels` workflow uses trusted default-branch tooling for `label` events `edited`, `created`, `deleted`, plus manual dispatch. Only recorded managed identities participate:

- **Edited:** validate the event name/colour/description, retain `changes.name.from` and the prior accepted name as aliases, and reconcile live source state. A stale event retains old-name history but cannot overwrite a newer live edit. Pending PR history survives successive edits before merge. Reverting to an earlier name removes that name from its own alias list.
- **Created:** ignored; a new label is never managed just because its name matches. Recreating a deleted name does not restore its GitHub identity.
- **Deleted:** unmanaged deletion is ignored; managed deletion produces a visible warning and retains the accepted manifest. It never deletes labels elsewhere, recreates a source label or silently rebinds an id. Rebinding a replacement requires an explicitly reviewed manifest edit.

Names must be nonempty, trimmed, control-character-free and at most 50 Unicode code points; colour must be six hexadecimal digits, description at most 100 code points. Duplicate source identities and case/Unicode-normalization collisions across different roles' current names/alias histories are rejected. Explicit same-role aliases support deliberate case/Unicode-only renames; an unlisted case/normalization collision is never silently adopted. Removing the robot prefix is allowed. Invalid UI edits are reported, not propagated blindly; the UI itself is not rolled back.

Valid changes create/update a dedicated `chore/reference-labels-*` topic branch and **draft bot pull request** with the delivery body's Proposal, completed data-update Implementation and Acceptance sections. No OpenSpec Automation section applies here. The existing delivery bot promotes its completed draft and runs required checks; **the person merges it**. There is no direct main push, bypass, automatic readiness by the publisher or auto-merge. Publication uses the existing repository-scoped delivery App's Contents write and Pull requests write capabilities; no consumer writes or extra Issues grant is needed. Default-branch and topic-head changes during preflight are rejected; non-force updates reject concurrent sibling commits. A branch with manual/unrelated edits is not overwritten. Normal delivery update-branch merge commits remain eligible when their second parent is an ancestor of the trusted default head, their content differs from that trusted base only in the manifest, and the merge leaves the topic's manifest unchanged. A publication failure after branch creation may leave an unmerged topic branch for inspection, never a default-branch change.

A metadata edit reverted to the accepted manifest before merge retires its generated PR: after the usual source/head preflight, the publisher comments that the reference now matches main and closes the PR instead of writing a pointless revert commit. Read-only mode reports `would-retire` without commenting/closing. Alias-history changes remain meaningful and are not discarded just because the display name reverted.

### Pending reconciliation states

For a valid managed edit or manual reconciliation:

| State | Next reconciliation |
| --- | --- |
| No PR | No-op if the reference matches accepted main; otherwise publish a fresh topic PR |
| Open with diff | Update the same trusted branch; no-op if unchanged; comment/close if the proposed manifest now equals main |
| Open with empty diff | Accept trusted history instead of rejecting the empty files list; retire if still matching main, or reuse for a new meaningful edit |
| Open after base refresh | Validate trusted base ancestry/content and unchanged topic manifest, then reconcile normally |
| Closed unmerged by the person | Leave the closed PR/branch untouched; if source drift persists, the next event opens a fresh PR (closing is not an opt-out) |
| Merged | Use the newly accepted main/history; no-op until a new edit needs a fresh PR |
| Branch deleted | If its PR is closed, reconcile from main normally; if still open, fail visibly without writes until a person restores the branch or closes that PR |
| Branch exists without PR | Do not overwrite or delete the orphan; if a diff remains, publish a fresh uniquely named branch/PR |

The workflow summary links the PR and shows the proposed manifest. Between the UI edit and PR merge, the Labels page shows the edit but runners/consumers use the **previously accepted manifest**. Ordinary reference sync compares the live id and metadata with the recorded reference snapshot, checks for pending reference PRs, and rereads immediately before PATCH. UI drift or a pending reconciliation blocks source writes rather than restoring stale accepted metadata. Initial source renames emit events that update the accepted snapshots through this same PR path.

GitHub has no atomic compare-and-update label endpoint: a UI edit between the last source read and PATCH remains possible. During bootstrap, an exact reversion to the original snapshot before its event/pending PR is observed is likewise indistinguishable from the not-yet-applied migration. Avoid concurrent UI edits during initial alignment; reconcile and inspect the event/PR history if this occurs. This is not an atomic synchronization guarantee.

### Missed-event recovery

`delivery labels-reference` reports reconciliation from the live reference labels, read-only by default. `delivery labels-reference --apply` explicitly publishes/updates the same reconciliation PR using the ordinary signed-in credential; **it writes only a topic branch/PR, never labels or main**. The workflow's manual dispatch defaults to read-only and needs explicit `apply: true` to publish. CLI argument errors and malformed/reference-missing states fail closed.

A missed rename recovers the accepted manifest name as an alias. Entirely missed multiple intermediate names cannot be inferred from the current Labels API: add those aliases in a reviewed correction. No new schedules, consumer inventory, central fan-out, automatic historical sweep or credential expansion is introduced. The separately authorized manual closed-PR sweep below is not part of reference reconciliation.

## Default-on consumer sync and transition behavior

All three isolated automatic jobs, base-label sync, open-PR exclusivity and closed-PR cleanup, are **enabled by default**. The **calling repository's** `DELIVERY_LABELS_ENABLED=false` opts out of all three (case-insensitive, without whitespace trimming). Unset, empty, `true` and any other value remain enabled; ` false ` does not disable writes. No variable is set automatically. Opt-out occurs before label API reads or token minting. Manual dry runs stay read-only even when opted out and do not mint a label App token.

Each consumer receives a changed manifest on its **next forwarded delivery event after merge**; idle repositories wait. A reference UI edit alone does not immediately update consumers, and opening its PR does not publish the new contract. Sync compares the entire paginated listing before writing:

| Existing state | Operation |
| --- | --- |
| Current name exists | Update only its metadata if necessary; preserve/report old-name definitions |
| Current missing; exactly one previous name exists | PATCH the previous definition's URL with `new_name`, colour and description |
| Neither current nor previous exists | Create the current definition |
| Multiple previous definitions, or ambiguous case/normalization collision | Refuse rather than guess, duplicate or delete |

Renaming preserves the GitHub label id and existing issue/PR assignments. If old and new both exist, the new one wins, the old one is left alone and reported; assignments are not merged automatically. Report mode shows each planned rename and conflict with zero mutation. Sync never deletes definitions or directly modifies assignments. Removed manifest entries become unmanaged. GitHub write payloads contain only the endpoint's supported fields, not reference metadata/history. Permission/API failures remain visible warnings and summaries, independently of promotion, finalization and the Delivery check. No label job is a prerequisite of required delivery jobs.

Definition sync needs no caller edit for callers tracking `main`. Open-PR exclusivity separately requires the tiny label-only caller described below, not edits to delivery triggers. Version-pinned callers must update the workflow reference and matching `tools_ref` to the same reviewed revision; `tools_ref` defaults to `main`. A workflow pin alone does not pin scripts: pin tooling to the same old revision until upgrading both together. A previous read-only snapshot found a1, crew, herdr-app, xrbuild and its private workspace tracking main with default tooling; MyWorkflows calls its local workflow. None of these six consumers needs an update for a moving-main definition-sync rollout; this is not a maintained inventory or a promise of automatic label-event subscription.

## Scheduling and assignment-only events

The isolated, advisory `label-sync` job serializes definition synchronization in the repository-wide
`delivery-label-sync` group, with `cancel-in-progress: false` and `queue: max`. False alone protects running jobs
but GitHub's default single pending slot still cancels an older waiting job when a third request arrives.
The multi-pending queue prevents that misleading cancelled PR check during normal bursts while preserving
serialization. GitHub allows up to 100 pending jobs; overflow, explicit/manual cancellation and caller-level
whole-run cancellation remain limits. This is not a guarantee against every possible cancellation.
See [GitHub's concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Review-label **assignments** do not change source, implementation bodies, readiness or label definitions.
Only the advisory `review-label-reconciliation` job in its own reusable `.github/workflows/review-labels.yml`
runs on open label additions. Its separate caller subscribes to `pull_request_target: [labeled]`. Delivery and test
callers do not subscribe to either assignment action. Job guards in delivery are defensive only: **skipped required
checks satisfy GitHub protection**, so calling the delivery workflow and skipping its jobs is not isolation.
The label workflow never contains or calls delivery/test jobs, and publishes only the distinctly named non-required
`review-labels / Reconcile managed review labels (advisory)` check. No new required check or dependency is introduced. Unmanaged additions are no-ops after manifest resolution; editable names and
`previousNames` cannot be hard-coded in the YAML guard. The separate reference workflow still receives repository
`label: [edited, created, deleted]` events, which concern definition changes rather than PR assignments.

### Exact caller rollout and test-workflow audit

MyWorkflows #36 deliberately removed assignment events from delivery callers. Keep that exclusion: forwarding
labels to delivery could replace a failed `delivery / Delivery check` with a newer skipped result on the same head.
A reusable workflow cannot add subscriptions to its caller, so zero consumer edits are impossible. Instead,
**add one small caller file**, separate from delivery and tests. Copy `templates/review-labels-caller.yml` to
`.github/workflows/review-labels.yml` in each external consumer with this exact content. It forwards only `labeled`:

<!-- review-labels-caller:start -->
```yaml
# Copy to .github/workflows/review-labels.yml; keep delivery/test callers free of label events.
name: Review labels

on:
  pull_request_target:
    types: [labeled]

permissions:
  contents: read
  pull-requests: read

jobs:
  review-labels:
    uses: timurproko/MyWorkflows/.github/workflows/review-labels.yml@main
    secrets:
      app_id: ${{ vars.DELIVERY_BOT_APP_ID }}
      app_private_key: ${{ secrets.DELIVERY_BOT_PRIVATE_KEY }}
```

| Repository | Add caller file | Test workflow and label-event status at read-only audit |
| --- | --- | --- |
| `timurproko/herdr-app` | `.github/workflows/review-labels.yml` | `tests.yml`: both assignment actions excluded |
| `timurproko/crew` | `.github/workflows/review-labels.yml` | `tests.yml`: both assignment actions excluded |
| `timurproko/a1` | `.github/workflows/review-labels.yml` | `ci.yml`: explicit PR types exclude both; other inspected test entry points do not subscribe to label events or Delivery completion |
| `timurproko/xrbuild` | `.github/workflows/review-labels.yml` | Historical audit found label triggers; the separate CI-trigger repair is now merged |
| `timurproko/.xrbuild` | `.github/workflows/review-labels.yml` | `ci.yml`: both assignment actions excluded |
| `timurproko/MyConfigs` | `.github/workflows/review-labels.yml` | `ci.yml`: both assignment actions excluded |
| `timurproko/MyWorkflows` | `.github/workflows/self-review-labels.yml` | `test.yml`: default PR actions exclude both |

MyWorkflows' self-caller is included here with the same settings except its display name and local
`uses: ./.github/workflows/review-labels.yml`. Delivery template/self-callers are reverted to their original
label-free event lists; no other repository is edited. If the earlier proposed delivery-trigger edit was adopted,
remove `labeled`/`unlabeled` there as well; do not retain it alongside the separate caller. Callers tracking `main`
use the new reusable file after merge; pinned callers align its workflow reference and matching `tools_ref` too.
Keep both label actions excluded from delivery and test triggers.

**Actions-policy prerequisite:** public repositories with a restrictive workflow-path allowlist must also authorize
the new caller path for `pull_request_target` or GitHub will block it. Built-in delivery protection defaults remain
unchanged; label-only adoption is explicit. In a consumer with an existing `.github/protection.json`, add only
`.github/workflows/review-labels.yml` to its existing `workflow-events.workflows` array, retaining all declarations,
required checks and events. Where no override exists, first obtain its current declarations through read-only
`delivery protect --repo owner/name`, then publish a reviewed override preserving them plus the new caller path.
MyWorkflows' own override declares `.github/workflows/self-review-labels.yml` in addition to its existing self-delivery
path; no required checks or App grants change. Declaration alone does not apply the live policy. After merge,
inspect a fresh protection report and obtain separate named-repository authorization before
`delivery protect --repo owner/name --apply --allow-rule-changes`. This task does not apply policies, change live
permissions, or claim the new self-caller is live before its path is authorized.

Tests run independently of delivery. Adding this separate workflow cannot subscribe tests or emit skipped
delivery/test checks, and no inspected test workflow consumes Review labels or Delivery completion. The historical xrbuild audit found both label actions in
`ci.yml`; the separate first-stage repair has now merged in crew, xrbuild, herdr-app and the private workspace.
Those test triggers exclude `labeled`, `unlabeled` and body-only `edited`, and their required-check aggregators
skip cancelled runs. Do not reintroduce those subscriptions. The Delivery caller keeps `edited` for body validation.
No other repository is edited here. A job-level skip is too late because workflow-level concurrency may already
cancel tests. Historical cancelled checks are not rewritten or rerun by this change.

### Open-PR exclusivity and deterministic ordering

For each managed addition, resolve `under-review`, `review-approved` and `review-changes-needed` from one validated
manifest, including every `previousNames` alias. Bot and person additions use the same policy. Validate event/PR
identity, read current open state and paginate current assignments rather than trusting webhook labels. Ignore
unmanaged additions; closed/merged PRs are no-ops owned by clear-on-close cleanup.

When multiple managed names remain, paginate `GET /repos/{owner}/{repo}/issues/{pr}/events`. For each currently
assigned managed name, find its latest exact-name `labeled` event. The assigned name with the latest `created_at`
timestamp wins, with numeric event-id ordering for equal timestamps. Neither label-definition creation timestamps
nor run start/queue order choose the winner. Ignore `unlabeled` events entirely when ranking survivors: the fresh
assignment snapshot already excludes removed names. No assignment is restored.

One missing addition is oldest; if two or more assigned names lack `labeled` history, fail closed with a visible
warning and no writes. API errors, malformed labeled-event ordering and pagination failures remain errors, not
missing history. Do not borrow history across aliases or infer identities across definition renames: after a rename
cycle, rank the surviving exact spelling's additions, even if another spelling has a newer addition. This deliberately
supersedes the earlier role-wide rename-history policy. Preserve the winning current/historical assignment and delete
every other assigned managed name, including aliases of the winner's own role. Fresh reads before each DELETE allow
one run to converge to a single survivor; re-runs are idempotent. Never replace the entire label set or change definitions.

The dedicated per-repository/PR `delivery-review-label-reconciliation` concurrency group uses `queue: max` and
`cancel-in-progress: false`. Jobs serialize, but ordering remains independent of execution order because each
reads fresh history. Before each individual deletion the script twice reads current assignments, latest history
and open state, retries changed snapshots within a bound, and rescans after writes. DELETE 404s require confirmed
PR access and exact assignment absence. Missing App rights, malformed history, multiple missing additions, denied reads or bounded
churn produce visible advisory warnings/summaries; required delivery jobs are independent. The existing opt-out
occurs before token minting or label API reads and no fallback credential is used for writes.

Limits: GitHub's timestamps can tie, so the event-id tie-break is deterministic rather than a subsecond wall-clock
claim. History/webhook visibility delays, failed APIs, explicit cancellations, queue overflow (100 pending jobs)
and consumer whole-run cancellation can postpone reconciliation. There is no schedule/backfill, historical sweep,
lease, timer, crash-expiry guarantee or cross-controller lock. GitHub offers no atomic delete-if-still-open-and-latest
endpoint; the read/DELETE race remains: independent writers or closure/reopen between the last read and DELETE remain a non-atomic race. The
closed-event job still owns closures; no stale verdict or review label is automatically restored after reopening.

## Review loop and stage meanings

There are exactly three managed labels: Build, Review and Approved. Build means building/fixing, including one
combined fix round for CI failures and blocking review findings. Review is the review stage, including waiting
for CI after review approval. Approved means the review approved that commit and CI is green on that same commit;
review approval alone or green checks on an earlier head are not enough. Closed Approved remains a historical
record, not approval of new commits.

Keep one concern per pull request. Make the change, run only the tests for what you touched, push and report
immediately: CI and the review start together. No full local test suite is required of workers or reviewers.
Reviewers identify the exact commit, state what they checked, and mark every finding BLOCKING or FOLLOW-UP.
Only blocking findings cause another round; follow-ups are recorded as separate work. Combine CI failures and
blocking findings into one fix round. The second review covers only the fix (delta review); after two rounds
the person decides, rather than launching a third automated round.

The bot retains its existing promotion on completed draft outcomes, followed by linked-change finalization.
Labels do not authorize promotion. No approval dispatch or caller migration is needed. Agents never mark ready.
The shared change-delivery skill is the source of these delivery rules; crew's orchestration is separate work.

## Runner manifest API and crew contract

At each review operation, read and validate one manifest snapshot from the configured source repository (default `timurproko/MyWorkflows`). Discover `default_branch` with `GET /repos/{source}`, then fetch `GET /repos/{source}/contents/labels/base.json?ref=<URL-encoded-default-branch>` with `Accept: application/vnd.github.raw+json`. **Equivalent one-read form:** `GET /repos/{source}/contents/labels/base.json` without `ref`. Omitting `ref` resolves the default branch on GitHub. Do not assume `main` or use a stale pinned copy.

Default one-read URL: `https://api.github.com/repos/timurproko/MyWorkflows/contents/labels/base.json`. The current explicit-ref URL is `https://api.github.com/repos/timurproko/MyWorkflows/contents/labels/base.json?ref=main`. Require `version: 1`, all three stable keys, valid current names and `previousNames` arrays; tolerate additional reference metadata. Use one consistent snapshot within the operation, resolve by key and preserve unrelated labels.

A runner **MAY use built-in defaults on read/validation failure if it explicitly warns**. The warned fallback is Build/Review/Approved with the exact initial emoji/space names and alias lists in the table above, not the pre-migration names as current names. Silent fallback is forbidden. It cannot discover arbitrary future UI names and may leave those assignments untouched until manifest access recovers; it is not successful synchronization. This runner availability policy never authorizes reference reconciliation or MyWorkflows sync/cleanup to substitute hard-coded display names.

Crew's separately implemented transport makes exactly one contents API read without `ref`, with a **two-second timeout**, and uses that warned fallback on failure. No separate repository-discovery read is required. No crew source is modified here; retain the lifecycle boundaries from **crew PR #7**:

- Resolve the implementation PR from the implementation report/current branch, not a `Plan:` report. Respect repository opt-out; use the runner's signed-in credential, not the delivery App key.
- At review start, add current `under-review` and remove both verdict keys' current/historical assignments **before launching the reviewer**, even for drafts or pending CI.
- On `APPROVE`, add current `review-approved` only when the review approved that commit and CI is green on that same commit; keep Review while CI is pending. When both hold, clear current/historical review-in-progress and opposite-verdict names. On `CHANGES NEEDED` for blocking findings, clear competing roles and add current `review-changes-needed` (Build). FOLLOW-UP findings alone do not trigger another round. Verdicts are mutually exclusive.
- Failed launch/report, stop, finish, observed death or abandonment clears current/historical in-progress names without inventing a verdict. Complete old cleanup before replacement; retain one owner per PR or wait for that owner's last local reviewer to finish. Plain labels cannot coordinate overlapping independent controllers.
- Use ordinary `POST /repos/{owner}/{repo}/issues/{pr}/labels` with `{"labels":["<resolved current name>"]}` and `DELETE /repos/{owner}/{repo}/issues/{pr}/labels/{URL-encoded-resolved-name}`. Do not replace the whole label set or delete repository definitions. Repeated add is harmless; confirm access and absence before treating a remove-label 404 as success. Warn on permissions/API failures and use existing recovery.

Closed/merged cleanup removes Build and Review current/historical assignments; Approved stays as the record, including its aliases. A reopened PR keeps that record until the next review sets one; removed assignments are not restored. Unrelated labels remain untouched. This policy supersedes the earlier all-verdicts clear-on-close contract; retained Approved is historical evidence, not approval of later commits.

All three labels are **advisory**, never required checks, readiness conditions or merge gates; absence is not approval. A retained verdict is not a promise that later commits were reviewed. No lease, heartbeat, state comment, timer, supervisor or cross-controller lock is added. There is **no time-based crash-expiry guarantee**: a lost machine can leave an open PR labeled until recovery or a person clears it.

## Closed-event fallback

The already forwarded `pull_request_target: closed` event validates all three stable roles from one manifest snapshot, then clears the two transient roles `under-review` (Review) and `review-changes-needed` (Build) current names and `previousNames` assignments on merged **and** unmerged closures. `review-approved` (Approved), including its historical aliases, remains as the record even if unexpectedly present alongside another stage. Unrelated labels survive. No verdict is added and no definition is deleted.

Cleanup validates repository/event/PR identity and current closure state, paginates assignments, and checks for reopen before **each** removal. After removals or a DELETE 404, cleanup rescans both transient roles' current/historical names so a concurrent definition rename cannot masquerade as assignment absence. A DELETE 404 succeeds only after confirming access and that exact assignment's absence; continued assignment churn fails visibly rather than reporting success. A final-read/reopen race cannot be made atomic. Opt-out, missed events and failed APIs can prevent cleanup; warnings do not hide these limits. The event handler does not sweep historical PRs or replay herdr-app #14's old closure. Use the explicit manual recovery below for older closed PRs.

## Explicit manual closed-PR sweep

`delivery labels-sweep --repo owner/name` reports only Build/Review managed assignments on already-closed/merged pull requests in exactly one repository, **read-only by default**. Inspect the PR numbers and exact names in a fresh report, then obtain separate named-repository authorization before running `delivery labels-sweep --repo owner/name --apply`. Both `--repo owner/name` and `--repo=owner/name` work. There is no automatic invocation, schedule, dispatch or post-merge backfill, and implementation approval is not authorization to apply it. Do not run either mode as part of implementing this change.

The command uses the normal signed-in `gh` credential or `GH_TOKEN`, never the delivery App private key or a newly minted App token. It reads one local published manifest snapshot from the installed tooling, validates all three stable keys, and resolves only Build/Review current names and `previousNames`, preserving Approved and its aliases; update the tooling first if its palette is stale. Report mode remains read-only even when opted out. For local apply, an environment value `DELIVERY_LABELS_ENABLED=false` disables writes (case-insensitive, no trimming); the calling repository's variable continues to gate the automatic jobs and is not fetched by this local command. Separate authorization is required regardless of opt-out settings.

Discovery paginates `GET /repos/{owner}/{repo}/pulls?state=closed&per_page=100&page=N` and validates the complete list before any mutation; it never treats ordinary issues as PRs. Assignment reads are also paginated. Each PR is freshly re-read for identity and closed state, and apply shares the event cleanup's before-each-removal reopen check, whole-transient-set rescan, bounded retry, confirmed absence and DELETE-404 access checks. Open/reopened PRs are skipped, not relabeled; no definitions are created/deleted, no verdicts added, and unrelated assignments remain unchanged. Read/access/malformed-data and pagination-limit failures fail closed, not as empty results. Apply failures exit nonzero and identify the failed PR; earlier PRs may already have been cleaned, with no rollback. Inspect a fresh report before retrying.

GitHub has no atomic delete-if-still-closed operation: reopening between the final state read and DELETE remains possible, just as for event cleanup. Concurrent label/review changes may prevent confirmed cleanup and must fail visibly. Pagination is a bounded best-effort snapshot, not a frozen repository transaction; concurrent closures can require a fresh report and another separately authorized apply. Runners should not add new review labels to closed PRs. A reopened PR keeps any retained Approved record and waits for its next review to set a label; no removed assignment is restored.

## Permissions and optional default pruning

Sync, open-PR reconciliation and cleanup mint separate repository-scoped App tokens with existing **Pull requests write** permission, revoked after each job. GitHub labels endpoints accept that grant despite the `/issues/` namespace; **no added Issues permission** or caller permission change is needed. See [GitHub's label API permissions](https://docs.github.com/en/rest/issues/labels#create-a-label). The caller token is read-only diagnostic access, never a write fallback. Missing App rights/secrets, forbidden access and rate limits produce warnings, not delivery failures. Local diagnostics/manual apply use the signed-in `gh` credential or normal `GH_TOKEN`; never export the App private key. Private repositories require actual access.

`delivery labels --repo owner/name` emits the read-only palette diff; explicit `--apply` synchronizes definitions. `--prune-unused-defaults` instead reports default-label usage; `--apply --prune-unused-defaults` explicitly prunes eligible defaults instead of syncing. Every apply/prune needs separate named-repository authorization; implementation approval does not authorize live writes. Automatic jobs never invoke the pruner.

Pruning additionally needs visibility of both issues and PRs, including closed/merged work; unreadable usage fails closed. It recognizes only ten original GitHub defaults (`accessibility`, `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`) with unchanged metadata and the default marker. **Current, previous and accepted reference names of managed labels are excluded**, even if a future name matches an otherwise eligible GitHub default. Custom/modified/default-marker-free labels are preserved; missing defaults are not recreated. It paginates all-state usage, preflights every candidate before deletion, then freshly checks identity, metadata, marker and usage per candidate. Missing definitions are skipped; permission failures are not absence and failed deletes are not blindly retried.

**Deleting a label deletes its assignments everywhere.** GitHub has no atomic delete-if-unused operation. Obtain separate consent, inspect a fresh report and use a quiet maintenance window. Automatic preservation is the only zero-deletion-risk policy. The historical [base-label audit](plans/base-labels.md) counted 51 unused candidates but authorized none; a1's used bug/enhancement must remain.

## Repository identity validation

All label listing, sync, usage/pruning, manual sweep and closed-event cleanup share `validateRepository` in `scripts/repository-labels.mjs`. Both CLI repo flag forms work. Owners are 1–39 ASCII letters/digits or single separating hyphens, without leading/trailing/consecutive hyphens. Repository names are 1–100 ASCII letters/digits, hyphens, underscores or dots, except exactly `.` or `..`. Dotted/leading-dot names are accepted unchanged; slash extras, whitespace, URLs, percent escapes and query/fragment syntax are rejected, without trimming or stripping `.git`.

Other delivery/protection identity parsers were audited previously and already accept leading dots; tightening their broader owner/length rules is a separate follow-up, unchanged here. The exclusivity addition uses a separate label-only caller and declares its path in MyWorkflows' own Actions-policy override; it does not change required checks, built-in protection defaults, consumer identity parsing or App permission grants. No live policy is applied.

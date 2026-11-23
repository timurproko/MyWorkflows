# Delivery labels

## Published palette and stable keys

`labels/base.json` publishes the accepted contract. Its version-1 `labels` object has these **permanently stable keys**; display names are editable data:

| Key | Initial GitHub name | Color | Previous names |
| --- | --- | --- | --- |
| `under-review` | 🤖 Review | `840479` | 🤖 Under review |
| `review-approved` | 🤖 Approved | `1a7f37` | none |
| `review-changes-needed` | 🤖 Rework | `9a6700` | 🤖 Changes needed |

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

Valid changes create/update a dedicated `chore/reference-labels-*` topic branch and **draft bot pull request** with the delivery body's Proposal, completed data-update Implementation and Acceptance sections. No OpenSpec Automation section applies here. The existing delivery bot can promote it and run required checks; **the person merges it**. There is no direct main push, bypass, automatic readiness by the publisher or auto-merge. Publication uses the existing repository-scoped delivery App's Contents write and Pull requests write capabilities; no consumer writes or extra Issues grant is needed. Default-branch and topic-head changes during preflight are rejected; non-force updates reject concurrent sibling commits. A branch with manual/unrelated edits is not overwritten. Normal delivery update-branch merge commits remain eligible when their second parent is an ancestor of the trusted default head, their content differs from that trusted base only in the manifest, and the merge leaves the topic's manifest unchanged. A publication failure after branch creation may leave an unmerged topic branch for inspection, never a default-branch change.

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

Both existing isolated automatic jobs, base-label sync and closed-PR cleanup, are **enabled by default**. The **calling repository's** `DELIVERY_LABELS_ENABLED=false` opts out of both (case-insensitive, without whitespace trimming). Unset, empty, `true` and any other value remain enabled; ` false ` does not disable writes. No variable is set automatically. Opt-out occurs before label API reads or token minting. Manual dry runs stay read-only even when opted out and do not mint a label App token.

Each consumer receives a changed manifest on its **next forwarded delivery event after merge**; idle repositories wait. A reference UI edit alone does not immediately update consumers, and opening its PR does not publish the new contract. Sync compares the entire paginated listing before writing:

| Existing state | Operation |
| --- | --- |
| Current name exists | Update only its metadata if necessary; preserve/report old-name definitions |
| Current missing; exactly one previous name exists | PATCH the previous definition's URL with `new_name`, colour and description |
| Neither current nor previous exists | Create the current definition |
| Multiple previous definitions, or ambiguous case/normalization collision | Refuse rather than guess, duplicate or delete |

Renaming preserves the GitHub label id and existing issue/PR assignments. If old and new both exist, the new one wins, the old one is left alone and reported; assignments are not merged automatically. Report mode shows each planned rename and conflict with zero mutation. Sync never deletes definitions or directly modifies assignments. Removed manifest entries become unmanaged. GitHub write payloads contain only the endpoint's supported fields, not reference metadata/history. Permission/API failures remain visible warnings and summaries, independently of promotion, finalization and the Delivery check. No label job is a prerequisite of required delivery jobs.

Callers tracking `main` need no edit. Version-pinned callers must update the workflow reference and matching `tools_ref` to the same reviewed revision; `tools_ref` defaults to `main`. A workflow pin alone does not pin scripts: pin tooling to the same old revision until upgrading both together. A previous read-only snapshot found a1, crew, herdr-app, xrbuild and its private workspace tracking main with default tooling; MyWorkflows calls its local workflow. None of these six consumers needs an update for a moving-main rollout; this is not a maintained inventory.

## Scheduling and assignment-only events

The isolated, advisory `label-sync` job serializes definition synchronization in the repository-wide
`delivery-label-sync` group, with `cancel-in-progress: false` and `queue: max`. False alone protects running jobs
but GitHub's default single pending slot still cancels an older waiting job when a third request arrives.
The multi-pending queue prevents that misleading cancelled PR check during normal bursts while preserving
serialization. GitHub allows up to 100 pending jobs; overflow, explicit/manual cancellation and caller-level
whole-run cancellation remain limits. This is not a guarantee against every possible cancellation.
See [GitHub's concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Review-label **assignments** do not change source, implementation bodies, readiness or label definitions.
`pull_request`/`pull_request_target` actions `labeled` and `unlabeled` should not restart delivery or tests.
The delivery caller template and this repository's self-caller omit those actions. Shared finalization,
Delivery check and label-sync also skip them if a nonstandard caller forwards them; closed-event cleanup and
post-merge refresh keep their existing event guards. The separate reference workflow still receives repository
`label: [edited, created, deleted]` events, which concern definition changes rather than PR assignments.

A read-only audit found the label-triggered CI restart in both **timurproko/herdr-app/.github/workflows/tests.yml**
and **timurproko/crew/.github/workflows/tests.yml**. The exact proposed follow-up in each consumer is to change:

```yaml
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft, edited]
```

Remove only `labeled` and `unlabeled` from their existing lists; keep push/manual triggers, job readiness and
per-PR code-change supersession unchanged. Their inspected readiness and required-gate jobs do not depend on
labels. A job-level skip is too late: workflow-level concurrency can already cancel the previous CI run.
Neither consumer is edited by this shared change. There is no consumer test-workflow template here that could
update those files centrally; `templates/delivery-caller.yml` controls delivery only. Consumers using labels as
real test inputs must assess that policy separately; advisory review labels are not test inputs here.

This repository's test workflow uses GitHub's default PR actions (opened, synchronize, reopened), excluding
labels; the inspected a1 development-validation and xrbuild workspace CI triggers already omit them as well.
Moving-main callers receive the shared queue/guards after merge, but fixing the two consumer test subscriptions
requires the separate edits above. Historical cancelled checks are not rewritten or rerun by this change.

## Runner manifest API and crew contract

At each review operation, read and validate one manifest snapshot from the configured source repository (default `timurproko/MyWorkflows`). Discover `default_branch` with `GET /repos/{source}`, then fetch `GET /repos/{source}/contents/labels/base.json?ref=<URL-encoded-default-branch>` with `Accept: application/vnd.github.raw+json`. **Equivalent one-read form:** `GET /repos/{source}/contents/labels/base.json` without `ref`. Omitting `ref` resolves the default branch on GitHub. Do not assume `main` or use a stale pinned copy.

Default one-read URL: `https://api.github.com/repos/timurproko/MyWorkflows/contents/labels/base.json`. The current explicit-ref URL is `https://api.github.com/repos/timurproko/MyWorkflows/contents/labels/base.json?ref=main`. Require `version: 1`, all three stable keys, valid current names and `previousNames` arrays; tolerate additional reference metadata. Use one consistent snapshot within the operation, resolve by key and preserve unrelated labels.

A runner **MAY use built-in defaults on read/validation failure if it explicitly warns**. The warned fallback is Review/Approved/Rework with the exact initial emoji/space names and alias lists in the table above, not the pre-migration names as current names. Silent fallback is forbidden. It cannot discover arbitrary future UI names and may leave those assignments untouched until manifest access recovers; it is not successful synchronization. This runner availability policy never authorizes reference reconciliation or MyWorkflows sync/cleanup to substitute hard-coded display names.

Crew's separately implemented transport makes exactly one contents API read without `ref`, with a **two-second timeout**, and uses that warned fallback on failure. No separate repository-discovery read is required. No crew source is modified here; retain the lifecycle boundaries from **crew PR #7**:

- Resolve the implementation PR from the implementation report/current branch, not a `Plan:` report. Respect repository opt-out; use the runner's signed-in credential, not the delivery App key.
- At review start, add current `under-review` and remove both verdict keys' current/historical assignments **before launching the reviewer**, even for drafts or pending CI.
- On `APPROVE`, clear current/historical review-in-progress and opposite-verdict names, then add current `review-approved`; on `CHANGES NEEDED`, do the same and add current `review-changes-needed`. Verdicts are mutually exclusive.
- Failed launch/report, stop, finish, observed death or abandonment clears current/historical in-progress names without inventing a verdict. Complete old cleanup before replacement; retain one owner per PR or wait for that owner's last local reviewer to finish. Plain labels cannot coordinate overlapping independent controllers.
- Use ordinary `POST /repos/{owner}/{repo}/issues/{pr}/labels` with `{"labels":["<resolved current name>"]}` and `DELETE /repos/{owner}/{repo}/issues/{pr}/labels/{URL-encoded-resolved-name}`. Do not replace the whole label set or delete repository definitions. Repeated add is harmless; confirm access and absence before treating a remove-label 404 as success. Warn on permissions/API failures and use existing recovery.

Closed/merged cleanup removes all three managed roles' current/historical assignments, including both verdicts; it never preserves a verdict as a closed-PR record. A reopened PR has no robot review label until the next review sets one; removed assignments are not restored. Unrelated labels remain untouched. This closure policy supersedes older published runner text promising verdict persistence; open-PR review/verdict transitions above are unchanged.

All three labels are **advisory**, never required checks, readiness conditions or merge gates; absence is not approval. A retained verdict is not a promise that later commits were reviewed. No lease, heartbeat, dispatch protocol, state comment, timer, supervisor or cross-controller lock is added. There is **no time-based crash-expiry guarantee**: a lost machine can leave an open PR labeled until recovery or a person clears it.

## Closed-event fallback

The already forwarded `pull_request_target: closed` event resolves `under-review`, `review-approved` and `review-changes-needed` by stable key from one validated manifest snapshot and removes every current name and `previousNames` assignment on merged **and** unmerged closures. Both verdicts are removed even if unexpectedly present together. Unrelated labels survive. No verdict is added and no definition is deleted.

Cleanup validates repository/event/PR identity and current closure state, paginates assignments, and checks for reopen before **each** removal. After removals or a DELETE 404, cleanup rescans all three roles' current/historical names so a concurrent definition rename cannot masquerade as assignment absence. A DELETE 404 succeeds only after confirming access and that exact assignment's absence; continued assignment churn fails visibly rather than reporting success. A final-read/reopen race cannot be made atomic. Opt-out, missed events and failed APIs can prevent cleanup; warnings do not hide these limits. The event handler does not sweep historical PRs or replay herdr-app #14's old closure. Use the explicit manual recovery below for older closed PRs.

## Explicit manual closed-PR sweep

`delivery labels-sweep --repo owner/name` reports managed assignments on already-closed/merged pull requests in exactly one repository, **read-only by default**. Inspect the PR numbers and exact names in a fresh report, then obtain separate named-repository authorization before running `delivery labels-sweep --repo owner/name --apply`. Both `--repo owner/name` and `--repo=owner/name` work. There is no automatic invocation, schedule, dispatch or post-merge backfill, and implementation approval is not authorization to apply it. Do not run either mode as part of implementing this change.

The command uses the normal signed-in `gh` credential or `GH_TOKEN`, never the delivery App private key or a newly minted App token. It reads one local published manifest snapshot from the installed tooling, validates all three stable keys, and resolves only their current names and `previousNames`; update the tooling first if its palette is stale. Report mode remains read-only even when opted out. For local apply, an environment value `DELIVERY_LABELS_ENABLED=false` disables writes (case-insensitive, no trimming); the calling repository's variable continues to gate the automatic jobs and is not fetched by this local command. Separate authorization is required regardless of opt-out settings.

Discovery paginates `GET /repos/{owner}/{repo}/pulls?state=closed&per_page=100&page=N` and validates the complete list before any mutation; it never treats ordinary issues as PRs. Assignment reads are also paginated. Each PR is freshly re-read for identity and closed state, and apply shares the event cleanup's before-each-removal reopen check, whole-managed-set rescan, bounded retry, confirmed absence and DELETE-404 access checks. Open/reopened PRs are skipped, not relabeled; no definitions are created/deleted, no verdicts added, and unrelated assignments remain unchanged. Read/access/malformed-data and pagination-limit failures fail closed, not as empty results. Apply failures exit nonzero and identify the failed PR; earlier PRs may already have been cleaned, with no rollback. Inspect a fresh report before retrying.

GitHub has no atomic delete-if-still-closed operation: reopening between the final state read and DELETE remains possible, just as for event cleanup. Concurrent label/review changes may prevent confirmed cleanup and must fail visibly. Pagination is a bounded best-effort snapshot, not a frozen repository transaction; concurrent closures can require a fresh report and another separately authorized apply. Runners should not add new review labels to closed PRs. A reopened PR simply waits for its next review to set a label; no old verdict is restored.

## Permissions and optional default pruning

Sync and cleanup mint separate repository-scoped App tokens with existing **Pull requests write** permission, revoked after each job. GitHub labels endpoints accept that grant despite the `/issues/` namespace; **no added Issues permission** or caller permission change is needed. See [GitHub's label API permissions](https://docs.github.com/en/rest/issues/labels#create-a-label). The caller token is read-only diagnostic access, never a write fallback. Missing App rights/secrets, forbidden access and rate limits produce warnings, not delivery failures. Local diagnostics/manual apply use the signed-in `gh` credential or normal `GH_TOKEN`; never export the App private key. Private repositories require actual access.

`delivery labels --repo owner/name` emits the read-only palette diff; explicit `--apply` synchronizes definitions. `--prune-unused-defaults` instead reports default-label usage; `--apply --prune-unused-defaults` explicitly prunes eligible defaults instead of syncing. Every apply/prune needs separate named-repository authorization; implementation approval does not authorize live writes. Automatic jobs never invoke the pruner.

Pruning additionally needs visibility of both issues and PRs, including closed/merged work; unreadable usage fails closed. It recognizes only ten original GitHub defaults (`accessibility`, `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`) with unchanged metadata and the default marker. **Current, previous and accepted reference names of managed labels are excluded**, even if a future name matches an otherwise eligible GitHub default. Custom/modified/default-marker-free labels are preserved; missing defaults are not recreated. It paginates all-state usage, preflights every candidate before deletion, then freshly checks identity, metadata, marker and usage per candidate. Missing definitions are skipped; permission failures are not absence and failed deletes are not blindly retried.

**Deleting a label deletes its assignments everywhere.** GitHub has no atomic delete-if-unused operation. Obtain separate consent, inspect a fresh report and use a quiet maintenance window. Automatic preservation is the only zero-deletion-risk policy. The historical [base-label audit](plans/base-labels.md) counted 51 unused candidates but authorized none; a1's used bug/enhancement must remain.

## Repository identity validation

All label listing, sync, usage/pruning, manual sweep and closed-event cleanup share `validateRepository` in `scripts/repository-labels.mjs`. Both CLI repo flag forms work. Owners are 1–39 ASCII letters/digits or single separating hyphens, without leading/trailing/consecutive hyphens. Repository names are 1–100 ASCII letters/digits, hyphens, underscores or dots, except exactly `.` or `..`. Dotted/leading-dot names are accepted unchanged; slash extras, whitespace, URLs, percent escapes and query/fragment syntax are rejected, without trimming or stripping `.git`.

Other delivery/protection identity parsers were audited previously and already accept leading dots; tightening their broader owner/length rules is a separate follow-up, unchanged here. This label change does not alter consumer identity parsing, protection, caller events or workflow permission grants.

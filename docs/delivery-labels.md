# Delivery labels

## Palette, default-on policy and timing

`labels/base.json` is the only base-label definition. Its version-1 `labels` object is keyed by stable names; the first key is `under-review`. That entry exactly matches herdr-app's original label: `🤖 Under review`, color `840479`, empty description. The emoji is U+1F916 followed by one ordinary space, with no variation selector.

The existing reusable Delivery workflow has two independent, non-required jobs: base-label sync and closed-PR review-label cleanup. Both are **enabled by default**, without per-repository setup. The **calling repository's** Actions variable `DELIVERY_LABELS_ENABLED=false` explicitly opts out of both automatic writers. The comparison is case-insensitive, without whitespace trimming: `false`, `False` and `FALSE` disable writes, but ` false ` does not. Unset, empty, `true` and any other value remain enabled. Existing `true` settings keep working. No variable or App permission is changed automatically.

Unless opted out, the first forwarded delivery event after adoption syncs the palette. A changed central definition reaches each consumer on its next forwarded event, **not immediately while the repository is idle**. There is no inventory, central discovery/fan-out workflow, consumer schedule, new dispatch input or protection change.

Sync creates missing managed definitions and updates only their color/description in place. Assignments survive. Defaults and custom labels are preserved, and a definition removed from a later manifest becomes unmanaged, not deleted. A case/Unicode-normalization collision is reported rather than renaming a custom label silently.

Manual dry runs stay read-only even when opted out: the existing dispatch with `dry_run: true` reports the palette diff without writes, using no App token. Automatic opted-out events report the explicit opt-out and neither mint a label App token nor read label state. Errors appear as warnings and job summaries, independently of promotion, finalization and the Delivery check; a later event retries sync. No label job is a prerequisite of those jobs or a required merge check.

## Consumer adoption and version pins

Callers tracking `main` pick up the policy on their next forwarded delivery event after merge, with no variable or caller edit. Read-only checks for this change found that a1, crew, herdr-app, xrbuild and its private workspace all track `main` with default `tools_ref: main`; MyWorkflows uses its local default-branch workflow. None of these six consumers needs an update. This is a snapshot, not a maintained repository inventory.

Version-pinned callers must update both the workflow reference in `uses` and matching `tools_ref` to the same reviewed revision containing this policy. A workflow pin alone does not pin scripts: `tools_ref` defaults to `main`. Leaving an old workflow pin with that default can mix the old token-mint gate with the new runner policy, causing visible missing-token warnings instead of synchronization. To retain the old behavior, pin tooling to the same old revision until updating both references together. The input default is unchanged.

A repository that must not receive automatic label writes must set the explicit opt-out before adopting the updated workflow/tooling. This task does not set variables, apply labels or edit any consumer. Adoption enables future event-driven writes; it does not replay historical closures or force an immediate update in idle repositories.

## Identity and permissions

Both automatic writers mint their **own repository-scoped delivery App installation token** with **Pull requests write**, using the existing App id/key secrets. The token action revokes each token after the job. The existing finalization publisher and its token remain unchanged.

GitHub's label endpoints accept either Issues write **or** Pull requests write for App installation tokens. This applies to creating/updating repository labels and adding/removing PR labels, despite the `/issues/` endpoint namespace. Therefore the delivery App's existing Pull requests write grant suffices: **no added Issues permission or permission-acceptance step is required**. See the [GitHub labels API permission documentation](https://docs.github.com/en/rest/issues/labels#create-a-label).

The current caller `GITHUB_TOKEN` has Pull requests read and cannot do these writes. It is used only for an explicitly requested read-only manual diff; it is never a write fallback. Missing App secrets, a misconfigured installation, forbidden access or rate limits produce visible warnings and summaries, not promotion/finalization or required-check failures. The owner fixes the missing existing delivery capability or explicitly opts out; the tool does not request a broader PAT or change permissions itself.

Local diagnostics/manual application use the ordinary signed-in `gh` credential (or its normal `GH_TOKEN` override), not an exported App key. Fine-grained credentials need access to the target repository and the corresponding label read/write permission. Private repositories require actual private-repository access. Pruning additionally needs visibility of both issues and PRs so historical usage is not missed; inaccessible usage fails closed.

## Local report/apply and optional pruning

The `delivery labels` command requires `--repo owner/name` explicitly and emits JSON:

| Flags after `delivery labels --repo owner/name` | Behavior |
| --- | --- |
| None | Read-only base-label diff and preserved unmanaged names |
| `--apply` | Explicitly create/update the managed definitions, with the signed-in credential |
| `--prune-unused-defaults` | Read-only default-label usage report; does not sync the palette |
| `--apply --prune-unused-defaults` | Explicitly prune eligible defaults instead of syncing the palette |

The apply flag is a manual write authorization, not part of automatic rollout. A maintainer must authorize it separately for the named repository; approving implementation does not authorize it. No apply/prune command is run by this change, and automatic jobs never import or invoke the pruner.

Pruning recognizes only the ten known GitHub defaults (`accessibility`, `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`) with their original metadata and GitHub default marker. A custom label with the same name, a changed description/color, or an unreadable usage count is not permission to delete it. Missing defaults are not recreated.

The command paginates all-state issue/PR usage, including closed and merged work. It reads every candidate before deleting any, then freshly checks each candidate's identity, metadata, default marker and usage before deletion. Used labels are retained. A 404 for a definition removed since the report is skipped; permission failures are not disguised as absence. Failed deletions are not blindly retried.

**Deleting a label deletes its assignments everywhere.** GitHub has no atomic delete-if-unused operation, so a usage change between the final read and DELETE remains possible. Obtain separate consent for the repository, inspect a fresh report, and use a quiet maintenance window. Keeping all defaults is the only zero-deletion-risk policy and remains the automatic behavior.

The [approved plan's historical audit](plans/base-labels.md#5-defaults-preserve-automatically-prune-only-on-explicit-request) found 51 unused candidates, but authorized none. In particular, a1's used `bug` and `enhancement` classifications must remain. That snapshot is not a substitute for a fresh report.

## Direct review-runner contract (crew integration is separate)

A review runner owns the normal lifetime of the `under-review` manifest entry. The label is **advisory**, not an approval, required check, readiness condition or merge gate. The person may merge while it is present. Its absence does not establish that review happened or passed.

Unless the repository has explicitly opted out, once the base definition is available, whoever starts an agent review uses their signed-in GitHub credential to add/remove only `🤖 Under review`. Do not create or change review labels for an opted-out repository. Ordinary PR-label editing with `gh` or `gh-axi` is sufficient. The exact API is:

| Action | Request |
| --- | --- |
| Add | `POST /repos/{owner}/{repo}/issues/{pr}/labels` with `{"labels":["🤖 Under review"]}` |
| Remove | `DELETE /repos/{owner}/{repo}/issues/{pr}/labels/%F0%9F%A4%96%20Under%20review` |

Do not replace the whole label set or delete the repository definition. Repeated add is harmless; repeated remove succeeds when absence is confirmed. A 404 can also mean an inaccessible PR/repository, so check access/absence rather than treating every 404 as successful cleanup. Surface permission/network failures and retry through existing recovery; no dispatch, App key or review-specific API is needed.

The separate crew task must:

- Resolve the implementation PR from its worker's implementation report/current branch, not mistake a `Plan:` report for a final review target.
- Add the label when `crew review` starts, before launching the reviewer, including on a draft or pending-CI PR. Report add failure honestly and remove on launch failure.
- Remove on either report verdict (`APPROVE` or `CHANGES NEEDED`), malformed/failed reports, stop, finish, observed death and abandonment, using crew's existing Core/task lifecycle and recovery observations.
- Complete old cleanup before starting a replacement. Keep one owner per PR, or retain the label until that owner's last local reviewer ends. A plain label cannot coordinate overlapping independent controllers.
- Add fake-Core/GitHub tests for verdicts, launch/terminal failure, stop/finish/death, repeated operations and denied access. No live labels are necessary for those tests.

No crew source is modified in this repository. There are no leases, heartbeats, state comments, timers, supervisor processes or consumer sweeps. If an entire runner machine disappears, an open PR can retain its label until crew recovers or a person removes it. No time-based crash-expiry guarantee is made.

## Closed-event final fallback

On the **already forwarded** `pull_request_target: closed` event, `review-label-cleanup` removes the exact Under review assignment for either a merged or unmerged closure. It applies to any PR author/target branch, not only the default branch. It validates the event's repository and PR identity, checks current closure state, paginates assignments, then rechecks the PR before removal so a queued closure does not intentionally clear a newly reopened review. It preserves all other assignments and the definition. Missing assignment is an idempotent no-op; a DELETE 404 is successful only after confirming PR access and label absence.

The job is enabled by default with sync, respects the same explicit opt-out, has its own App token, has no dependency into promotion/finalization, and uses job-level failure isolation with explicit warnings. Normal successfully processed closures therefore cannot keep a stale Under review label even if crew never reported. Explicit opt-out, failed API calls or lost event delivery can still prevent cleanup; they are not hidden by a claim of absolute availability. A last-read/reopen race cannot be made atomic with the label API.

This does not scan historical PRs. Herdr-app #14 was already merged with the label before this feature; its old event is not replayed. A person may separately authorize direct removal of that old assignment after rollout. Nothing in this change clears it or reopens a PR.

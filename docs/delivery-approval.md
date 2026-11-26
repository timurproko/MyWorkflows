# Approval-bound delivery

## Default sequence

Every repository using Delivery waits for review approval before the bot promotes a draft. There is no opt-in
variable. Completion ticks mean implementation is written, not permission to run full CI or mark ready.

1. The worker implements on the draft, ticks outcomes as they land, builds and runs the project's full local
   suite once on the head handed off, pushes, and reports the commands/results and exact commit.
2. The reviewer checks out that pushed head, builds and runs the project's full local suite once, and records
   what was checked and the verdict. Too-early review requests are refused with a reason; crew wait owns waiting
   for completed outcomes, matching pushed heads and successful light draft checks. Those crew operations are
   a separate implementation, not part of this repository.
3. On approval covering the current head, the runner sets Approved immediately, without waiting for CI, and
   dispatches the approved SHA to Delivery. Review means an active review only. There is no intermediate
   approved/CI stage or chip; the PR's own checks show CI, and required checks still block merge.
4. The bot proves approval coverage, merges a stale base if clean, finalizes the linked OpenSpec change **on the
   draft**, pushes its archive/spec commit, and publishes `reviewedHead` and `finalizedHead` in Automation.
   Fresh branch/body/base/draft snapshot checks precede publication and readiness. Only then does it mark ready.
5. The ready-for-review event starts full CI on the final head. Consumers must keep heavy suites gated on ready
   PRs and exclude label actions and body-only `edited` from test triggers. Draft light checks remain useful;
   MyWorkflows' own tooling-test workflow deliberately tests draft changes too.

A plain PR (no linked OpenSpec change) follows the same approval and clean-base-merge rules, with no archive
commit and **no Automation section**. Its JSON result still identifies reviewed and final heads. The Delivery
check for a linked ready PR requires `finalizedHead` to equal that exact head; `reviewedHead` is audit metadata,
not a credential or a new required check. Ordinary events never authorize draft promotion from metadata/labels.

After an approved head fails CI, the fix stays on the ready PR. The worker builds/tests once on the repaired
head and pushes; that push runs CI. Crew reviews only the new commits (delta review), moves approval to the new
head on success, sets Approved immediately and may dispatch again. Do not convert to draft just to hide CI.
The bot continues existing ready-PR finalization and base refresh; it does not infer reviewer approval or set
review labels from test results. The label runner and dispatch integration in crew are separate work.

## Dispatch contract for crew and people

**External consumer workflow file:** `.github/workflows/delivery.yml`, copied from
`templates/delivery-caller.yml`. Dispatch that caller **on the repository's default branch**; do not assume its
name is main. The shared MyWorkflows `.github/workflows/delivery.yml` is a reusable `workflow_call`, not a direct
dispatch endpoint. **MyWorkflows itself dispatches `.github/workflows/self-delivery.yml`.**

| Input | Type | Contract |
| --- | --- | --- |
| `pr` | required string | Positive PR number in the calling repository |
| `approved_head` | optional string | Complete lowercase 40-hex SHA reviewed by the caller; required for a mutating draft promotion |
| `dry_run` | boolean, default `true` | Classification-only audit; use explicit `false` to publish |

The caller forwards all three inputs unchanged to the reusable workflow. Ready-PR reconciliation and read-only
audits may omit `approved_head`; omission never promotes a draft. Use the default-branch workflow definition,
not a PR-controlled ref. Typical dispatch (substitute actual values):

```bash
gh workflow run delivery.yml --ref <default-branch> -f pr=<number> -f approved_head=<full-reviewed-sha> -f dry_run=false
```

The REST equivalent is `POST /repos/{owner}/{repo}/actions/workflows/delivery.yml/dispatches` with
`{"ref":"<default-branch>","inputs":{"pr":"<number>","approved_head":"<full-reviewed-sha>","dry_run":"false"}}`.
For MyWorkflows substitute `self-delivery.yml`. Crew must use its signed-in credential with repository access
and Actions write/dispatch rights, not the delivery App private key. People with repository write access and
workflow-dispatch rights may assert approval themselves; no GitHub review submission or approval label is
required. The trusted workflow mints its own repository-scoped App credential for publication. Ordinary agents
must not self-approve or dispatch promotion on their own authority. Agents never mark ready or arm auto-merge.

### Head coverage and refusal

An exact approved head is accepted. Otherwise the approved SHA must occur on the head's first-parent chain
within 1,000 commits. Every subsequent first-parent commit must have **both** GitHub `author.login` and
`committer.login` equal to the configured delivery App login, and must be either:

- A single-parent `docs(openspec): finalize <change>` or `docs(openspec): refinalize <change>` commit changing
  only that change's active/archive paths and canonical `openspec/specs/` paths. Plain PRs have no archive exemption.
- A two-parent clean base merge whose second parent is an ancestor of the current base and whose tree exactly
  equals `git merge-tree --write-tree <parent1> <parent2>`. Human base history reached through that second parent
  is not delivery work and is not required to be App-authored.

Arbitrary bot commits, restore commits, another App, a human committer, hand-edited/conflicted merges, human
first-parent commits, divergent force pushes and unavailable/incomplete proof are not approval coverage. A new
non-bot commit needs delta review; divergence requires a full review. Body metadata cannot substitute for proof.
Approval-bound publication never introduces a restore commit: an archived draft with a conflicting base needs
repair and review. Legacy automatic ready-PR refresh can still restore/re-finalize, but those restore commits
are deliberately not exempt from subsequent approval checks.

### Result and waiting contract

GitHub's dispatch response only means **queued**, not promoted. After the run, inspect its conclusion, the
publication step's JSON output/job summary, and fresh PR state. Structured results include `number`, observed
`head`, requested `approvedHead` where supplied, `disposition` and a `reason` for refusal/wait/retry. Successful
publication includes `reviewedHead`, `finalizedHead`, `pushedHead`, `promoted`, commits and body-update status.

| Situation | Result |
| --- | --- |
| Complete draft on ordinary delivery event | `waiting`, `awaiting-approval`; success, no publication |
| Mutating draft dispatch without a SHA | `blocked`, `approval-head-required`; error annotation, nonzero run |
| Malformed SHA in a mutating approval dispatch | `blocked`, `approval-head-invalid`; error annotation, nonzero run |
| Head not covered by the requested approval | `blocked`, `approval-head-mismatch`; error annotation, nonzero run, no branch/body/readiness writes |
| Changed snapshot or target during publication | `retry`, reason naming the boundary; no readiness mutation on the changed snapshot |
| Successful draft publication | `promoted`, exact reviewed/final heads and commit list; fresh PR is ready |
| Dry run | Read-only classification, no App writer or branch/body/readiness/label writes; `would-reconcile` is explicitly not approval verification |

Invalid identities/content, missing permissions, conflicts, API errors or Git failures also fail closed, with a
named error in the log/summary. A dry plain PR is classified `skipped/unassociated`; that is not a promotion
verdict. Partial publication is possible: an archive push/body patch can succeed before another API fails.
Inspect current state before retrying the same approved SHA. Bot-only proof allows safe retries after archive,
body or readiness failure without duplicate finalization. A retry is not permission to promote a changed head;
new human work needs review. GitHub has no atomic compare-and-promote or compare-and-patch endpoint, so a push
between the final read and mutation remains a documented race; required exact-head checks still apply.

## A person working alone

No crew reviewer or crew installation is needed. Finish the draft outcomes and local suite, inspect the exact
pushed head, then open **Actions → Delivery → Run workflow** on the default branch, enter the PR number and that
SHA, and set dry run to false. That is the person's approval; the bot handles finalization and readiness.
Alternatively, the person may mark ready by hand and let existing ready-PR finalization run. Required checks
still gate merge. Agents do not use that manual-ready escape hatch.

## Migration for open drafts and existing callers

- Shared tooling tracking `main` gets default waiting after merge **without an opt-in**. Already-complete open
  drafts remain draft; old ticks, labels and Automation records are not grandfathered approval. Inspect the
  current head and dispatch its SHA, or have a person promote manually. There is no bulk promotion.
- Existing copied callers do **not** acquire new dispatch inputs automatically. Replace
  `.github/workflows/delivery.yml` with the current template, or add this dispatch input and forwarding line:

  ```yaml
  # on.workflow_dispatch.inputs:
  approved_head:
    description: Full SHA approved by a reviewer or person; required to promote a draft
    type: string
    required: false
  # jobs.delivery.with:
  approved_head: ${{ inputs.approved_head }}
  ```

  Keep existing `pr`, `dry_run`, secrets and label-free delivery triggers. Until that caller edit reaches the
  default branch, crew cannot dispatch the new input; a person can still promote manually. This task edits no
  consumers. Pinned consumers align the workflow reference and matching `tools_ref` when upgrading both.
- MyWorkflows' self-caller forwards the same input under `self-delivery.yml`; the reusable workflow file is not
  renamed or made directly dispatchable. Already-ready PRs stay ready and retain existing finalization/checks.
- The managed changes-needed role retains its stable key `review-changes-needed` and source id/node id, but its
  name becomes Build with Rework and Changes-needed aliases. Normal sync renames definitions in place on the
  next delivery event, preserving assignments; no live apply or historical sweep is part of implementation.
  [Label details](delivery-labels.md) cover collisions, opt-out and retained Approved records.

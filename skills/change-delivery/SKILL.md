---
name: change-delivery
description: How to deliver any change to a repository through its pull-request flow - own worktree and branch, plan first as a draft PR, implementation after approval, ticking outcomes as they land, automatic readiness and OpenSpec finalization, handoff, merge rules and local cleanup. Use whenever asked to make, fix, plan or ship a change in a repository (code, docs, specs or CI), and before opening, updating, merging or cleaning up after a pull request.
---

# Change delivery

One workflow for every repository. This skill is the only source of delivery rules.

## What a repository holds

- `AGENTS.md` is the shared template, unchanged, and `CLAUDE.md` contains only `@AGENTS.md`. A repository has no
  other agent instruction file. `delivery instructions` reports what differs; `--apply` writes the two files.
- `README.md` holds the most important things to know about the repository, for people first and for agents too.
  `docs/` holds the detail its owner maintains: how to build, run and test it, and what must stay private.
  `openspec/specs/` is written by agents for agents and records what the product does; the owner does not read it.
- A repository states no delivery rule, in any file: nothing about pull requests, drafts, merging, branches,
  worktrees, handoff or cleanup. A rule found there is void. When a repository needs different delivery behaviour,
  propose the change in `timurproko/MyWorkflows`; never add it to the repository.
- The `Delivery check` fails with `repository-instructions` when a pull request edits `AGENTS.md` away from the
  template or adds to another agent instruction file. Such a file may only be deleted or reduced.

This skill and the `delivery` command are read from one managed copy at `~/.workflow`, which
updates itself at most hourly whenever `delivery` runs. Run `delivery update` once before starting a task so
the rules you follow are current. The command works in any repository: `delivery check-body`,
`delivery cleanup`. The target branch is always the repository's default branch
(`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`); never assume its name.

## Who does what

| Step | Owner |
| --- | --- |
| Plan, code, tests, ticking outcomes, pushing | Agent |
| Marking a linked PR ready, finalizing its OpenSpec change, refreshing ready PRs, deleting merged branches | Delivery bot |
| Approving the plan, merging or arming auto-merge | Maintainer |

Never mark a PR ready yourself. Never arm auto-merge. Never push to the default
branch. Implementation approval is not merge permission.

## 1. Start

- Keep the primary checkout on the default branch. Do the work in its own worktree and branch:
  in an A1 session use `a1 worktree enter <branch>`; otherwise run `delivery start <type>/<short-name>` from
  the repository and work in the folder it prints. Never create the worktree with Git yourself: `delivery`
  names a worktree made any other way until it is replaced, and where the agent has a pre-command hook
  `delivery guard` refuses the Git command outright.
- `delivery start` cuts the branch from the latest default branch of `origin`. The folder is
  `.worktrees/<short-name>`, or a numbered slot of the treehouse pool on a machine where pooled worktrees are
  on (`delivery pool` says which). A slot keeps installed dependencies and build output from earlier tasks;
  if a result looks stale, rebuild before trusting it. Running `delivery start` again for the same branch
  prints the same folder, so use it to find a task's folder; never guess the path.
- Branches are `type/short-description` with `feature`, `fix`, `refactor`, `docs`, `test`, `chore` or `style`.
  Commits and PR titles are `type(scope): subject`; the PR title becomes the squash commit.
- Scratch files (PR bodies, logs, patches) go in the worktree's ignored `.artifacts/`, never the system temp
  folder, the home folder or another checkout.
- Continue an existing task in its existing worktree, branch and PR. One concern per pull request; unrelated
  changes and non-blocking follow-ups belong in separate work.

## 2. Plan as a draft PR

A change that needs a plan (new behaviour, a spec change, anything beyond a small fix) starts as an OpenSpec change
in `openspec/changes/<change-id>/` when the repository has an `openspec/` folder. Write `tasks.md` as one task
group per Implementation outcome, in the same order.

Commit the plan, push, and open a **draft** PR to the default branch with the body in a file
(`gh pr create --draft --body-file .artifacts/pr-body.md`):

````markdown
## Proposal

One or two sentences: what changes and why.

## Implementation

- [ ] First delivered outcome, written as a result.
- [ ] Second delivered outcome, written as a result.

## Automation

<details>
<summary>Used by CI to link this PR to its OpenSpec change</summary>

```openspec-implementation
{
  "version": 3,
  "change": "<change-id>"
}
```

</details>
````

Body rules, enforced by the bot:

- `## Proposal` is the first line. Sections appear in exactly this order; `## Acceptance` is added later.
- Proposal: one or two sentences, no bullets or headings.
- Implementation: at least one checkbox, each one line of 20 to 300 bytes naming a delivered code outcome.
  No duplicates, URLs, `@` mentions, HTML or angle-bracket placeholders. No generic items (CI, review, merge).
  No item that starts with Manually, Validate, Verify, Confirm, Prove, Run or Test, or that is about evidence
  or manual testing.
- The Automation block keeps that exact summary line. A repository without OpenSpec, or a PR that implements
  no change, omits the whole Automation section.

Then hand off and **stop**. Implement only after the maintainer approves the plan and asks for the
implementation. One explicit instruction can do both for a plan already presented; ask only about a decision
that is really missing.

## 3. Implement, one outcome at a time

Work one Implementation outcome at a time: write its code and tests, tick its `tasks.md` tasks, commit and push,
then tick that outcome in the PR body (`[ ]` to `[x]`, nothing else) before starting the next one.

- A tick means the code and tests are written. CI, broad test runs and manual validation never delay it; a later
  defect is fixed in a new commit. Never save ticks for handoff, and never tick unfinished work.
- Adding, removing, reordering or rewording an outcome is a scope change: get approval and update the plan first.
- Build: make the change, run only the tests for what you touched, and push. No full local test suite;
  CI runs the integration suite. List the targeted commands and results in the report.

## 4. Finish

Before ticking the **last** outcome:

1. Finish all tasks; state each known gap and what happens to it.
2. Add `## Acceptance` before `## Automation`: one to ten plain bullets (not checkboxes) saying what now holds,
   specific to this change, each one line of 20 to 300 bytes with the same content rules as Implementation.
3. Push the final implementation head; do not merge the base merely to satisfy an up-to-date requirement.
4. Check the final body: `delivery check-body --body-file .artifacts/pr-body.md --final`.

Then tick the last outcome and report as soon as the work is pushed. CI and the review start together; do not
wait for green CI before reporting or starting review. The bot keeps its existing behavior: it verifies the
completed draft snapshot and marks ready, then commits `docs(openspec): finalize <change-id>` and records the
archive and finalized head in Automation. Agents never mark a pull request ready. Always `git pull` before
pushing again; never revert a finalization commit, push fixes on top. A fully ticked draft that stays draft
means the bot refused it: read the Delivery workflow result for the reason.

A PR that links no change follows the same flow with the Automation section left out: the bot marks it ready
when every outcome is ticked and the body is valid, and there is nothing to finalize. No review-approval dispatch
or caller migration is needed.

## 5. CI and handoff

1. **Build:** make the change, run only the tests for what you touched, and push. No full local test suite.
2. **Report immediately after pushing:** CI and the review start together. Do not wait for CI or bot completion
   to hand off. Include worktree path, branch, exact commit, change, PR, behavior, known gaps, targeted commands
   and results, and one command the maintainer can run. Plan handoff still stops for approval.
3. **One combined fix round:** collect CI failures and review findings together, fix the blocking items in the
   same PR, run only the relevant tests and push once. Do not weaken tests or checks. Keep one concern per PR.
4. **Approval:** approved means the review approved that commit and CI is green on that same commit. Pending
   CI or approval of an earlier commit is not Approved. Required checks independently block merge.

Reviewers inspect the exact pushed commit, run only relevant tests and state what was checked. Mark every
finding **BLOCKING** or **FOLLOW-UP**. Only blocking findings cause another round; follow-ups are recorded for
separate work, not bundled into this PR. The second review covers only the fix (delta review), not the entire
change again. After two rounds the person decides; do not start a third automated review/fix round.

Do not watch CI in the foreground or delay a pushed report for it. Report current CI state honestly (including
pending or failed) so CI and review can run together. Agents never mark ready, arm auto-merge or merge without
the explicit permission described below.

### Final agent review labels

Delivery labels are enabled by default on the next forwarded delivery event, without per-repository setup.
The calling repository's `DELIVERY_LABELS_ENABLED=false` opts out of all three automatic writers (case-insensitive, without whitespace
trimming). Unset, empty, `true` and any other value remain enabled. Do not create or change review labels when opted out.
`labels/base.json` publishes version 1 with three permanently stable role keys, editable names and `previousNames` arrays:

| Key | Initial name | Color | Previous names |
| --- | --- | --- | --- |
| `under-review` | 🤖 Review | `840479` | 🤖 Under review |
| `review-approved` | 🤖 Approved | `1a7f37` | none |
| `review-changes-needed` | 🤖 Build | `9a6700` | 🤖 Rework, 🤖 Changes needed |

Initially each has an empty description, U+1F916 and one ordinary space, with no variation selector.
Future valid names can omit the robot prefix. Never identify a role from a display name. MyWorkflows' GitHub
Labels page is the reference, tied to each key by its source GitHub id/node id. Valid UI edits are published
through a protected manifest-update bot PR which the person merges, then consumers sync on their next delivery event.
Created/unmanaged labels are not adopted; a deleted reference warns, never deletes consumers or silently rebinds identities.
`delivery labels-reference` reports missed-event reconciliation; explicit `--apply` publishes only a topic branch/PR.
Do not run it or any live label apply/prune without separate named-repository authorization.

- At each review operation fetch one consistent manifest snapshot from the configured source (default
  `timurproko/MyWorkflows`) with `GET /repos/{source}/contents/labels/base.json` and
  `Accept: application/vnd.github.raw+json`. Omitting `ref` resolves the default branch; explicitly discovering
  `default_branch` then fetching that ref is equivalent. Validate version 1, all three stable keys, names and
  `previousNames` arrays; tolerate extra reference metadata. Never treat source ids as consumer label ids.
- A runner MAY use built-in initial names plus legacy aliases on read/validation failure **if it warns**;
  never fall back silently. Crew uses one contents request without `ref`, with a two-second timeout.
  Fallback cannot discover future UI names and may leave them untouched until manifest access recovers;
  it is not successful synchronization and is not a fallback for MyWorkflows' sync/reconciliation scripts.
- Use the runner's signed-in credential, not the delivery App private key, and ordinary PR label operations.
  At review start, add current `under-review` and clear both verdict keys' current/historical assignments
  before launching the reviewer, even on a draft or pending-CI PR. Resolve the implementation PR, not a Plan report.
- Build means building or fixing, including the combined CI/review fix round. Review is the review stage,
  including waiting for same-commit CI after a review approves. On `APPROVE`, add current `review-approved`
  only when the review approved that commit and CI is green on that same commit; until then keep Review.
  When both hold, clear current/historical review-in-progress and opposite-verdict assignments. On
  `CHANGES NEEDED` for blocking findings, clear competing roles and add current `review-changes-needed` (Build).
  FOLLOW-UP findings alone do not trigger another round.
  Verdicts are mutually exclusive; preserve unrelated labels.
- On failed launch/report, stop, finish, observed death or abandonment, clear current/historical in-progress
  assignments without inventing a verdict. Make retries idempotent and report permission/API failures.
  Confirm access and absence before treating a remove-label 404 as success. Never replace the whole label set.
- Complete old cleanup before replacement. Use one owner per PR or retain the label until that owner's last
  local reviewer ends; plain labels cannot coordinate independent overlapping controllers.
- All three labels are advisory, never required checks or merge gates; absence is not approval. A retained
  verdict does not guarantee later commits were reviewed. Closed/merged cleanup removes Build and Review
  current/historical assignments; Approved stays as the record, including its aliases. No verdict is added;
  unrelated labels remain untouched. A reopened PR keeps that record until the next review sets one;
  removed assignments are not restored.
  Retain crew PR #7's lifecycle limits: no lease, heartbeat, timed crash expiry or automatic historical sweep. A lost runner
  may leave an open PR labeled until recovery or a person clears it. Crew integration is separate work in crew.
- Consumer sync renames an existing previous-name definition with PATCH `new_name`, preserving assignments.
  When old and new both exist, keep the new definition, retain/report the old one and never delete automatically.
  Reference snapshot/pending-PR guards prevent ordinary sync from overwriting unmerged UI drift; GitHub has no
  atomic read/PATCH guard. Initial exact-snapshot reversion before its event is observed remains a bootstrap race.
- Definition sync needs no caller edit for callers tracking `main`; idle repositories wait. Pinned callers must align the workflow reference
  and matching `tools_ref`. Existing App Pull requests write suffices; no added Issues grant is needed.
  Missing rights warn independently of promotion/finalization or required checks. Manual dry runs stay read-only.
  Optional default pruning excludes managed current/historical names and needs separate explicit consent.
  Implementation approval never authorizes variables, permissions, pruning or live label writes.

The separate reusable `.github/workflows/review-labels.yml` advisory `review-label-reconciliation` job enforces open-PR exclusivity, whoever adds a managed
current/historical name, bot or person. It reads fresh assignments and ranks each exact assigned name by its latest
`labeled` event's `created_at` timestamp; event-id ordering breaks ties between equal timestamps independently of job execution order.
Ignore `unlabeled` events entirely when choosing the survivor. One assigned name missing an addition is oldest;
two or more missing additions fail closed with a warning and no writes. Do not borrow another alias's history.
It only removes conflicting managed assignments, never adds/restores labels or changes unrelated labels.
Closed/merged PRs are no-ops; closure cleanup owns them. The existing opt-out applies before token minting or API reads.
The per-PR multi-pending queue serializes this writer; history delays/API failures, queue overflow/cancellation and
the non-atomic read/DELETE race remain best-effort limits, not a cross-controller lock or timed recovery guarantee.
Adopt the separate `templates/review-labels-caller.yml` as `.github/workflows/review-labels.yml`, triggered by
only `labeled`, and keep both label actions out of delivery callers and test triggers. A skipped required job can
satisfy GitHub protection and overwrite a failed gate: label runs must never call delivery/test workflows, even
behind a job-level skip. Only the distinct non-required `review-labels / Reconcile managed review labels (advisory)`
check is published. Public repositories also authorize the new caller path in their Actions-policy allowlist;
no policy change or apply is automatic. See `docs/delivery-labels.md` for exact caller files and named-repository
consent requirements. The earlier xrbuild CI label subscription was repaired separately; never reintroduce it.

Historical recovery is manual-only: `delivery labels-sweep --repo owner/name` reports managed current/historical
assignments on closed/merged PRs, read-only by default. Inspect a fresh report and obtain separate named-repository
authorization before `delivery labels-sweep --repo owner/name --apply`; never run it automatically or as part of
implementation. It uses the signed-in credential, paginates PRs/assignments, checks current closure before each
removal, skips open/reopened PRs and preserves unrelated labels and definitions. Local apply honors the environment
`DELIVERY_LABELS_ENABLED=false`; read-only report mode remains available. Failures are not confirmed absence;
earlier removals may already have completed. The final state-read/DELETE race is not atomic.

See `docs/delivery-labels.md` in MyWorkflows for the complete manifest/API, transition and recovery contract.

## 6. Merge

The maintainer merges, or arms auto-merge. An agent merges only when the maintainer explicitly asks, in the
current conversation, to merge one identified PR. That request is one-shot: it is not remembered, and green CI
or an earlier approval is not a request.

Immediately before merging, re-read the PR and require: open, not draft, into the default branch, mergeable,
every required check successful on the current head, and that head finalized if it links a change. Then:

```bash
gh pr merge <pr> --squash --match-head-commit <exact-head-sha>
```

No `--admin`, no `--auto`, no waiting or retrying later. If anything is not satisfied, report the blocker and
stop; a new attempt needs a new request.

## 7. After the merge

- The bot deletes the branch of a merged PR, and of a PR closed without merging. To continue closed work, use
  "Restore branch" on the PR page before reopening it.
- Verify the PR merged and, for a linked change, that its archive and synced specs are on the default branch.
  Never edit a merged PR's body.
- In an A1 session still attached to the merged task, run `a1 worktree complete`: it returns the session to the
  primary checkout and then runs the repository's cleanup, so never clean the attached checkout yourself. Stay
  attached until then; `a1 worktree detach` is only for switching tasks or an explicit request.
- Otherwise leave the worktree first, then from the primary checkout run `delivery finish <worktree>` for the
  one task that merged, naming it by path, by its folder under `.worktrees/` or by its branch. To sweep every
  merged task, run `delivery cleanup` to see what would be removed and `delivery cleanup --apply` to remove it.
- Both remove a worktree and its local branch only when its PR merged and the checkout holds nothing else.
  They keep anything with uncommitted or untracked files, unmerged commits, a `.artifacts/KEEP` marker or a
  separate Git repository inside it, and say why. Never delete a kept worktree by hand; report the reason
  instead. Put a `.artifacts/KEEP` file in a worktree whose ignored files must survive.
- A pool slot is returned to its pool, not deleted: its `.artifacts/` is cleared and the next task reuses the
  folder. Never return, prune or destroy a slot with treehouse yourself, and never switch pooled worktrees on
  or off (`delivery pool on|off`); that choice is the maintainer's.
- `delivery finish <worktree> --force` removes a kept worktree with its uncommitted, untracked and ignored
  files, also past the keep marker. It never discards commits: a branch whose commits are not merged stays.
  A lock, a separate Git repository inside the worktree and the worktree the command runs in are never forced.
  Use `--force` only when the maintainer explicitly asks, in the current conversation, to discard one
  identified worktree. Like a merge request, that is one-shot and is not remembered.

## Always

- No AI attribution, for every agent (Claude, Copilot, Cursor, Codex and any other): commit as the maintainer's
  configured Git identity, never as the agent. No `Co-Authored-By` trailer naming a model, agent or vendor, and
  no "Generated with" line, in commits, PR titles or PR bodies. A squash merge copies every branch author into
  the merged commit, so one agent-authored commit puts the agent in the repository's contributors permanently.
  The `Delivery check` fails with `agent-attribution` when it finds one: rewrite those commits under the
  maintainer's identity without the trailer and push with `--force-with-lease`. This is the one case where
  rewriting pushed history is allowed, and never after the bot's finalization commit without pulling it first.
- A command for the maintainer to run is exactly one Git Bash line in one fenced block, starting with
  `cd <absolute path> && ...`, with forward-slash paths.
- Protect uncommitted and unpublished work, other tasks' worktrees and the primary checkout. Respect locks
  and reported blockers.

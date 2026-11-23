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
- Continue an existing task in its existing worktree, branch and PR. One task, one PR.

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
- Before pushing, run only quick targeted checks of what changed. Do not loop broad local suites; CI on the
  final head is the integration gate.

## 4. Finish

Before ticking the **last** outcome:

1. Finish all tasks; state each known gap and what happens to it.
2. Add `## Acceptance` before `## Automation`: one to ten plain bullets (not checkboxes) saying what now holds,
   specific to this change, each one line of 20 to 300 bytes with the same content rules as Implementation.
3. Bring the branch up to date with the default branch and push.
4. Check the final body: `delivery check-body --body-file .artifacts/pr-body.md --final`.

Then tick the last outcome. That ends the agent's part. The bot verifies the exact snapshot and marks the PR
ready, then commits `docs(openspec): finalize <change-id>` to the branch and records the archive in the
Automation block. Always `git pull` before pushing again; never revert a finalization commit, push fixes on top.
A fully ticked draft that stays draft means the bot refused it: read the `Delivery` workflow run for the reason.

A PR that links no change follows the same steps with the Automation section left out: the bot marks it ready
when every outcome is ticked and the body is valid, and there is nothing to finalize.

## 5. CI and handoff

- Drafts run no test suites. The ready, finalized head gets the repository's tests plus the `Delivery check`.
- Do not watch CI in the foreground. Read its current result, report it, and repair failures in the same PR
  without weakening a test or a check.
- Hand off after pushing a plan, after CI is green, and after any repair push: worktree path, branch, commit,
  change, PR, behaviour, known gaps, and one command the maintainer can run. Say when nothing is runnable.

### Final agent review labels

Delivery labels are enabled by default: the next forwarded delivery event syncs the base palette without
per-repository setup. The calling repository's `DELIVERY_LABELS_ENABLED=false` is the explicit opt-out for both
automatic writers (case-insensitive, without whitespace trimming). Unset, empty, `true` and any other value
remain enabled. Do not create or change review labels for an opted-out repository. Once the base palette is
available, whoever runs the agent review owns the `under-review` entry in the shared `labels/base.json`
(GitHub name `🤖 Under review`). Use the review runner's signed-in credential, not the delivery App private
key, and plain PR add-label/remove-label operations; no lease, heartbeat or dispatch protocol exists.

- Add the label when the review starts, before launching the reviewer, even if the PR is draft or CI is pending.
- Remove it on either verdict, `APPROVE` or `CHANGES NEEDED`, and on failed launch/report, stop, finish, observed
  death or abandonment. Make retries idempotent, preserve all other labels and report permission/API failures.
  Confirm access and absence before treating a remove-label 404 as success.
- Complete old cleanup before replacing a reviewer. Use one owner per PR, or retain the label until that owner's
  last local reviewer ends; plain labels cannot coordinate independent overlapping controllers.
- The label is advisory: never make it a required check or merge gate, and never interpret absence as approval.
  Unless opted out, the shared workflow clears it on successfully processed closed/merged PR events. It does not
  observe crew reports, guarantee timed crash expiry, or sweep historical PRs. A lost runner leaves an open PR
  labeled until existing recovery or a person clears it. Crew hooks are a separate integration task.
- Callers tracking `main` need no edit; idle repositories wait for their next delivery event. Version-pinned
  callers must update both the workflow reference and matching `tools_ref` to a revision containing this policy;
  a workflow pin alone leaves scripts on the existing `tools_ref` default of `main` unless explicitly aligned.
- The isolated label jobs use existing App Pull requests write permission; missing rights produce visible
  warnings, not promotion/finalization or required-check failures. Manual dry runs stay read-only even when
  opted out. Sync never deletes labels; optional default-label pruning remains a separate explicit manual
  command and maintainer decision. Implementation approval does not authorize setting variables, applying
  permissions, pruning or other live label writes.

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

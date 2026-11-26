# MyWorkflows

One implementation of the agent change-delivery workflow, shared by every repository that adopts it.
A repository keeps its code and specs; the workflow lives here and is updated here.

## The workflow

1. An agent opens a **draft** pull request whose body has `## Proposal`, `## Implementation` (checkboxes),
   later `## Acceptance`, and an `## Automation` block linking the OpenSpec change.
2. The agent ticks each Implementation checkbox as that outcome is written and pushed.
3. The worker builds/tests locally once on the pushed handoff head; the draft waits for approval by default.
   The reviewer checks out that head, builds/tests the full local suite once and reports commands/results.
4. After approval, a trusted writer dispatches the reviewed SHA. The bot merges the base if clean, finalizes
   the linked change on the draft, records reviewed/finalized heads, and only then marks ready.
5. The repository's own CI confirms the final head. Approved is set immediately on review approval, independently
   of CI; required checks still block merge. The maintainer merges, or arms auto-merge.
6. After a merge, the bot deletes the merged branch and brings other ready PRs up to date.

Agents never mark a PR ready and never arm auto-merge. An agent merges one PR only on an explicit request
for that PR, and only with green CI on its current head. Ticking all outcomes no longer promotes a draft.
A person working alone can approve by dispatching the exact head in Actions, without crew, or manually mark ready.
See [approval dispatch, response reasons and migration for open drafts](docs/delivery-approval.md).

## Ready pull-request refresh

After a merge, the shared job refreshes stale, ready PRs with same-repository heads against the delivery target,
using the observed head SHA so a concurrent push cannot be overwritten. Drafts, closed PRs and forks are excluded.
Dependabot-authored PRs are also excluded: Dependabot owns rebasing its branches. This is an author policy,
not a title filter; other bot-authored PRs, including reference-label reconciliation, remain eligible.
Recognized update permission refusals (including workflow changes the App cannot write) are skipped with a warning
naming the repository, PR and GitHub reason; independent PRs are still refreshed. Unknown errors, rate limits,
invalid credentials and denied reads remain failures. The App's permissions are not expanded and no fallback
token is used. Consumers tracking the shared workflow and tooling at `main` receive this behavior without caller
edits after merge.

## Adopting it in a repository

1. Install the delivery bot (GitHub App) on the repository. Store its App id as the Actions variable `DELIVERY_BOT_APP_ID` and its private key as the secret `DELIVERY_BOT_PRIVATE_KEY`; every repository uses these two names.
2. Copy `templates/delivery-caller.yml` to `.github/workflows/delivery.yml`, unchanged. For advisory review-label
   exclusivity, also copy `templates/review-labels-caller.yml` to `.github/workflows/review-labels.yml`; never add label events to delivery or test callers.
3. Name your CI gate `CI required`, then run `delivery protect --repo <owner/name>` to inspect protection.
   Use `--apply` to install missing protection: the default branch requires `CI required` and
   `delivery / Delivery check`, squash merges only, and linear history. No repository registration or file is needed.
4. Run `delivery instructions --apply` to write `AGENTS.md` (the shared template) and `CLAUDE.md` (`@AGENTS.md`).
   Move anything else agents were told into `docs/` and delete the old instruction files.
5. Copy `templates/workflow-bootstrap.mjs` to `scripts/workflow-bootstrap.mjs` and run it from the package manager's
   `prepare` script (`node scripts/workflow-bootstrap.mjs`), and from a Git `pre-push` hook if the repository has
   hooks. Any agent that installs dependencies or pushes then gets the shared workflow on a machine that lacks it,
   and a current copy on one that has it. It does nothing on CI runners and never fails the command that runs it.

The target branch is the repository's default branch. Only repositories that need different protection add the
optional override described below.

## Base labels and agent review

`labels/base.json` publishes three permanently stable role keys and their editable names/history:

| Key | Initial name | Color | Previous names |
| --- | --- | --- | --- |
| `under-review` | 🤖 Review | `840479` | 🤖 Under review |
| `review-approved` | 🤖 Approved | `1a7f37` | none |
| `review-changes-needed` | 🤖 Build | `9a6700` | 🤖 Rework, 🤖 Changes needed |

Initially each has an empty description; names start with U+1F916 and one ordinary space, without a variation selector.
The reference is these managed labels on **MyWorkflows' GitHub Labels page**, bound by GitHub id/node id.
UI edits create a validated manifest-update bot PR; the person merges it through normal protection.
Created/unmanaged labels are not adopted and deleting a reference never deletes consumers. Future valid names
may omit the robot prefix. `delivery labels-reference` reports missed-event reconciliation;
`--apply` publishes a topic PR only, never writes labels or main.

Sync, open-PR exclusivity and closed-PR cleanup are **enabled by default**. The consumer's `DELIVERY_LABELS_ENABLED=false` opts out
(case-insensitive, without whitespace trimming). Unset, empty, `true` and any other value remain enabled.
After the reference PR merges, each consumer syncs on its next delivery event; idle repositories wait.
Renames use `previousNames` and PATCH `new_name` to preserve existing assignments. When old and new both exist,
keep the new one, preserve/report the old one and never delete automatically. Reference sync guards unmerged UI drift.
Definition sync needs no caller edit for callers tracking `main`; pinned callers must align the workflow reference and matching `tools_ref`.
Open-PR exclusivity requires its separate label-only caller as described below.
Manual dry runs stay read-only even when opted out; optional default pruning needs separate explicit consent
and excludes managed current/historical names.

Runners read the version-1 manifest by stable key at each operation from
`GET /repos/timurproko/MyWorkflows/contents/labels/base.json` with `Accept: application/vnd.github.raw+json`.
Omitting `ref` resolves the default branch; explicit discovery is equivalent. A configurable source is allowed.
Warned fallback to the initial names and legacy aliases is allowed on read/validation failure, never silently;
crew uses one request with a two-second timeout. Crew implementation remains a separate task, retaining crew PR #7's limits.
At review start, add current `under-review` and clear both verdict keys' current/historical assignments before launching the reviewer.
On `APPROVE` use current `review-approved` immediately when approval covers the current head, without waiting for CI;
on `CHANGES NEEDED` use current `review-changes-needed` (Build), clearing review/other-verdict aliases.
Verdicts are mutually exclusive. Failed launch/report, stop, finish, observed death or abandonment clears only
in-progress names without inventing a verdict. Closed/merged cleanup removes Build and Review
current/historical assignments; Approved stays as the record, including its aliases. Unrelated labels are preserved.
A reopened PR keeps that record until the next review sets one; cleanup never restores removed assignments.
Build means building/fixing, including after review or CI failure; Review means an active review; Approved means
approval covers the current head. There is no intermediate approved/CI stage; GitHub checks show CI separately.
All three labels are advisory; absence is not approval, and a retained verdict does not guarantee later commits were reviewed.
The runner uses its signed-in credential; no heartbeat, lease or timed crash-expiry guarantee is added.
Existing App Pull requests write permission suffices; no added Issues grant or caller permission change is needed.
Label jobs remain isolated from promotion/finalization and required checks, with visible warnings on failure.
Definition sync uses a repository-wide multi-pending queue, not cancellation of waiting PR checks.
Open-PR additions run only `review-label-reconciliation` in the separate `.github/workflows/review-labels.yml`
reusable workflow, publishing `review-labels / Reconcile managed review labels (advisory)`, never a required check.
Delivery callers do not subscribe to label events: even a skipped required job can overwrite a failed gate.
It ranks each currently assigned managed name by its latest exact-name `labeled` event's `created_at` timestamp,
with event-id ordering for equal timestamps, regardless of bot or person; current/historical aliases participate equally.
`unlabeled` events never rank survivors. One missing addition is oldest; two or more missing additions warn without writes.
Closed/merged PRs are no-ops for this writer. Per-PR serialization uses a multi-pending queue, while fresh history
prevents an older queued event winning. API failures, history delays, queue cancellation and the non-atomic
read/DELETE race remain best-effort limits; no labels are added or restored.
Add the separate tiny caller from `templates/review-labels-caller.yml`, triggered by only `labeled`; keep both label
actions out of delivery and test triggers. The [exact seven-consumer caller files and policy/test audit](docs/delivery-labels.md#scheduling-and-assignment-only-events)
include required Actions-policy allowlisting and the historical xrbuild label-triggered CI issue, repaired separately.
Keep label additions/removals and body-only edits out of test triggers.
Older closed PRs are not swept automatically. `delivery labels-sweep --repo owner/name` is an explicit,
read-only report; `--apply` removes only managed assignments on still-closed PRs, with pagination and reopen
checks. Obtain separate named-repository authorization and inspect a fresh report before applying; the command
uses the signed-in credential and never changes definitions or open PRs. See [manual recovery, reference
updates, transition/race limits and the exact runner contract](docs/delivery-labels.md).

## Local setup, once per machine

```bash
git clone https://github.com/timurproko/MyWorkflows.git ~/.workflow && node ~/.workflow/bin/delivery.mjs install
```

Every agent and command on the machine reads the workflow from that one managed copy, `~/.workflow`.
`delivery install` links its skills into `~/.claude/skills` and `~/.agents/skills` and puts its `delivery` command on
the path, turns Claude Code commit and pull-request attribution off in `~/.claude/settings.json`, and registers
the worktree guard there as a hook (see below). The copy fast-forwards itself at most once an hour whenever `delivery` runs, and `delivery update` does it
immediately, so nobody pulls by hand. A failed update (offline, no access) is reported in one line and never
blocks a command.

A separate clone is only for developing the workflow. `delivery install --dev` from such a clone links that clone
instead; run `delivery install` again to return to the managed copy.

| Command | Purpose |
| --- | --- |
| `delivery check-body --body-file <path> --final` | Validate a pull-request body with the rules the bot applies |
| `delivery labels --repo <owner/name>` | Read-only base-label diff; explicit `--apply` syncs definitions; `--prune-unused-defaults` instead reports defaults eligible for separately authorized pruning |
| `delivery labels-sweep --repo <owner/name> [--apply]` | Report managed assignments on closed/merged PRs; explicit apply removes them with fresh closure checks, never automatically |
| `delivery labels-reference [--apply]` | Read-only reconciliation from MyWorkflows' live reference labels; explicit apply publishes a protected manifest PR, never writes labels |
| `delivery start <type>/<short-name>` | Start, or return to, one task's checkout and print its folder: `.worktrees/<short-name>`, or a pool slot when pooled worktrees are on |
| `delivery cleanup` | List merged, clean worktrees that can be removed; `--apply` removes them, and returns pool slots to their pool |
| `delivery finish <worktree>` | Remove one task's worktree and its merged branch; `--force` also discards its uncommitted files, never unmerged commits |
| `delivery pool` | Say whether this machine uses pooled worktrees; `delivery pool on` and `delivery pool off` set it |
| `delivery guard` | Refuse, with exit code 2, a shell command that creates a worktree with Git; run by an agent's pre-command hook |

Pooled worktrees need [treehouse](https://github.com/kunchenguid/treehouse) on the machine. Installing it turns them
on; `~/.workflow/settings.local.json` (`"pooledWorktrees": false`, a file Git ignores) turns them off without uninstalling. A pooled
task works in a numbered slot that keeps its installed dependencies and build output for the next task.

A task's checkout comes only from `delivery start`. Two things hold agents to that:

- **The report.** `delivery start`, `delivery cleanup` and `delivery bootstrap` name every worktree of the
  repository that is neither under `.worktrees/` nor a pool slot, with the commands that replace it. Nothing is
  moved or removed unasked. This reaches every agent, after the fact.
- **The guard.** `delivery guard` refuses a shell command that runs `git worktree add`, before it runs. It takes
  the command as its arguments, or as a hook's JSON on standard input (`tool_input.command`), prints the reason
  and exits with 2; anything it does not recognise, or cannot read, it lets through. `delivery install` and
  `delivery bootstrap` register it for Claude Code as a `PreToolUse` hook on its shell tools in
  `~/.claude/settings.json`. Any other agent that can run a command before each shell call is wired the same
  way: have that hook run `delivery guard`, hand it the command, and treat exit code 2 as a refusal. An agent
  without such a hook is covered by the report only.
| `delivery install` | Download or update the managed copy and link its skill and command |
| `delivery update` | Fast-forward the managed copy now |
| `delivery openspec <arguments>` | Run OpenSpec at the version this repository pins |
| `delivery instructions` | Report agent instruction files that differ from `templates/AGENTS.md`; `--apply` writes `AGENTS.md` and `CLAUDE.md` |
| `delivery bootstrap` | What a repository's bootstrap file runs: download if missing, update hourly, relink only what is absent; silent when nothing changes and never fails |
| `delivery protect --repo <owner/name>` | Compare live protection with defaults or the repository's override; `--apply` installs missing protection, and existing changes also need `--allow-rule-changes` |

## The OpenSpec version

`package.json` here pins the one OpenSpec version. The delivery bot finalizes with it, `delivery openspec` runs it
locally, and a repository's CI runs it through the `actions/openspec` action
(`uses: timurproko/MyWorkflows/actions/openspec@main`), so no repository pins a version of its own. Dependabot opens a
pull request here when a newer version is published; this repository's tests run against it, and merging it updates
the bot, every machine and every repository's CI at once.

The OpenSpec skills agents use (propose, apply, explore, update) come from the same version. Each machine generates
them with OpenSpec itself into the managed copy's ignored `.generated/` folder and links them next to
`change-delivery`, and generates them again the first time it runs after the pinned version changes. No repository
carries a copy. The skills that archive a change or synchronize specifications by hand are withheld, because the
delivery bot does both.

## Branch and tag protection

`delivery protect --repo <owner/name>` works for any repository without an entry in this project. Its built-in
policy requires `CI required` and `delivery / Delivery check` on the actual default branch, with strict/up-to-date
checks, pull requests, resolved review threads, squash merges only, linear history, no deletion or force push,
and repository-admin bypass for pull requests only. The default `allow-delivery-events` Actions policy permits
`.github/workflows/delivery.yml` on exactly `pull_request_target` and `workflow_dispatch`. Public consumers adopting
optional label exclusivity must also declare/authorize the separate review-labels caller path, as documented in
[the rollout notes](docs/delivery-labels.md#exact-caller-rollout-and-test-workflow-audit); no policy is applied automatically.

### Optional repository override

Only a repository that differs adds `.github/protection.json` to its own default branch. The file is a JSON
array of declarations: the same shape as an entry in the former inventory, but without an `owner/name` key.
A present file replaces the whole default array; fields and arrays are not merged with defaults. Include exactly
one `default-branch` and one `workflow-events`, plus any extra branch or release-tag declarations. Omitted
`mergeMethods` means squash only; omitted `linearHistory` means false; omitted `checks` means no additional CI
checks, and the delivery check remains unless `delivery` is false. See [this repository's override](.github/protection.json)
and the [exact a1 migration file](docs/protection-migration.md).

The command reads the file from GitHub, pinned to the resolved default-branch commit, and reports the source and
commit. Local files and unmerged branches are deliberately ignored, so running from another checkout cannot
change the policy for `--repo`. Only a missing file selects defaults; malformed JSON, invalid declarations and
API errors fail closed. Supported fields are:

| Kind | Ruleset name | What it enforces |
| --- | --- | --- |
| `default-branch` | `protect-<default branch>` | No deletion or force push, pull request required, the repository's test checks plus `delivery / Delivery check`, branch up to date, and the repository admin may bypass for pull requests only. Options: `checks`, `mergeMethods`, `linearHistory`, `delivery: false` until the repository calls the shared workflow. |
| `branch` | `protect-<branch>` | No deletion or force push, for a branch only automation advances. Required field: `branch`. |
| `release-tags` | `protect-release-tags` | No deletion or movement of tags except by the release Apps. Options: `pattern` (default `v*`), `bypassApps` (numeric App IDs). |
| `workflow-events` | Actions policy `allow-delivery-events` | A public repository runs `pull_request_target` only where a policy allows it. Required arrays: `workflows` (paths in `.github/workflows/`) and `events`. |

### Applying safely

Report mode never writes. It exits nonzero when existing managed protection differs, displays those differences
as blocked, and asks you to add or correct the override rather than silently replacing live rules with defaults.
Merge the override before running the command again.

`--apply` alone can create missing protection and is a no-op when everything matches. Any change to an existing
managed ruleset or Actions policy requires `--apply --allow-rule-changes`; use that combination only for a
deliberate policy change, not to work around a missing override. The complete comparison, including classic
protection reads, finishes before the first write. A conflict blocks all writes without explicit consent.

With consent, an existing ruleset governing the same refs is updated in place, retaining required-check App pins.
Classic branch-protection deletion also requires consent and a fresh read confirming the matching ruleset is
active. Unmanaged rulesets and Actions policies are reported and left alone. The migration's
[ordering](docs/protection-migration.md) preserves existing protection while a1 adds its separate override.

GitHub offers rulesets on a private repository only on a paid plan. The private xrbuild workspace can run the
same delivery workflow and checks without rulesets, but they advise without blocking a merge; this command
does not bypass GitHub's plan or permission restrictions.

## Layout

- `scripts/` - the automation, imported from `timurproko/a1` and made repository-independent.
- `.github/workflows/delivery.yml` - the reusable workflow callers use: finalize on draft then promote on approval, delivery check,
  ready-PR refresh, merged-branch deletion.
- `skills/change-delivery/` - the one agent skill for every repository.
- `bin/delivery.mjs` - the local command.
- `templates/` - files a repository copies when it adopts the workflow.
- `labels/base.json` - the shared palette; [label behavior and rollout](docs/delivery-labels.md).
- `test/` - `npm test`.

## Status

In use by `timurproko/a1`, `timurproko/crew`, `timurproko/herdr-app` (scaffold only; source import pending),
`timurproko/xrbuild`, its private workspace repository, and this repository itself
(`.github/workflows/self-delivery.yml`, the caller template with a local `uses` line and dispatch filename), so a change to the shared
automation is exercised by the next pull request here. Covered: promotion and
finalization, the delivery check, ready-PR refresh, merged-branch deletion, plain delivery without OpenSpec, the
shared skill, local worktree cleanup and the machine bootstrap.
A repository without OpenSpec gets the same flow: its pull requests leave out the Automation section.
Base-label sync and closed-PR review-label cleanup are enabled by default with an explicit opt-out;
review-runner hooks in crew are separate work, not implemented here.

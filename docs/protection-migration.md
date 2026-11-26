# Protection override migration

There is no central repository inventory. The shared default-branch ruleset builder now uses
`strict_required_status_checks_policy: false`, for built-in defaults and repository overrides alike. Required
checks (`CI required` and `delivery / Delivery check`, or a repository's declared equivalent) still gate every
merge. With several agents working in one repository, the strict rule sent every open pull request back through
a base merge and a full CI run after each merge. Non-strict checks avoid that requirement, but two changes can
pass separately and break together. Configured default-branch push CI detects integration failures after merge;
it does not prevent them.

The coordinator already changed crew, xrbuild and herdr-app's live strict flags to false and kept backups. This
change does not apply anything live; the tool will no longer try to restore strict mode there. Other repositories
with strict managed default-branch checks change on their next explicit protection apply. Read a fresh report
first with `delivery protect --repo owner/name`; a nonzero drift report is not an instruction to bypass it blindly.
After merging/updating the tooling and inspecting all reported differences, a person may apply the intended
change with `delivery protect --repo owner/name --apply --allow-rule-changes`. This command may apply every
reported managed-policy difference, not only strictness; unrelated drift needs its own decision. No protection
apply is part of this PR. The task report records the read-only affected-repository audit.

MyWorkflows retains its `Delivery tooling tests` gate, self-delivery workflow and existing lack of a linear-history
requirement. Required-check names and App pins, review-thread resolution, merge methods, deletion/force-push
protection and bypass permissions remain unchanged. The exact a1 override below still applies; strictness is a
shared builder policy, not a new per-repository field.

## Fast-merge drift reporting and approval boundary

`delivery fast-merge --repo owner/name` is GET-only. Repeat `--repo` for an explicitly named list. It reports active/inherited
rules, classic protection, required contexts/App pins, merge queues and denied/malformed reads. Its `proposedChanges` list
contains only exact strict-bit changes, tied to the observed repository/ref/ruleset id and update timestamp. Every other
field is preserved by the proposal. Inherited rules require inspection by their owner; private FORBIDDEN means unknown,
not no protection. `--apply`, `--allow-rule-changes` and other write flags are rejected: **no narrow live application path
is implemented or authorized**. Re-read a fresh report and get explicit named-repository approval before any future apply.

At the 2026-11-26 audit, the pending public proposals are MyWorkflows/main ruleset 27641478, a1/develop 21140393 and
timurproko.com/master 27884227, each strict=true -> false only. a1's application must additionally wait for per-merge develop
validation in a separate a1 change. xrbuild, crew and herdr-app are already non-strict; no changes are proposed there.
MyConfigs and .xrbuild protection could not be read, so neither has an approved payload. All required contexts, integration
pins, PR/queue policy, bypasses, other branch/tag rules and merge settings stay unchanged. No repository settings were
changed by the fast-merge implementation. The full evidence, merge-setting table and named list are in
[the audit](plans/fast-merge-no-rerun.md).

The existing broad `delivery protect` apply command above remains a separate, explicit maintenance operation; it is **not**
a way to apply just this proposal without reviewing its entire diff and obtaining consent. The shared workflow only reports
drift. Adopters tracking main receive semantic no-op behavior on their next event, but a still-strict rule can continue to
block merging a behind head; the bot no longer updates that branch just to satisfy strictness. Do not bypass the rule.

Non-strict policy assumes validation on each default-branch push. `delivery base-health --repo owner/name` reports actual
current-head push test evidence and flags failures, missing/pending results and unknown access. The shared advisory summary
is not a guaranteed notification channel; agents must include this diagnostic at handoff/merge preparation. Existing caller
tokens without protection/Actions read can yield unknown; no grants are expanded automatically. A read-only local diagnostic
using the signed-in credential can provide evidence. Neither missing nor older green evidence is passing integrated CI.

## Historical defaults/override adoption order

The original adoption steps below predate the non-strict policy above; their no-policy-change statements describe
that earlier migration, not this deliberate strict-to-nonstrict update.

## Order

1. Merge the MyWorkflows defaults/override change first. It includes MyWorkflows' override and the conservative
   preflight guard. Do not apply protection as part of this migration.
2. Until a1's separate override PR merges, report mode identifies its live check/merge/workflow differences as
   blocked and exits nonzero. `--apply` alone refuses every write. Do not use `--allow-rule-changes` to bypass
   this safeguard during adoption.
3. In a separate a1 PR, add the exact file below to its default branch. No rule application is necessary:
   the declarations already describe its live protection.
4. Report mode must show matches for crew, xrbuild, herdr-app and MyWorkflows after the MyWorkflows change
   merges, and for a1 after its own file merges. None of the five repositories' GitHub rules needs to change.

Reading overrides from GitHub intentionally means a new file in an unmerged PR is not used by the CLI. Before
merge, a read-only comparison using the proposed declarations and live API snapshots can establish that the
payload is unchanged, but it is not evidence that the default branch already contains the file.

## Exact file for a1

Path in a1: `.github/protection.json`

```json
[
  {
    "kind": "default-branch",
    "checks": ["Development validation required"],
    "mergeMethods": ["merge", "squash"]
  },
  { "kind": "branch", "branch": "master" },
  { "kind": "release-tags", "pattern": "v*", "bypassApps": [4942462] },
  {
    "kind": "workflow-events",
    "workflows": [
      ".github/workflows/delivery.yml",
      ".github/workflows/release-reopening-auto-merge.yml"
    ],
    "events": ["pull_request_target", "workflow_run", "workflow_dispatch"]
  }
]
```

This is the full replacement array, not a patch. In particular, it does not enable linear history, does allow
merge and squash, keeps the automation-only `master` branch and `v*` release-tag bypass App `4942462`, and
retains both workflow paths and all three events.

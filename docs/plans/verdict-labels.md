# Agent-review verdict labels

> Historical plan: closure-time verdict persistence below is superseded by [labels-clear-on-close](labels-clear-on-close.md). Current policy removes all three managed roles and every historical alias on merged/unmerged closure; older closed PRs have a separately authorized report-first manual sweep. See [the current runner contract](../delivery-labels.md). Historical implementation evidence below is retained, not current guidance.

Historical plan: display names and metadata authority are superseded by [reference-driven renames](label-rename.md). Old names below describe that historical snapshot, not the current runner contract.

## Proposal

Extend the shared base palette with explicit agent-review verdict labels so a pull request retains its review result after closure. Keep the existing default-on sync and restrict shared closed-event cleanup to Under review; the review-runner implementation remains separate in timurproko/crew pull request #7.

This plan is approved for implementation. This repository has no OpenSpec directory. No live repository labels, assignments, variables, permissions or consumer files will be changed by this task.

## Exact palette and lifecycle

The manifest stays version 1, with these stable keys and exact definitions:

| Key | GitHub name | Color | Description |
| --- | --- | --- | --- |
| `under-review` | `🤖 Under review` | `840479` | Empty string |
| `review-approved` | `🤖 Approved` | `1a7f37` | Empty string |
| `review-changes-needed` | `🤖 Changes needed` | `9a6700` | Empty string |

Every name starts with U+1F916 and one ordinary space, with no variation selector. Under review remains unchanged. The existing default-on sync creates/updates all three definitions on each consumer's next forwarded delivery event, respecting the existing opt-out, permissions, failure isolation and read-only manual-report behavior. Idle consumers wait; no direct label writes or fan-out are introduced.

The separately implemented reviewer runner uses its signed-in credential and ordinary PR-label operations:

- At review start, add Under review and remove either previous verdict label before launching the reviewer.
- On `APPROVE`, remove Under review and add Approved; on `CHANGES NEEDED`, remove Under review and add Changes needed. Verdicts are mutually exclusive.
- On failed launch/report, stop, finish, observed death or abandonment, clear Under review without inventing a verdict. Retain existing idempotency, confirmed-absence, recovery and single-owner constraints; preserve unrelated assignments.
- On merge or unmerged close, shared cleanup removes ONLY Under review and leaves both verdict labels untouched as a record. It must not add a verdict. Existing identity, current-state, reopen, pagination and confirmed-404 safeguards stay intact.

All three labels are advisory, not required checks or merge gates. Absence is not approval, and a retained verdict records a review result rather than guaranteeing review of later commits. Opted-out repositories receive no automatic review-label changes. No crew source is edited here.

## Ordered implementation outcomes

These groups match the draft PR's Implementation checklist, in order.

### 1. The base manifest and sync tests include both exact robot verdict definitions without changing validator behavior

Status: implemented; the manifest and sync/CLI tests cover all three definitions while preserving #27's validator and identity tests.

- Add the two version-1 definitions to `labels/base.json` with the exact keys, Unicode names, colors and empty descriptions above.
- Update manifest enumeration and sync expectations in `test/repository-labels.test.ts` for the complete palette: exact fields/code points, read-only diff, creation, metadata updates, unchanged definitions and default-on automation.
- Keep focused single-label fixtures explicitly scoped where useful; do not weaken collision, no-deletion, opt-out or permissions coverage.
- Leave `scripts/repository-labels.mjs` and owner/name validation untouched. Pull request #27 (`fix/labels-dot-repo`) merged as `77d2225` and is incorporated into this branch; preserve its dotted/leading-dot repository-name coverage when updating overlapping tests.

### 2. Closed-event regression tests preserve both verdict labels on merged and unmerged closures while clearing only Under review

Status: implemented; 24 regression scenarios cover both verdicts individually and together, merged/unmerged closure, Under review present/absent, direct/default-on automation and repeat processing. The cleanup script and workflow already meet the contract and remain unchanged.

- Preserve the existing cleanup script and isolated workflow job unless a demonstrated contract defect requires a narrowly scoped correction.
- In `test/review-label-cleanup.test.ts`, cover each verdict on merged and unmerged closure, with Under review present and absent, plus both verdicts present defensively.
- Assert final assignments and API writes: only the exact Under review assignment can be deleted; verdict and unrelated assignments survive, no repository definitions are deleted, and duplicate closure processing remains idempotent.
- Exercise the automation entry point as well as direct cleanup so the default-on shared path preserves verdicts; retain workflow-contract assertions and existing safety tests.

### 3. README, label documentation and the shared skill describe all three labels and the runner-to-cleanup lifecycle consistently

Status: implemented; all three references list the exact palette and describe review-start reset, mutually exclusive verdict transitions, failure cleanup and verdict persistence on closure. Contract tests cover the complete palette, direct API operations and lifecycle.

- Update `README.md`, `docs/delivery-labels.md` and `skills/change-delivery/SKILL.md` with the palette, review-start reset, verdict transition and persistent-on-closure contract.
- Keep signed-in runner ownership separate from delivery App cleanup and crew pull request #7 implementation. Preserve advisory semantics, opt-out, event cadence, aligned version pins and separate manual-write/pruning consent.
- Extend `test/label-contract.test.ts` to cover all manifest entries and the lifecycle in the documentation and shared skill, without removing existing policy assertions.

## Inspection and validation

Inspection found that `scripts/review-label-cleanup.mjs` selects only `manifest.labels["under-review"].name` and deletes only that assignment. The reusable workflow's isolated `review-label-cleanup` job invokes this script for closed events; it does not enumerate the palette for deletion. This already satisfies the intended runtime scope, but needs explicit verdict-preservation regression coverage.

The original baseline full suite passed under Node 24.22.0: `npm ci --ignore-scripts` followed by `npm test`, 28 files and 359 tests passing. After incorporating #27, the full suite ran again: 431 tests passed and one unchanged bootstrap test exceeded its 5000 ms timeout (29 files, 432 tests total). A focused rerun of `test/bootstrap.test.ts` passed all six tests without modifications; the full-run timeout remains reported, not hidden. Implementation targeted checks passed: 109 manifest/sync/CLI tests, 39 cleanup tests and five documentation contract tests. The implementation full suite ran under Node 24.22.0: 436 passed, with the same unchanged bootstrap test timing out at 5000 ms (437 total, 29 files). Its focused rerun again passed all six bootstrap tests without modifications. No tests or timeouts were weakened. All planned outcomes are implemented; the known validation caveat is that pre-existing full-suite timeout. Crew hooks remain separate in crew PR #7. The validator, shared cleanup script and reusable workflow are unchanged by this task, and no live labels were written.

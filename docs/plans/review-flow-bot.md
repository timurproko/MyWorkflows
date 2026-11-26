# Managed review labels and a bounded delivery loop

Status: re-scoped by the person through the coordinator; all four revised outcomes are implemented.
Targeted validation passes 434 tests; full local suites are intentionally not part of the approved loop.

This plan supersedes the earlier review-before-CI proposal in this PR. Keep the existing completion-based bot
promotion/finalization exactly as on main. Remove the approval-bound dispatch implementation, its metadata,
caller changes, dedicated documentation and obsolete tests through a new commit, without rewriting history.
This repository has no OpenSpec directory; the PR remains unlinked. No other repository or live policy is changed.

## Implementation outcomes

### 1. Existing bot promotion remains unchanged

Restore the delivery workflows/caller template, publication scripts, plain delivery, metadata parser, delivery
check and their tests to the main implementation. Completed valid drafts are promoted automatically and linked
changes are finalized afterward. No review-approval dispatch, promotion opt-in/default, extra reviewed-head
metadata or caller migration is introduced. Agents never mark ready.

### 2. Three managed stages retain assignments and the final record

Keep exactly Build, Review and Approved. The stable changes-needed role is named Build, with Rework and Changes
needed as previous names and the same reference id/node id. Sync renames definitions in place, retaining
assignments. Open-PR reconciliation includes all three roles and aliases. Closure cleanup and the manual sweep
clear only Build/Review and retain Approved and its aliases. Keep existing opt-out, read-only modes and safeguards.

### 3. Shared guidance defines the approved bounded loop

One concern per pull request. Build the change, run only tests for what was touched, push and report immediately;
CI and review start together. No full local test suite. Combine CI failures and blocking review findings into
one fix round. Every finding is BLOCKING or FOLLOW-UP; only blocking findings cause another round. The second
review covers only the fix, and after two rounds the person decides. Approved means review approval of that
commit plus green CI on the same commit; Review remains while CI is pending. Update README, label docs and the
shared skill consistently, and retain contract/label tests for this scope.

### 4. Required checks remain mandatory without strict base freshness

Additional scope approved by the person: set the shared default-branch ruleset builder's strict status-check
policy to false, including repository overrides. Preserve required checks and their App pins and all other
protection. With parallel agents, strict mode sent every open PR through a merge and full CI after each merge;
CI on the default branch catches rare cross-change interactions. Add migration tests and current documentation,
read-only audit which repositories differ, and report the exact authorized application command. The coordinator
already changed crew, xrbuild and herdr-app manually; do not run any live apply here.

## Validation and handoff

Run targeted label, review-loop contract, protection and existing promotion checks, push the new commit normally, update
the approved PR outcomes/acceptance text, and report immediately with current CI status. Do not wait for CI or
review before reporting, run full local suites, mark ready, arm auto-merge or merge. Previous full-suite results
are historical, not validation of the new head. The earlier machine-specific bootstrap failures are outside this
scope; they reproduced with unchanged main sources locally and passed on main's Linux CI.

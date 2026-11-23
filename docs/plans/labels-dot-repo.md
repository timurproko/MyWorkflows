# Correct label repository identity validation

## Approved scope

Accept GitHub-valid dotted and leading-dot repository names in local label commands and automatic sync/closed-PR cleanup, using their existing shared `validateRepository` entry point. The maintainer approved implementation with a narrower audit-only scope for all other identity validators: they already accept leading dots and must not be rewritten or tightened in this change.

This repository has no OpenSpec directory. The two outcomes below match the revised PR checklist.

## Findings

Before this fix, `scripts/repository-labels.mjs:validateRepository` accepts exactly two slash-separated segments, each beginning with an ASCII letter, digit, underscore or hyphen and continuing with ASCII letters, digits, underscores, dots or hyphens. It rejects every leading-dot repository name, including otherwise valid names such as `octocat/.hidden`, and valid dot-only names of three or more dots. Internal/trailing dots work. Missing/extra slashes, URL forms and whitespace are rejected. Owner login syntax and either segment's length are not enforced: underscores/dots in owners, leading/trailing/repeated owner hyphens and overlong identities are incorrectly accepted.

Correction to the initial audit: the old JavaScript regex also rejects final line terminators (confirmed with Node 24); it does not have the newline exception initially claimed.

`bin/delivery.mjs` delegates label arguments unchanged to `labelsMain`; Node's `parseArgs` does not reject dots. The prune command, label listing/usage, sync and direct review-label cleanup all use the defective validator. `run-label-automation.mjs` also invokes it before either automatic operation, so both reusable workflow label jobs inherit the failure.

## 1. Label commands and automation accept valid repository identities

- Keep the shared `validateRepository` interface, returned original string and error text; fix only its owner/name validation.
- Require one slash; owner is 1–39 ASCII alphanumeric characters or single separating hyphens, with no leading/trailing/consecutive hyphen. Repository is 1–100 ASCII letters, digits, hyphens, underscores or dots, excluding exactly `.` and `..`.
- Do not trim or normalize input, strip `.git`, accept URLs or add selector syntax. Reject whitespace/control characters anywhere, non-string inputs, extra path segments, percent escapes and query/fragment syntax.
- Add table-driven boundaries and fake-API regressions for reports/prune usage, automatic sync, direct cleanup and runner cleanup, using dotted and leading-dot names. Cover both CLI repo flag forms and malformed arguments before any API request.
- Preserve read-only defaults, explicit write authorization, opt-out behavior, pagination, unrelated labels and idempotent cleanup. No live prune command or label write is authorized.

## 2. Document accepted names and the audit's follow-up candidates

Update `docs/delivery-labels.md` with the accepted label identity format and the audit below. Leave the non-label validators unchanged: tightening owner/length rules there could reject identities that currently work and needs separate approval.

| Checked paths | Finding / treatment |
| --- | --- |
| `bin/delivery.mjs`, `scripts/repository-labels.mjs`, `scripts/prune-default-labels.mjs` | Fix the shared label validation entry point; retain explicit selection and flags. |
| `scripts/run-label-automation.mjs`, `scripts/review-label-cleanup.mjs`, reusable workflow label jobs | Inherit the fix; cover sync and closed-event cleanup through fake APIs. Workflow expressions have no separate owner/name restriction. |
| `scripts/openspec-archive-github.mjs` reader factories, `scripts/openspec-archive-publication.mjs`, `scripts/publish-openspec-finalization.mjs` | Already accept leading dots; broader owner/length/dot-segment validation is a follow-up candidate only. |
| `scripts/openspec-delivery-policy.mjs`, `scripts/openspec-association-repair.mjs` | Serialized identities already accept leading dots; leave permissive validation unchanged, follow-up only. |
| `scripts/delivery-check.mjs`, `scripts/refresh-ready-pull-requests.mjs`, `scripts/repository-protection.mjs`, protect CLI parsing | Already accept leading dots; leave broader validation unchanged, follow-up only. |
| `scripts/reconcile-merged-branch.mjs`, `scripts/execute-merged-branch-cleanup.mjs`, `scripts/merged-branch-cleanup.mjs`, `scripts/ready-pull-request-refresh.mjs`, `scripts/plain-delivery.mjs`, `scripts/openspec-finalization-publication.mjs` | Identities are propagated/interpolated or compared exactly; no leading-dot restriction. Branch-ref restrictions are unrelated and unchanged. |
| `scripts/bootstrap.mjs`, `scripts/managed-copy.mjs`, `templates/workflow-bootstrap.mjs`, install/worktree tooling | Fixed trusted tooling URL or Git metadata/local paths; no restrictive consumer owner/name parser. |
| Reusable workflow, caller/self-delivery templates and actions | Inherited repository context or fixed trusted tooling repository; no inline parser rejects dots. Events, permissions, opt-out and tools refs remain unchanged. |

## Validation and safety

Use injected/fake API clients and subprocess stubs only for label operations. Do not run live pruning, label application, consumer workflow dispatches, permission changes or protection application.

Run quick targeted checks as outcomes land. Before reporting implementation, run the complete CI commands from `.github/workflows/test.yml`: `npm ci --ignore-scripts` then `npm test`, using Node 24 or newer. Report exact local results and the PR's current CI status without waiting in the foreground.

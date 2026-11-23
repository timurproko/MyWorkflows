# Correct GitHub repository identity validation

## Proposal

Accept GitHub-valid dotted and leading-dot repository names throughout delivery tooling without accepting malformed owner/name identities. Use one identity predicate so local label commands and automatic sync/closed-PR cleanup cannot disagree with promotion, finalization or protection tooling.

This is a plan only; implementation awaits approval. This repository has no OpenSpec directory.

## Findings

`scripts/repository-labels.mjs:validateRepository` currently accepts exactly two slash-separated segments, each beginning with an ASCII letter, digit, underscore or hyphen and continuing with ASCII letters, digits, underscores, dots or hyphens. Consequently it rejects every leading-dot repository name, including otherwise valid names such as `octocat/.hidden`, and also valid dot-only names of three or more dots. It accepts internal/trailing dots. It rejects missing/extra slashes, URL forms and ordinary whitespace, but JavaScript's end anchor allows a final line terminator. It does not enforce owner login syntax or either segment's length; it wrongly accepts underscores/dots in owners, leading/trailing/repeated owner hyphens and overlong identities.

`bin/delivery.mjs` delegates label arguments unchanged to `labelsMain`; Node's `parseArgs` does not reject dots. The prune command, label listing/usage, sync and direct review-label cleanup all use the defective validator. `run-label-automation.mjs` also invokes it before either automatic operation, so both reusable workflow label jobs inherit the failure.

### Audit inventory

| Path | Current finding / planned treatment |
| --- | --- |
| `bin/delivery.mjs`, `scripts/repository-labels.mjs`, `scripts/prune-default-labels.mjs` | Fix the shared label validation entry point; retain explicit repository selection and existing CLI flag behavior. |
| `scripts/run-label-automation.mjs`, `scripts/review-label-cleanup.mjs`, `.github/workflows/delivery.yml` label jobs | Shared validation rejects leading dots; regression-test sync and closed-event cleanup through the runner and direct cleanup with fake APIs. Workflow expressions do not impose another owner/name restriction. |
| `scripts/openspec-archive-github.mjs` reader factories, `scripts/openspec-archive-publication.mjs`, `scripts/publish-openspec-finalization.mjs` | Existing identity regexes accept leading dots but also malformed owners, dot/dot-dot repository segments and overlong names; reuse the new predicate while preserving existing failure codes and credential scope. |
| `scripts/openspec-delivery-policy.mjs`, `scripts/openspec-association-repair.mjs` | Serialized repository identities have the same permissive regex; align validation and exercise dotted names in manifest/repair parsing. |
| `scripts/delivery-check.mjs`, `scripts/refresh-ready-pull-requests.mjs` | Existing environment-identity regexes accept leading dots but have the same malformed-input gaps; align them and cover their entry points. |
| `scripts/repository-protection.mjs`, protect CLI parsing | Protection's regex accepts dots but is too permissive for owners, lengths and dot/dot-dot names; align validation and retain read-only defaults and consent checks. |
| `scripts/reconcile-merged-branch.mjs`, `scripts/execute-merged-branch-cleanup.mjs`, `scripts/merged-branch-cleanup.mjs`, `scripts/ready-pull-request-refresh.mjs`, `scripts/plain-delivery.mjs`, `scripts/openspec-finalization-publication.mjs` | Repository identities are propagated/interpolated or compared exactly, not split with a leading-character restriction; distinguish branch-ref validation from repository validation and retain existing identity/authorization checks. |
| `scripts/bootstrap.mjs`, `scripts/managed-copy.mjs`, `templates/workflow-bootstrap.mjs`, install/worktree tooling | Bootstrap clones a fixed trusted tooling URL; local worktree operations use Git metadata/paths, not a restrictive owner/name parser. No consumer repository-name fix is indicated. |
| Reusable workflow, caller/self-delivery templates and actions | Repository context is inherited or the trusted tooling repository is fixed; no inline owner/name regex or split rejects dots. Preserve event, permission, opt-out and tools-ref behavior. |

## 1. Labels accept exactly valid GitHub owner/name identities

- Introduce a small dependency-free shared identity predicate and retain the public `validateRepository` interface/error text for label callers.
- Require one slash; owner is 1–39 ASCII alphanumeric characters or single separating hyphens, with no leading/trailing/consecutive hyphen. Repository is 1–100 ASCII letters, digits, hyphens, underscores or dots, excluding exactly `.` and `..`.
- Do not trim or normalize input, strip a `.git` suffix, accept URLs or add an alternate selector syntax. Reject whitespace/control characters anywhere, including final line terminators, non-string inputs, extra path segments, percent escapes and query/fragment syntax.
- Add table-driven boundary tests, dotted/leading-dot and three-dot cases, and fake-API regressions for ordinary label reports, prune reports, automatic sync, runner cleanup and direct closed-PR cleanup. Exercise both CLI repo flag forms and reject malformed flags/identities before an API call.
- Preserve read-only diagnostics, explicit write authorization, opt-out handling, pagination, assignment preservation and idempotent cleanup. No live prune command or label write is authorized.

## 2. Delivery and protection use the same repository identity contract

- Replace the other existing owner/name regex validators listed above with the shared predicate; preserve their established error messages/codes and all authorization/route restrictions.
- Add dotted and leading-dot regression cases for every changed path, including reader/publisher scope, promotion/finalization entry points, delivery checks, serialized manifests/repair records, refresh entry point and protection. Prove invalid identities fail before network access or credential minting.
- Complete a repository-wide audit of owner/name consumers, documenting any additional finding before changing scope; do not apply the repository predicate to branch names, actor logins, local paths or fixed bootstrap URLs.
- Update `docs/delivery-labels.md` with the accepted identity format and summarize the final audit in the implementation report without publishing private consumer identities.

## Validation and safety

Use injected/fake API clients and subprocess stubs only for label operations, including CLI regression tests. Do not run live pruning, label application, consumer workflow dispatches, permission changes or protection application.

Run quick targeted checks as the affected outcomes land. Before the implementation report, run the complete CI commands from `.github/workflows/test.yml`: `npm ci --ignore-scripts` followed by `npm test`, using Node 24 or newer. Report exact results and any environment limitation; do not claim CI results for a different head.

# Preserve green ready heads after independent merges

Status: implementation approved in PR #41 for semantic classification, read-only drift proposals, base-health visibility, documentation and regression coverage. **Live protection/settings changes remain unapproved.** The original investigation/proposal below is retained as evidence; the approved application path is dry-run only, not a live writer.

## Implemented scope and remaining rollout gaps

- `scripts/spec-base-impact.mjs` is shared by the finalizer, Delivery check and merge sweep. Independent advances preserve head/body/provenance; affected specs can be replayed with the pinned tool to prove unchanged output. Unknown reads/history/replay block; necessary repair retains scoped commits and lease/target checks.
- Strict live checks report drift instead of updating clean behind branches. `delivery fast-merge --repo owner/name` prints exact per-repository strict-bit proposals and effective/classic protection evidence. It has no apply mode; write flags are rejected. No protection, merge setting, permission, variable or private-repository file was changed.
- `delivery base-health --repo owner/name` and an independent advisory delivery job report product push gates on the exact default head. Older/advisory/skipped evidence cannot report passing. Caller tokens without sufficient read permission report unknown; the signed-in local diagnostic can provide evidence. No guaranteed person notification or new merge gate is claimed.
- All eight audited callers track main, so shared changes arrive after merge on the next event without consumer edits. Settings do not auto-align. The three strict-bit changes still need named-repository authorization; a1 also needs separate per-merge develop validation, and private protection access remains unresolved.
- Focused fake-API and temporary-Git tests cover no-op preservation, necessary spec repair, replay, unknown evidence, races, read-only proposals and default-head health. Regression-test details remain below. No overlapping-path rerun policy was added.

## Finding

The fast path already exists in the post-merge refresher, but not consistently in finalization or live protection. Turning off strict checks alone is insufficient. A linked delivery still treats *any* base advance as invalidation and can merge, restore and re-finalize an otherwise unchanged head.

The two reported PRs are not a controlled comparison: crew #23 also contains real spec conflicts. Preserve those repairs; eliminate only unnecessary updates. Do not promise that a conflicting or semantically invalidated PR will keep its checks.

## Read-only evidence, 2026-11-26 UTC

Source checkout: `ff9570cc50bc83eca6c71a1a76ea0a7f99245689` (MyWorkflows #38). Live settings were read around 19:03–19:09 UTC using `gh-axi api` GETs (the installed wrapper for `gh api`). No settings writes, dispatches, label mutations or PR edits were used in the investigation.

### Discovery and limits

Enumerated authenticated owned repositories, including private repositories, with paginated `GET /user/repos?affiliation=owner&per_page=100`. Inspected workflow listings/content on the default branch of all 28 non-fork repositories. Eight adopters were found, including private `.xrbuild` and MyConfigs. Also checked the canonical `.github/workflows/delivery.yml` path in 104 owned forks; no additional shared caller was found there. Code search alone was incomplete (only a1 appeared), so it was not used as the inventory.

Non-forks with no shared delivery caller found: agentnumberone.dev, Ameria-Heart, CalmXR, fm-acceptance, Full-StackUnityDeveloper, GravityComposerXR, HealthScopeXR, max, Meta-XR-Extensions, MyHoudiniTools, MyUnityProjects, MyUnityTools, PhysicsPlaygroundXR, pi-agent, ProfessionalUnityDeveloper, RealityScannerXR, VitalSportsXR, XRBootcampFoundations, xrbuild-archive and xrbuild.dev. All names in this document are under `timurproko/`. No claim is made about other owners or nonstandard caller paths in forks.

For each adopter read `GET /repos/{repo}`, `/rules/branches/{default}?per_page=100`, `/rulesets?includes_parents=true&per_page=100`, and `/branches/{default}/protection`. Classic protection returned **404 Branch not protected** for the six public adopters: their rulesets, not classic protection, govern merging. Private protection endpoints returned **FORBIDDEN / Insufficient permissions** for both private adopters; that is **unknown**, not evidence that they have no protection or queue.

| Repository | Default | Active default ruleset id | Strict required checks | Required contexts | Merge queue |
| --- | --- | --- | --- | --- | --- |
| xrbuild | main | 26798547 | false | CI required (integration 15368); delivery / Delivery check | No active queue rule |
| crew | main | 27793002 | false | CI required; delivery / Delivery check | No active queue rule |
| herdr-app | main | 27809283 | false | CI required; delivery / Delivery check | No active queue rule |
| MyWorkflows | main | 27641478 | **true** | Delivery tooling tests; delivery / Delivery check | No active queue rule |
| a1 | develop | 21140393 | **true** | Development validation required; delivery / Delivery check | No active queue rule |
| timurproko.com | master | 27884227 | **true** | CI required; delivery / Delivery check | No active queue rule |
| MyConfigs (private) | main | Unreadable | Unknown | Unknown | Unknown |
| .xrbuild (private workspace) | main | Unreadable | Unknown | Unknown | Unknown |

All readable default rulesets require PRs and prevent deletion/force-push. xrbuild, crew, herdr-app and timurproko.com additionally require linear history; MyWorkflows and a1 do not. a1 also has separate master and release-tag rulesets; do not modify them.

Repository merge settings (S = squash, M = merge commit, R = rebase; these are repository switches, not necessarily the methods permitted by the branch rule):

| Repository | Enabled methods | Auto-merge allowed | Always suggest updating PR branches (`allow_update_branch`) | Delete branch on merge |
| --- | --- | --- | --- | --- |
| xrbuild | S | true | false | true |
| crew | S | true | false | true |
| herdr-app | S, M, R | false | false | true |
| MyWorkflows | S, M, R | false | false | false |
| a1 | S, M, R | true | false | false |
| timurproko.com | S, M, R | false | false | false |
| MyConfigs | S, M, R | false | false | false |
| .xrbuild | S, M, R | false | false | false |

Branch PR rules permit squash only in all readable adopters except a1 (merge and squash). These method/auto-merge switches are not the cause of base-refresh reruns. `allow_update_branch=false` controls GitHub's suggestion, not whether the App can call update-branch. No change to these switches is needed for the fast path.

### Exact observed sequence

- [xrbuild #55](https://github.com/timurproko/xrbuild/pull/55) merged at **18:58:37Z**, target `120833ab4750ea5392168bd549903b7dd8a61b8f`.
- Its [merge delivery run 45880099311](https://github.com/timurproko/xrbuild/actions/runs/45880099311/job/140116992176) actually **ran** refresh successfully. At **18:59:00Z**, the candidate result for #52 was `skipped`, head `b90a359fe1de7a6e8a36a43fc50a3ef903a4ae60`, reason **"non-strict protection; conflict-free head is merely behind"**. #56 was also skipped for that reason; #53 was draft.
- [xrbuild #52](https://github.com/timurproko/xrbuild/pull/52) then merged at **19:00:26Z**, still on that exact head. Its `CI required` successes completed at **18:38:17Z** and **18:40:21Z**, before #55 merged; no new CI was needed for #52. Its earlier [18:29 delivery run](https://github.com/timurproko/xrbuild/actions/runs/45876284703) shows the *job* skipped because it was not a merged-closure event. Job-level skip and per-candidate no-op are different evidence.
- Ruleset history proves that **both** crew and xrbuild previously enforced strict checks. `GET /repos/timurproko/crew/rulesets/27793002/history/58927860` has strict=true; version `59799194` changes it to false at **14:17:07Z**. xrbuild versions `58618947` and `59799198` likewise show true -> false at **14:17:08Z**. Current settings cannot be projected backward onto earlier runs.
- [crew #23](https://github.com/timurproko/crew/pull/23) had a green CI run on `4382c4b3ee44312b0ea9312f6c3fd23a01f982ce` at **17:09Z** ([45865201585](https://github.com/timurproko/crew/actions/runs/45865201585)). At **17:52:38Z**, maintainer-authored merge `5d2c626e44ea8106c0c6e9c59ae036ae1f911927` brought in main. Its message records a conflict in `openspec/specs/task-orchestration/spec.md`; an earlier 15:56 merge records conflicts in that spec and `crew.test.mjs`.
- Finalization then committed `ad063414a63acd3cdb515a176d94144d2ef54faa` at **17:53:06Z**, followed by [new CI 45871462289](https://github.com/timurproko/crew/actions/runs/45871462289) at **17:53:14Z**. Thus there was real overlapping spec work and an actual head change. The history does **not** support blaming this particular later merge on strict checks (already false) or claiming the refresh bot authored that merge. Strict enforcement explains the earlier policy; conflict repair and finalization explain this later rerun.

Proof responses and scratch are retained outside the checkout in the crew task folder's `audit/`: settings, effective rules, classic-protection responses, caller contents, ruleset history/versions, PR timelines/commit evidence, checks and run logs. GitHub links above preserve the relevant public evidence; private endpoint failures are retained, not normalized to empty rules.

## Current shared logic and remaining gap

- `.github/workflows/delivery.yml:refresh` runs on a merged `pull_request_target:closed` into the actual default branch, or a forwarded `workflow_run`. It skips other events, including ordinary synchronize/body-edit runs. No per-repository fast/slow input or variable exists. a1 alone forwards successful `Release reopening auto-merge` completions to cover merges made with `GITHUB_TOKEN`; the other callers use PR events and manual reconcile.
- `scripts/ready-pull-request-refresh.mjs` freshly lists/re-reads ready same-repository PRs, excludes draft/closed/fork/Dependabot candidates, compares target to head, and reads active rulesets (including inherited rules). Current heads are no-ops; non-strict clean behind heads skip; unknown mergeability defers. Strict checks **or** a known conflict attempt `PUT update-branch` with `expected_head_sha`. A real conflict generally returns 422/manual resolution, not an automatic conflict fix. Read/malformed-policy failures do not authorize writes. Recognized mutation permission refusals warn and skip that PR.
- `scripts/openspec-finalization-publication.mjs:reconcileFinalization` has a separate unconditional `if (behind)` path: restore archived change/spec baseline, commit restoration, merge target, finalize, push with lease, update body. It runs on ready linked-PR events and manual reconcile, not as a fan-out after every base merge. A later edited/synchronize event can therefore restart CI even when post-merge refresh correctly did nothing.
- `scripts/openspec-delivery-finalization.mjs:verifyPrepared` and `scripts/openspec-archive-github.mjs:inspectVersion3DeliverySnapshot` equate manifest `specBaseSha` with today's base SHA. `validateVersion3Candidate` also requires today's target to be an ancestor of the PR head. These checks enforce freshness even if finalization's merge is removed. All three paths must share semantic validity, not merely relax the publisher.
- `scripts/repository-protection.mjs` already builds strict=false, including overrides (landed in #38). README and `docs/protection-migration.md` already describe non-strict defaults and consent-based apply. The three still-strict public repositories have not picked up that desired policy live. Do not implement the same default again or pretend it applies itself.

## Proposed implementation outcomes (approval required)

### 1. Ready-head preservation and semantic finalization

Create one trusted base-impact classifier shared by refresh, finalization and Delivery check. Preserve a ready head, metadata and checks when only an independent base change landed. Do not issue update-branch, merge/rebase, create a provenance-only commit, rewrite acceptance metadata, dispatch CI or rerun CI just because `behind_by > 0` or the base SHA differs.

Treat the manifest's existing `specBaseSha` as the immutable recorded finalization baseline, not a mandatory live-base identity. Keep the existing manifest format readable; prove that baseline is valid, an ancestor of the current target, and appropriate for this delivery's head. Compare trusted Git trees/blobs from recorded baseline to current target, never PR-executed code or user-supplied path claims. Continue to verify all existing head/archive/tasks/evidence/scenario digests, exact finalized head and path-scope constraints.

Determine affected capabilities from the archived delta, including removed/retired capabilities. Check their canonical input bytes (including missing files), own active/archive path collisions and any other actual finalization inputs. Unrelated application code and unrelated capabilities must not invalidate the record. Where affected baseline bytes changed, replay the delta in the isolated trusted sandbox to determine validity/output; a change that leaves the finalized result valid should remain a no-op. Re-finalize only on demonstrated spec-state invalidation. Malformed/tampered manifests, unprovable ancestry, missing history, API errors, incomplete pagination or ambiguous impact block/defer with a reason; never silently treat unknown as independent or bless corrupted evidence by re-finalizing it.

Only real conflict repair or semantic invalidation may justify changing a ready branch. GitHub update-branch cannot resolve real conflicts: report them for manual resolution. When re-finalization needs the target baseline, preserve the existing scoped restore/merge/archive process, lease checks, target/body/head rereads and archive date; push one necessary final head, which correctly gets fresh CI. Do not merge today's base for initial finalization merely because it advanced independently either.

The post-merge sweep must detect spec-invalidated linked ready PRs even if no PR event follows a base merge. Reuse the classifier and scoped publisher (or a trusted reconcile call), rather than calling update-branch for every linked PR. Keep unknown/conflicting/ineligible candidates bounded and isolated. A strict live policy becomes an explicit **configuration-drift blocker**, not permission to mutate every behind branch. Required GitHub protection still blocks merging until the maintainer aligns it; never bypass it.

### 2. Explicit protection alignment and read-only drift reporting

Keep the existing strict=false builder and documented adoption default. Add a focused read-only fast-merge policy report to shared delivery summaries and a local diagnostic, covering **effective rulesets plus classic protection**, required check names/App pins, merge queues and access failures. Report strict=true/active queue/missing required checks as drift; unknown settings must be visibly unknown. No automatic settings writes, no PAT fallback, no silent removal of a queue or required check. Reuse existing protection reporting where possible; add effective-rule coverage rather than a second conflicting desired-policy inventory.

A maintainer can inspect `delivery protect --repo owner/name` before applying protection. That command currently applies the *whole* managed desired policy, not a strict-only patch. This task's authorization must not accidentally permit its unrelated drift. Provide a narrow application path/report that preserves all fields except the specifically approved strict bit, re-reads immediately before a write, aborts on changed/unapproved drift, and prints the resulting verification. Application is a separate explicit step, never an adoption side effect.

#### Exact settings approval list

| Repository / ref / ruleset | Requested change | Unchanged |
| --- | --- | --- |
| MyWorkflows / main / 27641478 | `required_status_checks.parameters.strict_required_status_checks_policy: true -> false` | Required contexts above, pins, bypasses, PR rules, methods, other protections |
| a1 / develop / 21140393 | Same strict bit true -> false, **after default-branch CI coverage below is addressed** | Development gate name, merge+squash exception, master/tag rules, App permissions |
| timurproko.com / master / 27884227 | Same strict bit true -> false | CI/delivery gates, linear history, all other settings |
| xrbuild / main / 26798547 | **No settings change**; already false | Keep CI integration 15368 and delivery check |
| crew / main / 27793002 | **No settings change**; already false | Keep both required checks and all protections |
| herdr-app / main / 27809283 | **No settings change**; already false | Keep both required checks and all protections |
| MyConfigs / main | **No authorized payload**; obtain readable protection evidence first | Do not infer missing protection, buy a plan, add a queue or remove checks |
| .xrbuild / main | **No authorized payload**; obtain readable protection evidence first | Same; private workspace is not public xrbuild |

Approval of implementation is not approval of settings writes. Ask for the exact named subset of the first three rows before applying anything; refresh the report first. Private rows require another exact proposal once their settings can be inspected. No merge-method, auto-merge, update-button or deletion toggle needs alignment for this behavior. A newly discovered active merge queue needs a separate approval proposal: queues can deliberately create integration runs, so it is incompatible with a promise of zero new CI unless the person chooses that trade-off.

### 3. Default-branch safety visibility and adopter rollout

Removing up-to-date enforcement admits a real risk: two PRs may each be green against an old base and fail together on main, even with disjoint paths. Required head checks are not proof of the integrated result. There is no queue guarantee in the six readable adopters.

Observed fallback coverage:

| Repository | Validation after a default-branch merge |
| --- | --- |
| xrbuild | `.github/workflows/ci.yml` push main; run 45880325069 was in progress at snapshot |
| crew | `tests.yml` push main; run 45874018344 successful |
| herdr-app | `tests.yml` push main; run 45873998626 successful |
| MyWorkflows | `test.yml` push main; run 45845781287 successful |
| timurproko.com | `ci.yml` push master; run 45139770173 successful |
| MyConfigs | `ci.yml` push main; run 45786221093 successful |
| .xrbuild | `ci.yml` push main (Windows workspace validation); do not equate this with public xrbuild's full suites |
| a1 | **Gap:** `ci.yml` subscribes to PRs into develop, not push; Develop is manual and publication/full regression are scheduled/manual. Latest develop push run found was an old cancelled Release run, not evidence of per-merge validation. Nightly regression/publication failures already existed at the snapshot. |

The ordinary fallback is CI on the default branch after each merge, with a red Actions run/commit and GitHub notification subscriptions. Today there is **no shared, guaranteed person notification or agent-visible base-health gate**; a green PR can coexist with red main. a1's nightly triage is repository-specific and delayed. Do not claim the risk is already surfaced clearly everywhere.

Propose a read-only `delivery base-health --repo owner/name` diagnostic plus a shared delivery-summary warning that links failing/missing/pending default-head test runs and names their exact SHA. Never mistake a green advisory Delivery/label workflow or an older green commit for passing product CI. Keep this advisory, not a new required PR check, and never clear failing main by updating unrelated PR branches. Update the shared skill to have agents report this diagnostic at handoff/merge preparation; people get a direct run link/reason in the existing summary, not a promised alert they may never see. A push-triggered notification bot/issue writer is outside this scope and would require explicit approval.

Before approving a1's strict=false apply, arrange a separately reviewed a1 change for validation on every develop merge (reuse its existing development validation; no edits outside this task checkout). Until then mark it as rollout-blocked rather than claiming CI-after-merge covers it. Other consumers already subscribe to default-branch push; caller files for their product CI need no migration here.

A cheap overlapping-path guard is **not recommended as the default rerun policy**: overlapping paths can be harmless, disjoint paths can interact, and blanket overlap reruns violate the requested conflict/spec-invalidity-only behavior. Report overlap as advisory context if useful. Retain exact relevant-spec impact checking; consider an optional selective integration check later only with its false-positive/false-negative limits and added CI cost approved explicitly.

All eight observed delivery callers track `@main` (MyWorkflows uses its trusted local reusable workflow); none overrides `tools_ref`, whose default is main. After this shared implementation merges, they receive it on the next forwarded event without caller edits. Existing in-flight runs retain their snapshot. Protection does **not** follow a workflow reference: named settings alignment remains separately authorized. Future pinned adopters must update `uses` and matching `tools_ref` together; idle repositories wait for an event. No polling, mass branch updates, label-event subscriptions, automatic settings synchronization or cross-repository pushes are part of rollout.

### 4. Regression coverage and documentation

Add focused tests with fake APIs and temporary Git repositories, without live mutations:

- `test/ready-pull-request-refresh.test.ts`: green non-strict behind PR retains exact SHA with zero PUT/push/dispatch; strict drift reports without an update; current/unknown/conflicting heads; classic strict plus non-strict ruleset; inherited/queue rules; denied/malformed/paginated reads; existing eligibility, permission refusal and expected-head race guarantees.
- `test/openspec-finalization-publication.test.ts`: finalized behind PR survives unrelated code merge and unrelated capability merge without commits/body edits/pushes; same result on edited/manual/synchronize events; active first finalization does not merge an independent base; real affected-spec invalidation re-finalizes once; unchanged replay remains no-op; conflict requires repair; malformed manifest never gets reblessed; head/body/target races fail closed.
- `test/openspec-delivery-finalization.test.ts` and `test/openspec-archive-publication.test.ts`: historical recorded baseline stays valid across independent target advances; shared capability edits/additions/deletions/retirements and archive collisions invalidate correctly; recorded base not ancestral/unknown is rejected; exact head, archive/tasks/evidence/scenario digests and changed-path scopes remain enforced; existing version-3 records remain readable.
- `test/delivery-check.test.ts`: same classifier accepts a valid historical baseline, rejects proven invalidation and reports unknown; removing live-base equality must not admit a tampered head. A fresh evaluation sees invalidation even when previous checks were green.
- `test/delivery-workflow-events.test.ts`: merge sweep checks spec impact without re-running product CI or publishing a skipped required check over an earlier failure; non-merge/label-only events remain excluded; manual dry-run cannot mutate; a1 workflow-run fallback stays bounded.
- `test/repository-protection.test.ts` and focused diagnostic tests: defaults/overrides remain non-strict; report mode has zero writes; exact named strict-only application preserves checks/App pins/other fields, rejects races/unapproved drift; inaccessible private rules stay unknown. Base-health tests distinguish current failed/pending/missing test evidence from older/advisory green runs.
- Update README adoption/refresh descriptions, `docs/protection-migration.md` and the shared skill to describe the semantic no-op contract, read-only diagnostics, named consent and the a1 coverage gap. Do not present this proposal as shipped behavior before implementation.

Targeted implementation commands will select only the touched test files, for example `npx vitest run test/ready-pull-request-refresh.test.ts test/openspec-finalization-publication.test.ts test/openspec-delivery-finalization.test.ts test/openspec-archive-publication.test.ts test/delivery-check.test.ts test/delivery-workflow-events.test.ts test/repository-protection.test.ts`, plus the new focused diagnostic test. Do not run the full local suite. Push the final head, trigger CI through publication, report immediately without waiting/polling. This planning commit changes no workflow logic, so regression-test implementation waits for approval.

## Approval boundary

Approve the implementation outcomes separately from any named settings changes. Required decisions: the three strict-bit rows (a1 conditional on default-branch CI), the semantic-baseline/no-mutation contract, and advisory base-health/drift reporting without overlap-driven reruns. Private protection access and a1's separate repository change are explicit rollout gaps, not assumed consent. Crew should publish this plan as a **draft** PR with all implementation outcomes unchecked, then stop for the person's approval.

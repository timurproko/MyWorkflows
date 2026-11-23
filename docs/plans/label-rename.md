# Reference-driven review labels and safe renames

## Proposal

Shorten the three shared robot labels to Review, Approved and Rework, and make managed labels on the GitHub Labels page of `timurproko/MyWorkflows` the editable reference for future names, colours and descriptions. Publish accepted reference changes through a protected-branch pull request; consumers keep converging through the existing default-on delivery sync without losing assignments.

This extended plan is approved for implementation, including explicitly warned runner fallback and equivalent implicit default-branch resolution. This repository has no `openspec/` directory. It supersedes the display-name and metadata-source contracts in the historical base-labels, verdict-labels and labels-default-on plans, not their historical audit results. No label, assignment, variable, permission or consumer repository will be changed by this agent. Crew implementation belongs to the separate `crew-label-rename` task in `timurproko/crew`.

## Stable identities and initial migration

Keep the keys `under-review`, `review-approved` and `review-changes-needed` permanently stable. Display names are data, not identifiers. Initial desired names contain U+1F916, one ordinary U+0020 space and respectively `Review`, `Approved`, `Rework`; colours stay `840479`, `1a7f37`, `9a6700`, with empty descriptions.

Extend the version-1 manifest additively with `previousNames` and rename-stable reference identity plus an accepted reference snapshot. For example:

```json
{
  "version": 1,
  "labels": {
    "under-review": {
      "name": "🤖 Review",
      "color": "840479",
      "description": "",
      "previousNames": ["🤖 Under review"],
      "reference": {
        "id": 13190967182,
        "nodeId": "LA_kwDOVy9vAc8AAAADEj4vjg",
        "name": "🤖 Under review",
        "color": "840479",
        "description": ""
      }
    }
  }
}
```

The actual manifest retains all three entries and supplies `name` and `previousNames` for every key, including an empty list for Approved. Runners may configure the manifest source repository, defaulting to `timurproko/MyWorkflows`; resolve that source's default branch rather than assuming `main`. Crew uses GitHub's implicit default-branch resolution by omitting the contents API `ref`, as specified below. The `reference` metadata is the last accepted observation of the source label, not a second palette for consumers. Normally it matches the desired metadata; the initial migration deliberately records the observed old names while requesting the new names. Read-only inspection found these source identities:

| Stable key | Reference GitHub id | Reference node id | Initial previous names |
| --- | --- | --- | --- |
| `under-review` | `13190967182` | `LA_kwDOVy9vAc8AAAADEj4vjg` | `🤖 Under review` |
| `review-approved` | `13192323713` | `LA_kwDOVy9vAc8AAAADElLigQ` | none |
| `review-changes-needed` | `13192323855` | `LA_kwDOVy9vAc8AAAADElLjDw` | `🤖 Changes needed` |

Re-read these identities before implementation and fail visibly if the reference has been deleted/replaced or unexpectedly edited. Never bind by a guessed display name. A reference replacement requires an explicit reviewed identity-rebinding manifest change.

## Ordered implementation outcomes

These match the draft PR's Implementation checkboxes, in order. Tests accompany each code outcome.

### 1. Stable reference identities and alias-aware sync preserve assignments through managed label renames

Status: implemented; alias migration and repository-label targeted tests pass.

- Extend manifest validation for optional alias/reference fields while accepting existing version-1 manifests without them. Reject malformed identities, duplicate identities, invalid names/metadata and ambiguous current/previous names across keys before any write. Keep names nonempty, trimmed, within GitHub's limit and free of control characters; colours are six hexadecimal digits and descriptions obey the existing limit. Normalize case/Unicode for collision detection, not for silent renaming.
- Set the initial desired names and the reference identities/snapshots above. Build GitHub write bodies explicitly; never send `previousNames` or `reference` to the labels API.
- Preflight the complete paginated label listing. If the desired name exists, keep/update it; retain and explicitly report any old-name definitions. If it is missing and exactly one previous name exists, PATCH that existing label's URL with `new_name`, colour and description. Never delete/recreate it or edit PR assignments. If neither exists, create the desired label. Ambiguous multiple legacy matches or case/normalization collisions fail closed instead of guessing or duplicating.
- Report-only CLI and workflow dry runs show the source and destination of planned renames and preserved legacy conflicts with zero mutation. Apply reports distinguish create, update, rename and unchanged results. API-provided names remain escaped data, never shell syntax, workflow commands or unescaped summary markup.
- Cover assignment/identity preservation in a stateful fake API, legacy-only/new-only/both/neither cases, multiple aliases, pagination, metadata changes, no-op repeat runs, preflight failures and denied writes. Preserve default-on/opt-out, token isolation and no-deletion contracts.

### 2. Reference label events and manual reconciliation publish validated manifest updates through protected pull requests

Status: implemented; reference reconciliation/publication tests pass with fake APIs.

- Add a MyWorkflows-only workflow for `label: [edited, created, deleted]` plus a read-only-by-default manual dispatch. Execute only trusted default-branch tooling with a narrowly repository-scoped existing delivery App token for Contents write and Pull requests write when publishing; do not grant extra Issues access or write consumer labels. Treat event names/descriptions as untrusted data.
- Match source labels by recorded id and node id, never by name. On `edited`, read name/colour/description from the payload and append `changes.name.from` plus the previous manifest name to `previousNames` when applicable. Deduplicate history and exclude the new current name so a rename back is supported. Validate the complete proposed manifest before publication, including cross-key current/alias collisions. Missing/invalid identity or previous-name data produces a visible diagnostic, not a guessed migration.
- Serialize publication without cancelling earlier events. On each run reconcile the other managed references from live GitHub state too, to catch missed/interleaved edits, while preserving the event's old-name history. Recheck live source state before publication; stale events must not revert a newer live edit. Read the pending reconciliation branch as well as the latest default branch so intermediate aliases survive a burst of edits before merge. Protect unrelated/manual branch edits with head checks; never force-push over them.
- Ignore unmanaged `created`/`edited` events. A new label does not become managed because its name matches. On managed `deleted`, report the missing stable identity and retain the last accepted manifest; do not delete consumers, recreate/rebind the reference, or publish a destructive update. Unmanaged deletions are ignored. A missing required reference blocks reconciliation with a visible warning.
- Provide `delivery labels-reference` as a read-only reconciliation report against the fixed reference repository, and `delivery labels-reference --apply` to publish/update the same reconciliation PR using the ordinary signed-in credential. Apply here authorizes only a branch/PR update, never a label write. Share the event/manual validation and publication implementation. A missed event recovers the prior manifest name as an alias; intermediate names from entirely missed multiple renames cannot be inferred from current GitHub state and must be supplied in a reviewed alias correction.
- Publish on a dedicated topic branch as a draft PR into the discovered default branch, with valid Proposal, fully delivered data-update Implementation outcome and Acceptance; omit Automation because there is no OpenSpec change. Existing delivery automation can promote this generated data-only PR and run required checks. The person merges it. Never push to main, bypass protection, mark ready directly or arm auto-merge. Reuse one open reconciliation PR; create a new branch/PR after its predecessor closes. No-diff events do not open PRs.
- Between a UI edit and its PR merge, the Labels page shows the new reference but main's manifest/runners/consumers still use the previously accepted contract. The workflow summary and PR explain the exact diff, validation warnings and this delay. After merge, consumers apply the manifest on their next forwarded delivery event; idle consumers wait, pinned consumers must update workflow and tools_ref together. There is no fan-out, schedule, immediate global rename guarantee or consumer-permission expansion.
- Cover edited/created/deleted/unmanaged events, stale/duplicate events, multiple edits before merge, missed-event reconciliation, deleted/recreated identities, malformed metadata, new/current/alias collisions, no-diff runs, branch races, draft PR body validity, existing PR reuse, App permissions and no direct default-branch/label writes.

### 3. Reference synchronization respects unmerged UI edits while the initial normal sync aligns the reference labels

Status: implemented; source-identity, bootstrap, UI drift, pending-PR and last-read guard tests pass.

- Special-case the reference repository by its fixed repository identity and recorded label ids, not by label display names. Before a source-label write, compare its live metadata with the accepted `reference` snapshot. Only an exact identity/snapshot match with no pending reference reconciliation PR permits applying desired manifest metadata; drift is reported and reserved for reference reconciliation instead of being overwritten by ordinary delivery sync. Re-read immediately before each write. Missing/replaced ids or a conflicting destination name block that source update.
- This permits the initial post-merge default-on sync to rename the two existing source labels in place from the recorded old snapshot to Review/Rework, leaving Approved untouched, without this agent writing any labels. Resulting edited events refresh the reference snapshot through the same PR path, making repeat syncs harmless. A live label already matching desired metadata is a no-op while the snapshot update is pending.
- Once a UI edit occurs, ordinary reference sync cannot restore the previous manifest value while its reconciliation PR awaits merge. This applies to colour/description edits and renames, including reverting to an earlier alias. No initial sync is forced by this agent; the next normal delivery event performs it.
- GitHub has no atomic compare-and-update label endpoint: a UI edit between the final source read and PATCH remains a narrow race. Surface this limitation and retain event history/reconciliation recovery; never claim an atomic guarantee. UI edits during bootstrap are reconciled, not silently discarded.
- Cover bootstrap rename/assignment preservation, matching desired labels, pending UI rename/recolour/description changes, revert-to-alias, identity replacement, denied writes, duplicate events and feedback-loop/no-op behavior.

### 4. Closed-PR cleanup resolves current and historical review names by key and preserves all verdict assignments

Status: implemented; current/historical review and verdict cleanup regressions pass.

- Resolve only `under-review` current name plus `previousNames` from the manifest, and remove matching assignments on merged and unmerged closed PRs, including both names present together. Do not hard-code any runtime display name or enumerate the whole palette for removal.
- Preserve current and historical verdict assignments under `review-approved` and `review-changes-needed`, plus unrelated labels. Never add a verdict or delete a label definition. Maintain repository/event/current-state validation, pagination, reopen checks before each removal, idempotency and confirmed-access/absence handling for DELETE 404s.
- Change runner messages and workflow step names to key/role-based wording so future UI renames do not stale logs. Cover arbitrary future names without a robot prefix, multiple historical review aliases, all current/historical verdicts together, reopen between removals and default-on/opt-out/dry-run/token safeguards.

### 5. Runner guidance and prune contracts use stable keys and the published reference-driven manifest

- Update README, `docs/delivery-labels.md`, the shared `skills/change-delivery/SKILL.md`, workflow descriptions, contract/CLI tests and every active label-name enumeration. Historical plans retain historical examples with explicit supersession notes pointing here; they are not current runner contracts.
- Publish the runtime manifest API: discover `default_branch` with `GET /repos/timurproko/MyWorkflows`, then fetch `GET /repos/timurproko/MyWorkflows/contents/labels/base.json?ref=<default_branch>` with `Accept: application/vnd.github.raw+json` (URL-encode the ref). Current public URL is `https://api.github.com/repos/timurproko/MyWorkflows/contents/labels/base.json?ref=main`. Validate JSON/version/required stable keys and read `name`, `color`, `description`, `previousNames`; reference identity/snapshot fields are metadata, not consumer label ids. Fetch once at each review operation and consistently use that validated snapshot. Omitting `ref` on the contents request is equivalent default-branch resolution. A runner MAY fall back to built-in Review/Approved/Rework names and the legacy aliases on read/validation failure provided it explicitly warns; silent fallback is forbidden.
- Document crew's coordinator-approved transport/failure exceptions: make exactly one `GET /repos/{configured-source}/contents/labels/base.json` with `Accept: application/vnd.github.raw+json`, omitting `ref` so GitHub resolves the default branch, with a two-second timeout and no separate repository-discovery read. On fetch/validation failure, crew may use an explicitly warned fallback: `under-review` name `🤖 Review`, previousNames `["🤖 Under review"]`; `review-approved` name `🤖 Approved`, previousNames `[]`; `review-changes-needed` name `🤖 Rework`, previousNames `["🤖 Changes needed"]`. This runner availability exception does not authorize silent fallback, source reconciliation from fallback values, or hard-coded display names in MyWorkflows runtime scripts. State that fallback cannot discover arbitrary future UI names and can leave those assignments untouched until manifest access recovers; it is not successful synchronization.
- Document crew's separate lifecycle contract from crew PR #7: at review start add current `under-review` name and clear both verdict keys' current/historical assignments; on APPROVE clear current/historical review and opposite verdict names and add current `review-approved`; on CHANGES NEEDED do the same for `review-changes-needed`. Failed launch/report, stop, finish, observed death or abandonment clears only current/historical in-progress names, never inventing a verdict. Resolve the implementation PR, not a Plan report; complete old cleanup before replacement and retain single-owner constraints. Preserve unrelated labels, idempotency, confirmed access/absence, opt-out, signed-in credentials and advisory status. No leases, heartbeat, cross-controller coordination, historical sweep or timed crash-expiry guarantee is added: a lost runner can leave an open PR labeled until existing recovery or a person clears it; closed-event fallback remains best effort. Crew source is not edited here.
- Initial names retain the robot prefix; future valid UI edits may remove it. No script or runner may require that prefix or infer a role from a name. Explain the PR acceptance delay, event-driven propagation delay, pinned consumers, missing/deleted reference recovery and last-read/PATCH race.
- Audit optional default-label pruning and add coverage preserving every current/historical managed robot label, including changed display names. Pruning remains a separate explicitly authorized default-only operation; automatic reconciliation/sync never imports or invokes it. If future reference names overlap GitHub defaults, managed current/previous names must be explicitly excluded from pruning even when their metadata matches a default.

## Validation and handoff

Use fake APIs and subprocess fixtures; never call a live label-write endpoint, run live label apply/prune, edit crew, change permissions or set consumer variables. Keep CI-compatible Node 24. Run focused checks with each outcome and the complete `npm test` suite once before implementation handoff, as explicitly requested. Read and report the PR's current CI results without foreground watching; neither readiness nor merge is performed by the agent.

Planning baseline: the full `npm test` run on Node 24.22.0 completed with 436 passing tests and one unchanged bootstrap test timing out at its existing 5000 ms limit (29 test files: 28 passed, one failed). No code was changed or timeout weakened. The draft body passes `delivery check-body`. Report the draft PR's current CI status at handoff. The coordinator approved implementation of this extended plan with the warned-fallback/default-branch-resolution adjustments recorded above. The task report will start with `Plan: <PR URL>`, summarize the full scope, give the checkout/branch/commit and a single maintainer command, then signal `crew done label-rename` and stop.

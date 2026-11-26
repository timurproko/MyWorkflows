# Repository-independent protection defaults

Historical plan: its strict/up-to-date-check policy is superseded by the approved non-strict shared default
in [review-flow-bot](review-flow-bot.md) and the current [protection migration](../protection-migration.md).

## Proposal

Replace the central repository inventory with built-in defaults and one optional `.github/protection.json` in the protected repository. No GitHub protection is changed by this refactor, and no `delivery protect --apply` command will be run as part of this task.

## Decisions

### Defaults need no declaration

For any `owner/name`, use these declarations when the optional file is absent:

```json
[
  {
    "kind": "default-branch",
    "checks": ["CI required"],
    "mergeMethods": ["squash"],
    "linearHistory": true
  },
  {
    "kind": "workflow-events",
    "workflows": [".github/workflows/delivery.yml"],
    "events": ["pull_request_target", "workflow_dispatch"]
  }
]
```

Keep the existing ruleset builders' other protections: no deletion or force push, a pull request and resolved review threads, strict/up-to-date required checks including `delivery / Delivery check`, and repository-admin bypass for pull requests only. Preserve required-check integration pins. Resolve the actual default branch; never assume `main` or `develop`.

### One optional file, read from GitHub

Read `.github/protection.json` from the target repository's default branch on GitHub, not the current checkout. This makes `--repo` reliable from any directory and prevents an unmerged local edit or an unrelated checkout from silently changing the policy being applied. Resolve the default branch to a commit and read the file at that commit for a consistent configuration snapshot. Report the configuration source and commit.

The file is a JSON array of declarations, exactly the shape of one value in today's inventory: `default-branch`, optional `branch` and `release-tags`, and `workflow-events`. A present file replaces the whole default array; it is not a field-wise merge. This avoids ambiguous array-merging rules, preserves today's field semantics, and needs no additional version, repository key, plugin or configuration layer. The existing optional fields and builder defaults remain supported. In particular, omitted `linearHistory` remains false in a replacement file, preserving both exceptional repositories.

Validate the file before any writes: require one default-branch and one workflow-events declaration, valid kinds/fields/value types, and no duplicate branch or policy declarations. Only an actual missing-file response selects defaults; malformed JSON, an unreadable file, authentication failures and other API failures fail closed instead of falling back.

This repository will have this exact `.github/protection.json`:

```json
[
  { "kind": "default-branch", "checks": ["Delivery tooling tests"] },
  {
    "kind": "workflow-events",
    "workflows": [".github/workflows/self-delivery.yml"],
    "events": ["pull_request_target", "workflow_dispatch"]
  }
]
```

### Conservative apply guard, with no repository special cases

Build the complete comparison before performing any mutation, including Actions policies, branch/tag rulesets and possible classic-protection cleanup. Creating missing protection remains allowed with `--apply`. If any existing managed ruleset or Actions policy differs, refuse all writes unless the caller also passes `--allow-rule-changes`. Require that flag for classic-protection deletion as well, retaining the existing fresh-read check that a matching active ruleset protects the branch before deletion. An unchanged repository requires no flag and causes no writes.

This intentionally treats every difference as potentially important rather than implementing a fragile stronger/weaker ordering. It catches different check names, workflows/events, merge methods, linear-history rules, bypass actors and unknown live rule types, as well as weaker settings. Report mode shows the differences and explicitly says live changes are blocked; it must not claim the repository matches or recommend an unguarded apply. The flag authorizes deliberate live-policy changes only with `--apply`; it is not another policy source.

Unmanaged rulesets/policies remain untouched and are clearly reported; they are never silently counted as managed matches. Preserve the current check-source pinning and same-ref ruleset matching. The preflight must finish successfully before the first POST, PUT or DELETE, so a later conflict cannot follow an earlier partial update.

## Ordered implementation outcomes

1. **Any repository resolves built-in protection defaults or its own default-branch override without a central inventory.**
   - Add default declarations, remote optional-file loading and validation in `scripts/repository-protection.mjs`.
   - Add this repository's `.github/protection.json`, delete `protection/repositories.json`, and replace both test suites' inventory readers.
   - Cover arbitrary repository names, absent versus invalid/unreadable files, non-main default branches, full replacement semantics, and exact unchanged payloads for default and exceptional policies.
2. **Protection changes are preflighted and existing live policies cannot change without explicit consent.**
   - Add `--allow-rule-changes` to `bin/delivery.mjs` and the protection function; update help and report formatting.
   - Separate comparison from mutation; refuse every write on conflicts unless explicitly authorized.
   - Cover conflicts discovered after otherwise-creatable policies/rulesets, no-file a1-like protection, matching/no-write behavior, authorized updates, retained integration pins, untouched unmanaged protection, and guarded classic-rule cleanup.
3. **Adoption and migration documentation describe zero-config protection and preserve all five repositories' behavior.**
   - Change README adoption step 3 to name the CI gate `CI required`, run `delivery protect --repo <owner/name>` to inspect, then use `--apply` to install missing protection.
   - Document the defaults, optional file schema/source, deliberate-update flag, paid-plan limitation without inventory language, and the exact a1 file below.
   - Update remaining executable/test inventory consumers and clarify the old herdr-app plan as historical rather than an active adoption instruction.
   - Add regressions demonstrating defaults match crew/xrbuild/herdr-app and overrides preserve MyWorkflows/a1, including their absence of linear-history requirements. No replacement central repository map is shipped.

## Safe transition

1. Implement and ship this MyWorkflows change first, including its own override, the preflight guard, and the prepared a1 content below. Do not apply protection anywhere.
2. Until a1's separate PR lands, its missing file resolves to defaults but its live check name, merge methods and workflow events conflict. Report mode identifies that blocked mismatch; `--apply` without `--allow-rule-changes` refuses before any writes. No repository-name exception or temporary inventory is needed. Do not use the explicit override flag as a migration workaround.
3. A separate a1 task adds exactly the file below to a1's default branch. That task is outside this PR. Its merged file makes report mode match all existing a1 branch/tag rulesets and its Actions policy, without applying anything.
4. After this PR merges, crew, xrbuild, herdr-app and MyWorkflows must report matches using the shipped command, without any apply. a1 must report matches after its own file merges. None of the five repositories' live rules changes during this migration.

### Exact file for the separate a1 PR

Path: `.github/protection.json`

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

## Validation and handoff

Run quick targeted protection and self-delivery tests while implementing each outcome; let CI provide broad integration coverage. Use report-only GitHub reads to compare defaults against crew/xrbuild/herdr-app and to capture the two exceptional repositories' current policies. Before this PR merges, its own new override is necessarily absent from the remote default branch: compare the proposed override with the live snapshot through the test seam and label that evidence accurately, not as a remote-file CLI match. The same distinction applies to a1 until its separate PR merges. Full remote-file CLI matches are post-merge checks, not a reason to read unmerged local configuration.

No implementation or tests have been changed at the planning stage. Wait for plan approval. Never mark the draft PR ready or merge it as part of this task.

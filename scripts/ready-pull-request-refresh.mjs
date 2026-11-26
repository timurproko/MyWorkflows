import { targetBranch } from "./delivery-target.mjs";
import { parseImplementation } from "./openspec-archive-policy.mjs";
import { archiveReaderFromGet, inspectDeliveryBaseImpact, inspectVersion3DeliverySnapshot } from "./openspec-archive-github.mjs";
const FULL_SHA = /^[0-9a-f]{40}$/;
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10;

/**
 * Classify one freshly read pull request for base-branch refresh. Only an
 * open, non-draft, non-Dependabot pull request whose base and head both live
 * in the governed repository and whose base is the delivery target may be updated.
 */
export function classifyRefreshCandidate(pull, repository) {
  const number = pull?.number;
  const headSha = pull?.head?.sha;
  const skip = reason => ({ disposition: "skipped", number, headSha, reason });
  const fail = reason => ({ disposition: "failed", number: Number.isSafeInteger(number) ? number : null, headSha: headSha ?? null, reason });
  if (!Number.isSafeInteger(number) || number < 1) return fail("malformed pull request number");
  if (pull.state !== "open") return skip("pull request is not open");
  if (typeof pull.draft !== "boolean") return fail("draft state is malformed");
  if (pull.draft) return skip("draft pull request");
  if (pull.user?.login === "dependabot[bot]") return skip("Dependabot owns rebasing this pull request");
  if (pull.base?.ref !== targetBranch()) return skip(`base branch is not ${targetBranch()}`);
  if (pull.base?.repo?.full_name !== repository) return skip("base repository is not the governed repository");
  if (pull.head?.repo?.full_name !== repository) return skip("head repository is a fork or unavailable");
  if (typeof headSha !== "string" || !FULL_SHA.test(headSha)) return fail("head SHA is malformed or missing");
  return { disposition: "eligible", number, headSha };
}

/**
 * Decide whether an eligible head already contains the current target, using
 * a GitHub comparison of `target...head`.
 */
export function decideRefresh(eligibility, comparison, targetSha, { strict = false, mergeable = null } = {}) {
  if (eligibility.disposition !== "eligible") return eligibility;
  const behindBy = comparison?.behind_by;
  if (!Number.isSafeInteger(behindBy) || behindBy < 0) {
    return { ...eligibility, disposition: "failed", targetSha, reason: "comparison response is malformed" };
  }
  if (behindBy === 0) return { ...eligibility, disposition: "current", targetSha };
  if (strict && mergeable !== false) return { ...eligibility, targetSha, behindBy, disposition: "blocked", reason: "configuration drift: strict checks require an independently approved settings change" };
  if (mergeable !== false) {
    return { ...eligibility, targetSha, behindBy, disposition: mergeable === true ? "skipped" : "deferred",
      reason: mergeable === true ? "non-strict protection; conflict-free head is merely behind" : "mergeability is not yet known; no refresh attempted" };
  }
  return { ...eligibility, disposition: "update", targetSha, behindBy };
}

/** Active rules are read from GitHub, not the desired defaults: existing strict consumers still need refresh. */
export function strictRefreshRequired(rules) {
  if (!Array.isArray(rules) || rules.some(rule => typeof rule?.type !== "string")) throw new Error("active branch rules are malformed");
  const checks = rules.filter(rule => rule.type === "required_status_checks");
  if (checks.some(rule => typeof rule.parameters?.strict_required_status_checks_policy !== "boolean")) {
    throw new Error("active required-check strictness is malformed");
  }
  return checks.some(rule => rule.parameters.strict_required_status_checks_policy);
}

/**
 * Interpret GitHub's update-branch response. Accepted updates, expected-head
 * races, already-current heads, merge conflicts and recognized permission
 * refusals are bounded outcomes; unknown errors and rate limits still fail.
 */
export function interpretBranchUpdate(decision, response) {
  if (response.status === 202) return { ...decision, disposition: "updated" };
  const message = typeof response.body?.message === "string" ? response.body.message : "";
  // Security: only an explicit mutation permission refusal is a skip, never a blanket 403 bypass.
  const rateLimited = response.headers?.["x-ratelimit-remaining"] === "0" || response.headers?.["retry-after"] != null;
  const permissionMessage = message.trim();
  const permissionRefused = /^resource not accessible by integration\.?$/i.test(permissionMessage)
    || /^refusing to allow a GitHub App to create or update workflow .+ without [`'"]?workflows[`'"]? permission\.?$/i.test(permissionMessage);
  if (response.status === 403 && !rateLimited && permissionRefused) {
    return { ...decision, disposition: "skipped", permissionDenied: true, reason: `update-branch permission refused (HTTP 403): ${message.slice(0, 500)}` };
  }
  if (response.status === 422) {
    if (/expected head sha/i.test(message)) return { ...decision, disposition: "deferred", reason: "head changed after it was read" };
    if (/no new commits/i.test(message)) return { ...decision, disposition: "current" };
    if (/conflict/i.test(message)) return { ...decision, disposition: "blocked", reason: "merge conflict requires manual resolution" };
  }
  return { ...decision, disposition: "failed", reason: `update-branch returned ${response.status}: ${message.slice(0, 200) || "no message"}` };
}

/**
 * Reconcile every open pull request targeting the delivery target. Each candidate is
 * re-read and compared against a freshly read target before an expected-head
 * update, so a stale decision can never replace a newer head. Per-candidate
 * failures are reported without stopping independent candidates; listing and
 * credential failures abort the pass.
 */
export async function refreshReadyPullRequests({ repository, request, reconcileLinked, maxPages = DEFAULT_MAX_PAGES }) {
  const prefix = `/repos/${repository}`;
  const numbers = [];
  for (let page = 1; ; page += 1) {
    if (page > maxPages) throw new Error(`open pull-request listing exceeded ${maxPages} pages`);
    const listing = await request(`${prefix}/pulls?state=open&base=${targetBranch()}&per_page=${PAGE_SIZE}&page=${page}`);
    if (!Array.isArray(listing.body)) throw new Error("open pull-request listing was not an array");
    for (const pull of listing.body) {
      if (!Number.isSafeInteger(pull?.number) || pull.number < 1) throw new Error("open pull-request listing contained a malformed number");
      if (!numbers.includes(pull.number)) numbers.push(pull.number);
    }
    if (listing.body.length < PAGE_SIZE) break;
  }

  // One effective active-rules snapshot per pass, including inherited rulesets. Read errors never authorize a write.
  let strictPolicy;
  const strict = () => strictPolicy ??= (async () => {
    const rules = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const batch = (await request(`${prefix}/rules/branches/${encodeURIComponent(targetBranch())}?per_page=${PAGE_SIZE}&page=${page}`)).body;
      strictRefreshRequired(batch); // Validate every page before any mutation, never infer non-strict from an invalid read.
      if (batch.length > PAGE_SIZE) throw new Error("active branch rules page is oversized");
      rules.push(...batch);
      if (batch.length < PAGE_SIZE) return strictRefreshRequired(rules);
    }
    throw new Error(`active branch rules exceeded ${maxPages} pages`);
  })();
  const results = [];
  for (const number of numbers) {
    try {
      results.push(await refreshCandidate(number));
    } catch (error) {
      // Security: credential/read authorization failures abort. Expected mutation refusals are interpreted locally.
      if (error?.status === 401 || error?.status === 403) throw error;
      results.push({ disposition: "failed", number, headSha: null, reason: String(error?.message ?? error).slice(0, 300) });
    }
  }
  return results;

  async function refreshCandidate(number) {
    const pull = (await request(`${prefix}/pulls/${number}`)).body;
    const eligibility = classifyRefreshCandidate(pull, repository);
    if (eligibility.disposition !== "eligible") return eligibility;
    if (eligibility.number !== number) return { ...eligibility, disposition: "failed", reason: "pull request identity changed while reading" };

    const targetSha = (await request(`${prefix}/git/ref/heads/${targetBranch()}`)).body?.object?.sha;
    if (typeof targetSha !== "string" || !FULL_SHA.test(targetSha)) return { ...eligibility, disposition: "failed", reason: "target ref is malformed" };
    const comparison = (await request(`${prefix}/compare/${targetSha}...${eligibility.headSha}?per_page=1`)).body;
    const current = decideRefresh(eligibility, comparison, targetSha);
    if (current.disposition === "current" || current.disposition === "failed") return current;
    const decision = decideRefresh(eligibility, comparison, targetSha, { strict: await strict(), mergeable: pull.mergeable });
    const implementation = parseImplementation(pull.body ?? "");
    if (implementation) {
      if (implementation.version !== 3 || !implementation.archive || implementation.finalizedHead !== eligibility.headSha) {
        return { ...eligibility, disposition: "deferred", reason: "linked head awaits normal finalization" };
      }
      const reader = archiveReaderFromGet(repository, async path => (await request(path)).body);
      const candidate = { ...pull, base: { ...pull.base, sha: targetSha } };
      const value = await inspectVersion3DeliverySnapshot(reader, candidate, implementation, eligibility.headSha);
      const impact = await inspectDeliveryBaseImpact(reader, candidate, implementation, value);
      if (impact.disposition === "invalidated") {
        if (!reconcileLinked) return { ...eligibility, disposition: "blocked", reason: "spec base invalidated; trusted finalization required" };
        const result = await reconcileLinked(number);
        return { ...eligibility, disposition: result.disposition, reason: "spec base invalidated", pushedHead: result.pushedHead };
      }
      // Conflict repair of linked heads must use the scoped publisher, not a blind update-branch.
      if (pull.mergeable === false) return { ...eligibility, disposition: "blocked", reason: "merge conflict requires manual resolution" };
    }
    if (decision.disposition !== "update") return decision;

    // Concurrency: the expected head binds this decision to the exact SHA just compared; GitHub rejects it if the branch moved.
    const response = await request(`${prefix}/pulls/${number}/update-branch`, {
      method: "PUT", body: { expected_head_sha: decision.headSha }, expected: [202, 403, 422],
    });
    return interpretBranchUpdate(decision, response);
  }
}

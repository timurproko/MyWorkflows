import { parseArgs } from "node:util";
import { labelApi, loadBaseLabels, validateRepository } from "./repository-labels.mjs";
import { cleanupClosedReviewLabels, managedReviewNames } from "./review-label-cleanup.mjs";

/** Explicit, single-repository historical recovery. Only manual CLI/dispatch paths invoke it. */
export async function sweepReviewLabels({ repository, apply = false, api = labelApi, manifest, environment = process.env }) {
  validateRepository(repository);
  if (apply && environment.DELIVERY_LABELS_ENABLED?.toLowerCase() === "false") {
    return { repository, applied: false, disposition: "disabled", pulls: [] };
  }
  manifest ??= await loadBaseLabels();
  managedReviewNames(manifest);
  // Complete discovery/identity validation before the first mutation. A fresh GET, not this
  // listing, authorizes each removal; a PR can reopen while we paginate or clean another PR.
  const numbers = new Set();
  for (let page = 1; ; page++) {
    if (page > 1000) throw new Error("closed pull-request pagination limit exceeded; nothing was swept");
    const pulls = await api("GET", `repos/${repository}/pulls?state=closed&per_page=100&page=${page}`);
    if (!Array.isArray(pulls) || pulls.length > 100) throw new Error("invalid closed pull-request listing");
    for (const pull of pulls) {
      if (!Number.isSafeInteger(pull?.number) || pull.number < 1 || pull.state !== "closed"
        || pull.base?.repo?.full_name !== repository || numbers.has(pull.number)) {
        throw new Error("invalid or repeated closed pull-request identity or state");
      }
      numbers.add(pull.number);
    }
    if (pulls.length < 100) break;
  }
  const pulls = [];
  for (const number of numbers) {
    try {
      pulls.push(await cleanupClosedReviewLabels({ repository, number, api, manifest, apply }));
    } catch (error) {
      // Earlier PRs may already be cleaned. Never claim the whole repository succeeded.
      throw Object.assign(new Error(`review-label sweep failed on PR #${number}; earlier removals may have completed; inspect a fresh report before retrying`), { status: error.status, cause: error });
    }
  }
  return { repository, applied: apply, pulls };
}

export async function sweepMain(args, options = {}) {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, apply: { type: "boolean" } } });
  return sweepReviewLabels({ ...options, repository: values.repo, apply: Boolean(values.apply) });
}

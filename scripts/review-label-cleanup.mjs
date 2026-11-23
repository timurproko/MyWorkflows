import { labelApi, labelNames, loadBaseLabels, validateManifest, validateRepository } from "./repository-labels.mjs";

/** Event-only final fallback. Normal review lifetime is owned by the signed-in review runner. */
export async function cleanupReviewLabel({ repository, event, api = labelApi, manifest }) {
  validateRepository(repository);
  const number = event?.number;
  if (event?.action !== "closed" || event.repository?.full_name !== repository
    || !Number.isSafeInteger(number) || number < 1 || event.pull_request?.number !== number
    || event.pull_request.state !== "closed" || event.pull_request.base?.repo?.full_name !== repository) {
    throw new Error("review-label cleanup requires a matching closed pull-request event");
  }
  manifest = validateManifest(manifest === undefined ? await loadBaseLabels() : manifest);
  const names = labelNames(manifest.labels["under-review"]);
  const prefix = `repos/${repository}`;
  async function currentState() {
    const pull = await api("GET", `${prefix}/pulls/${number}`);
    if (pull?.number !== number || pull.base?.repo?.full_name !== repository || !["open", "closed"].includes(pull.state)) {
      throw new Error("invalid current pull-request identity or state");
    }
    return pull.state;
  }
  async function hasLabel(name) {
    for (let page = 1; page <= 1000; page++) {
      const labels = await api("GET", `${prefix}/issues/${number}/labels?per_page=100&page=${page}`);
      if (!Array.isArray(labels) || labels.length > 100 || labels.some(label => typeof label?.name !== "string")) {
        throw new Error("invalid pull-request label listing");
      }
      if (labels.some(label => label.name === name)) return true;
      if (labels.length < 100) return false;
    }
    throw new Error("pull-request label pagination limit exceeded");
  }
  if (await currentState() === "open") return { number, disposition: "reopened" };
  let removed = false;
  for (const name of names) {
    if (!await hasLabel(name)) continue;
    // Recheck before EACH alias removal; a closure can be followed by a new review after reopening.
    if (await currentState() === "open") return { number, disposition: "reopened" };
    try {
      await api("DELETE", `${prefix}/issues/${number}/labels/${encodeURIComponent(name)}`);
      removed = true;
    } catch (error) {
      if (error.status !== 404) throw error;
      // A 404 may mean an inaccessible PR. Confirm access and this exact assignment's absence.
      const state = await currentState();
      if (await hasLabel(name)) throw error;
      if (state === "open") return { number, disposition: "reopened" };
    }
  }
  return { number, disposition: removed ? "removed" : "absent" };
}

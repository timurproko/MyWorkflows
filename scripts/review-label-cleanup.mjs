import { labelApi, loadBaseLabels, validateManifest, validateRepository } from "./repository-labels.mjs";

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
  const name = manifest.labels["under-review"].name;
  const prefix = `repos/${repository}`;
  async function currentState() {
    const pull = await api("GET", `${prefix}/pulls/${number}`);
    if (pull?.number !== number || pull.base?.repo?.full_name !== repository || !["open", "closed"].includes(pull.state)) {
      throw new Error("invalid current pull-request identity or state");
    }
    return pull.state;
  }
  async function hasLabel() {
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
  if (!await hasLabel()) return { number, disposition: "absent" };
  // A queued close event must not intentionally clear a review started after reopening.
  if (await currentState() === "open") return { number, disposition: "reopened" };
  try {
    await api("DELETE", `${prefix}/issues/${number}/labels/${encodeURIComponent(name)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    // A 404 may mean an inaccessible PR, not absence. Confirm both access and absence before succeeding.
    await currentState();
    if (await hasLabel()) throw error;
    return { number, disposition: "absent" };
  }
  return { number, disposition: "removed" };
}

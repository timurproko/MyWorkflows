import { labelApi, labelNames, loadBaseLabels, validateManifest, validateRepository } from "./repository-labels.mjs";

export function managedReviewNames(manifest) {
  validateManifest(manifest);
  const keys = ["under-review", "review-approved", "review-changes-needed"];
  if (keys.some(key => !manifest.labels[key])) throw new Error("review cleanup requires all three managed review roles");
  return keys.flatMap(key => labelNames(manifest.labels[key]));
}

/** Closure clears transient Build/Review stages, not the Approved record (including its aliases). */
export function closedReviewNames(manifest) {
  managedReviewNames(manifest); // Still require and validate all three stable roles.
  return ["under-review", "review-changes-needed"].flatMap(key => labelNames(manifest.labels[key]));
}

/** Event-only final fallback. Normal review lifetime is owned by the signed-in review runner. */
export async function cleanupReviewLabel({ repository, event, api = labelApi, manifest }) {
  validateRepository(repository);
  const number = event?.number;
  if (event?.action !== "closed" || event.repository?.full_name !== repository
    || !Number.isSafeInteger(number) || number < 1 || event.pull_request?.number !== number
    || event.pull_request.state !== "closed" || event.pull_request.base?.repo?.full_name !== repository) {
    throw new Error("review-label cleanup requires a matching closed pull-request event");
  }
  return cleanupClosedReviewLabels({ repository, number, api, manifest, apply: true });
}

/** Shared manual/event core. Never trust a listing or old event as the current PR state. */
export async function cleanupClosedReviewLabels({ repository, number, api = labelApi, manifest, apply = false }) {
  validateRepository(repository);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("invalid pull-request number");
  const names = closedReviewNames(manifest === undefined ? await loadBaseLabels() : manifest);
  const prefix = `repos/${repository}`;
  async function currentState() {
    const pull = await api("GET", `${prefix}/pulls/${number}`);
    if (pull?.number !== number || pull.base?.repo?.full_name !== repository || !["open", "closed"].includes(pull.state)) {
      throw new Error("invalid current pull-request identity or state");
    }
    return pull.state;
  }
  async function assignedReviewNames() {
    const assigned = new Set();
    for (let page = 1; page <= 1000; page++) {
      const labels = await api("GET", `${prefix}/issues/${number}/labels?per_page=100&page=${page}`);
      if (!Array.isArray(labels) || labels.length > 100 || labels.some(label => typeof label?.name !== "string")) {
        throw new Error("invalid pull-request label listing");
      }
      for (const label of labels) if (names.includes(label.name)) assigned.add(label.name);
      if (labels.length < 100) return [...assigned];
    }
    throw new Error("pull-request label pagination limit exceeded");
  }
  if (await currentState() === "open") return { number, disposition: "reopened" };
  if (!apply) {
    const names = await assignedReviewNames();
    if (await currentState() === "open") return { number, disposition: "reopened" };
    return { number, disposition: names.length ? "would-remove" : "absent", names };
  }
  let removed = false;
  // Sync can rename an assigned definition while this independent job is removing it.
  // Rescan both transient roles after removals/404s, not just the now-missing old spelling.
  for (let pass = 0; pass <= names.length; pass++) {
    const assigned = await assignedReviewNames();
    if (!assigned.length) return { number, disposition: await currentState() === "open" ? "reopened" : removed ? "removed" : "absent" };
    for (const name of assigned) {
      if (await currentState() === "open") return { number, disposition: "reopened" };
      try {
        await api("DELETE", `${prefix}/issues/${number}/labels/${encodeURIComponent(name)}`);
        removed = true;
      } catch (error) {
        if (error.status !== 404) throw error;
        // A 404 may mean inaccessible PR, not a rename. Confirm access and exact-name absence.
        const state = await currentState();
        if ((await assignedReviewNames()).includes(name)) throw error;
        if (state === "open") return { number, disposition: "reopened" };
      }
    }
  }
  throw new Error("review assignments kept changing during cleanup; retry instead of reporting success");
}

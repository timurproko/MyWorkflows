import { labelApi, labelNames, loadBaseLabels, validateRepository } from "./repository-labels.mjs";
import { managedReviewNames } from "./review-label-cleanup.mjs";

const roles = ["under-review", "review-approved", "review-changes-needed"];
const later = (a, b) => a.time - b.time || a.id - b.id;

/** Assignment timestamps belong to issue events, NOT the label definition or workflow run. */
export function latestReviewAssignment(assigned, events, manifest) {
  const names = managedReviewNames(manifest);
  const role = name => roles.find(key => labelNames(manifest.labels[key]).includes(name));
  const latest = new Map(), byRole = new Map(), ids = new Set();
  for (const event of events) {
    if (!["labeled", "unlabeled"].includes(event?.event)) continue;
    if (typeof event.label?.name !== "string") throw new Error("invalid label event name");
    if (!names.includes(event.label.name)) continue;
    const time = Date.parse(event.created_at);
    if (!Number.isSafeInteger(event.id) || event.id < 1 || ids.has(event.id)
      || typeof event.created_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(event.created_at) || !Number.isFinite(time)) {
      throw new Error("invalid or repeated managed label event ordering");
    }
    ids.add(event.id);
    const entry = { ...event, time };
    for (const [map, key] of [[latest, event.label.name], [byRole, role(event.label.name)]]) {
      if (!map.has(key) || later(entry, map.get(key)) > 0) map.set(key, entry);
    }
  }
  const candidates = assigned.map(name => {
    let entry = latest.get(name);
    // Definition sync can rename an assignment without a new labeled event. History may
    // retain its previous spelling. Only resolve that ambiguity for a single assigned alias.
    if (!entry && assigned.filter(other => role(other) === role(name)).length === 1) entry = byRole.get(role(name));
    if (!entry || entry.event !== "labeled") throw new Error("current assignment has no confirmed addition in label history; retry");
    return { name, id: entry.id, time: entry.time };
  });
  return candidates.sort(later).at(-1);
}

/** Advisory event-only writer. Never adds labels or trusts webhook assignment snapshots. */
export async function reconcileReviewLabels({ repository, event, api = labelApi, manifest, enabled = process.env.DELIVERY_LABELS_ENABLED }) {
  if (enabled?.toLowerCase() === "false") return { disposition: "disabled" };
  validateRepository(repository);
  const number = event?.number;
  if (event?.action !== "labeled" || event.repository?.full_name !== repository
    || !Number.isSafeInteger(number) || number < 1 || event.pull_request?.number !== number
    || event.pull_request.base?.repo?.full_name !== repository || typeof event.label?.name !== "string"
    || !["open", "closed"].includes(event.pull_request.state)) {
    throw new Error("review-label reconciliation requires a matching labeled pull-request event");
  }
  if (event.pull_request.state !== "open" || event.pull_request.merged === true) return { number, disposition: "closed" };
  manifest ??= await loadBaseLabels();
  const names = managedReviewNames(manifest);
  if (!names.includes(event.label.name)) return { number, disposition: "unmanaged" };
  const prefix = `repos/${repository}`;
  async function open() {
    const pull = await api("GET", `${prefix}/pulls/${number}`);
    if (pull?.number !== number || pull.base?.repo?.full_name !== repository || !["open", "closed"].includes(pull.state)) {
      throw new Error("invalid current pull-request identity or state");
    }
    return pull.state === "open" && pull.merged !== true;
  }
  async function pages(resource) {
    const result = [];
    for (let page = 1; page <= 1000; page++) {
      const batch = await api("GET", `${prefix}/issues/${number}/${resource}?per_page=100&page=${page}`);
      if (!Array.isArray(batch) || batch.length > 100) throw new Error(`invalid ${resource} listing`);
      result.push(...batch);
      if (batch.length < 100) return result;
    }
    throw new Error(`${resource} pagination limit exceeded`);
  }
  async function assignments() {
    const labels = await pages("labels");
    if (labels.some(label => typeof label?.name !== "string") || new Set(labels.map(label => label.name)).size !== labels.length) {
      throw new Error("invalid or repeated label assignment");
    }
    return labels.map(label => label.name).filter(name => names.includes(name)).sort();
  }
  async function snapshot() {
    if (!await open()) return null;
    const assigned = await assignments();
    const winner = assigned.length > 1 ? latestReviewAssignment(assigned, await pages("events"), manifest) : undefined;
    if (!await open()) return null;
    return { assigned, winner };
  }
  let removed = false;
  // One deletion per fresh, twice-checked snapshot. External writers cannot be locked by
  // Actions concurrency; bound churn and leave an honest warning rather than false success.
  for (let pass = 0; pass < names.length * 3 + 3; pass++) {
    const before = await snapshot();
    if (!before) return { number, disposition: "closed" };
    if (before.assigned.length < 2) return { number, disposition: removed ? "reconciled" : "unchanged", kept: before.assigned[0] ?? null };
    const current = await snapshot();
    if (!current) return { number, disposition: "closed" };
    if (JSON.stringify(before) !== JSON.stringify(current)) continue;
    const name = current.assigned.find(name => name !== current.winner.name);
    // No endpoint supports an atomic delete-if-open-and-still-latest operation.
    try {
      await api("DELETE", `${prefix}/issues/${number}/labels/${encodeURIComponent(name)}`);
      removed = true;
    } catch (error) {
      if (error.status !== 404) throw error;
      // A 404 can hide denied access. Confirm PR access AND exact assignment absence.
      const stillOpen = await open();
      if ((await assignments()).includes(name)) throw error;
      if (!stillOpen) return { number, disposition: "closed" };
    }
  }
  throw new Error("review assignments kept changing during reconciliation; retry");
}

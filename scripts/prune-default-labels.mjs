import { labelApi, listLabels, validateRepository } from "./repository-labels.mjs";

// GitHub's unmodified default metadata is a pruning allowlist, not part of the managed base palette.
export const GITHUB_DEFAULT_LABELS = Object.freeze([
  { name: "accessibility", color: "f143ab", description: "Barrier affecting people with disabilities" },
  { name: "bug", color: "d73a4a", description: "Something isn't working" },
  { name: "documentation", color: "0075ca", description: "Improvements or additions to documentation" },
  { name: "duplicate", color: "cfd3d7", description: "This issue or pull request already exists" },
  { name: "enhancement", color: "a2eeef", description: "New feature or request" },
  { name: "good first issue", color: "7057ff", description: "Good for newcomers" },
  { name: "help wanted", color: "008672", description: "Extra attention is needed" },
  { name: "invalid", color: "e4e669", description: "This doesn't seem right" },
  { name: "question", color: "d876e3", description: "Further information is requested" },
  { name: "wontfix", color: "ffffff", description: "This will not be worked on" },
]);

function unmodified(label) {
  return label?.default === true && Number.isSafeInteger(label.id) && label.id > 0 && GITHUB_DEFAULT_LABELS.some(original => label.name === original.name
    && label.color?.toLowerCase() === original.color && label.description === original.description);
}

/** The REST issues endpoint includes pull requests; state=all preserves historical classifications. */
export async function labelUsage(repository, name, api = labelApi) {
  validateRepository(repository);
  const seen = new Set();
  let issues = 0, pullRequests = 0;
  for (let page = 1; page <= 1000; page++) {
    const batch = await api("GET", `repos/${repository}/issues?state=all&labels=${encodeURIComponent(name)}&per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length > 100) throw new Error("unreadable label usage; pruning refused");
    for (const issue of batch) {
      if (!Number.isSafeInteger(issue?.number) || issue.number < 1 || seen.has(issue.number)) throw new Error("invalid or repeated issue in label usage; pruning refused");
      seen.add(issue.number);
      if (issue.pull_request) pullRequests++; else issues++;
    }
    if (batch.length < 100) return { issues, pullRequests };
  }
  throw new Error("label usage pagination limit exceeded; pruning refused");
}

/** Explicit CLI operation only. Automatic sync never calls this function. */
export async function pruneDefaultLabels({ repository, apply = false, api = labelApi }) {
  validateRepository(repository);
  const existing = await listLabels(repository, api);
  const eligible = existing.filter(unmodified);
  // Read every candidate first: unreadable counts cannot follow an earlier deletion.
  const labels = [];
  for (const label of eligible) {
    const usage = await labelUsage(repository, label.name, api);
    labels.push({ name: label.name, ...usage, action: usage.issues || usage.pullRequests ? "retained-used" : "would-delete" });
  }
  if (apply) {
    for (const result of labels.filter(label => label.action === "would-delete")) {
      const path = `repos/${repository}/labels/${encodeURIComponent(result.name)}`;
      let current;
      try { current = await api("GET", path); }
      catch (error) { if (error.status === 404) { result.action = "skipped-missing"; continue; } throw error; }
      const original = eligible.find(label => label.name === result.name);
      if (!unmodified(current) || current.id !== original.id || current.name !== result.name) { result.action = "skipped-changed"; continue; }
      const usage = await labelUsage(repository, result.name, api);
      Object.assign(result, usage);
      if (usage.issues || usage.pullRequests) { result.action = "retained-used"; continue; }
      // GitHub has no atomic delete-if-unused. The separately authorized maintenance window must be quiet.
      await api("DELETE", path);
      result.action = "deleted";
    }
  }
  return { repository, applied: apply, labels, preserved: existing.filter(label => !unmodified(label)).map(label => label.name),
    warning: "Deleting a label removes all its assignments. A final usage-read/DELETE race remains; authorize pruning separately in a quiet maintenance window." };
}

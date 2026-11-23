import { appendFile, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { folded, labelApi, labelMetadata, listLabels, REFERENCE_REPOSITORY, validateManifest } from "./repository-labels.mjs";

const prefix = `repos/${REFERENCE_REPOSITORY}`;
const path = "labels/base.json";
const branchPrefix = "chore/reference-labels-";
const title = "chore(labels): reconcile reference definitions";
const same = (a, b) => JSON.stringify(labelMetadata(a)) === JSON.stringify(labelMetadata(b));
const signature = labels => JSON.stringify(labels.map(label => [label.id, label.node_id, labelMetadata(label)]).sort((a, b) => a[0] - b[0]));
export const referenceBody = `## Proposal

Accept validated edits to the managed reference labels and preserve their previous names for assignment-safe consumer renames.

## Implementation

- [x] Managed reference metadata and alias history match the validated source labels.

## Acceptance

- Stable reference identities and current names are validated before publication.
- Consumer definitions migrate on their next delivery event without automatic deletion.
`;

/** Pure reconciliation: event strings are data, identities are never inferred from names. */
export function reconcileReferenceManifest({ manifest, pendingManifest, live, event }) {
  validateManifest(manifest);
  if (pendingManifest) validateManifest(pendingManifest);
  if (event && (event.repository?.full_name !== REFERENCE_REPOSITORY || !["edited", "created", "deleted"].includes(event.action))) {
    throw new Error("reference reconciliation requires a matching label event");
  }
  const entries = Object.entries(manifest.labels);
  if (entries.some(([, label]) => !label.reference)) throw new Error("every managed label requires a reference identity");
  const matched = event && entries.find(([, label]) => label.reference.id === event.label?.id);
  if (event && !matched) return { disposition: "unmanaged", manifest };
  if (matched && matched[1].reference.nodeId !== event.label?.node_id) throw new Error("reference node identity mismatch");
  if (event?.action === "deleted") throw new Error("managed reference deleted; retain manifest and rebind only by reviewed change");
  if (event?.action === "created") return { disposition: "unmanaged", manifest };
  if (event?.changes?.name && typeof event.changes.name.from !== "string") throw new Error("invalid previous reference name");
  // Validate event metadata too, even if a later live edit supersedes this event.
  if (matched) validateManifest({ version: 1, labels: { "under-review": labelMetadata(event.label) } });
  const next = structuredClone(manifest);
  for (const [key, label] of entries) {
    const source = live.find(item => item.id === label.reference.id);
    if (!source || source.node_id !== label.reference.nodeId) throw new Error("managed reference missing or replaced; no destructive propagation");
    const pending = pendingManifest?.labels[key];
    if (pending && (pending.reference?.id !== label.reference.id || pending.reference?.nodeId !== label.reference.nodeId)) {
      throw new Error("pending reference identity changed; manual review required");
    }
    // Keep an intentional bootstrap request until normal sync applies it, provided the UI has not drifted.
    const desired = same(source, label.reference) && !same(label, label.reference) ? labelMetadata(label) : labelMetadata(source);
    const history = [...(label.previousNames ?? []), ...(pending?.previousNames ?? []), label.name,
      ...(pending ? [pending.name] : []), ...(matched?.[0] === key && event.changes?.name ? [event.changes.name.from] : [])];
    const seen = new Set([folded(desired.name)]);
    const previousNames = history.filter(name => {
      // Validate before folding, including history supplied by stale events.
      validateManifest({ version: 1, labels: { "under-review": { name, color: label.color, description: "" } } });
      if (seen.has(folded(name))) return false;
      seen.add(folded(name)); return true;
    });
    next.labels[key] = { ...desired, previousNames, reference: { id: source.id, nodeId: source.node_id, ...labelMetadata(source) } };
  }
  validateManifest(next);
  return { disposition: JSON.stringify(next) === JSON.stringify(manifest) ? "unchanged" : "reconciled", manifest: next };
}

async function pages(api, route) {
  const all = [];
  for (let page = 1; page <= 1000; page++) {
    const batch = await api("GET", `${prefix}/${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length > 100) throw new Error("invalid reference pagination");
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  throw new Error("reference pagination limit exceeded");
}
async function manifestAt(api, ref) {
  const file = await api("GET", `${prefix}/contents/${path}?ref=${encodeURIComponent(ref)}`);
  if (file?.encoding !== "base64" || typeof file.content !== "string") throw new Error("invalid reference manifest response");
  return validateManifest(JSON.parse(Buffer.from(file.content, "base64").toString("utf8")));
}
async function headAt(api, branch) {
  const ref = await api("GET", `${prefix}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!/^[a-f0-9]{40}$/.test(ref?.object?.sha ?? "")) throw new Error("invalid reference branch head");
  return ref.object.sha;
}

/** Publish data only, through a topic PR. No API route in this function writes labels or the default branch. */
export async function reconcileReference({ api = labelApi, apply = false, event, now = Date.now }) {
  const repo = await api("GET", prefix);
  if (repo?.full_name !== REFERENCE_REPOSITORY || typeof repo.default_branch !== "string" || !repo.default_branch) throw new Error("invalid reference repository");
  const base = repo.default_branch;
  const baseHead = await headAt(api, base);
  const manifest = await manifestAt(api, baseHead);
  // Ignore unrelated events before looking at or publishing any pending PR.
  if (event && !Object.values(manifest.labels).some(label => label.reference?.id === event.label?.id)) {
    reconcileReferenceManifest({ manifest, live: [], event });
    return { disposition: "unmanaged", applied: false };
  }
  const pulls = (await pages(api, `pulls?state=open&base=${encodeURIComponent(base)}`)).filter(pull =>
    pull.head?.repo?.full_name === REFERENCE_REPOSITORY && pull.head?.ref?.startsWith(branchPrefix));
  if (pulls.length > 1) throw new Error("multiple reference PRs; manual review required");
  const pull = pulls[0];
  const branch = pull?.head.ref ?? `${branchPrefix}${now()}`;
  const head = pull ? await headAt(api, branch) : baseHead;
  let pendingManifest;
  if (pull) {
    const files = await pages(api, `pulls/${pull.number}/files`);
    const commits = await pages(api, `pulls/${pull.number}/commits`);
    if (pull.title !== title || !files.length || files.some(file => file.filename !== path || file.previous_filename)
      || !commits.length || commits.some(commit => commit.commit?.message !== title)) {
      throw new Error("reference branch contains manual or unrelated edits; refusing to overwrite");
    }
    pendingManifest = await manifestAt(api, head);
  }
  const live = await listLabels(REFERENCE_REPOSITORY, api);
  const result = reconcileReferenceManifest({ manifest, pendingManifest, live, event });
  const content = `${JSON.stringify(result.manifest, null, 2)}\n`;
  const baseline = pendingManifest ?? manifest;
  const changed = JSON.stringify(result.manifest) !== JSON.stringify(baseline);
  if (!apply || !changed) return { ...result, disposition: changed ? "would-publish" : "unchanged", applied: false, pr: pull?.html_url };
  // All preflight reads finish before writes. Optimistic ref updates reject sibling concurrent commits.
  if (signature(live) !== signature(await listLabels(REFERENCE_REPOSITORY, api))) throw new Error("reference labels changed during reconciliation; retry");
  if (await headAt(api, base) !== baseHead || (pull && await headAt(api, branch) !== head)) throw new Error("reference branch changed during reconciliation; retry");
  const commit = await api("GET", `${prefix}/git/commits/${head}`);
  if (!/^[a-f0-9]{40}$/.test(commit?.tree?.sha ?? "")) throw new Error("invalid reference commit tree");
  const tree = await api("POST", `${prefix}/git/trees`, { base_tree: commit.tree.sha,
    tree: [{ path, mode: "100644", type: "blob", content }] });
  const created = await api("POST", `${prefix}/git/commits`, { message: title, tree: tree.sha, parents: [head] });
  if (pull) await api("PATCH", `${prefix}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: created.sha, force: false });
  else await api("POST", `${prefix}/git/refs`, { ref: `refs/heads/${branch}`, sha: created.sha });
  const published = pull
    ? await api("PATCH", `${prefix}/pulls/${pull.number}`, { body: referenceBody })
    : await api("POST", `${prefix}/pulls`, { title, head: branch, base, draft: true, body: referenceBody });
  return { ...result, disposition: "published", applied: true, pr: published.html_url ?? pull?.html_url };
}

export async function referenceMain(args, { api = labelApi, event } = {}) {
  const { values } = parseArgs({ args, options: { apply: { type: "boolean" } } });
  return reconcileReference({ api, event, apply: Boolean(values.apply) });
}
export async function referenceAutomationMain({ environment = process.env, api = labelApi, report = console.log } = {}) {
  try {
    if (environment.GITHUB_ACTIONS !== "true" || environment.GITHUB_REPOSITORY !== REFERENCE_REPOSITORY
      || !["label", "workflow_dispatch"].includes(environment.GITHUB_EVENT_NAME)) throw new Error("trusted reference workflow required");
    const apply = environment.REFERENCE_APPLY === "true";
    if (apply && (!environment.REFERENCE_APP_TOKEN || environment.GH_TOKEN !== environment.REFERENCE_APP_TOKEN)) throw new Error("separate reference App token required");
    const event = environment.GITHUB_EVENT_NAME === "label" ? JSON.parse(await readFile(environment.GITHUB_EVENT_PATH, "utf8")) : undefined;
    const result = await reconcileReference({ api, apply, event });
    // Only trusted enums/PR numbers are printed; UI strings stay in the JSON manifest diff.
    const message = `Reference labels: ${result.disposition}. UI edits propagate only after the reference PR merges and each consumer's next delivery event.`;
    report(message);
    const link = /^https:\/\/github\.com\/timurproko\/MyWorkflows\/pull\/[1-9]\d*$/.test(result.pr ?? "") ? `\n${result.pr}\n` : "";
    const data = result.manifest ? JSON.stringify(result.manifest, null, 2).replace(/[<>&`]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`) : "";
    if (environment.GITHUB_STEP_SUMMARY) await appendFile(environment.GITHUB_STEP_SUMMARY, `## Reference labels\n${message}\n${link}${data ? `\nProposed manifest (current main remains accepted until merge):\n\n\`\`\`json\n${data}\n\`\`\`\n` : ""}`);
    return 0;
  } catch (error) {
    const reasons = ["managed reference deleted", "managed reference missing or replaced", "invalid base-label manifest", "reference labels changed during reconciliation", "reference branch changed during reconciliation", "reference branch contains manual or unrelated edits"];
    const reason = reasons.find(value => error.message?.startsWith(value)) ?? "check managed identities, valid metadata/history, live reference access and pending PR edits";
    const message = `Reference label reconciliation blocked: ${reason}. No consumer label writes or automatic deletion were attempted.`;
    report(`::warning::${message}`);
    if (environment.GITHUB_STEP_SUMMARY) await appendFile(environment.GITHUB_STEP_SUMMARY, `## Reference labels\n${message}\n`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await referenceAutomationMain();

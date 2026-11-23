import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify, parseArgs } from "node:util";

const run = promisify(execFile);
export const folded = name => name.normalize("NFC").toLowerCase();
export const REFERENCE_REPOSITORY = "timurproko/MyWorkflows";
export const labelNames = label => [label.name, ...(label.previousNames ?? [])];
export const labelMetadata = label => ({ name: label.name, color: label.color, description: label.description ?? "" });
const sameMetadata = (a, b) => a?.name === b.name && a.color?.toLowerCase() === b.color.toLowerCase() && (a.description ?? "") === b.description;

async function referencePublicationPending(repository, api) {
  for (let page = 1; page <= 1000; page++) {
    const pulls = await api("GET", `repos/${repository}/pulls?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(pulls) || pulls.length > 100) throw new Error("invalid reference pull-request listing");
    if (pulls.some(pull => pull.head?.repo?.full_name?.toLowerCase() === REFERENCE_REPOSITORY.toLowerCase()
      && pull.head?.ref?.startsWith("chore/reference-labels-"))) return true;
    if (pulls.length < 100) return false;
  }
  throw new Error("reference pull-request pagination limit exceeded");
}
const text = (value, max) => typeof value === "string" && [...value].length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

export function validateRepository(repository) {
  const parts = typeof repository === "string" ? repository.split("/") : [];
  const [owner = "", name = ""] = parts;
  if (parts.length !== 2 || owner.length > 39 || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(owner)
    || name.length > 100 || !/^[A-Za-z0-9_.-]+$/.test(name) || name === "." || name === "..") {
    throw new Error("name one repository as owner/name");
  }
  return repository;
}

export function validateManifest(manifest) {
  const invalid = () => { throw new Error("invalid base-label manifest"); };
  if (!manifest || manifest.version !== 1 || Object.keys(manifest).some(key => !["version", "labels"].includes(key))
    || !manifest.labels || Array.isArray(manifest.labels) || typeof manifest.labels !== "object"
    || !Object.hasOwn(manifest.labels, "under-review")) invalid();
  const names = new Map(), ids = new Set(), nodes = new Set();
  const validName = name => text(name, 50) && name.trim() && name === name.trim();
  const validMetadata = label => validName(label.name) && typeof label.color === "string"
    && /^[0-9a-fA-F]{6}$/.test(label.color) && text(label.description, 100);
  for (const [key, label] of Object.entries(manifest.labels)) {
    if (!/^[a-z][a-z0-9-]*$/.test(key) || !label || typeof label !== "object" || Array.isArray(label)
      || Object.keys(label).some(field => !["color", "description", "name", "previousNames", "reference"].includes(field))
      || !validMetadata(label) || (label.previousNames !== undefined && !Array.isArray(label.previousNames))) invalid();
    const exact = new Set();
    for (const name of labelNames(label)) {
      if (!validName(name) || exact.has(name) || (names.has(folded(name)) && names.get(folded(name)) !== key)) invalid();
      // Explicit same-role aliases permit deliberate case/Unicode-only renames; never cross roles.
      exact.add(name); names.set(folded(name), key);
    }
    if (label.reference !== undefined) {
      const ref = label.reference;
      if (!ref || Object.keys(ref).sort().join(",") !== "color,description,id,name,nodeId" || !validMetadata(ref)
        || !Number.isSafeInteger(ref.id) || ref.id < 1 || !/^[A-Za-z0-9_-]+$/.test(ref.nodeId ?? "")
        || ids.has(ref.id) || nodes.has(ref.nodeId)) invalid();
      ids.add(ref.id); nodes.add(ref.nodeId);
    }
  }
  return manifest;
}

export async function loadBaseLabels() {
  return validateManifest(JSON.parse(await readFile(new URL("../labels/base.json", import.meta.url), "utf8")));
}

/** Only these trusted routes are constructed by the caller; credentials come from gh's normal login or GH_TOKEN. */
export async function labelApi(method, path, body) {
  const child = run("gh", ["api", "-X", method, "-H", "X-GitHub-Api-Version: 2022-11-28", path,
    ...(body === undefined ? [] : ["--input", "-"])], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
  if (body !== undefined) child.child.stdin.end(JSON.stringify(body));
  try {
    const { stdout } = await child;
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch (error) {
    // Do not echo API bodies or credential-bearing subprocess errors into workflow annotations.
    const status = Number(error.stderr?.match(/\(HTTP (\d{3})\)/)?.[1]) || undefined;
    throw Object.assign(new Error(status ? `GitHub label API returned HTTP ${status}` : "GitHub label API request failed"), { status });
  }
}

export async function listLabels(repository, api = labelApi) {
  validateRepository(repository);
  const labels = [];
  const names = new Set();
  for (let page = 1; page <= 1000; page++) {
    const batch = await api("GET", `repos/${repository}/labels?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length > 100) throw new Error("invalid label listing");
    for (const label of batch) {
      if (!label || !text(label.name, 50) || !label.name.trim() || typeof label.color !== "string" || !/^[0-9a-fA-F]{6}$/.test(label.color)
        || !(label.description === null || text(label.description, 100)) || names.has(folded(label.name))) {
        throw new Error("invalid or repeated label in listing");
      }
      names.add(folded(label.name));
      labels.push(label);
    }
    if (batch.length < 100) return labels;
  }
  throw new Error("label pagination limit exceeded; nothing was synchronized");
}

/** Sync renames/upserts managed definitions, never deleting labels or changing assignments. */
export async function syncLabels({ repository, apply = false, api = labelApi, manifest }) {
  validateRepository(repository);
  manifest = validateManifest(manifest === undefined ? await loadBaseLabels() : manifest);
  const existing = await listLabels(repository, api);
  const managed = new Set(Object.values(manifest.labels).map(label => folded(label.name)));
  const conflicts = [];
  const referenceRepository = repository.toLowerCase() === REFERENCE_REPOSITORY.toLowerCase();
  const referencePending = referenceRepository && await referencePublicationPending(repository, api);
  // Compare every current/legacy name before the first write. Never guess through collisions.
  const labels = Object.entries(manifest.labels).map(([key, wanted]) => {
    const matches = labelNames(wanted).map(name => {
      const found = existing.find(label => folded(label.name) === folded(name));
      if (found && found.name !== name) {
        if (labelNames(wanted).includes(found.name)) return undefined;
        throw new Error("managed label name collides with a differently cased or normalized name");
      }
      return found;
    });
    let [current, ...old] = matches;
    if (referenceRepository) {
      if (!wanted.reference) throw new Error("reference sync requires recorded label identities");
      const source = existing.find(label => label.id === wanted.reference.id);
      if (!source || source.node_id !== wanted.reference.nodeId || (current && current.id !== source.id)
        || (!sameMetadata(source, wanted) && (referencePending || !sameMetadata(source, wanted.reference)))) {
        return { key, name: wanted.name, action: "reference-drift" };
      }
      if (sameMetadata(source, wanted)) return { key, name: wanted.name, action: "unchanged" };
      if (source.name !== wanted.name) {
        managed.add(folded(source.name));
        return { key, name: wanted.name, action: "rename", previousName: source.name };
      }
      return { key, name: wanted.name, action: "update" };
    }
    const legacy = old.filter(Boolean);
    if (current && legacy.length) conflicts.push({ key, kept: current.name, preserved: legacy.map(label => label.name) });
    if (!current && legacy.length > 1) throw new Error("multiple previous managed label names exist; rename is ambiguous");
    const source = current ?? legacy[0];
    if (!current && source) managed.add(folded(source.name));
    return { key, name: wanted.name, action: !source ? "create" : !current ? "rename"
      : source.color.toLowerCase() !== wanted.color.toLowerCase() || (source.description ?? "") !== wanted.description ? "update" : "unchanged",
      ...(!current && source ? { previousName: source.name } : {}) };
  });
  if (apply) {
    for (const label of labels) {
      const wanted = manifest.labels[label.key];
      if (referenceRepository && ["update", "rename"].includes(label.action)) {
        // Narrow the UI-edit/PATCH race. GitHub offers no atomic conditional label update.
        const source = await api("GET", `repos/${repository}/labels/${encodeURIComponent(label.previousName ?? label.name)}`);
        if (source?.id !== wanted.reference.id || source.node_id !== wanted.reference.nodeId || !sameMetadata(source, wanted.reference)
          || await referencePublicationPending(repository, api)) {
          label.action = "reference-drift";
          continue;
        }
      }
      if (label.action === "create") await api("POST", `repos/${repository}/labels`, labelMetadata(wanted));
      if (["update", "rename"].includes(label.action)) await api("PATCH",
        `repos/${repository}/labels/${encodeURIComponent(label.previousName ?? label.name)}`,
        { ...(label.action === "rename" ? { new_name: wanted.name } : {}), color: wanted.color, description: wanted.description });
    }
  }
  return { repository, applied: apply, labels, preserved: existing.filter(label => !managed.has(folded(label.name))).map(label => label.name),
    ...(conflicts.length ? { conflicts } : {}) };
}

export async function labelsMain(args, { api = labelApi, manifest } = {}) {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, apply: { type: "boolean" }, "prune-unused-defaults": { type: "boolean" } } });
  if (values["prune-unused-defaults"]) {
    const { pruneDefaultLabels } = await import("./prune-default-labels.mjs");
    return pruneDefaultLabels({ repository: values.repo, apply: Boolean(values.apply), api, manifest });
  }
  return syncLabels({ repository: values.repo, apply: Boolean(values.apply), api, manifest });
}

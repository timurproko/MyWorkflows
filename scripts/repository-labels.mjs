import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify, parseArgs } from "node:util";

const run = promisify(execFile);
const folded = name => name.normalize("NFC").toLowerCase();
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
  const names = new Set();
  for (const [key, label] of Object.entries(manifest.labels)) {
    if (!/^[a-z][a-z0-9-]*$/.test(key) || !label || Object.keys(label).sort().join(",") !== "color,description,name"
      || !text(label.name, 50) || !label.name.trim() || label.name !== label.name.trim()
      || typeof label.color !== "string" || !/^[0-9a-fA-F]{6}$/.test(label.color) || !text(label.description, 100)) invalid();
    const name = folded(label.name);
    if (names.has(name)) invalid();
    names.add(name);
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

/** Sync only upserts managed definitions. It never deletes labels or changes any assignments. */
export async function syncLabels({ repository, apply = false, api = labelApi, manifest }) {
  validateRepository(repository);
  manifest = validateManifest(manifest === undefined ? await loadBaseLabels() : manifest);
  const existing = await listLabels(repository, api);
  const managed = new Set(Object.values(manifest.labels).map(label => folded(label.name)));
  // Preflight the whole comparison before the first write, including case-colliding custom names.
  const labels = Object.entries(manifest.labels).map(([key, wanted]) => {
    const current = existing.find(label => folded(label.name) === folded(wanted.name));
    if (current && current.name !== wanted.name) throw new Error("managed label name collides with a differently cased or normalized name");
    return { key, name: wanted.name, action: !current ? "create"
      : current.color.toLowerCase() !== wanted.color.toLowerCase() || (current.description ?? "") !== wanted.description ? "update" : "unchanged" };
  });
  if (apply) {
    for (const label of labels) {
      const wanted = manifest.labels[label.key];
      if (label.action === "create") await api("POST", `repos/${repository}/labels`, wanted);
      if (label.action === "update") await api("PATCH", `repos/${repository}/labels/${encodeURIComponent(label.name)}`,
        { color: wanted.color, description: wanted.description });
    }
  }
  return { repository, applied: apply, labels, preserved: existing.filter(label => !managed.has(folded(label.name))).map(label => label.name) };
}

export async function labelsMain(args, { api = labelApi } = {}) {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, apply: { type: "boolean" }, "prune-unused-defaults": { type: "boolean" } } });
  if (values["prune-unused-defaults"]) {
    const { pruneDefaultLabels } = await import("./prune-default-labels.mjs");
    return pruneDefaultLabels({ repository: values.repo, apply: Boolean(values.apply), api });
  }
  return syncLabels({ repository: values.repo, apply: Boolean(values.apply), api });
}

import { snapshotOpenSpec } from "./openspec-archive-staging.mjs";
import { archiveFailure, inspectTasks, parseImplementation, retiredCapability, SHA } from "./openspec-archive-policy.mjs";
import { parseImplementationAcceptanceScenarios } from "./openspec-acceptance-checklist.mjs";
import { assertManualAcceptanceMerge, requireAcceptance } from "./openspec-acceptance-policy.mjs";
import { parseAssociationRepair } from "./openspec-association-repair.mjs";
import { parseConditionalAcceptance, verifyConditionalAcceptance } from "./openspec-delivery-policy.mjs";
import { targetBranch } from "./delivery-target.mjs";
import { classifySpecBase, replaySpecSnapshot } from "./spec-base-impact.mjs";

export function createArchiveReader({ repository, token, fetchImpl = fetch, apiUrl = "https://api.github.com", deadline = Infinity }) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw archiveFailure("repository-identity");
  const prefix = `/repos/${repository}`;
  async function get(path) {
    const search = path.startsWith("/search/issues?") && new URLSearchParams(path.split("?")[1]).get("q")?.startsWith(`repo:${repository} `);
    if ((!path.startsWith(`${prefix}/`) && !search) || /[\r\n]/.test(path)) throw archiveFailure("api-scope");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw archiveFailure("archive-deadline");
    let response;
    try {
      response = await fetchImpl(`${apiUrl}${path}`, {
        headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}), "x-github-api-version": "2022-11-28" },
        signal: AbortSignal.timeout(Math.min(20_000, remaining)), redirect: "error",
      });
    } catch { throw archiveFailure("github-unavailable"); }
    if (!response.ok) throw archiveFailure(response.status === 404 ? "github-not-found" : "github-request", String(response.status));
    const body = await response.text();
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw archiveFailure("github-response-size");
    try { return JSON.parse(body); } catch { throw archiveFailure("github-response-json"); }
  }
  return archiveReaderFromGet(repository, get);
}

export function archiveReaderFromGet(repository, get) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw archiveFailure("repository-identity");
  const prefix = `/repos/${repository}`;
  async function pages(path, limit = 1000, field = null) {
    const items = [];
    for (let page = 1; page <= Math.ceil(limit / 100); page += 1) {
      const result = await get(`${prefix}${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const batch = field ? result[field] : result;
      if (!Array.isArray(batch)) throw archiveFailure("github-pagination");
      items.push(...batch);
      if (batch.length < 100 || field && result.total_count === items.length) return items;
    }
    throw archiveFailure("github-pagination-limit");
  }
  async function ancestor(base, head) {
    if (!SHA.test(base) || !SHA.test(head)) throw archiveFailure("commit-identity");
    const comparison = await get(`${prefix}/compare/${base}...${head}`);
    if (!["ahead", "identical"].includes(comparison.status) || comparison.merge_base_commit?.sha !== base) {
      throw archiveFailure("commit-ancestry");
    }
  }
  return { repository, prefix, get, pages, ancestor };
}

async function snapshotBytes(snapshot, paths) {
  return await Promise.all(paths.map(async path => {
    const bytes = await snapshot.blob(path);
    if (!bytes) throw archiveFailure("delivery-content-missing", path);
    return [path, bytes];
  }));
}

export async function inspectVersion3DeliverySnapshot(reader, pull, implementation, sha, { allowLegacyVersion3Phase = false } = {}) {
  requireAcceptance(implementation?.version === 3 && implementation.archive && implementation.acceptanceManifest
    && implementation.acceptanceManifest === `${implementation.archive}acceptance.md`, "delivery-not-finalized");
  const snapshot = await snapshotOpenSpec(reader, sha);
  const active = `openspec/changes/${implementation.change}/`;
  requireAcceptance(![...snapshot.entries.keys()].some(path => path.startsWith(active)), "delivery-change-still-active");
  const archivePaths = [...snapshot.entries.keys()].filter(path => path.startsWith(implementation.archive)).sort();
  for (const required of [".openspec.yaml", "proposal.md", "design.md", "tasks.md", "acceptance.md"]) {
    requireAcceptance(archivePaths.includes(`${implementation.archive}${required}`), "delivery-artifact-missing");
  }
  const manifestText = (await snapshot.blob(implementation.acceptanceManifest))?.toString();
  requireAcceptance(manifestText, "delivery-manifest-missing");
  const manifest = parseConditionalAcceptance(manifestText);
  const contentPaths = archivePaths.filter(path => path !== implementation.acceptanceManifest);
  const archiveEntries = await snapshotBytes(snapshot, contentPaths);
  const evidenceEntries = archiveEntries.filter(([path]) => /(?:^|\/)(?:evidence\/|implementation-evidence\.md$)/.test(path));
  const tasksBytes = await snapshot.blob(`${implementation.archive}tasks.md`);
  requireAcceptance(tasksBytes, "delivery-tasks-missing");
  inspectTasks(tasksBytes.toString());
  const capabilities = [...new Set(contentPaths.flatMap(path => {
    const suffix = path.slice(implementation.archive.length);
    const match = /^specs\/(.+)\/spec\.md$/.exec(suffix);
    return match ? [match[1]] : [];
  }))];
  const metadata = (await snapshot.blob(`${implementation.archive}.openspec.yaml`))?.toString();
  const retired = new Set();
  for (const capability of capabilities) {
    if (await snapshot.blob(`openspec/specs/${capability}/spec.md`)) continue;
    if (retiredCapability(metadata, (await snapshot.blob(`${implementation.archive}specs/${capability}/spec.md`))?.toString())) retired.add(capability);
  }
  // Invariant: a capability the change retires has no canonical spec; every other one must still exist.
  const specEntries = await snapshotBytes(snapshot, capabilities.filter(capability => !retired.has(capability)).map(capability => `openspec/specs/${capability}/spec.md`));
  const scenarios = parseImplementationAcceptanceScenarios(pull.body ?? "", 3, { allowLegacyVersion3Phase });
  const verified = verifyConditionalAcceptance(manifest, { implementation, repository: reader.repository, sourcePr: pull.number,
    archiveEntries, specEntries, evidenceEntries, tasksBytes, scenarios, knownGaps: manifest.knownGaps });
  const repairBytes = await snapshot.blob(`${implementation.archive}association-repair.json`);
  const associationRepair = repairBytes ? parseAssociationRepair(repairBytes.toString()) : null;
  requireAcceptance(!associationRepair || associationRepair.repository === reader.repository
    && associationRepair.change === implementation.change && associationRepair.correctivePr === pull.number,
  "association-repair-corrective");
  const retiredSpecPaths = [...retired].map(capability => `openspec/specs/${capability}/spec.md`);
  return { snapshot, manifest, archiveEntries, specEntries, retiredSpecPaths, evidenceEntries, tasksBytes, scenarios, associationRepair, ...verified };
}

/** Head integrity is verified first; this classifier then proves whether base advancement matters. */
export async function inspectDeliveryBaseImpact(reader, pull, implementation, value, { targetSha = pull.base.sha } = {}) {
  const cache = new Map([[pull.head.sha, value.snapshot]]);
  const snapshot = sha => {
    if (!cache.has(sha)) cache.set(sha, snapshotOpenSpec(reader, sha));
    return cache.get(sha);
  };
  return await classifySpecBase({ baseline: value.manifest.specBaseSha, target: targetSha, head: pull.head.sha,
    change: implementation.change, archive: implementation.archive, ancestor: reader.ancestor, snapshot,
    replay: options => replaySpecSnapshot({ ...options, body: pull.body, implementation, repository: reader.repository,
      number: pull.number, targetSha }) });
}

async function verifyAssociationRepairSource(reader, correctivePull, record) {
  if (!record) return;
  const source = await reader.get(`${reader.prefix}/pulls/${record.sourcePr}`);
  let implementation;
  try { implementation = parseImplementation(source.body ?? ""); }
  catch { throw archiveFailure("association-repair-source-metadata"); }
  requireAcceptance(!implementation && source.number === record.sourcePr && source.merged === true && source.state === "closed"
    && source.draft === false && source.base?.ref === targetBranch() && source.base?.repo?.full_name === reader.repository
    && source.head?.repo?.full_name === reader.repository && source.head?.sha === record.sourceHead
    && source.merge_commit_sha === record.sourceMerge && source.number !== correctivePull.number,
  "association-repair-source");
  const validation = await findImplementationValidation(reader, source);
  requireAcceptance(validation.runId === record.validationRunId, "association-repair-validation");
  const actor = source.merged_by?.login;
  requireAcceptance(/^[a-zA-Z0-9-]{1,39}$/.test(actor ?? ""), "association-repair-merge-authority");
  const [permission, events] = await Promise.all([
    reader.get(`${reader.prefix}/collaborators/${actor}/permission`),
    reader.pages(`/issues/${source.number}/timeline`, 1000),
  ]);
  try { assertManualAcceptanceMerge(source, permission.permission, events); }
  catch { throw archiveFailure("association-repair-merge-authority"); }
}

export async function validateVersion3Candidate(reader, number) {
  if (!Number.isSafeInteger(number) || number < 1) throw archiveFailure("implementation-pr");
  const pull = await reader.get(`${reader.prefix}/pulls/${number}`);
  const implementation = parseImplementation(pull.body ?? "");
  requireAcceptance(implementation?.version === 3, "delivery-version");
  requireAcceptance(implementation.finalizedHead === pull.head?.sha, "delivery-head-stale");
  const files = await reader.pages(`/pulls/${number}/files`, 3000);
  requireAcceptance(pull.number === number && pull.state === "open" && pull.draft === false && pull.base?.ref === targetBranch()
    && pull.base?.repo?.full_name === reader.repository && pull.head?.repo?.full_name === reader.repository
    && SHA.test(pull.base?.sha ?? "") && SHA.test(pull.head?.sha ?? "")
    && files.length > 0 && files.length === pull.changed_files, "delivery-candidate-identity");
  const targetPath = `${reader.prefix}/git/ref/heads/${targetBranch()}`;
  const target = await reader.get(targetPath);
  const targetSha = target.object?.sha;
  requireAcceptance(SHA.test(targetSha ?? ""), "delivery-target-identity");
  const value = await inspectVersion3DeliverySnapshot(reader, pull, implementation, pull.head.sha);
  // The PR API base can be historical; classify and replay against this trusted canonical snapshot instead.
  const impact = await inspectDeliveryBaseImpact(reader, pull, implementation, value, { targetSha });
  requireAcceptance(impact.disposition === "valid", "delivery-spec-base-invalidated");
  await verifyAssociationRepairSource(reader, pull, value.associationRepair);
  const changed = new Set(files.flatMap(file => [file.filename, ...(file.status === "renamed" ? [file.previous_filename] : [])]));
  requireAcceptance(value.archiveEntries.every(([path]) => changed.has(path)) && changed.has(implementation.acceptanceManifest),
    "delivery-diff-incomplete");
  // Invariant: a delivery may change only the specs it digests, plus the specs it retires by deleting them.
  const specPaths = new Set([...value.specEntries.map(([path]) => path), ...value.retiredSpecPaths]);
  const activePrefix = `openspec/changes/${implementation.change}/`;
  const deliveredArchivePaths = new Set([...value.archiveEntries.map(([path]) => path), implementation.acceptanceManifest]);
  const archivedSources = new Set(files.flatMap(file => {
    const source = file.status === "renamed" ? file.previous_filename : file.status === "removed" ? file.filename : null;
    if (typeof source !== "string" || !source.startsWith(activePrefix)) return [];
    const expected = `${implementation.archive}${source.slice(activePrefix.length)}`;
    return deliveredArchivePaths.has(expected) && (file.status === "removed" || file.filename === expected) ? [source] : [];
  }));
  for (const path of changed) {
    if (path.startsWith("openspec/changes/") && !path.startsWith(implementation.archive) && !archivedSources.has(path)) {
      throw archiveFailure("delivery-unexpected-openspec-path", path);
    }
    if (path.startsWith("openspec/specs/") && !specPaths.has(path)) throw archiveFailure("delivery-unexpected-openspec-path", path);
  }
  // A historical PR base is allowed, but a target that moves during validation is not certified.
  const currentTarget = await reader.get(targetPath);
  requireAcceptance(currentTarget.object?.sha === targetSha, "delivery-target-stale");
  return { disposition: "ready-for-maintainer-integration", pull, implementation, targetSha, ...value };
}

export async function findImplementationValidation(reader, pull) {
  const { pages, get, prefix } = reader;
  // Provenance: only the reviewed CI workflow and PR association can certify this head.
  const runs = await pages(`/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pull.head.sha}`, 1000, "workflow_runs");
  const candidates = [];
  let associated;
  for (const run of runs) {
    if (run.head_sha !== pull.head.sha || run.event !== "pull_request" || run.path !== ".github/workflows/ci.yml"
      || run.head_repository?.full_name !== reader.repository || !Array.isArray(run.pull_requests)) continue;
    if (run.pull_requests.some(item => item.number === pull.number && item.head?.sha === pull.head.sha)) candidates.push(run);
    else if (!run.pull_requests.length && typeof pull.head.ref === "string" && run.head_branch === pull.head.ref) {
      // Compatibility: GitHub clears historical run PR arrays after squash, but retains commit association.
      associated ??= await pages(`/commits/${pull.head.sha}/pulls`, 1000);
      if (associated.some(item => item.number === pull.number && item.head?.sha === pull.head.sha
        && item.head.repo?.full_name === reader.repository && item.base?.ref === targetBranch())) candidates.push(run);
    }
  }
  candidates.sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt);
  const run = candidates[0];
  if (!run || run.status !== "completed" || run.conclusion !== "success" || !Number.isSafeInteger(run.id)) {
    throw archiveFailure("implementation-validation");
  }
  const jobs = await pages(`/actions/runs/${run.id}/jobs?filter=latest`, 1000, "jobs");
  const required = jobs.filter(job => job.name === "Development validation required");
  if (required.length !== 1 || required[0].status !== "completed" || required[0].conclusion !== "success") {
    throw archiveFailure("implementation-required-check");
  }
  const validated = required[0].head_sha;
  if (validated !== pull.head.sha) {
    if (!SHA.test(validated ?? "")) throw archiveFailure("validation-head");
    const merge = await get(`${prefix}/git/commits/${validated}`);
    if (merge.parents?.length !== 2 || merge.parents[1]?.sha !== pull.head.sha) throw archiveFailure("validation-head");
    if (run.pull_requests.length) {
      if (!run.pull_requests.some(item => item.number === pull.number && item.base?.sha === merge.parents[0]?.sha)) throw archiveFailure("validation-head");
    } else await reader.ancestor(merge.parents[0].sha, pull.merge_commit_sha);
  }
  return { runId: run.id, headSha: pull.head.sha, checkedSha: validated, attempt: run.run_attempt };
}

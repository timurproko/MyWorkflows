import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { archiveFailure, SHA } from "./openspec-archive-policy.mjs";
import { prepareSinglePrDelivery } from "./openspec-delivery-finalization.mjs";

const same = (a, b) => a === null && b === null || Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b);

/** A historical baseline is provenance, not an instruction to merge today's target into the head.
 * Snapshots are trusted Git trees (including missing blobs), never PR-supplied lists of affected paths.
 * Unknown ancestry/reads/replay errors throw: they never authorize a branch write.
 */
export async function classifySpecBase({ baseline, target, head, change, archive, snapshot, ancestor, replay }) {
  if (![baseline, target, head].every(sha => SHA.test(sha ?? ""))) throw archiveFailure("delivery-target-identity");
  await ancestor(baseline, head);
  if (baseline === target) return { disposition: "valid", reason: "recorded baseline is current" };
  await ancestor(baseline, target);
  const [before, after, candidate] = await Promise.all([snapshot(baseline), snapshot(target), snapshot(head)]);
  const deltaRoot = `${archive ?? `openspec/changes/${change}/`}specs/`;
  const specs = [...candidate.entries.keys()].filter(path => path.startsWith(deltaRoot) && path.endsWith("/spec.md"))
    .map(path => `openspec/specs/${path.slice(deltaRoot.length)}`);
  const paths = new Set([...before.entries.keys(), ...after.entries.keys()]);
  // Another copy of this change is a collision, not ordinary baseline freshness.
  const sensitive = [...paths].filter(path => path.startsWith(`openspec/changes/${change}/`)
    || path.startsWith("openspec/changes/archive/") && new RegExp(`^openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${change}/`).test(path));
  for (const path of sensitive) {
    if (!same(await before.blob(path), await after.blob(path))) return { disposition: "invalidated", reason: "finalization inputs changed", path };
  }
  const configurationPaths = [];
  for (const path of [...paths].filter(path => path === "openspec/config.yaml" || path.startsWith("openspec/schemas/"))) {
    if (!same(await before.blob(path), await after.blob(path))) configurationPaths.push(path);
  }
  const changed = [];
  for (const path of specs) if (!same(await before.blob(path), await after.blob(path))) changed.push(path);
  if (!changed.length && !configurationPaths.length) return { disposition: "valid", reason: "independent target advance" };
  // Even config comments may be independent: validate/replay with current config before requesting repair.
  if (archive && replay && await replay({ candidate, target: after, specs, configurationPaths })) {
    return { disposition: "valid", reason: "delta replay preserves finalized specs" };
  }
  return { disposition: "invalidated", reason: "affected finalization inputs changed", paths: [...changed, ...configurationPaths] };
}

/** Replay using only the centrally pinned tool, in a data-only sandbox, with no inherited credentials/hooks.
 * Ignore provenance-only acceptance.md differences; compare every affected output, including deletions.
 */
export async function replaySpecSnapshot({ candidate, target, specs, configurationPaths = [], body, implementation, repository, number, targetSha,
  toolRoot = resolve("node_modules/@fission-ai/openspec") }) {
  const root = await mkdtemp(join(tmpdir(), "delivery-spec-replay-"));
  try {
    for (const path of candidate.entries.keys()) {
      const bytes = await candidate.blob(path);
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), bytes);
    }
    for (const path of configurationPaths) {
      const bytes = await target.blob(path);
      if (bytes === null) await rm(join(root, path), { force: true });
      else { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), bytes); }
    }
    const targetSpecs = new Map();
    for (const path of candidate.entries.keys()) if (path.startsWith("openspec/specs/")) targetSpecs.set(path, await candidate.blob(path));
    for (const path of specs) {
      const bytes = await target.blob(path);
      if (bytes === null) targetSpecs.delete(path);
      else targetSpecs.set(path, bytes);
    }
    const result = await prepareSinglePrDelivery({ root, change: implementation.change, repository, sourcePr: number, body,
      specBaseSha: targetSha, targetSpecs, write: false, toolRoot });
    return !result.changes.some(entry => specs.includes(entry.filename));
  } finally { await rm(root, { recursive: true, force: true }); }
}

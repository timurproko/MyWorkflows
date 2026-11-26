import { inspectUnassociatedPull } from "./openspec-association-policy.mjs";
import {
  assertImplementationOnlyProgress, parseImplementationProgress, parsePlainAcceptanceScenarios,
} from "./openspec-acceptance-checklist.mjs";
import { archiveFailure, SHA } from "./openspec-archive-policy.mjs";
import { targetBranch } from "./delivery-target.mjs";
import { samePromotionSnapshot } from "./openspec-finalization-publication.mjs";

/**
 * Plain delivery: the same draft, ticks and automatic readiness for a pull request that links no OpenSpec
 * change, which is every pull request in a repository without OpenSpec. There is nothing to finalize, so
 * promotion is the whole of the automation's part.
 */

const checked = body => {
  let inImplementation = false;
  return body.split("\n").map(line => {
    const text = line.replace(/\r$/, "");
    if (/^##\s/.test(text)) inImplementation = text === "## Implementation";
    return inImplementation ? line.replace(/^- \[ \] /, "- [x] ") : line;
  }).join("\n");
};

/**
 * Apply the promotion validators to a body without an Automation section. `final` treats every
 * Implementation item as checked, because the check runs before the author ticks the last one.
 */
export function inspectPlainBody(body, { final = false } = {}) {
  let complete = false;
  try {
    const progress = parseImplementationProgress(body);
    if (progress.format !== "checklist") throw archiveFailure("implementation-progress-legacy-draft");
    complete = progress.complete;
    assertImplementationOnlyProgress(progress.items);
    if (complete || final) parsePlainAcceptanceScenarios(final ? checked(body) : body);
    return { ok: true, complete, linked: false };
  } catch (error) {
    if (typeof error?.archiveCode !== "string") throw error;
    return { ok: false, complete, linked: false, reason: `draft-${error.archiveCode}` };
  }
}

/**
 * Mark one complete unlinked draft ready. A draft without an Implementation checklist, or with unticked
 * items, is an ordinary draft and is left alone quietly; a fully ticked one that is refused is `blocked`,
 * so the author sees why it stayed a draft.
 */
export async function promotePlainDraft({ reader, publisher, pull, number, inspectUnassociated = inspectUnassociatedPull }) {
  const head = pull.head?.sha ?? null;
  const skipped = reason => ({ disposition: "skipped", reason, head, commits: [] });
  const blocked = reason => ({ disposition: "blocked", reason: `draft-${reason}`, head, commits: [] });

  let progress;
  try {
    progress = parseImplementationProgress(pull.body ?? "");
  } catch (error) {
    if (error?.archiveCode === "implementation-progress-missing") return skipped("unassociated");
    if (typeof error?.archiveCode === "string") return skipped(`draft-${error.archiveCode}`);
    throw error;
  }
  if (progress.format !== "checklist" || !progress.complete) return skipped("draft");

  // Security: only a same-repository branch into the delivery target is promoted with the App identity.
  if (pull.base?.ref !== targetBranch() || pull.base.repo?.full_name !== reader.repository
    || pull.head?.repo?.full_name !== reader.repository || !SHA.test(head ?? "") || !SHA.test(pull.base?.sha ?? "")
    || typeof pull.node_id !== "string" || !pull.node_id) return skipped("draft-ineligible-identity");

  try {
    assertImplementationOnlyProgress(progress.items);
    parsePlainAcceptanceScenarios(pull.body ?? "");
  } catch (error) {
    if (typeof error?.archiveCode === "string") return blocked(error.archiveCode);
    throw error;
  }
  // Invariant: an active OpenSpec change must be linked and finalized; it never rides in as a plain delivery.
  const association = await inspectUnassociated(reader, pull);
  if (association.blocked) return blocked(association.reason);

  const target = (await reader.get(`${reader.prefix}/git/ref/heads/${targetBranch()}`)).object?.sha;
  if (!SHA.test(target ?? "")) throw archiveFailure("target-identity");
  try {
    await reader.ancestor(target, head);
  } catch (error) {
    if (typeof error?.archiveCode === "string") return blocked("delivery-target-stale");
    throw error;
  }

  const current = await reader.get(`${reader.prefix}/pulls/${number}`);
  if (!samePromotionSnapshot(current, pull, reader.repository)) {
    return { disposition: "retry", reason: "draft-changed-before-ready", head, commits: [] };
  }
  await publisher.ready(number, pull.node_id);
  return { disposition: "promoted", head, promoted: true, commits: [] };
}

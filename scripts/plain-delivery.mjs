import { inspectUnassociatedPull } from "./openspec-association-policy.mjs";
import {
  assertImplementationOnlyProgress, parseImplementationProgress, parsePlainAcceptanceScenarios,
} from "./openspec-acceptance-checklist.mjs";
import { archiveFailure, SHA } from "./openspec-archive-policy.mjs";
import { targetBranch } from "./delivery-target.mjs";


/**
 * Plain delivery uses the same approval-bound promotion as linked changes, without archive metadata.
 * This module validates the body and association; the trusted publication engine owns head proof and readiness.
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
 * Validate one complete unlinked draft. No mutation or approval inference happens here.
 */
export async function inspectPlainDraft({ reader, pull, inspectUnassociated = inspectUnassociatedPull }) {
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

  return { disposition: "eligible", head, commits: [] };
}

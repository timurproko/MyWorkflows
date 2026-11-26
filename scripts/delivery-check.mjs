#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectAgentAttribution } from "./agent-attribution.mjs";
import { inspectRepositoryInstructions } from "./repository-instructions.mjs";
import { inspectUnassociatedPull } from "./openspec-association-policy.mjs";
import { createArchiveReader, validateVersion3Candidate } from "./openspec-archive-github.mjs";
import { parseImplementation, SHA } from "./openspec-archive-policy.mjs";

/**
 * The delivery gate a repository requires next to its own tests. It answers one question for the
 * exact pull-request head: is this a deliverable candidate? Repository CI then only runs tests.
 *
 * `pass` means deliverable, `fail` means a blocker the author must act on, and `wait` means trusted
 * automation still has to finalize this head; `wait` also fails the check so the head cannot merge.
 */
export async function checkDelivery({ reader, number, expectedHead,
  inspectUnassociated = inspectUnassociatedPull, validateFinalized = validateVersion3Candidate,
  inspectAttribution = inspectAgentAttribution, inspectInstructions = inspectRepositoryInstructions }) {
  if (!Number.isSafeInteger(number) || number < 1 || !SHA.test(expectedHead ?? "")) return fail("event-identity");
  const pull = await reader.get(`${reader.prefix}/pulls/${number}`);
  // Invariant: a decision certifies only the head this event named; a newer push receives its own run.
  if (pull?.number !== number || pull.head?.sha !== expectedHead) return fail("event-drift");
  if (pull.state !== "open") return pass("closed");
  if (pull.draft) return wait("draft");
  // Invariant: attribution is refused before anything else can pass, because a merge makes it permanent.
  const attribution = await inspectAttribution(reader, pull);
  if (attribution) return fail("agent-attribution", attribution);
  // Invariant: delivery rules live in the shared workflow only, so a repository cannot grow its own beside them.
  const instructions = await inspectInstructions(reader, pull);
  if (instructions) return fail("repository-instructions", instructions);

  let implementation;
  try {
    implementation = parseImplementation(pull.body ?? "");
  } catch (error) {
    return fail("malformed-implementation-metadata", codeOf(error));
  }
  if (!implementation) {
    const association = await inspectUnassociated(reader, pull);
    return association.blocked ? fail(association.reason, association.changes?.join(",")) : pass("unlinked");
  }
  if (implementation.version !== 3) return fail("delivery-version", `version ${implementation.version} is no longer delivered`);
  if (!implementation.archive || implementation.finalizedHead !== expectedHead) return wait("awaiting-finalization");
  try {
    await validateFinalized(reader, number);
  } catch (error) {
    if (typeof error?.archiveCode !== "string") throw error;
    return fail(error.archiveCode, error.archiveDetail);
  }
  return pass("finalized");
}

const pass = reason => ({ outcome: "pass", reason });
const wait = reason => ({ outcome: "wait", reason });
const fail = (reason, detail) => ({ outcome: "fail", reason, ...(detail ? { detail } : {}) });
const codeOf = error => typeof error?.archiveCode === "string" ? error.archiveCode : "metadata-invalid";

const EXPLANATION = {
  draft: "The pull request is still a draft. Completed outcomes wait for an approved-head dispatch; the bot finalizes on the draft before marking it ready.",
  "awaiting-finalization": "This head still holds the active change. The delivery bot finalizes ready pull requests and pushes the finalized head, which receives its own check.",
  unlinked: "The pull request links no OpenSpec change and adds no active change, so nothing needs finalizing.",
  finalized: "The linked change is archived and its specifications are synchronized at this exact head.",
  closed: "The pull request is no longer open.",
  "repository-instructions": "The pull request adds to what this repository tells agents. AGENTS.md is the shared template unchanged (delivery instructions --apply writes it), CLAUDE.md contains only @AGENTS.md, and no other agent instruction file is added or extended. Put what is specific to the repository in docs/, and propose a delivery rule in timurproko/MyWorkflows.",
  "agent-attribution": "A commit, the title or the body names an AI agent as author or co-author. Rewrite those commits under the maintainer identity without the trailer (git rebase, then git push --force-with-lease), so the squash merge cannot copy the agent into the contributors.",
};

/**
 * Rationale: the bot pushes the finalized head and records it in the pull-request body a moment later, so a check
 * started by that push briefly sees the old record. It re-reads for a short while before reporting `wait`.
 */
export async function settleDelivery(check, { attempts = 9, delayMs = 10_000, sleep = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  let result = await check();
  for (let attempt = 1; attempt < attempts && result.outcome === "wait" && result.reason === "awaiting-finalization"; attempt += 1) {
    await sleep(delayMs);
    result = await check();
  }
  return result;
}

/** One Markdown paragraph for the job summary. */
export function describeResult(result) {
  const detail = result.detail ? ` (${result.detail})` : "";
  const explanation = EXPLANATION[result.reason] ? `\n\n${EXPLANATION[result.reason]}` : "";
  return `Delivery check: **${result.outcome}**; reason: \`${result.reason}\`${detail}.${explanation}`;
}

async function main(environment = process.env) {
  const repository = environment.GITHUB_REPOSITORY ?? "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY is required");
  const reader = createArchiveReader({ repository, token: environment.GITHUB_TOKEN ?? environment.GH_TOKEN });
  const result = await settleDelivery(() => checkDelivery({ reader, number: Number(environment.DELIVERY_PR_NUMBER),
    expectedHead: environment.DELIVERY_EXPECTED_HEAD }));
  if (environment.GITHUB_STEP_SUMMARY) await appendFile(environment.GITHUB_STEP_SUMMARY, `## Delivery\n\n${describeResult(result)}\n`);
  console.log(JSON.stringify(result));
  if (result.outcome !== "pass") {
    const title = result.outcome === "wait" ? "Not deliverable yet" : "Blocked";
    console.log(`::error title=Delivery::${title}: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

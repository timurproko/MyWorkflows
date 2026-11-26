import { describe, expect, it } from "vitest";
import { checkDelivery, describeResult, settleDelivery } from "../scripts/delivery-check.mjs";

const head = "b".repeat(40);
const archive = "openspec/changes/archive/2026-01-02-example-change/";
const fence = (value: unknown) => `## Proposal\n\nDeliver the example behavior.\n\n## Automation\n\n\`\`\`openspec-implementation\n${JSON.stringify(value)}\n\`\`\`\n`;
const finalized = { version: 3, change: "example-change", archive, acceptanceManifest: `${archive}acceptance.md`, finalizedHead: head };

function run(pull: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const reader = { prefix: "/repos/owner/repo", repository: "owner/repo",
    get: async () => ({ number: 5, state: "open", draft: false, body: "", head: { sha: head }, ...pull }) };
  return checkDelivery({ reader, number: 5, expectedHead: head,
    inspectUnassociated: async () => ({ blocked: false }), validateFinalized: async () => ({}), inspectAttribution: async () => null, inspectInstructions: async () => null, ...overrides });
}

describe("delivery check", () => {
  it("passes an ordinary pull request that links and adds no change", async () => {
    await expect(run({})).resolves.toEqual({ outcome: "pass", reason: "unlinked" });
    await expect(run({ state: "closed" })).resolves.toEqual({ outcome: "pass", reason: "closed" });
  });

  it("blocks an active change that is not linked", async () => {
    const inspectUnassociated = async () => ({ blocked: true, reason: "missing-implementation-association", changes: ["example-change"] });
    await expect(run({}, { inspectUnassociated }))
      .resolves.toEqual({ outcome: "fail", reason: "missing-implementation-association", detail: "example-change" });
  });

  it("waits while a draft or an unfinalized head is not deliverable", async () => {
    await expect(run({ draft: true })).resolves.toEqual({ outcome: "wait", reason: "draft" });
    await expect(run({ body: fence({ version: 3, change: "example-change" }) })).resolves.toEqual({ outcome: "wait", reason: "awaiting-finalization" });
    await expect(run({ body: fence({ ...finalized, finalizedHead: "c".repeat(40) }) })).resolves.toEqual({ outcome: "wait", reason: "awaiting-finalization" });
  });

  it("passes only a finalized record that validates at the exact head", async () => {
    await expect(run({ body: fence(finalized) })).resolves.toEqual({ outcome: "pass", reason: "finalized" });
    const refusal = Object.assign(new Error("refused"), { archiveCode: "delivery-target-stale" });
    await expect(run({ body: fence(finalized) }, { validateFinalized: async () => { throw refusal; } }))
      .resolves.toEqual({ outcome: "fail", reason: "delivery-target-stale" });
    await expect(run({ body: fence(finalized) }, { validateFinalized: async () => { throw new Error("network"); } })).rejects.toThrow("network");
  });

  it("refuses a ready pull request that carries agent attribution, before any pass", async () => {
    const inspectAttribution = async () => "abc1234 co-authored by Copilot";
    await expect(run({ body: fence(finalized) }, { inspectAttribution }))
      .resolves.toEqual({ outcome: "fail", reason: "agent-attribution", detail: "abc1234 co-authored by Copilot" });
    await expect(run({ draft: true }, { inspectAttribution })).resolves.toEqual({ outcome: "wait", reason: "draft" });
  });

  it("fails malformed metadata and event drift", async () => {
    await expect(run({ body: "```openspec-implementation\nnot json\n```\n" })).resolves.toMatchObject({ outcome: "fail", reason: "malformed-implementation-metadata" });
    await expect(run({ head: { sha: "d".repeat(40) } })).resolves.toEqual({ outcome: "fail", reason: "event-drift" });
    await expect(checkDelivery({ reader: {}, number: 0, expectedHead: head })).resolves.toEqual({ outcome: "fail", reason: "event-identity" });
  });

  it("re-reads while the bot is still recording the finalized head, and only then reports wait", async () => {
    const waiting = { outcome: "wait", reason: "awaiting-finalization" };
    const answers = [waiting, waiting, { outcome: "pass", reason: "finalized" }];
    let sleeps = 0;
    const sleep = async () => { sleeps += 1; };
    expect(await settleDelivery(async () => answers.shift()!, { sleep })).toEqual({ outcome: "pass", reason: "finalized" });
    expect(sleeps).toBe(2);
    expect(await settleDelivery(async () => waiting, { attempts: 3, sleep })).toEqual(waiting);
    expect(sleeps).toBe(4);
    expect(await settleDelivery(async () => ({ outcome: "wait", reason: "draft" }), { sleep })).toEqual({ outcome: "wait", reason: "draft" });
    expect(sleeps).toBe(4);
  });

  it("explains each result for the job summary", () => {
    expect(describeResult({ outcome: "wait", reason: "awaiting-finalization" })).toContain("delivery bot finalizes");
    expect(describeResult({ outcome: "fail", reason: "delivery-target-stale", detail: "x" })).toContain("`delivery-target-stale` (x)");
  });
});

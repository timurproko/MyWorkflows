import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import definitions from "../labels/base.json";
import { inspectDeliveryBody } from "../scripts/check-delivery-body.mjs";
import { labelMetadata } from "../scripts/repository-labels.mjs";
import { reconcileReference, reconcileReferenceManifest, referenceBody, referenceMain, referenceAutomationMain } from "../scripts/reference-labels.mjs";

const repository = "timurproko/MyWorkflows", prefix = `repos/${repository}`;
const manifest = () => structuredClone(definitions);
const source = () => Object.values(definitions.labels).map(label => ({ ...labelMetadata(label.reference), id: label.reference.id, node_id: label.reference.nodeId }));
const event = (live: any[], extra = {}) => ({ action: "edited", repository: { full_name: repository }, label: { ...live[0] }, changes: { name: { from: "🤖 Under review" } }, ...extra });
function fake() {
  let serial = 10;
  const sha = () => (++serial).toString(16).padStart(40, "0");
  const main = "a".repeat(40), tree = "b".repeat(40);
  const refs: Record<string, string> = { trunk: main };
  const manifests: Record<string, any> = { [main]: manifest() };
  const live = source(); live[0].name = "In progress";
  const pulls: any[] = [];
  const messages: string[] = [];
  const trees: Record<string, any> = {};
  const api = vi.fn(async (method: string, route: string, body?: any): Promise<any> => {
    if (method === "GET" && route === prefix) return { full_name: repository, default_branch: "trunk" };
    if (method === "GET" && route.includes("/git/ref/heads/")) return { object: { sha: refs[decodeURIComponent(route.split("/heads/")[1])] } };
    if (method === "GET" && route.includes("/contents/labels/base.json")) {
      const ref = new URL(`https://api.github.com/${route}`).searchParams.get("ref")!;
      return { encoding: "base64", content: Buffer.from(JSON.stringify(manifests[ref])).toString("base64") };
    }
    if (method === "GET" && route.includes("/labels?")) return structuredClone(live);
    if (method === "GET" && route.includes("/pulls?")) return pulls.filter(pull => pull.state !== "closed");
    if (method === "GET" && route.includes("/files?")) return [{ filename: "labels/base.json" }];
    if (method === "GET" && route.includes("/commits?")) return messages.map(message => ({ commit: { message } }));
    if (method === "GET" && route.includes("/git/commits/")) return { tree: { sha: tree } };
    if (method === "POST" && route.endsWith("/git/trees")) {
      const id = sha(); trees[id] = JSON.parse(body.tree[0].content); return { sha: id };
    }
    if (method === "POST" && route.endsWith("/git/commits")) {
      const id = sha(); manifests[id] = trees[body.tree]; messages.push(body.message); return { sha: id };
    }
    if (method === "POST" && route.endsWith("/git/refs")) { refs[body.ref.replace("refs/heads/", "")] = body.sha; return {}; }
    if (method === "PATCH" && route.includes("/git/refs/heads/")) {
      expect(body.force).toBe(false); refs[decodeURIComponent(route.split("/heads/")[1])] = body.sha; return {};
    }
    if (method === "POST" && route.endsWith("/pulls")) {
      const pull = { ...body, head: { ref: body.head, repo: { full_name: repository } }, number: pulls.length + 1, html_url: "https://github.com/timurproko/MyWorkflows/pull/100" };
      pulls.push(pull); return pull;
    }
    if (method === "PATCH" && /\/pulls\/\d+$/.test(route)) { Object.assign(pulls[0], body); return pulls[0]; }
    throw new Error(`unexpected ${method} ${route}`);
  });
  return { api, live, pulls, refs, manifests, messages };
}

describe("reference identity reconciliation", () => {
  it("accepts arbitrary UI names/metadata, preserves old/event aliases and stable ids", () => {
    const live = source(); Object.assign(live[0], { name: "Reading", color: "aabbcc", description: "new description" });
    const result = reconcileReferenceManifest({ manifest: manifest(), live, event: event(live) }).manifest;
    expect(result.labels["under-review"]).toEqual({ name: "Reading", color: "aabbcc", description: "new description",
      previousNames: ["🤖 Under review", "🤖 Review"], reference: { id: live[0].id, nodeId: live[0].node_id, name: "Reading", color: "aabbcc", description: "new description" } });
  });
  it("preserves the initial requested migration until normal sync and then refreshes the source snapshot", () => {
    expect(reconcileReferenceManifest({ manifest: manifest(), live: source() }).manifest).toEqual(manifest());
    const live = source(); live[0].name = "🤖 Review";
    expect(reconcileReferenceManifest({ manifest: manifest(), live }).manifest.labels["under-review"].reference.name).toBe("🤖 Review");
  });
  it("keeps pending intermediate history, handles stale events and a rename back without current aliases", () => {
    const live = source(); live[0].name = "Intermediate";
    const first = reconcileReferenceManifest({ manifest: manifest(), live }).manifest;
    live[0].name = "🤖 Under review"; live[0].color = "ffffff";
    const next = reconcileReferenceManifest({ manifest: manifest(), pendingManifest: first, live, event: event([{ ...live[0], name: "Stale event name" }], { changes: { name: { from: "Missed intermediate" } } }) }).manifest;
    expect(next.labels["under-review"].name).toBe("🤖 Under review");
    expect(next.labels["under-review"].previousNames).toEqual(["🤖 Review", "Intermediate", "Missed intermediate"]);
  });
  it("honours an explicit UI reversion to the original bootstrap name and preserves case-only aliases", () => {
    const live = source();
    expect(reconcileReferenceManifest({ manifest: manifest(), live, event: event(live) }).manifest.labels["under-review"].name).toBe("🤖 Under review");
    live[0].name = "🤖 REVIEW";
    const next = reconcileReferenceManifest({ manifest: manifest(), live, event: event(live) }).manifest;
    expect(next.labels["under-review"].previousNames).toContain("🤖 Review");
  });
  it("ignores unmanaged/created labels and never adopts a recreated name with another id", () => {
    const live = source();
    for (const action of ["created", "edited", "deleted"]) {
      expect(reconcileReferenceManifest({ manifest: manifest(), live, event: event(live, { action, label: { ...live[0], id: 1 } }) }).disposition).toBe("unmanaged");
    }
    expect(reconcileReferenceManifest({ manifest: manifest(), live, event: event(live, { action: "created" }) }).disposition).toBe("unmanaged");
  });
  it.each([
    (live: any[]) => live[0].name = "",
    (live: any[]) => live[0].name = "🤖 Approved",
    (live: any[]) => live[0].name = "🤖 Changes needed",
    (live: any[]) => live[0].color = "bad",
    (live: any[]) => live[0].description = "x".repeat(101),
    (live: any[]) => live[0].node_id = "replacement",
    (live: any[]) => live.shift(),
  ])("rejects invalid/colliding edits or missing/replaced references", mutate => {
    const live = source(); mutate(live);
    expect(() => reconcileReferenceManifest({ manifest: manifest(), live })).toThrow();
  });
  it("reports deleted reference and invalid events without propagating deletion", () => {
    const live = source();
    expect(() => reconcileReferenceManifest({ manifest: manifest(), live, event: event(live, { action: "deleted" }) })).toThrow("deleted");
    expect(() => reconcileReferenceManifest({ manifest: manifest(), live, event: event(live, { repository: { full_name: "other/repo" } }) })).toThrow("matching");
    expect(() => reconcileReferenceManifest({ manifest: manifest(), live, event: event(live, { changes: { name: { from: null } } }) })).toThrow("previous");
  });
});

describe("protected reference publication", () => {
  it("reports read-only by default, then publishes only a manifest commit and a draft PR", async () => {
    const f = fake();
    expect((await referenceMain([], { api: f.api })).disposition).toBe("would-publish");
    expect(f.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    const result = await reconcileReference({ api: f.api, apply: true, now: () => 123 });
    expect(result).toMatchObject({ disposition: "published", applied: true });
    expect(f.pulls[0]).toMatchObject({ base: "trunk", draft: true, body: referenceBody });
    const writes = f.api.mock.calls.filter(([method]) => method !== "GET");
    expect(writes.map(([, route]) => route)).toEqual([`${prefix}/git/trees`, `${prefix}/git/commits`, `${prefix}/git/refs`, `${prefix}/pulls`]);
    expect(JSON.stringify(writes)).not.toContain("new_name");
    expect(f.refs.trunk).toBe("a".repeat(40));
    expect((await reconcileReference({ api: f.api, apply: true })).disposition).toBe("unchanged");
    expect(f.pulls).toHaveLength(1);
  });
  it("updates one pending branch while retaining intermediate aliases across edits", async () => {
    const f = fake();
    await reconcileReference({ api: f.api, apply: true, event: event(f.live), now: () => 123 });
    f.live[0].name = "Reading again";
    const result = await reconcileReference({ api: f.api, apply: true, event: event(f.live, { changes: { name: { from: "In progress" } } }) });
    expect(result.manifest.labels["under-review"].previousNames).toContain("In progress");
    expect(f.pulls).toHaveLength(1);
    expect(f.api.mock.calls.some(([method, route]) => method === "PATCH" && route === `${prefix}/git/refs/heads/chore%2Freference-labels-123`)).toBe(true);
  });
  it("creates a different branch after a previous PR closes", async () => {
    const f = fake(); await reconcileReference({ api: f.api, apply: true, now: () => 123 });
    f.pulls[0].state = "closed";
    await reconcileReference({ api: f.api, apply: true, now: () => 124 });
    expect(f.pulls.map(pull => pull.head.ref)).toEqual(["chore/reference-labels-123", "chore/reference-labels-124"]);
  });
  it("blocks manual branch edits and live/head races before writes", async () => {
    const f = fake(); await reconcileReference({ api: f.api, apply: true });
    f.messages.push("manual edit"); f.api.mockClear();
    await expect(reconcileReference({ api: f.api, apply: true })).rejects.toThrow("manual");
    expect(f.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    const g = fake(); let listings = 0;
    const api = vi.fn(async (method, route, body?) => {
      if (route.includes("/labels?") && ++listings === 2) g.live[0].name = "Changed concurrently";
      return g.api(method, route, body);
    });
    await expect(reconcileReference({ api, apply: true })).rejects.toThrow("changed during");
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
  it("ignores unrelated events and surfaces denied/missing references without writes", async () => {
    const f = fake();
    expect((await reconcileReference({ api: f.api, apply: true, event: event(f.live, { label: { id: 1 } }) })).disposition).toBe("unmanaged");
    expect(f.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    f.live.pop();
    await expect(reconcileReference({ api: f.api, apply: true })).rejects.toThrow("missing");
    expect(f.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    await expect(reconcileReference({ api: async () => { throw new Error("denied"); }, apply: true })).rejects.toThrow("denied");
  });
  it("has a valid delivered body and a trusted isolated event workflow with no label/default-branch writes", async () => {
    // Exercise the same public validator as the delivery bot.
    expect(inspectDeliveryBody(referenceBody, { final: true }).ok).toBe(true);
    const workflow = await readFile(".github/workflows/reference-labels.yml", "utf8");
    expect(workflow).toContain("types: [edited, created, deleted]");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("ref: ${{ github.event.repository.default_branch }}");
    expect(workflow).toContain("permission-contents: write");
    expect(workflow).toContain("permission-pull-requests: write");
    expect(workflow).not.toMatch(/permission-issues|git push|gh pr merge|github.event.label.name/);
  });
  it("rejects untrusted automation or a fallback write credential, and emits safe warnings", async () => {
    const report = vi.fn(), api = vi.fn();
    expect(await referenceAutomationMain({ environment: {}, api, report })).toBe(1);
    expect(await referenceAutomationMain({ environment: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: "workflow_dispatch", REFERENCE_APPLY: "true", GH_TOKEN: "fallback" }, api, report })).toBe(1);
    expect(api).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.stringContaining("::warning::"));
  });
});

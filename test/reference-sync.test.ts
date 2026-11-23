import { describe, expect, it, vi } from "vitest";
import definitions from "./fixtures/bootstrap-labels.json";
import { labelMetadata, REFERENCE_REPOSITORY, syncLabels as synchronize } from "../scripts/repository-labels.mjs";
const manifest = () => structuredClone(definitions);
const syncLabels = options => synchronize({ manifest: manifest(), ...options });
function fake({ pending = false } = {}) {
  const labels = Object.values(definitions.labels).map(label => ({ ...labelMetadata(label.reference), id: label.reference.id, node_id: label.reference.nodeId }));
  const api = vi.fn(async (method: string, route: string, body?: any) => {
    if (route.includes("/pulls?")) return pending ? [{ head: { ref: "chore/reference-labels-123", repo: { full_name: REFERENCE_REPOSITORY } } }] : [];
    if (route.includes("/labels?")) return labels;
    const item = labels.find(label => label.name === decodeURIComponent(route.split("/").at(-1)!));
    if (method === "GET") return { ...item };
    if (method === "PATCH" && item) { Object.assign(item, body, { name: body.new_name ?? item.name }); return item; }
    throw new Error("only in-place updates of reference identities allowed");
  });
  return { api, labels };
}

describe("reference UI drift guard", () => {
  it("allows the initial normal sync to rename the existing reference ids, then stays idempotent", async () => {
    const f = fake();
    const original = f.labels.map(label => label.id);
    expect((await syncLabels({ repository: REFERENCE_REPOSITORY, api: f.api, apply: true })).labels.map(item => item.action)).toEqual(["rename", "unchanged", "rename"]);
    expect(f.labels.map(label => label.id)).toEqual(original);
    expect(f.labels.map(label => label.name)).toEqual(["🤖 Review", "🤖 Approved", "🤖 Rework"]);
    expect((await syncLabels({ repository: REFERENCE_REPOSITORY, api: f.api, apply: true })).labels.every(item => item.action === "unchanged")).toBe(true);
    expect(f.api.mock.calls.filter(([method]) => method === "PATCH")).toHaveLength(2);
  });
  it.each([
    (item: any) => item.name = "Arbitrary UI name",
    (item: any) => item.color = "ffffff",
    (item: any) => item.description = "pending UI description",
    (item: any) => item.id = 1,
    (item: any) => item.node_id = "replacement",
  ])("does not overwrite unmerged UI metadata or replacement identities", async mutate => {
    const f = fake(); mutate(f.labels[0]);
    const result = await syncLabels({ repository: REFERENCE_REPOSITORY, api: f.api, apply: true });
    expect(result.labels[0].action).toBe("reference-drift");
    expect(f.api.mock.calls.filter(([method, route]) => method !== "GET" && route.includes(encodeURIComponent(f.labels[0].name)))).toEqual([]);
  });
  it("blocks the bootstrap write during a pending reconciliation, including a revert to the original alias", async () => {
    const f = fake({ pending: true });
    const result = await syncLabels({ repository: REFERENCE_REPOSITORY, api: f.api, apply: true });
    expect(result.labels.map(item => item.action)).toEqual(["reference-drift", "unchanged", "reference-drift"]);
    expect(f.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
  it("rereads each identity immediately before PATCH and skips a newly drifted source", async () => {
    const f = fake();
    const api = vi.fn(async (method, route, body?) => {
      if (method === "GET" && route.endsWith(encodeURIComponent("🤖 Under review"))) f.labels[0].color = "ffffff";
      return f.api(method, route, body);
    });
    expect((await syncLabels({ repository: REFERENCE_REPOSITORY, api, apply: true })).labels[0].action).toBe("reference-drift");
    expect(f.labels[0].name).toBe("🤖 Under review");
  });
  it("refuses a destination owned by a different reference identity, and requires reference identity metadata", async () => {
    const f = fake(); f.labels.push({ ...f.labels[0], name: "🤖 Review", id: 12 });
    expect((await syncLabels({ repository: REFERENCE_REPOSITORY, api: f.api, apply: true })).labels[0].action).toBe("reference-drift");
    const value: any = manifest(); delete value.labels["under-review"].reference;
    await expect(syncLabels({ repository: REFERENCE_REPOSITORY, api: f.api, manifest: value, apply: true })).rejects.toThrow("recorded");
  });
});

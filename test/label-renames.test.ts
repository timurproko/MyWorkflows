import { describe, expect, it, vi } from "vitest";
import definitions from "./fixtures/bootstrap-labels.json";
import { labelMetadata, syncLabels as synchronize, validateManifest } from "../scripts/repository-labels.mjs";

const repository = "owner/consumer";
const manifest = () => structuredClone(definitions);
const syncLabels = options => synchronize({ manifest: manifest(), ...options });
function fake(initial: any[]) {
  const labels = structuredClone(initial);
  const api = vi.fn(async (method: string, path: string, body?: any) => {
    if (method === "GET") return labels;
    const label = labels.find((item: any) => item.name === decodeURIComponent(path.split("/").at(-1)!));
    if (method === "PATCH") { Object.assign(label, body, { name: body.new_name ?? label.name }); delete label.new_name; return label; }
    if (method === "POST") { const result = { ...body, id: 99 }; labels.push(result); return result; }
    throw new Error("no DELETE or assignment writes allowed");
  });
  return { api, labels };
}
const old = () => Object.values(definitions.labels).map((label, n) => ({ ...labelMetadata(label.reference), id: n + 1 }));

describe("assignment-preserving alias migration", () => {
  it("plans renames read-only then renames the same ids with explicit API fields and is idempotent", async () => {
    const { api, labels } = fake(old());
    const report = await syncLabels({ repository, api });
    expect(report.labels.map(item => item.action)).toEqual(["rename", "unchanged", "rename"]);
    expect(report.labels[0]).toMatchObject({ previousName: "🤖 Under review", name: "🤖 Review" });
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    await syncLabels({ repository, api, apply: true });
    expect(labels.map(label => label.id)).toEqual([1, 2, 3]);
    expect(labels.map(label => label.name)).toEqual(["🤖 Review", "🤖 Approved", "🤖 Build"]);
    expect(api.mock.calls.filter(([method]) => method !== "GET")).toEqual([
      ["PATCH", `repos/${repository}/labels/${encodeURIComponent("🤖 Under review")}`, { new_name: "🤖 Review", color: "840479", description: "" }],
      ["PATCH", `repos/${repository}/labels/${encodeURIComponent("🤖 Changes needed")}`, { new_name: "🤖 Build", color: "9a6700", description: "" }],
    ]);
    expect((await syncLabels({ repository, api, apply: true })).labels.every(item => item.action === "unchanged")).toBe(true);
  });

  it.each(["🤖 Rework", "🤖 Changes needed"])("renames %s to Build on the same definition and retains its assignments", async previous => {
    const { api, labels } = fake([{ name: previous, color: "9a6700", description: "", id: 42, assignments: [7, 19] }]);
    const result = await syncLabels({ repository, api, apply: true });
    expect(result.labels.find(label => label.key === "review-changes-needed")).toMatchObject({ action: "rename", previousName: previous, name: "🤖 Build" });
    expect(labels.find(label => label.id === 42)).toMatchObject({ name: "🤖 Build", assignments: [7, 19] });
  });

  it("keeps an existing new definition and reports/preserves old definitions without deleting", async () => {
    const { api, labels } = fake([...old(), labelMetadata(definitions.labels["under-review"]), labelMetadata(definitions.labels["review-changes-needed"])]);
    const result = await syncLabels({ repository, api, apply: true });
    expect(result.conflicts).toEqual([
      { key: "under-review", kept: "🤖 Review", preserved: ["🤖 Under review"] },
      { key: "review-changes-needed", kept: "🤖 Build", preserved: ["🤖 Changes needed"] },
    ]);
    expect(labels).toHaveLength(5);
    expect(result.preserved).toEqual(["🤖 Under review", "🤖 Changes needed"]);
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });

  it("supports successive arbitrary renames, and refuses ambiguous or case-colliding sources before writes", async () => {
    const value = manifest();
    value.labels["under-review"].previousNames.push("Review v2");
    const one = fake([{ ...old()[0], name: "Review v2" }]);
    expect((await syncLabels({ repository, api: one.api, manifest: value })).labels[0].previousName).toBe("Review v2");
    for (const initial of [[old()[0], { ...old()[0], name: "Review v2" }], [{ ...old()[0], name: "🤖 UNDER REVIEW" }]]) {
      const { api } = fake(initial);
      await expect(syncLabels({ repository, api, manifest: value, apply: true })).rejects.toThrow();
      expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    }
  });

  it.each([
    (value: any) => value.labels["under-review"].previousNames = "old",
    (value: any) => value.labels["under-review"].previousNames.push("🤖 Approved"),
    (value: any) => value.labels["under-review"].previousNames.push("🤖 Review"),
    (value: any) => value.labels["under-review"].previousNames.push(""),
    (value: any) => value.labels["under-review"].reference.id = -1,
    (value: any) => value.labels["under-review"].reference.nodeId = "bad\nnode",
    (value: any) => value.labels["review-approved"].reference.id = value.labels["under-review"].reference.id,
    (value: any) => value.labels["review-approved"].reference.nodeId = value.labels["under-review"].reference.nodeId,
  ])("rejects malformed or ambiguous history/identity", mutate => {
    const value = manifest(); mutate(value);
    expect(() => validateManifest(value)).toThrow("invalid base-label manifest");
  });

  it.each([["Reading", "READING"], ["Café", "Cafe\u0301"]])("renames explicit case/Unicode-only aliases in place: %s", async (current, previous) => {
    const value: any = { version: 1, labels: { "under-review": { name: current, previousNames: [previous], color: "840479", description: "" } } };
    const { api, labels } = fake([{ name: previous, color: "840479", description: "", id: 7 }]);
    expect((await syncLabels({ repository, api, manifest: value, apply: true })).labels[0].action).toBe("rename");
    expect(labels[0]).toMatchObject({ id: 7, name: current });
    expect((await syncLabels({ repository, api, manifest: value, apply: true })).labels[0].action).toBe("unchanged");
  });

  it("accepts legacy manifests and arbitrary names without robot prefixes", () => {
    expect(validateManifest({ version: 1, labels: { "under-review": { name: "Review", color: "840479", description: "" } } })).toBeTruthy();
  });
});

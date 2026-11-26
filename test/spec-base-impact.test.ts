import { describe, expect, it, vi } from "vitest";
import { classifySpecBase } from "../scripts/spec-base-impact.mjs";

const baseline = "a".repeat(40), target = "b".repeat(40), head = "c".repeat(40);
const archive = "openspec/changes/archive/2026-11-26-example/";
const spec = "openspec/specs/example/spec.md";
const delta = `${archive}specs/example/spec.md`;
function fixture(before = { [spec]: "old" }, after: Record<string, string> = { [spec]: "old" }) {
  const trees: Record<string, Record<string, string>> = { [baseline]: before, [target]: after,
    [head]: { [spec]: "final", [delta]: "delta" } };
  const ancestor = vi.fn(async () => {});
  const snapshot = vi.fn(async (sha: string) => ({ entries: new Map(Object.entries(trees[sha]!)),
    blob: async (path: string) => trees[sha]![path] === undefined ? null : Buffer.from(trees[sha]![path]!) }));
  return { baseline, target, head, archive, change: "example", snapshot, ancestor };
}

describe("semantic base impact", () => {
  it("preserves a head across code and unrelated capability changes", async () => {
    const f = fixture(undefined, { [spec]: "old", "openspec/specs/other/spec.md": "new", "src/app": "new" });
    expect(await classifySpecBase(f)).toMatchObject({ disposition: "valid", reason: "independent target advance" });
    expect(f.ancestor.mock.calls).toEqual([[baseline, head], [baseline, target]]);
  });
  it.each([{ [spec]: "new" }, {}, { [spec]: "new", "openspec/specs/other/spec.md": "other" }])(
    "invalidates affected modifications or retirements %j", async after => {
      expect(await classifySpecBase(fixture(undefined, after))).toMatchObject({ disposition: "invalidated" });
    });
  it("includes additions to a previously missing canonical capability", async () => {
    expect(await classifySpecBase(fixture({}, { [spec]: "added" }))).toMatchObject({ disposition: "invalidated" });
  });
  it("preserves finalized output when a trusted replay proves the same result", async () => {
    const replay = vi.fn(async () => true);
    expect(await classifySpecBase({ ...fixture(undefined, { [spec]: "new" }), replay })).toMatchObject({ disposition: "valid" });
    expect(replay).toHaveBeenCalledOnce();
  });
  it("replays configuration changes instead of refreshing for comments or unrelated schemas", async () => {
    const f = fixture(undefined, { [spec]: "old", "openspec/config.yaml": "schema: spec-driven\n# comment" });
    expect(await classifySpecBase({ ...f, replay: async () => true })).toMatchObject({ disposition: "valid" });
    expect(await classifySpecBase(f)).toMatchObject({ disposition: "invalidated", paths: ["openspec/config.yaml"] });
  });
  it.each([`${archive}tasks.md`, "openspec/changes/example/tasks.md"])(
    "invalidates changed configuration or colliding delivery input %s", async path => {
      expect(await classifySpecBase(fixture(undefined, { [spec]: "old", [path]: "new" }))).toMatchObject({ disposition: "invalidated", path });
    });
  it("rejects unknown ancestry, reads and replay without turning them into invalidation permission", async () => {
    const f = fixture();
    await expect(classifySpecBase({ ...f, ancestor: async () => { throw new Error("ancestry unknown"); } })).rejects.toThrow("ancestry unknown");
    await expect(classifySpecBase({ ...f, snapshot: async () => { throw new Error("truncated"); } })).rejects.toThrow("truncated");
    await expect(classifySpecBase({ ...fixture(undefined, { [spec]: "new" }), replay: async () => { throw new Error("replay failed"); } })).rejects.toThrow("replay failed");
    await expect(classifySpecBase({ ...f, target: "bad" })).rejects.toThrow("delivery-target-identity");
  });
});

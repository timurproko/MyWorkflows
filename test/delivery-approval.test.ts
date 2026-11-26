import { describe, expect, it } from "vitest";
import { assertApprovalCovers } from "../scripts/delivery-approval.mjs";
import { parseImplementation } from "../scripts/openspec-archive-policy.mjs";

const a = "a".repeat(40), h = "b".repeat(40), base = "c".repeat(40), tree = "d".repeat(40);
function fixture({ author = "delivery[bot]", committer = author, parents = [a], subject = "docs(openspec): finalize example",
  paths = ["openspec/specs/example/spec.md", "openspec/changes/archive/2026-09-16-example/tasks.md"], chain = [h, a], mergeTree = tree, ancestor = "" }: any = {}) {
  const reads: string[] = [];
  const reader = { prefix: "/repos/o/r", get: async (path: string) => {
    reads.push(path);
    return { sha: h, author: { login: author }, committer: { login: committer } };
  } };
  const git = async (args: string[]) => {
    if (args[0] === "rev-list" && args[1] === "--first-parent") return chain.join("\n");
    if (args[0] === "rev-list") return [h, ...parents].join(" ");
    if (args[0] === "show") return subject;
    if (args[0] === "diff") return paths.join("\0");
    if (args[0] === "merge-base") return ancestor;
    if (args[0] === "merge-tree") return mergeTree;
    if (args[0] === "rev-parse") return tree;
    throw new Error(args.join(" "));
  };
  const run = (overrides = {}) => assertApprovalCovers({ reader, git, publisher: { actor: "delivery[bot]" }, approvedHead: a, head: h, target: base, change: "example", ...overrides });
  return { run, reads };
}

describe("approval coverage", () => {
  it("accepts an exact head without trusting or reading metadata", async () => {
    const f = fixture();
    await expect(f.run({ head: a })).resolves.toBeUndefined();
    expect(f.reads).toEqual([]);
  });
  it("accepts a scoped finalization and a clean first-parent base merge", async () => {
    await expect(fixture().run()).resolves.toBeUndefined();
    await expect(fixture({ parents: [a, base] }).run()).resolves.toBeUndefined();
    await expect(fixture({ subject: "docs(openspec): refinalize example" }).run()).resolves.toBeUndefined();
  });
  it.each([
    { author: "human" }, { committer: "human" }, { author: "other-app[bot]" },
    { subject: "fix: arbitrary bot code" }, { paths: ["src/app.js"] }, { paths: [] },
    { paths: ["openspec/changes/archive/2026-09-16-other/tasks.md"] },
    { paths: ["openspec/changes/other/tasks.md"] }, { parents: [] }, { parents: [a, base, h] },
    { chain: [h, base] }, { parents: [a, base], mergeTree: "conflict" },
    { parents: [a, base], mergeTree: a }, { parents: [a, base], ancestor: null },
  ])("refuses uncovered history %j", async options => {
    await expect(fixture(options).run()).rejects.toThrow("approval-head-mismatch");
  });
  it("does not exempt archive-shaped commits on plain deliveries", async () => {
    await expect(fixture().run({ change: null })).rejects.toThrow("approval-head-mismatch");
  });
  it("propagates API failure instead of treating it as approval", async () => {
    await expect(fixture().run({ reader: { prefix: "/repos/o/r", get: async () => { throw new Error("API unavailable"); } } })).rejects.toThrow("API unavailable");
  });
  it("validates reviewedHead without making it a promotion credential", () => {
    const body = (metadata: any) => `\`\`\`openspec-implementation\n${JSON.stringify(metadata)}\n\`\`\``;
    expect(parseImplementation(body({ version: 3, change: "example", reviewedHead: a }))).toMatchObject({ reviewedHead: a });
    expect(() => parseImplementation(body({ version: 3, change: "example", reviewedHead: "not-a-sha" }))).toThrow("delivery-reviewed-head");
    expect(() => parseImplementation(body({ version: 2, change: "example", reviewedHead: a }))).toThrow("metadata-fields");
  });
});

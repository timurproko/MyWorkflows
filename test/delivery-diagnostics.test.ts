import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { baseHealthReport, fastMergeReport } from "../scripts/delivery-diagnostics.mjs";
import { buildRuleset, DEFAULT_DECLARATIONS } from "../scripts/repository-protection.mjs";

const head = "a".repeat(40);
const ruleset = { id: 42, updated_at: "2026-11-26T14:00:00Z", ...buildRuleset(DEFAULT_DECLARATIONS[0], "main") };
const check = ruleset.rules.find(rule => rule.type === "required_status_checks")!;
const notFound = () => { throw Object.assign(new Error("not found"), { status: 404 }); };
function fixture() {
  const state = { rules: structuredClone(ruleset.rules).map(rule => ({ ...rule, ruleset_id: 42, ruleset_source: "owner/repo", ruleset_source_type: "Repository" })),
    full: structuredClone(ruleset), classic: null as any,
    runs: [{ id: 100, workflow_id: 5, head_sha: head, event: "push", head_branch: "main" }],
    jobs: [{ name: "CI required", head_sha: head, status: "completed", conclusion: "success" }],
    forbidden: "", moves: false, branchReads: 0 };
  const calls: string[] = [];
  const get = async (path: string) => {
    calls.push(path);
    if (state.forbidden && path.includes(state.forbidden)) throw Object.assign(new Error("read denied"), { status: 403 });
    if (path === "repos/owner/repo") return { default_branch: "main" };
    if (path === "repos/owner/repo/branches/main") return { commit: { sha: state.moves && ++state.branchReads > 1 ? "b".repeat(40) : head } };
    if (path.includes("contents/.github/protection.json")) return notFound();
    if (path.includes("rules/branches/main")) return state.rules.slice((Number(new URLSearchParams(path.split("?")[1]).get("page")) - 1) * 100).slice(0, 100);
    if (path.endsWith("rulesets/42")) return state.full;
    if (path.endsWith("/protection")) return state.classic ?? notFound();
    if (path.includes("/actions/runs?")) return { workflow_runs: state.runs, total_count: state.runs.length };
    if (path.includes("/actions/runs/") && path.includes("/jobs?")) return { jobs: state.jobs, total_count: state.jobs.length };
    throw new Error(`unexpected GET ${path}`);
  };
  return { state, calls, get };
}

describe("GET-only fast merge protection proposals", () => {
  it("reports aligned policy, contexts and App pins without proposing unrelated changes", async () => {
    const f = fixture();
    f.state.rules.find(rule => rule.type === "required_status_checks")!.parameters.required_status_checks[0].integration_id = 15368;
    const result = await fastMergeReport({ repository: "owner/repo", get: f.get });
    expect(result).toMatchObject({ readOnly: true, status: "aligned", proposedChanges: [] });
    expect(result.requiredChecks).toContainEqual({ context: "CI required", integration_id: 15368 });
    expect(f.calls.every(path => path.startsWith("repos/owner/repo"))).toBe(true);
  });
  it("prints only the exact strict-bit proposal tied to the named repository and observed ruleset", async () => {
    const f = fixture();
    f.state.rules.find(rule => rule.type === "required_status_checks")!.parameters.strict_required_status_checks_policy = true;
    const index = f.state.full.rules.findIndex(rule => rule.type === "required_status_checks");
    f.state.full.rules[index]!.parameters.strict_required_status_checks_policy = true;
    const before = JSON.stringify(f.state);
    const result = await fastMergeReport({ repository: "owner/repo", get: f.get });
    expect(result.status).toBe("drift");
    expect(result.proposedChanges).toEqual([expect.objectContaining({ repository: "owner/repo", branch: "main", rulesetId: 42,
      path: `/rules/${index}/parameters/strict_required_status_checks_policy`, before: true, after: false })]);
    expect(JSON.stringify(f.state)).toBe(before);
  });
  it("detects classic strictness even when effective rulesets are non-strict, preserving context App pins", async () => {
    const f = fixture();
    f.state.classic = { required_status_checks: { strict: true, contexts: ["CI required"], checks: [{ context: "CI required", app_id: 99 }] } };
    const result = await fastMergeReport({ repository: "owner/repo", get: f.get });
    expect(result).toMatchObject({ status: "drift", proposedChanges: [expect.objectContaining({ source: "classic protection", path: "/required_status_checks/strict" })] });
    expect(result.requiredChecks).toContainEqual({ context: "CI required", integration_id: 99 });
  });
  it("reports inherited strictness and queues without proposing unapproved owner-level writes", async () => {
    const f = fixture();
    f.state.rules = [{ type: "merge_queue" }, ...f.state.rules.map(rule => rule.type === "required_status_checks"
      ? { ...rule, ruleset_source_type: "Organization", parameters: { ...rule.parameters, strict_required_status_checks_policy: true } } : rule)] as any;
    const result = await fastMergeReport({ repository: "owner/repo", get: f.get });
    expect(result.status).toBe("unknown");
    expect(result.drift.join(" ")).toContain("merge queue");
    expect(result.proposedChanges).toEqual([]);
  });
  it("finds later-page strictness and missing required checks", async () => {
    const f = fixture();
    f.state.rules = Array.from({ length: 100 }, () => ({ type: "pull_request" })) as any;
    f.state.rules.push({ ...check, parameters: { ...check.parameters, required_status_checks: [], strict_required_status_checks_policy: false } } as any);
    const result = await fastMergeReport({ repository: "owner/repo", get: f.get });
    expect(result.drift).toEqual(expect.arrayContaining(["missing required check: CI required", "missing required check: delivery / Delivery check"]));
    expect(f.calls).toContain("repos/owner/repo/rules/branches/main?per_page=100&page=2");
  });
  it.each(["/rules/branches/", "/protection"])("keeps denied protection %s unknown, not unprotected", async forbidden => {
    const f = fixture(); f.state.forbidden = forbidden;
    expect(await fastMergeReport({ repository: "owner/repo", get: f.get })).toMatchObject({ status: "unknown", proposedChanges: [] });
  });
  it("fails closed on malformed and unbounded rules", async () => {
    const f = fixture();
    expect((await fastMergeReport({ repository: "owner/repo", get: async path => path.includes("/rules/branches/") ? {} : f.get(path) })).status).toBe("unknown");
    expect((await fastMergeReport({ repository: "owner/repo", get: async path => path.includes("/rules/branches/")
      ? Array.from({ length: 100 }, () => ({ type: "pull_request" })) : f.get(path) })).status).toBe("unknown");
  });
});

describe("exact default-head product CI health", () => {
  it("links a current passing push gate", async () => {
    const f = fixture();
    expect(await baseHealthReport({ repository: "owner/repo", get: f.get })).toMatchObject({ status: "passing", head,
      checks: [expect.objectContaining({ name: "CI required", status: "passing", url: "https://github.com/owner/repo/actions/runs/100" })] });
  });
  it.each([["failure", "failing"], ["cancelled", "failing"], ["skipped", "missing"], [null, "pending"]])("surfaces %s as %s", async (conclusion, status) => {
    const f = fixture();
    f.state.jobs[0]!.conclusion = conclusion as string;
    f.state.jobs[0]!.status = conclusion === null ? "in_progress" : "completed";
    expect((await baseHealthReport({ repository: "owner/repo", get: f.get })).status).toBe(status);
  });
  it.each(["old", "PR", "advisory"])("does not certify with %s evidence", async kind => {
    const f = fixture();
    if (kind === "old") f.state.runs[0]!.head_sha = "b".repeat(40);
    if (kind === "PR") f.state.runs[0]!.event = "pull_request";
    if (kind === "advisory") f.state.jobs[0]!.name = "delivery / Delivery check";
    expect((await baseHealthReport({ repository: "owner/repo", get: f.get })).status).toBe("missing");
  });
  it("never uses an older green attempt when the same workflow has a newer incomplete run", async () => {
    const f = fixture();
    f.state.runs.push({ ...f.state.runs[0]!, id: 101 });
    const get = async (path: string) => path.includes("runs/101/jobs") ? { jobs: [], total_count: 0 } : f.get(path);
    expect((await baseHealthReport({ repository: "owner/repo", get })).status).toBe("missing");
    expect(f.calls.some(path => path.includes("runs/100/jobs"))).toBe(false);
  });
  it.each(["denied", "moved", "wrong-job-head", "truncated"])("keeps %s evidence unknown", async kind => {
    const f = fixture();
    if (kind === "denied") f.state.forbidden = "/actions/";
    if (kind === "moved") f.state.moves = true;
    if (kind === "wrong-job-head") f.state.jobs[0]!.head_sha = "b".repeat(40);
    const get = async (path: string) => kind === "truncated" && path.includes("/actions/runs?")
      ? { workflow_runs: [], total_count: 1 } : f.get(path);
    expect((await baseHealthReport({ repository: "owner/repo", get })).status).toBe("unknown");
  });
});

const execute = promisify(execFile);
const cli = `
  import childProcess from "node:child_process";
  import { syncBuiltinESMExports } from "node:module";
  import { promisify } from "node:util";
  const stub = () => { throw new Error("unexpected subprocess"); };
  stub[promisify.custom] = async () => { throw new Error("unexpected subprocess"); };
  childProcess.execFile = stub;
  syncBuiltinESMExports();
  globalThis.fetch = async () => { throw new Error("unexpected network"); };
  process.argv = [process.execPath, "bin/delivery.mjs", ...process.argv.slice(1)];
  await import("./bin/delivery.mjs");
`;
describe("diagnostic CLI has no application path", () => {
  it.each(["--apply", "--allow-rule-changes", "--yes"])("refuses %s before any API access", async flag => {
    await expect(execute(process.execPath, ["--input-type=module", "-e", cli, "--", "fast-merge", "--repo", "owner/repo", flag]))
      .rejects.toMatchObject({ code: 2, stdout: "", stderr: expect.stringContaining("Unknown option") });
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DEFAULT_DECLARATIONS, DELIVERY_CHECK, PROTECTION_FILE, buildEventPolicy, buildRuleset, describePolicyChanges, describeChanges, findLiveRuleset, formatProtection, loadProtection, protectRepository, validateDeclarations } from "../scripts/repository-protection.mjs";

const events = { kind: "workflow-events", workflows: [".github/workflows/delivery.yml"], events: ["pull_request_target", "workflow_dispatch"] };
const declarations = [
  { kind: "default-branch", checks: ["Tests required"], mergeMethods: ["merge", "squash"] },
  { kind: "branch", branch: "master" },
  { kind: "release-tags", pattern: "v*", bypassApps: [42] },
  events,
];
const legacyDefault = {
  id: 7, name: "old-protect-develop", target: "branch", enforcement: "active", bypass_actors: [],
  conditions: { ref_name: { include: ["refs/heads/develop"], exclude: [] } },
  rules: [
    { type: "deletion" }, { type: "non_fast_forward" },
    { type: "pull_request", parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: true, required_reviewers: [], require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: true, allowed_merge_methods: ["merge", "squash"] } },
    { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: [{ context: "Tests required", integration_id: 15368 }] } },
  ],
};
const legacyTags = { id: 9, name: "old-protect-release-tags", target: "tag", enforcement: "active", bypass_actors: [{ actor_id: 42, actor_type: "Integration", bypass_mode: "always" }],
  conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } }, rules: [{ type: "deletion" }, { type: "non_fast_forward" }] };
const stray = { id: 11, name: "experiment", target: "branch", enforcement: "active", bypass_actors: [], conditions: { ref_name: { include: ["refs/heads/experiment"], exclude: [] } }, rules: [{ type: "deletion" }] };
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const standard = (list = declarations, defaultBranch = "develop") => list.filter(item => item.kind !== "workflow-events").map((item, index) => ({ ...buildRuleset(item, defaultBranch), id: index + 1 }));

function fake(rulesets: any[] = [], { classic = false, policies = [{ ...buildEventPolicy(events), id: 3 }] as any[], file = undefined as any, fileError = undefined as any, repository = "o/r", defaultBranch = "develop", reflectWrites = false } = {}) {
  const calls: Array<[string, string, any?]> = [];
  const root = `repos/${repository}`;
  const api = async (method: string, path: string, body?: unknown) => {
    calls.push([method, path, body]);
    if (method !== "GET") {
      if (reflectWrites && path.startsWith(`${root}/rulesets`)) {
        const id = method === "POST" ? Math.max(0, ...rulesets.map(item => item.id)) + 1 : Number(path.split("/").at(-1));
        const saved = { ...structuredClone(body as object), id };
        if (method === "POST") rulesets.push(saved);
        else {
          const index = rulesets.findIndex(item => item.id === id);
          if (index === -1) throw httpError(404);
          rulesets[index] = saved;
        }
        return saved;
      }
      return {};
    }
    if (path === root) return { default_branch: defaultBranch };
    if (path === `${root}/branches/${encodeURIComponent(defaultBranch)}`) return { commit: { sha: "default-sha" } };
    if (path === `${root}/contents/${PROTECTION_FILE}?ref=default-sha`) {
      if (fileError) throw fileError;
      if (file === undefined) throw httpError(404);
      return file;
    }
    const page = Number(new URLSearchParams(path.split("?")[1]).get("page") ?? 1);
    if (path.startsWith(`${root}/actions/policies?`)) return { total_count: policies.length, policies: policies.slice((page - 1) * 100, page * 100).map(({ id, name, enforcement }) => ({ id, name, enforcement })) };
    if (path.startsWith(`${root}/actions/policies/`)) return policies.find(policy => path.endsWith(`/${policy.id}`));
    if (path.startsWith(`${root}/rulesets?`)) return rulesets.slice((page - 1) * 100, page * 100).map(({ id, name }) => ({ id, name }));
    if (path.endsWith("/protection")) { if (classic && path.includes(`/branches/${encodeURIComponent(defaultBranch)}/`)) return {}; throw httpError(404); }
    const ruleset = rulesets.find(ruleset => path === `${root}/rulesets/${ruleset.id}`);
    if (ruleset) return ruleset;
    throw new Error(`unexpected API call: ${method} ${path}`);
  };
  return { api, calls, writes: () => calls.filter(([method]) => method !== "GET") };
}
const remoteFile = (value: any) => ({ type: "file", encoding: "base64", content: Buffer.from(JSON.stringify(value)).toString("base64") });

describe("repository protection configuration", () => {
  it("uses exact built-in defaults for any repository without registration", async () => {
    const live = fake(standard(DEFAULT_DECLARATIONS), { repository: "someone/new-project" });
    const report = await protectRepository({ repository: "someone/new-project", api: live.api });
    expect(report.rulesets.every(item => item.changes.length === 0)).toBe(true);
    expect(report.configuration).toEqual({ declarations: DEFAULT_DECLARATIONS, source: "built-in defaults", commit: "default-sha" });
    expect(live.writes()).toEqual([]);
    const branch = buildRuleset(DEFAULT_DECLARATIONS[0], "develop");
    expect(branch.name).toBe("protect-develop");
    expect(branch.conditions.ref_name).toEqual({ include: ["~DEFAULT_BRANCH"], exclude: [] });
    expect(branch.rules.map(rule => rule.type)).toEqual(["deletion", "non_fast_forward", "required_linear_history", "pull_request", "required_status_checks"]);
    expect(branch.rules.find(rule => rule.type === "pull_request")!.parameters.allowed_merge_methods).toEqual(["squash"]);
    expect(branch.rules.at(-1)!.parameters.required_status_checks).toEqual([{ context: "CI required" }, { context: DELIVERY_CHECK }]);
    expect(buildEventPolicy(DEFAULT_DECLARATIONS[1])).toEqual(buildEventPolicy(events));
    expect(formatProtection(report)).toContain("configuration: built-in defaults at default-sha");
  });

  it("reads the optional override at the resolved default-branch commit, replacing rather than merging defaults", async () => {
    const live = fake(standard(), { file: remoteFile(declarations) });
    const report = await protectRepository({ repository: "o/r", api: live.api });
    expect(report.configuration).toEqual({ declarations, source: PROTECTION_FILE, commit: "default-sha" });
    expect(report.rulesets.every(item => item.changes.length === 0)).toBe(true);
    expect(live.calls[1]!.slice(0, 2)).toEqual(["GET", "repos/o/r/branches/develop"]);
    expect(live.calls[2]!.slice(0, 2)).toEqual(["GET", `repos/o/r/contents/${PROTECTION_FILE}?ref=default-sha`]);
    expect(buildRuleset(report.configuration.declarations[0], "develop").rules.some(rule => rule.type === "required_linear_history")).toBe(false);
  });

  it("encodes default-branch names and ignores unrelated local configuration", async () => {
    const paths: string[] = [];
    const api = async (_method: string, path: string) => {
      paths.push(path);
      if (path.includes("/branches/")) return { commit: { sha: "pinned-sha" } };
      throw httpError(404);
    };
    expect((await loadProtection({ repository: "o/r", defaultBranch: "release/current", api })).source).toBe("built-in defaults");
    expect(paths).toEqual(["repos/o/r/branches/release%2Fcurrent", `repos/o/r/contents/${PROTECTION_FILE}?ref=pinned-sha`]);
  });

  it.each([401, 403, 429, 500])("fails closed on HTTP %s rather than using defaults", async status => {
    const live = fake([], { fileError: httpError(status) });
    await expect(protectRepository({ repository: "o/r", api: live.api, apply: true })).rejects.toThrow(`HTTP ${status}`);
    expect(live.writes()).toEqual([]);
  });

  it("does not hide a branch lookup failure or a network failure as a missing file", async () => {
    await expect(loadProtection({ repository: "o/r", defaultBranch: "main", api: async () => { throw httpError(404); } })).rejects.toThrow("HTTP 404");
    const live = fake([], { fileError: new Error("offline") });
    await expect(protectRepository({ repository: "o/r", api: live.api })).rejects.toThrow("offline");
  });

  it.each([
    { type: "dir" },
    { type: "file", encoding: "none", content: "" },
    { type: "file", encoding: "base64", content: Buffer.from("{").toString("base64") },
    remoteFile([]),
    remoteFile({}),
  ])("rejects unreadable or malformed remote files before any writes: %j", async file => {
    const live = fake([], { file });
    await expect(protectRepository({ repository: "o/r", api: live.api, apply: true })).rejects.toThrow();
    expect(live.writes()).toEqual([]);
  });

  it.each([
    [events],
    [...declarations, events],
    [...declarations, { kind: "branch", branch: "master" }],
    [...declarations, { kind: "branch", branch: "develop" }],
    [...declarations, { kind: "branch", branch: "bad..name" }],
    [...declarations, { kind: "plugin" }],
    [{ kind: "default-branch", checks: "CI required" }, events],
    [{ kind: "default-branch", linearHistory: "true" }, events],
    [{ kind: "default-branch", mergeMethods: ["unknown"] }, events],
    [{ kind: "default-branch", typo: true }, events],
    [declarations[0], { ...events, workflows: ["../workflow.yml"] }],
    [declarations[0], { ...events, events: [] }],
    [...declarations.slice(0, 2), { kind: "release-tags", bypassApps: ["42"] }, events],
  ])("rejects invalid declarations: %j", async (...items) => {
    // Vitest spreads each array row into arguments.
    expect(() => validateDeclarations(items, "develop")).toThrow(`invalid ${PROTECTION_FILE}`);
  });

  it("preserves this repository's required gates while declaring its separate advisory caller", async () => {
    const own = validateDeclarations(JSON.parse(await readFile(PROTECTION_FILE, "utf8")), "main");
    expect(own).toEqual([
      { kind: "default-branch", checks: ["Delivery tooling tests"] },
      { kind: "workflow-events", workflows: [".github/workflows/self-delivery.yml", ".github/workflows/self-review-labels.yml"], events: ["pull_request_target", "workflow_dispatch"] },
    ]);
    expect(buildRuleset(own[0], "main").rules.some(rule => rule.type === "required_linear_history")).toBe(false);
    await expect(readFile("protection/repositories.json", "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("existing repository migration", () => {
  const originalDefaults = [
    { kind: "default-branch", checks: ["CI required"], mergeMethods: ["squash"], linearHistory: true },
    { kind: "workflow-events", workflows: [".github/workflows/delivery.yml"], events: ["pull_request_target", "workflow_dispatch"] },
  ];

  it.each(["timurproko/crew", "timurproko/xrbuild", "timurproko/herdr-app"])("preserves the original declarations for %s without a file", async repository => {
    // These are the old inventory's declarations, independent of the new default constant.
    const live = fake(standard(originalDefaults, "main"), { repository, defaultBranch: "main", policies: [{ ...buildEventPolicy(originalDefaults[1]), id: 3 }] });
    const report = await protectRepository({ repository, api: live.api });
    expect(report.configuration.source).toBe("built-in defaults");
    expect(report.blocked).toBe(false);
    expect(report.rulesets.map(item => [item.name, item.changes])).toEqual([["Actions policy allow-delivery-events", []], ["protect-main", []]]);
    expect(live.writes()).toEqual([]);
  });

  it("preserves MyWorkflows' own check, self-delivery workflow and non-linear-history policy", async () => {
    const own = JSON.parse(await readFile(PROTECTION_FILE, "utf8"));
    const live = fake(standard(own, "main"), { repository: "timurproko/MyWorkflows", defaultBranch: "main", file: remoteFile(own), policies: [{ ...buildEventPolicy(own[1]), id: 3 }] });
    const report = await protectRepository({ repository: "timurproko/MyWorkflows", api: live.api });
    expect(report.configuration.source).toBe(PROTECTION_FILE);
    expect(report.rulesets.every(item => item.changes.length === 0)).toBe(true);
    expect(buildRuleset(own[0], "main").rules.some(rule => rule.type === "required_linear_history")).toBe(false);
    expect(live.writes()).toEqual([]);
  });

  it("publishes the exact approved a1 file and preserves every exceptional ruleset and workflow event", async () => {
    const migration = await readFile("docs/protection-migration.md", "utf8");
    const a1 = JSON.parse(migration.match(/```json\n([\s\S]*?)\n```/)![1]!);
    const plan = await readFile("docs/plans/protect-defaults.md", "utf8");
    const approved = JSON.parse([...plan.matchAll(/```json\n([\s\S]*?)\n```/g)].at(-1)![1]!);
    expect(a1).toEqual(approved);
    expect(a1).toEqual([
      { kind: "default-branch", checks: ["Development validation required"], mergeMethods: ["merge", "squash"] },
      { kind: "branch", branch: "master" },
      { kind: "release-tags", pattern: "v*", bypassApps: [4942462] },
      { kind: "workflow-events", workflows: [".github/workflows/delivery.yml", ".github/workflows/release-reopening-auto-merge.yml"], events: ["pull_request_target", "workflow_run", "workflow_dispatch"] },
    ]);
    const live = fake(standard(a1), { file: remoteFile(a1), policies: [{ ...buildEventPolicy(a1[3]), id: 3 }] });
    const report = await protectRepository({ repository: "o/r", api: live.api });
    expect(report.rulesets.map(item => [item.name, item.changes])).toEqual([
      ["Actions policy allow-delivery-events", []], ["protect-develop", []], ["protect-master", []], ["protect-release-tags", []],
    ]);
    const branch = buildRuleset(a1[0], "develop");
    expect(branch.rules.some(rule => rule.type === "required_linear_history")).toBe(false);
    expect(branch.rules.at(-1)!.parameters.required_status_checks).toEqual([{ context: "Development validation required" }, { context: DELIVERY_CHECK }]);
    expect(live.writes()).toEqual([]);
  });
});

describe("protection preflight", () => {
  it("blocks every write when an existing ruleset conflicts, even if the Actions policy could be created first", async () => {
    const live = fake([legacyDefault, legacyTags, stray], { policies: [] });
    const result = await protectRepository({ repository: "o/r", api: live.api, apply: true });
    expect(result.blocked).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.conflicts).toEqual(["protect-develop"]);
    expect(live.writes()).toEqual([]);
    const output = formatProtection(result);
    expect(output).toContain("protect-develop: blocked");
    expect(output).toContain("--apply and --allow-rule-changes");
    expect(output).not.toContain("Run again with --apply");
  });

  it("reports a missing-file a1-like policy conflict instead of treating defaults as safe to apply", async () => {
    const ownEvents = { ...events, workflows: [...events.workflows, ".github/workflows/release-reopening-auto-merge.yml"], events: [...events.events, "workflow_run"] };
    const live = fake(standard(), { policies: [{ ...buildEventPolicy(ownEvents), id: 3 }] });
    const report = await protectRepository({ repository: "o/r", api: live.api });
    expect(report.blocked).toBe(true);
    expect(report.conflicts).toEqual(["Actions policy allow-delivery-events", "protect-develop"]);
    expect(report.rulesets.every(item => item.changes.length > 0)).toBe(true);
    expect(live.writes()).toEqual([]);
    expect(formatProtection(report)).toContain("Nothing was changed. Add or correct .github/protection.json");
  });

  it("blocks rule creation when an existing Actions policy differs", async () => {
    const live = fake([], { policies: [{ ...buildEventPolicy(events), id: 3, enforcement: "disabled" }] });
    const report = await protectRepository({ repository: "o/r", api: live.api, apply: true });
    expect(report.conflicts).toEqual(["Actions policy allow-delivery-events"]);
    expect(live.writes()).toEqual([]);
  });

  it("requires explicit consent for classic protection deletion and blocks other writes too", async () => {
    const live = fake([], { classic: true, policies: [] });
    const report = await protectRepository({ repository: "o/r", api: live.api, apply: true });
    expect(report.conflicts).toEqual(["classic protection on develop"]);
    expect(live.writes()).toEqual([]);
    expect(report.notes).toContain("classic protection on develop would be removed only with --apply --allow-rule-changes");
  });

  it("fails closed on a late classic-protection read error before creating any policies or rulesets", async () => {
    const live = fake([], { policies: [] });
    const api = async (method: string, path: string, body?: unknown) => {
      if (path.endsWith("/protection")) throw httpError(403);
      return live.api(method, path, body);
    };
    await expect(protectRepository({ repository: "o/r", api, apply: true })).rejects.toThrow("HTTP 403");
    expect(live.writes()).toEqual([]);
  });

  it("rejects the consent flag without apply before reading GitHub", async () => {
    const live = fake();
    await expect(protectRepository({ repository: "o/r", api: live.api, allowRuleChanges: true })).rejects.toThrow("--allow-rule-changes requires --apply");
    expect(live.calls).toEqual([]);
  });

  it("guards unknown live rule types and exclusions rather than silently dropping them", async () => {
    const branch = buildRuleset(DEFAULT_DECLARATIONS[0], "develop");
    const existing = { ...branch, id: 1, rules: [...branch.rules, { type: "required_signatures" }], conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: ["refs/heads/other"] } } };
    const live = fake([existing]);
    const report = await protectRepository({ repository: "o/r", api: live.api, apply: true });
    expect(report.blocked).toBe(true);
    expect(report.rulesets[1].changes.join("\n")).toContain("required_signatures");
    expect(report.rulesets[1].changes.join("\n")).toContain("excluded refs");
    expect(live.writes()).toEqual([]);
    const policy = buildEventPolicy(events);
    const policyChanges = describePolicyChanges({ ...policy, rules: [...policy.rules, { type: "unknown" }], conditions: { workflow_path: { ...policy.conditions.workflow_path, exclude: ["ignored.yml"] } } }, policy);
    expect(policyChanges.join("\n")).toContain("excluded workflows");
    expect(policyChanges.join("\n")).toContain("unknown");
  });

  it("finds a same-name ruleset with changed refs and refuses an unguarded replacement", async () => {
    const branch = buildRuleset(DEFAULT_DECLARATIONS[0], "develop");
    const live = fake([{ ...branch, id: 1, conditions: { ref_name: { include: ["refs/heads/other"], exclude: [] } } }]);
    const report = await protectRepository({ repository: "o/r", api: live.api, apply: true });
    expect(report.blocked).toBe(true);
    expect(report.rulesets[1].changes).toContain("refs refs/heads/other -> refs/heads/develop");
    expect(live.writes()).toEqual([]);
  });

  it.each([false, true])("reserves default-branch refs before names after master becomes develop (branch first: %s)", async branchFirst => {
    const defaultDeclaration = { kind: "default-branch", checks: ["CI required"], mergeMethods: ["squash"], linearHistory: true };
    const masterDeclaration = { kind: "branch", branch: "master" };
    const declared = [...(branchFirst ? [masterDeclaration, defaultDeclaration] : [defaultDeclaration, masterDeclaration]), events];
    // The name still refers to master, but ~DEFAULT_BRANCH now resolves to develop.
    const rulesets = [{ ...buildRuleset(defaultDeclaration, "master"), id: 7 }];
    const live = fake(rulesets, { reflectWrites: true });
    const result = await protectRepository({ repository: "o/r", declarations: declared, api: live.api, apply: true, allowRuleChanges: true });
    expect(result.applied).toBe(true);
    expect(live.writes().filter(([method]) => method === "PUT").map(([, path]) => path)).toEqual(["repos/o/r/rulesets/7"]);
    expect(live.writes().filter(([method]) => method === "POST").map(([, path]) => path)).toEqual(["repos/o/r/rulesets"]);
    expect(rulesets).toHaveLength(2);
    expect(rulesets.find(item => item.id === 7)).toEqual({ ...buildRuleset(defaultDeclaration, "develop"), id: 7 });
    expect(rulesets.find(item => item.id !== 7)).toEqual({ ...buildRuleset(masterDeclaration, "develop"), id: 8 });
    const writeCount = live.writes().length;
    const report = await protectRepository({ repository: "o/r", declarations: declared, api: live.api });
    expect(report.blocked).toBe(false);
    expect(report.rulesets.every(item => item.changes.length === 0)).toBe(true);
    expect(live.writes()).toHaveLength(writeCount);
  });

  it("reads later pages before deciding existing protection is missing", async () => {
    const extra = Array.from({ length: 100 }, (_, index) => ({ ...stray, id: index + 100, name: `unmanaged-${index}` }));
    const live = fake([...extra, ...standard(DEFAULT_DECLARATIONS)], { policies: [...extra, { ...buildEventPolicy(events), id: 3 }] });
    const report = await protectRepository({ repository: "o/r", api: live.api, apply: true });
    expect(report.blocked).toBe(false);
    expect(report.rulesets.every(item => item.changes.length === 0)).toBe(true);
    expect(report.notes).toHaveLength(200);
    expect(live.writes()).toEqual([]);
    expect(live.calls.some(([, path]) => path === "repos/o/r/rulesets?per_page=100&page=2")).toBe(true);
    expect(live.calls.some(([, path]) => path === "repos/o/r/actions/policies?per_page=100&page=2")).toBe(true);
  });

  it("reports unmanaged Actions policies without modifying them", async () => {
    const live = fake(standard(DEFAULT_DECLARATIONS), { policies: [{ ...buildEventPolicy(events), id: 3 }, { id: 4, name: "other" }] });
    const report = await protectRepository({ repository: "o/r", api: live.api, apply: true });
    expect(report.notes).toEqual(["Actions policy other is not declared and was left alone"]);
    expect(live.writes()).toEqual([]);
  });
});

describe("repository protection", () => {
  it("builds the three ruleset kinds with generic names and existing field semantics", () => {
    const [main, master, tags] = standard();
    expect([main!.name, master!.name, tags!.name]).toEqual(["protect-develop", "protect-master", "protect-release-tags"]);
    expect(main!.bypass_actors).toEqual([{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }]);
    expect(main!.rules.at(-1)!.parameters!.required_status_checks).toEqual([{ context: "Tests required" }, { context: DELIVERY_CHECK }]);
    expect(master!.rules.map(rule => rule.type)).toEqual(["deletion", "non_fast_forward"]);
    expect(tags!.bypass_actors).toEqual([{ actor_id: 42, actor_type: "Integration", bypass_mode: "always" }]);
    expect(buildRuleset({ kind: "default-branch", linearHistory: true, delivery: false, checks: ["T"] }, "main").rules.at(-1)!.parameters.required_status_checks).toEqual([{ context: "T" }]);
    expect(() => buildRuleset({ kind: "other" }, "main")).toThrow("unknown ruleset kind");
  });

  it("matches a live ruleset by refs under any name or default-branch spelling", () => {
    const desired = buildRuleset(declarations[0], "develop");
    expect(findLiveRuleset([legacyTags, legacyDefault], desired, "develop")).toBe(legacyDefault);
    expect(findLiveRuleset([legacyTags], desired, "develop")).toBeNull();
    expect(describeChanges(legacyDefault, desired, "develop")).toEqual([
      "rename from old-protect-develop",
      "bypass none -> RepositoryRole:5:pull_request",
      `required_status_checks.required_status_checks: Tests required -> Tests required, ${DELIVERY_CHECK}`,
    ]);
  });

  it("reports without writing and never touches an unmanaged ruleset", async () => {
    const dry = fake([legacyDefault, legacyTags, stray], { classic: true });
    const report = await protectRepository({ repository: "o/r", api: dry.api, declarations });
    expect(dry.writes()).toEqual([]);
    expect(report.rulesets.map(ruleset => [ruleset.name, ruleset.changes.length])).toEqual([["Actions policy allow-delivery-events", 0], ["protect-develop", 3], ["protect-master", 1], ["protect-release-tags", 1]]);
    expect(report.notes).toContain("ruleset experiment is not declared and was left alone");
    expect(formatProtection(report)).toContain("Nothing was changed.");
  });

  it("applies in place, creates missing rulesets, and retains check integration pins", async () => {
    const live = fake([legacyDefault, legacyTags, stray]);
    await protectRepository({ repository: "o/r", api: live.api, declarations, apply: true, allowRuleChanges: true });
    const writes = live.writes();
    expect(writes.map(([method, path]) => `${method} ${path}`)).toEqual(["PUT repos/o/r/rulesets/7", "POST repos/o/r/rulesets", "PUT repos/o/r/rulesets/9"]);
    expect(writes[0]![2].rules.at(-1).parameters.required_status_checks).toEqual([{ context: "Tests required", integration_id: 15368 }, { context: DELIVERY_CHECK }]);
  });

  it("writes nothing when everything already matches", async () => {
    const same = fake(standard());
    const report = await protectRepository({ repository: "o/r", api: same.api, declarations, apply: true });
    expect(same.writes()).toEqual([]);
    expect(formatProtection(report)).toContain("protect-develop: matches");
  });

  it("removes classic protection only when a fresh read confirms a matching active ruleset", async () => {
    const ready = fake(standard(), { classic: true });
    const done = await protectRepository({ repository: "o/r", api: ready.api, declarations, apply: true, allowRuleChanges: true });
    expect(ready.writes().map(([method, path]) => `${method} ${path}`)).toEqual(["DELETE repos/o/r/branches/develop/protection"]);
    expect(done.notes).toEqual(["removed the classic branch protection rule on develop; protect-develop protects it"]);
    const stale = fake([legacyDefault, legacyTags], { classic: true });
    const kept = await protectRepository({ repository: "o/r", api: stale.api, declarations, apply: true, allowRuleChanges: true });
    expect(stale.writes().some(([method]) => method === "DELETE")).toBe(false);
    expect(kept.notes).toContain("kept the classic branch protection rule on develop: protect-develop is not confirmed active");
  });

  it("installs the Actions policy and reads existing policies in full before comparing", async () => {
    const desired = buildEventPolicy(events);
    expect(describePolicyChanges({ ...desired, id: 3 }, desired)).toEqual([]);
    expect(describePolicyChanges({ ...desired, enforcement: "disabled", conditions: {} }, desired)).toEqual(["enforcement disabled -> active", "workflows all workflows -> .github/workflows/delivery.yml"]);
    const fresh = fake([], { policies: [] });
    await protectRepository({ repository: "o/r", api: fresh.api, declarations: DEFAULT_DECLARATIONS, apply: true });
    expect(fresh.writes().map(([method, path]) => `${method} ${path}`)).toEqual(["POST repos/o/r/actions/policies", "POST repos/o/r/rulesets"]);
    const present = fake(standard(DEFAULT_DECLARATIONS), { policies: [{ ...desired, id: 3, rules: [{ type: "restrict_action_events", parameters: { allowed_events: ["pull_request_target"] } }] }] });
    await protectRepository({ repository: "o/r", api: present.api, declarations: DEFAULT_DECLARATIONS, apply: true, allowRuleChanges: true });
    expect(present.writes().map(([method, path]) => `${method} ${path}`)).toEqual(["PUT repos/o/r/actions/policies/3"]);
  });
});

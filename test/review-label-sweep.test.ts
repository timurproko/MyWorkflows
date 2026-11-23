import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import bootstrap from "./fixtures/bootstrap-labels.json";
import { loadBaseLabels } from "../scripts/repository-labels.mjs";
import { cleanupClosedReviewLabels } from "../scripts/review-label-cleanup.mjs";
import { sweepMain, sweepReviewLabels } from "../scripts/review-label-sweep.mjs";

const repository = "owner/.repo.name";
const manifest = { version: 1, labels: Object.fromEntries(Object.entries(bootstrap.labels).map(([key, label], index) =>
  [key, { ...label, name: `Role ${index}`, previousNames: [`Previous ${index}`, `Oldest ${index}`] }])) };
const managed = Object.values(manifest.labels).flatMap(label => [label.name, ...label.previousNames]);
const pull = (number, state = "closed") => ({ number, state, base: { repo: { full_name: repository } } });

function fake({ pulls = [pull(1), pull(2)], labels = new Map(pulls.map(pr => [pr.number, [...managed, "unrelated"]])),
  states = new Map(), deleteStatus = 0, confirm404 = true } = {}) {
  const reads = new Map();
  const api = vi.fn(async (method, path) => {
    const url = new URL(`https://api.github.com/${path}`);
    const page = Number(url.searchParams.get("page"));
    if (method === "GET" && url.pathname === `/repos/${repository}/pulls`) {
      expect(url.searchParams.get("state")).toBe("closed");
      expect(url.searchParams.get("per_page")).toBe("100");
      return pulls.slice((page - 1) * 100, page * 100);
    }
    const match = url.pathname.match(/^\/repos\/owner\/\.repo.name\/(pulls|issues)\/(\d+)(?:\/labels(?:\/(.+))?)?$/);
    if (!match) throw new Error(`unexpected ${method} ${path}`);
    const [, resource, id, name] = match;
    const number = Number(id);
    if (method === "GET" && resource === "pulls") {
      const sequence = states.get(number) ?? ["closed"];
      const read = reads.get(number) ?? 0;
      reads.set(number, read + 1);
      return pull(number, sequence[Math.min(read, sequence.length - 1)]);
    }
    if (method === "GET" && resource === "issues") {
      return (labels.get(number) ?? []).slice((page - 1) * 100, page * 100).map(name => ({ name }));
    }
    if (method === "DELETE" && resource === "issues" && name) {
      expect(managed).toContain(decodeURIComponent(name));
      const current = labels.get(number)!;
      if (!deleteStatus || (deleteStatus === 404 && confirm404)) {
        const index = current.indexOf(decodeURIComponent(name));
        if (index >= 0) current.splice(index, 1);
      }
      if (deleteStatus) throw Object.assign(new Error("failed"), { status: deleteStatus });
      return [];
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  return { api, labels };
}
const sweep = options => sweepReviewLabels({ repository, manifest, environment: {}, ...options });

describe("explicit historical review-label sweep", () => {
  it("reports exact managed current and historical assignments on merged and unmerged closures without writing", async () => {
    const source = fake({ pulls: [{ ...pull(1), merged_at: "2026-01-01" }, { ...pull(2), merged_at: null }] });
    expect(await sweep({ api: source.api })).toEqual({ repository, applied: false,
      pulls: [1, 2].map(number => ({ number, disposition: "would-remove", names: managed })) });
    expect(source.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    expect(source.labels.get(1)).toEqual([...managed, "unrelated"]);
  });

  it("explicit apply removes all roles/aliases only and repeated processing confirms absence", async () => {
    const source = fake();
    expect(await sweep({ api: source.api, apply: true })).toEqual({ repository, applied: true,
      pulls: [1, 2].map(number => ({ number, disposition: "removed" })) });
    expect(await sweep({ api: source.api, apply: true })).toEqual({ repository, applied: true,
      pulls: [1, 2].map(number => ({ number, disposition: "absent" })) });
    expect([...source.labels.values()]).toEqual([["unrelated"], ["unrelated"]]);
    expect(source.api.mock.calls.filter(([method]) => method !== "GET")).toHaveLength(managed.length * 2);
    expect(source.api.mock.calls.every(([method, path]) => method === "GET" || (method === "DELETE" && path.includes("/issues/") && path.includes("/labels/")))).toBe(true);
  });

  it("paginates closed PR discovery and assignment reads in report and apply", async () => {
    for (const apply of [false, true]) {
      const pulls = Array.from({ length: 101 }, (_, n) => pull(n + 1));
      const unrelated = Array.from({ length: 100 }, (_, n) => `custom-${n}`);
      const source = fake({ pulls, labels: new Map([[101, [...unrelated, ...managed]]]) });
      const result = await sweep({ api: source.api, apply });
      expect(result.pulls).toHaveLength(101);
      expect(source.api.mock.calls).toContainEqual(["GET", `repos/${repository}/pulls?state=closed&per_page=100&page=2`]);
      expect(source.api.mock.calls).toContainEqual(["GET", `repos/${repository}/issues/101/labels?per_page=100&page=2`]);
      expect(source.labels.get(101)).toEqual(apply ? unrelated : [...unrelated, ...managed]);
    }
  });

  it.each([false, true])("freshly excludes open/reopened PRs, apply=%s", async apply => {
    const source = fake({ states: new Map([[1, ["open"]], [2, ["closed", "open"]]]) });
    const result = await sweep({ api: source.api, apply });
    expect(result.pulls).toEqual([1, 2].map(number => ({ number, disposition: "reopened" })));
    expect(source.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    expect(source.api.mock.calls.some(([, path]) => path.includes("issues/1/"))).toBe(false);
  });

  it("stops between verdict removals on reopen without restoring old labels", async () => {
    const source = fake({ states: new Map([[1, ["closed", "closed", "open"]]]) });
    const result = await sweep({ api: source.api, apply: true });
    expect(result.pulls[0].disposition).toBe("reopened");
    expect(source.labels.get(1)).toEqual([...managed.slice(1), "unrelated"]);
    expect(source.labels.get(2)).toEqual(["unrelated"]);
  });

  it.each(["false", "FALSE", "False"])("opts apply out before requests but permits read-only reports: %s", async value => {
    const source = fake();
    const environment = { DELIVERY_LABELS_ENABLED: value };
    expect(await sweep({ api: source.api, apply: true, environment })).toEqual({ repository, applied: false, disposition: "disabled", pulls: [] });
    expect(source.api).not.toHaveBeenCalled();
    expect((await sweep({ api: source.api, environment })).applied).toBe(false);
    expect(source.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });

  it.each([undefined, "", "true", " false "])("does not invent additional opt-outs: %s", async value => {
    const source = fake();
    expect((await sweep({ api: source.api, apply: true, environment: { DELIVERY_LABELS_ENABLED: value } })).applied).toBe(true);
  });

  it.each([[], ["--repo"], ["--repo", "owner/.."], ["--repo", "https://github.com/owner/repo"],
    ["--repo", repository, "--unknown"], ["--repo", repository, "extra"], ["--repo", repository, "--apply=false"]])("rejects missing/malformed CLI arguments before requests: %j", async (...args) => {
    const api = vi.fn();
    await expect(sweepMain(args, { api, manifest })).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });

  it.each([["--repo", repository], [`--repo=${repository}`]])("accepts both repo flag forms without implicit apply: %j", async (...args) => {
    const source = fake();
    expect((await sweepMain(args, { api: source.api, manifest, environment: {} })).applied).toBe(false);
    expect(source.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    expect((await sweepMain([...args, "--apply"], { api: source.api, manifest, environment: {} })).applied).toBe(true);
  });

  it.each([null, {}, [pull(0)], [pull(1, "open")], [pull(1), pull(1)], [{ ...pull(1), base: { repo: { full_name: "foreign/repo" } } }], Array(101).fill(pull(1))].map(listing => ({ listing })))("rejects invalid discovery before any mutation: $listing", async ({ listing }) => {
    const api = vi.fn(async () => listing);
    await expect(sweep({ api, apply: true })).rejects.toThrow();
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });

  it("completes all discovery before writes and bounds endless PR pagination", async () => {
    const api = vi.fn(async (_method, path) => {
      const page = Number(new URL(`https://api.github.com/${path}`).searchParams.get("page"));
      return Array.from({ length: 100 }, (_, n) => pull((page - 1) * 100 + n + 1));
    });
    await expect(sweep({ api, apply: true })).rejects.toThrow("pagination limit");
    expect(api).toHaveBeenCalledTimes(1000);
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });

  it("fails before writes for malformed manifests and missing verdict roles", async () => {
    for (const value of [{ version: 99 }, { ...manifest, labels: { "under-review": manifest.labels["under-review"] } }]) {
      const api = vi.fn();
      await expect(sweep({ api, manifest: value, apply: true })).rejects.toThrow();
      expect(api).not.toHaveBeenCalled();
    }
  });

  it.each([401, 403, 404, 500])("surfaces discovery/access failures, never treating them as absence: %s", async status => {
    const api = vi.fn(async () => { throw Object.assign(new Error("denied"), { status }); });
    await expect(sweep({ api, apply: true })).rejects.toMatchObject({ status });
  });

  it("confirms DELETE 404 access and exact absence, and reports failed/partial sweeps", async () => {
    const source = fake({ deleteStatus: 404 });
    expect((await sweep({ api: source.api, apply: true })).pulls.map(result => result.disposition)).toEqual(["absent", "absent"]);
    for (const options of [{ deleteStatus: 404, confirm404: false }, { deleteStatus: 403 }]) {
      const failed = fake(options);
      await expect(sweep({ api: failed.api, apply: true })).rejects.toThrow("failed on PR #1; earlier removals may have completed");
    }
    const malformed = fake();
    const api = vi.fn((method, path) => path.includes("/issues/2/labels?") ? null : malformed.api(method, path));
    await expect(sweep({ api, apply: true })).rejects.toThrow("failed on PR #2");
    expect(malformed.labels.get(1)).toEqual(["unrelated"]);
  });

  it("shares default-read-only core and reads the published palette without hard-coded names", async () => {
    const source = fake();
    const current = await loadBaseLabels();
    const names = Object.values(current.labels).flatMap(label => [label.name, ...label.previousNames]);
    source.labels.set(1, [...names, "other"]);
    expect(await cleanupClosedReviewLabels({ repository, number: 1, api: source.api })).toEqual({ number: 1, disposition: "would-remove", names });
    expect(source.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    const command = await readFile("bin/delivery.mjs", "utf8");
    expect(command).toContain('command === "labels-sweep"');
    expect(command).toContain('await import("../scripts/review-label-sweep.mjs")');
    expect(command).toContain("await sweepMain(args)");
    const workflow = await readFile(".github/workflows/delivery.yml", "utf8");
    expect(workflow).not.toMatch(/labels-sweep|review-label-sweep/);
    const automation = await readFile("scripts/run-label-automation.mjs", "utf8");
    expect(automation).not.toMatch(/sweep/);
  });
});

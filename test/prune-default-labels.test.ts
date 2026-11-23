import { describe, expect, it, vi } from "vitest";
import { GITHUB_DEFAULT_LABELS, labelUsage, pruneDefaultLabels } from "../scripts/prune-default-labels.mjs";
import { labelsMain } from "../scripts/repository-labels.mjs";

const repository = "owner/repository";
const defaults = () => GITHUB_DEFAULT_LABELS.map((label, n) => ({ ...label, default: true, id: n + 1 }));
function fake(labels = defaults(), usage: Record<string, any[]> = {}, fresh: Record<string, any> = {}, laterUsage?: Record<string, any[]>) {
  const callsPerName = new Map<string, number>();
  return vi.fn(async (method: string, path: string) => {
    const url = new URL(`https://api.github.com/${path}`);
    if (url.pathname.endsWith("/issues")) {
      expect(url.searchParams.get("state")).toBe("all");
      const name = url.searchParams.get("labels")!;
      const page = Number(url.searchParams.get("page"));
      if (page === 1) callsPerName.set(name, (callsPerName.get(name) ?? 0) + 1);
      const items = (callsPerName.get(name)! > 1 && laterUsage ? laterUsage[name] : usage[name]) ?? [];
      return items.slice((page - 1) * 100, page * 100);
    }
    if (url.pathname.endsWith("/labels")) return labels;
    const name = decodeURIComponent(url.pathname.split("/").at(-1)!);
    if (method === "GET") {
      if (fresh[name] instanceof Error) throw fresh[name];
      return fresh[name] ?? labels.find(label => label.name === name);
    }
    if (method === "DELETE") return null;
    throw new Error("unexpected write");
  });
}

describe("explicit default-label pruning", () => {
  it.each(["owner/repo.name", "owner/.hidden"])("reports defaults and usage for dotted repository identities without writes: %s", async repository => {
    const api = fake([defaults()[1]], { bug: [{ number: 1, state: "closed" }, { number: 2, pull_request: {} }] });
    const result = await labelsMain([`--repo=${repository}`, "--prune-unused-defaults"], { api });
    expect(result).toMatchObject({ repository, applied: false,
      labels: [{ name: "bug", issues: 1, pullRequests: 1, action: "retained-used" }] });
    expect(api.mock.calls).toEqual([
      ["GET", `repos/${repository}/labels?per_page=100&page=1`],
      ["GET", `repos/${repository}/issues?state=all&labels=bug&per_page=100&page=1`],
    ]);
  });

  it("reports all ten unused unmodified defaults, without any write", async () => {
    const api = fake();
    const result = await labelsMain(["--repo", repository, "--prune-unused-defaults"], { api });
    expect(result.labels).toHaveLength(10);
    expect(result.labels.every(label => label.action === "would-delete")).toBe(true);
    expect(result.warning).toContain("race");
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });

  it("preserves a1's used classifications and does not recreate its absent defaults", async () => {
    const labels = defaults().filter(label => ["bug", "enhancement", "question"].includes(label.name));
    const api = fake(labels, { bug: [{ number: 1 }, { number: 2, pull_request: {} }],
      enhancement: Array.from({ length: 24 }, (_, n) => ({ number: n + 10, pull_request: {} })) });
    const result = await pruneDefaultLabels({ repository, api, apply: true });
    expect(result.labels.map(label => [label.name, label.action])).toEqual([["bug", "retained-used"], ["enhancement", "retained-used"], ["question", "deleted"]]);
    expect(result.labels[0]).toMatchObject({ issues: 1, pullRequests: 1 });
    expect(result.labels[1]).toMatchObject({ issues: 0, pullRequests: 24 });
    expect(api.mock.calls.filter(([method]) => method !== "GET")).toEqual([["DELETE", `repos/${repository}/labels/question`]]);
  });

  it("reproduces the 51 eligible historical candidates across the six snapshot palettes", async () => {
    let candidates = 0;
    for (let n = 0; n < 5; n++) candidates += (await pruneDefaultLabels({ repository, api: fake() })).labels.filter(label => label.action === "would-delete").length;
    const labels = defaults().filter(label => ["bug", "enhancement", "question"].includes(label.name));
    candidates += (await pruneDefaultLabels({ repository, api: fake(labels, { bug: [{ number: 1 }], enhancement: [{ number: 2, pull_request: {} }] }) })).labels.filter(label => label.action === "would-delete").length;
    expect(candidates).toBe(51);
  });

  it("preserves custom labels and customized/default-marker-free standard names", async () => {
    const labels = [
      { ...defaults()[0], color: "000000" }, { ...defaults()[1], description: "custom" },
      { ...defaults()[2], default: false }, { ...defaults()[3], default: undefined },
      { ...defaults()[4], name: "custom" },
    ];
    const api = fake(labels as any);
    const result = await pruneDefaultLabels({ repository, api, apply: true });
    expect(result.labels).toEqual([]);
    expect(result.preserved).toHaveLength(5);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("counts closed-only and paginated issues and pull requests", async () => {
    const items = Array.from({ length: 101 }, (_, n) => ({ number: n + 1, state: "closed", ...(n < 70 ? {} : { pull_request: {} }) }));
    const api = fake(defaults(), { bug: items });
    expect(await labelUsage(repository, "bug", api)).toEqual({ issues: 70, pullRequests: 31 });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("rechecks metadata, default marker and stable identity before each delete", async () => {
    for (const changed of [{ ...defaults()[0], color: "000000" }, { ...defaults()[0], default: false }, { ...defaults()[0], id: 100 }]) {
      const api = fake([defaults()[0]], {}, { accessibility: changed });
      expect((await pruneDefaultLabels({ repository, api, apply: true })).labels[0].action).toBe("skipped-changed");
      expect(api.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    }
  });

  it("skips newly used or deleted labels and never deletes after unreadable usage", async () => {
    const api = fake([defaults()[0]], {}, {}, { accessibility: [{ number: 1, state: "closed" }] });
    expect((await pruneDefaultLabels({ repository, api, apply: true })).labels[0].action).toBe("retained-used");
    expect(api.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    const missing = fake([defaults()[0]], {}, { accessibility: Object.assign(new Error("gone"), { status: 404 }) });
    expect((await pruneDefaultLabels({ repository, api: missing, apply: true })).labels[0].action).toBe("skipped-missing");
    const broken = vi.fn(async (_method: string, path: string) => path.includes("/issues?") ? null : defaults());
    await expect(pruneDefaultLabels({ repository, api: broken, apply: true })).rejects.toThrow("unreadable");
    expect(broken.mock.calls.some(([method]) => method !== "GET")).toBe(false);
  });

  it("preflights every candidate before deleting any and rejects repeated pagination", async () => {
    const api = fake();
    const broken = vi.fn(async (method: string, path: string) => {
      if (path.includes("labels=wontfix")) throw new Error("denied usage");
      return api(method, path);
    });
    await expect(pruneDefaultLabels({ repository, api: broken, apply: true })).rejects.toThrow("denied usage");
    expect(broken.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    await expect(labelUsage(repository, "bug", async () => [{ number: 1 }, { number: 1 }])).rejects.toThrow("repeated");
  });

  it("does not hide permission failures as missing labels or retry failed deletes", async () => {
    const denied = fake([defaults()[0]], {}, { accessibility: Object.assign(new Error("forbidden"), { status: 403 }) });
    await expect(pruneDefaultLabels({ repository, api: denied, apply: true })).rejects.toThrow("forbidden");
    let deletes = 0;
    const source = fake([defaults()[0]]);
    const api = async (method: string, path: string) => { if (method === "DELETE") { deletes++; throw new Error("unavailable"); } return source(method, path); };
    await expect(pruneDefaultLabels({ repository, api, apply: true })).rejects.toThrow("unavailable");
    expect(deletes).toBe(1);
  });
});

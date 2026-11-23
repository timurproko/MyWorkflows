import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { labelsMain, listLabels, loadBaseLabels, syncLabels, validateManifest, validateRepository } from "../scripts/repository-labels.mjs";
import { automationMain, runLabelAutomation } from "../scripts/run-label-automation.mjs";

const repository = "owner/arbitrary-repository";
const base = { name: "🤖 Under review", color: "840479", description: "" };
const approved = { name: "🤖 Approved", color: "1a7f37", description: "" };
const changesNeeded = { name: "🤖 Changes needed", color: "9a6700", description: "" };
const palette = [base, approved, changesNeeded];
const custom = { name: "custom", color: "abcdef", description: "keep me", default: false };
const manifest = () => ({ version: 1, labels: { "under-review": { ...base },
  "review-approved": { ...approved }, "review-changes-needed": { ...changesNeeded } } });
const creates = (repository: string) => palette.map(label => ["POST", `repos/${repository}/labels`, label]);
const environment = (extra = {}) => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request_target", GITHUB_REPOSITORY: repository,
  DELIVERY_LABELS_ENABLED: "true", LABELS_APP_TOKEN: "app-secret", GH_TOKEN: "app-secret", ...extra });
const reads = (labels: any[] = []) => vi.fn(async (method: string, path: string, _body?: unknown) => {
  if (method !== "GET") return {};
  const page = Number(new URL(`https://api.github.com/${path}`).searchParams.get("page"));
  return labels.slice((page - 1) * 100, page * 100);
});

describe("shared label repository identity validation", () => {
  it.each([
    "owner/repository", "Owner-9/repo.name", "owner/.hidden", "owner/.github", "owner/...",
    "owner/..hidden", "owner/trailing.", "owner/_", "owner/-", "owner/a..b", "owner/repo.git",
    "1/a", "a-b-c/a_b-1.2", `${"a".repeat(39)}/${"r".repeat(100)}`, `owner/${".".repeat(100)}`,
  ])("accepts a GitHub identity unchanged: %s", repository => {
    expect(validateRepository(repository)).toBe(repository);
  });

  it.each([
    undefined, null, 12, {}, ["owner/repo"], "", "owner", "/repo", "owner/", "owner/repo/extra", "owner//repo",
    "https://github.com/owner/repo", "git@github.com:owner/repo.git", "owner/.", "owner/..", "../escape",
    "-owner/repo", "owner-/repo", "ow--ner/repo", "ow_ner/repo", "ow.ner/repo", `${"a".repeat(40)}/repo`,
    `owner/${"r".repeat(101)}`, " owner/repo", "owner/repo ", "owner/re po", "owner/repo\n", "owner/repo\r\n",
    "owner/repo\t", "owner/repo\u2028", "owner/repo\0", "owner/répo", "øwner/repo", "owner/%2ehidden",
    "owner/repo?query", "owner/repo#fragment", "owner/repo\\extra",
  ])("rejects malformed identities before API access: %j", async repository => {
    expect(() => validateRepository(repository)).toThrow("owner/name");
    const api = reads();
    await expect(syncLabels({ repository, api })).rejects.toThrow("owner/name");
    if (typeof repository === "string") {
      await expect(labelsMain([`--repo=${repository}`], { api })).rejects.toThrow("owner/name");
      await expect(labelsMain([`--repo=${repository}`, "--prune-unused-defaults"], { api })).rejects.toThrow("owner/name");
    }
    expect(api).not.toHaveBeenCalled();
  });
});

describe("central base-label definitions", () => {
  it("matches all three exact robot definitions, including empty descriptions and no variation selectors", async () => {
    const actual = await loadBaseLabels();
    expect(actual).toEqual(manifest());
    for (const [label, suffix] of [[actual.labels["under-review"], "Under review"],
      [actual.labels["review-approved"], "Approved"], [actual.labels["review-changes-needed"], "Changes needed"]] as const) {
      expect([...label.name].map(value => value.codePointAt(0))).toEqual([0x1f916, 32, ...[...suffix].map(value => value.codePointAt(0))]);
    }
  });

  it.each([
    null, {}, { ...manifest(), version: 2 }, { ...manifest(), extra: true }, { version: 1, labels: [] },
    { version: 1, labels: {} }, { version: 1, labels: { "under-review": { ...base, description: null } } },
    { version: 1, labels: { "under-review": { ...base, color: "#840479" } } },
    { version: 1, labels: { "under-review": { ...base, name: "x\ny" } } },
    { version: 1, labels: { "under-review": { ...base, name: " " } } },
    { version: 1, labels: { "under-review": { ...base, name: "a".repeat(51) } } },
    { version: 1, labels: { "under-review": { ...base, description: "a".repeat(101) } } },
    { version: 1, labels: { "under-review": base, duplicate: { ...base, name: base.name.toUpperCase() } } },
  ])("rejects invalid manifests before requests: %j", async value => {
    const api = reads();
    await expect(syncLabels({ repository, api, manifest: value })).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });

  it("reports creates without mutation by default, preserving all unrelated labels", async () => {
    const api = reads([custom, { name: "bug", color: "d73a4a", description: "Something isn't working", default: true }]);
    expect(await syncLabels({ repository, api })).toEqual({ repository, applied: false,
      labels: Object.entries(manifest().labels).map(([key, label]) => ({ key, name: label.name, action: "create" })),
      preserved: ["custom", "bug"] });
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });

  it("creates all managed definitions with the exact fields", async () => {
    const api = reads([custom]);
    await syncLabels({ repository, api, apply: true });
    expect(api.mock.calls.filter(([method]) => method !== "GET")).toEqual(creates(repository));
  });

  it("updates metadata in place without renaming, deleting or changing assignments", async () => {
    const api = reads([...palette.map(label => ({ ...label, color: "ffffff", description: "old" })), custom]);
    await syncLabels({ repository, api, apply: true });
    expect(api.mock.calls.filter(([method]) => method !== "GET")).toEqual(palette.map(label => ["PATCH",
      `repos/${repository}/labels/${encodeURIComponent(label.name)}`, { color: label.color, description: "" }]));
  });

  it("is a no-op for exact definitions or equivalent colors/null descriptions", async () => {
    for (const existing of [palette, palette.map(label => ({ ...label, color: label.color.toUpperCase(), description: null }))]) {
      const api = reads(existing);
      expect((await syncLabels({ repository, api, apply: true })).labels.map(label => label.action)).toEqual([
        "unchanged", "unchanged", "unchanged",
      ]);
      expect(api.mock.calls).toHaveLength(1);
    }
  });

  it("adds only the missing verdict definitions to an existing Under review palette", async () => {
    const api = reads([base, custom]);
    const result = await syncLabels({ repository, api, apply: true });
    expect(result.labels.map(label => label.action)).toEqual(["unchanged", "create", "create"]);
    expect(api.mock.calls.filter(([method]) => method !== "GET")).toEqual(creates(repository).slice(1));
  });

  it("leaves removed manifest entries unmanaged and refuses case collisions before all writes", async () => {
    const api = reads([{ ...base, name: base.name.toUpperCase() }, custom]);
    await expect(syncLabels({ repository, api, apply: true })).rejects.toThrow("collides");
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    expect((await syncLabels({ repository, api: reads([custom]) })).preserved).toEqual(["custom"]);
  });

  it("paginates the complete comparison before mutating", async () => {
    const labels = Array.from({ length: 100 }, (_, n) => ({ ...custom, name: `custom-${n}` }));
    const api = reads([...labels, ...palette]);
    expect((await syncLabels({ repository, api, apply: true })).preserved).toHaveLength(100);
    expect(api.mock.calls).toEqual([["GET", `repos/${repository}/labels?per_page=100&page=1`], ["GET", `repos/${repository}/labels?per_page=100&page=2`]]);
  });

  it("fails closed on malformed pages, duplicate labels, inaccessible repos and denied writes", async () => {
    await expect(listLabels(repository, async () => ({ message: "bad" }))).rejects.toThrow("listing");
    await expect(listLabels(repository, reads([custom, custom]))).rejects.toThrow("repeated");
    const denied = vi.fn(async () => { throw Object.assign(new Error("denied"), { status: 403 }); });
    await expect(syncLabels({ repository, api: denied, apply: true })).rejects.toThrow("denied");
    const api = vi.fn(async (method: string) => { if (method === "GET") return []; throw new Error("write denied"); });
    await expect(syncLabels({ repository, api, apply: true })).rejects.toThrow("write denied");
  });

  it("validates CLI flags/repository and never implicitly applies", async () => {
    const api = reads();
    expect((await labelsMain(["--repo", repository], { api })).applied).toBe(false);
    await expect(labelsMain([], { api })).rejects.toThrow("owner/name");
    await expect(labelsMain(["--repo", "../escape"], { api })).rejects.toThrow("owner/name");
    await expect(labelsMain(["--repo", repository, "--unknown"], { api })).rejects.toThrow();
  });
});

describe("default-on label automation with explicit opt-out", () => {
  it.each(["owner/repo.name", "owner/.hidden"])("syncs the exact dotted repository from workflow context: %s", async repository => {
    const api = reads([custom]);
    const result = await runLabelAutomation({ environment: environment({ GITHUB_REPOSITORY: repository }), api, report: vi.fn() });
    expect(result).toMatchObject({ repository, applied: true, preserved: ["custom"] });
    expect(api.mock.calls).toEqual([
      ["GET", `repos/${repository}/labels?per_page=100&page=1`],
      ...creates(repository),
    ]);
  });

  it.each(["owner/.", "owner/..", "owner/repo/extra", "https://github.com/owner/repo"])("rejects malformed workflow repository context: %s", async repository => {
    const api = reads();
    await expect(runLabelAutomation({ environment: environment({ GITHUB_REPOSITORY: repository }), api })).rejects.toThrow("owner/name");
    expect(api).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "true", "TRUE", "1", "no", " false "])("syncs by default unless explicitly opted out: %s", async enabled => {
    const api = reads();
    const result = await runLabelAutomation({ environment: environment({ DELIVERY_LABELS_ENABLED: enabled }), api, report: vi.fn() });
    expect(result.applied).toBe(true);
    expect(api.mock.calls.filter(([method]) => method !== "GET")).toEqual(creates(repository));
  });

  it.each(["false", "False", "FALSE"])("does not even call the API or require an App token when opted out: %s", async enabled => {
    const api = reads();
    const report = vi.fn();
    expect(await runLabelAutomation({ environment: environment({ DELIVERY_LABELS_ENABLED: enabled, LABELS_APP_TOKEN: "", GH_TOKEN: "" }), api, report })).toEqual({ disposition: "disabled" });
    expect(api).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.stringContaining("explicit DELIVERY_LABELS_ENABLED=false opt-out"));
  });

  it.each([undefined, "", "true", "false", "FALSE"])("keeps manual dry-runs read-only without an App token: %s", async enabled => {
    const api = reads();
    const result = await runLabelAutomation({ environment: environment({ GITHUB_EVENT_NAME: "workflow_dispatch", LABELS_DRY_RUN: "true",
      DELIVERY_LABELS_ENABLED: enabled, LABELS_APP_TOKEN: "", GH_TOKEN: "read-only" }), api, report: vi.fn() });
    expect(result.applied).toBe(false);
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });

  it.each([undefined, "", "true"])("requires the separate App token for default-on writes without a fallback: %s", async enabled => {
    const api = reads();
    for (const extra of [{ LABELS_APP_TOKEN: "" }, { GH_TOKEN: "read-only" }]) {
      await expect(runLabelAutomation({ environment: environment({ DELIVERY_LABELS_ENABLED: enabled, ...extra }), api })).rejects.toThrow("separate delivery App token");
    }
    expect(api).not.toHaveBeenCalled();
    await runLabelAutomation({ environment: environment(), api, report: vi.fn() });
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(true);
  });

  it("rejects untrusted event execution and reports failures without leaking error data", async () => {
    const api = reads();
    await expect(runLabelAutomation({ environment: environment({ GITHUB_EVENT_NAME: "pull_request" }), api })).rejects.toThrow("trusted");
    const report = vi.fn();
    expect(await automationMain({ environment: environment(), report,
      api: async () => { throw Object.assign(new Error("secret and untrusted API body"), { status: 403 }); } })).toBe(1);
    expect(report.mock.calls.flat().join("\n")).toContain("::warning::");
    expect(report.mock.calls.flat().join("\n")).toContain("HTTP 403");
    expect(report.mock.calls.flat().join("\n")).not.toContain("untrusted API body");
    expect(api).not.toHaveBeenCalled();
  });

  it("grants the sync job read permissions for private-repository dry runs without an App token", async () => {
    const workflow = await readFile(".github/workflows/delivery.yml", "utf8");
    // Scope to this job: caller grants and sibling jobs do not become the reusable job's permissions.
    const sync = workflow.slice(workflow.indexOf("\n  label-sync:"), workflow.indexOf("\n  review-label-cleanup:"));
    const permissions = sync.match(/\n    permissions:\n((?:      [^\n]*\n)+)/)?.[1];
    expect(permissions).toBe("      contents: read\n      pull-requests: read\n");
    expect(sync).toContain("!(github.event_name == 'workflow_dispatch' && inputs.dry_run)");
    expect(sync).toContain("GH_TOKEN: ${{ steps.labels-app.outputs.token || github.token }}");
    for (const path of ["templates/delivery-caller.yml", ".github/workflows/self-delivery.yml"]) {
      const caller = await readFile(path, "utf8");
      expect(caller).toMatch(/\npermissions:\n  contents: write\n  pull-requests: read\n/);
    }
  });

  it("keeps the reusable sync job isolated, pinned, gated and free of new caller contracts", async () => {
    const workflow = await readFile(".github/workflows/delivery.yml", "utf8");
    const sync = workflow.slice(workflow.indexOf("\n  label-sync:"), workflow.indexOf("\n  review-label-cleanup:"));
    expect(sync).toContain("continue-on-error: true");
    expect(sync).not.toContain("needs:");
    expect(sync).toContain("if: vars.DELIVERY_LABELS_ENABLED != 'false' && !(github.event_name == 'workflow_dispatch' && inputs.dry_run)");
    expect(sync).toMatch(/\n    continue-on-error: true\n/);
    expect(sync).not.toContain("vars.DELIVERY_LABELS_ENABLED == 'true'");
    expect(sync).toContain("ref: ${{ inputs.tools_ref }}");
    expect(sync).toContain("persist-credentials: false");
    expect(sync).toContain("permission-pull-requests: write");
    expect(sync).not.toContain("permission-issues:");
    expect(sync).not.toContain("npm ci");
    for (const path of ["templates/delivery-caller.yml", ".github/workflows/self-delivery.yml"]) {
      const caller = await readFile(path, "utf8");
      expect(caller).not.toMatch(/schedule:|review-start|review-finish|LABELS_ENABLED/);
    }
  });
});

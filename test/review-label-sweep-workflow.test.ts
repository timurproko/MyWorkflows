import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";
import definitions from "./fixtures/bootstrap-labels.json";
import { automationMain, runLabelAutomation } from "../scripts/run-label-automation.mjs";

const repository = "owner/repository";
const managed = Object.values(definitions.labels).flatMap(label => [label.name, ...label.previousNames]);
const environment = (extra = {}) => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: repository, LABELS_OPERATION: "sweep", GH_TOKEN: "reader", ...extra });
function fake() {
  const labels = [...managed, "unrelated"];
  const pull = { number: 1, state: "closed", base: { repo: { full_name: repository } } };
  const api = vi.fn(async (method, path) => {
    if (method === "GET" && path.includes("/pulls?state=closed")) return [pull];
    if (method === "GET" && path.endsWith("/pulls/1")) return pull;
    if (method === "GET" && path.includes("/issues/1/labels?")) return labels.map(name => ({ name }));
    if (method === "DELETE") {
      const name = decodeURIComponent(path.split("/").at(-1));
      expect(managed).toContain(name);
      labels.splice(labels.indexOf(name), 1);
      return [];
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  return { api, labels };
}
const run = options => runLabelAutomation({ manifest: structuredClone(definitions), report: vi.fn(), ...options });
const yaml = async path => parse(await readFile(path, "utf8"));

describe("manual-only dispatched closed-PR sweep", () => {
  it.each([undefined, "false", "TRUE", "1"])("defaults to report without a writer, apply=%s", async apply => {
    const source = fake(), report = vi.fn();
    expect((await run({ ...source, report, environment: environment({ LABELS_SWEEP_APPLY: apply }) })).applied).toBe(false);
    expect(source.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
    expect(source.labels).toEqual([...managed, "unrelated"]);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("PR #1: would-remove"));
  });

  it("requires explicit apply and the separate writer; repeated dispatch is idempotent", async () => {
    const source = fake();
    await expect(run({ ...source, environment: environment({ LABELS_SWEEP_APPLY: "true" }) })).rejects.toThrow("separate delivery App token");
    expect(source.api).not.toHaveBeenCalled();
    const env = environment({ LABELS_SWEEP_APPLY: "true", LABELS_APP_TOKEN: "writer", GH_TOKEN: "writer" });
    expect((await run({ ...source, environment: env })).pulls[0].disposition).toBe("removed");
    expect((await run({ ...source, environment: env })).pulls[0].disposition).toBe("absent");
    expect(source.labels).toEqual(["unrelated"]);
    expect(source.api.mock.calls.filter(([method]) => method !== "GET")).toHaveLength(managed.length);
  });

  it("opts apply out before reads/token requirements, but still permits reports", async () => {
    const source = fake();
    const env = environment({ DELIVERY_LABELS_ENABLED: "FALSE" });
    expect(await run({ ...source, environment: { ...env, LABELS_SWEEP_APPLY: "true" } })).toEqual({ disposition: "disabled" });
    expect(source.api).not.toHaveBeenCalled();
    expect((await run({ ...source, environment: env })).applied).toBe(false);
  });

  it.each(["pull_request_target", "pull_request", "workflow_run", "push"])("never sweeps automatically on %s", async eventName => {
    const api = vi.fn();
    await expect(run({ api, environment: environment({ GITHUB_EVENT_NAME: eventName }) })).rejects.toThrow(/event|operation/);
    expect(api).not.toHaveBeenCalled();
  });

  it("fails the manual job visibly on API denial, never claiming confirmed absence", async () => {
    const api = vi.fn(async () => { throw Object.assign(new Error("denied"), { status: 403 }); });
    const report = vi.fn();
    expect(await automationMain({ api, report, manifest: definitions, environment: environment() })).toBe(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("::warning::Delivery label automation failed (HTTP 403)"));
  });

  it("ships isolated dispatch-only callers with a report-first trusted reusable job", async () => {
    const caller = await yaml("templates/review-label-sweep-caller.yml");
    const own = await yaml(".github/workflows/self-review-label-sweep.yml");
    const reusable = await yaml(".github/workflows/review-label-sweep.yml");
    expect(Object.keys(caller.on)).toEqual(["workflow_dispatch"]);
    expect(caller.on.workflow_dispatch.inputs.apply).toMatchObject({ type: "boolean", default: false });
    expect(caller.jobs.sweep.uses).toBe("timurproko/MyWorkflows/.github/workflows/review-label-sweep.yml@main");
    expect(own.on).toEqual(caller.on);
    expect(own.jobs.sweep).toEqual({ ...caller.jobs.sweep, uses: "./.github/workflows/review-label-sweep.yml" });
    expect(Object.keys(reusable.on)).toEqual(["workflow_call"]);
    expect(Object.keys(reusable.jobs)).toEqual(["sweep"]);
    expect(reusable.on.workflow_call.inputs.apply.default).toBe(false);
    expect(reusable.jobs.sweep.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(reusable.jobs.sweep["continue-on-error"]).toBeUndefined();
    const steps = reusable.jobs.sweep.steps;
    expect(steps[0].with).toMatchObject({ repository: "timurproko/MyWorkflows", ref: "${{ inputs.tools_ref }}", "persist-credentials": false });
    expect(steps.find(step => step.id === "sweep-app")).toMatchObject({ if: "inputs.apply && vars.DELIVERY_LABELS_ENABLED != 'false'",
      with: { "permission-pull-requests": "write" } });
    expect(steps.at(-1).env).toMatchObject({ LABELS_OPERATION: "sweep", LABELS_SWEEP_APPLY: "${{ inputs.apply }}" });
    expect(steps.at(-1).run).toBe("node scripts/run-label-automation.mjs");
    expect(JSON.stringify(reusable)).not.toMatch(/Delivery check|CI required|permission-issues|pull_request\.head/);
  });

  it("tests published branch heads before PR publication without a policy-gated dispatch", async () => {
    const workflow = await yaml(".github/workflows/test.yml");
    expect(workflow.on).toEqual({ pull_request: null, push: null });
    expect(workflow.jobs.test.if).toBeUndefined();
  });

  it("does not skip closed label webhooks and shares the close/reconcile multi-pending queue", async () => {
    const labels = (await yaml(".github/workflows/review-labels.yml")).jobs["review-label-reconciliation"];
    const close = (await yaml(".github/workflows/delivery.yml")).jobs["review-label-cleanup"];
    expect(labels.if).toContain("github.event.action == 'labeled'");
    expect(labels.if).not.toMatch(/state|merged/);
    expect(close.concurrency).toEqual(labels.concurrency);
    expect(close.concurrency).toMatchObject({ queue: "max", "cancel-in-progress": false });
  });
});

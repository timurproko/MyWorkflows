import { readFile, readdir } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { DELIVERY_CHECK } from "../scripts/repository-protection.mjs";

type Workflows = Map<string, any>;
const read = async (path: string) => parse(await readFile(path, "utf8"));
const labelActions = ["labeled", "unlabeled"];

function receivesLabels(workflow: any): boolean {
  const on = workflow.on;
  if (typeof on === "string") return on === "label";
  if (Array.isArray(on)) return on.includes("label");
  if (!on || typeof on !== "object") return false;
  if (Object.hasOwn(on, "label")) return true; // Includes the default `label:` subscription.
  return ["pull_request", "pull_request_target", "issues"].some(event => {
    const types = on[event]?.types;
    return (Array.isArray(types) ? types : [types]).some(type => labelActions.includes(type));
  });
}

// Traverse EVERY job, regardless of its if/needs/conclusion: GitHub publishes skipped jobs,
// and skipped required checks can replace a failed gate on the same commit.
function publishedChecks(workflows: Workflows, root: string, stack: string[] = [], prefix = ""): string[] {
  if (stack.includes(root)) throw new Error(`recursive workflow call: ${root}`);
  const workflow = workflows.get(root);
  if (!workflow?.jobs) throw new Error(`unresolved workflow: ${root}`);
  return Object.entries(workflow.jobs).flatMap(([id, job]: [string, any]) => {
    const name = job.name ?? id;
    if (typeof name !== "string" || name.includes("${{")) throw new Error(`dynamic check name: ${root}/${id}`);
    const check = prefix ? `${prefix} / ${name}` : name;
    if (!job.uses) return [check];
    const target = job.uses.startsWith("./") ? job.uses.slice(2)
      : job.uses.match(/^timurproko\/MyWorkflows\/(\.github\/workflows\/[^@]+)@[^@]+$/)?.[1];
    if (!target) throw new Error(`unresolved reusable workflow: ${job.uses}`);
    return [check, ...publishedChecks(workflows, target, [...stack, root], check)];
  });
}

function violations(workflows: Workflows, required: Set<string>): string[] {
  return [...workflows].filter(([, workflow]) => receivesLabels(workflow)).flatMap(([path]) =>
    publishedChecks(workflows, path).filter(name => {
      const segments = name.split(" / ");
      return required.has(name) || segments.some(segment => required.has(segment))
        || /\b(?:tests?|CI required|Delivery check)\b/i.test(name);
    }).map(name => `${path}: ${name}`));
}

async function fixtures() {
  const workflows: Workflows = new Map();
  for (const directory of [".github/workflows", "templates"]) {
    for (const name of await readdir(directory)) {
      if (/\.ya?ml$/.test(name)) workflows.set(`${directory}/${name}`, await read(`${directory}/${name}`));
    }
  }
  const protection = JSON.parse(await readFile(".github/protection.json", "utf8"));
  const required = new Set<string>([DELIVERY_CHECK, "Delivery check", "CI required",
    ...protection.flatMap(item => item.checks ?? []),
    ...Object.entries(workflows.get(".github/workflows/test.yml").jobs).map(([id, job]: [string, any]) => job.name ?? id),
  ]);
  return { workflows, required };
}

describe("label workflow and required-check namespaces", () => {
  it("never contains or transitively calls a required/test check from any label-triggered entrypoint", async () => {
    const { workflows, required } = await fixtures();
    expect([...workflows].filter(([, workflow]) => receivesLabels(workflow)).map(([path]) => path).sort()).toEqual([
      ".github/workflows/reference-labels.yml", ".github/workflows/self-review-labels.yml", "templates/review-labels-caller.yml",
    ]);
    expect(violations(workflows, required)).toEqual([]);
    expect(publishedChecks(workflows, "templates/review-labels-caller.yml")).toEqual([
      "review-labels", "review-labels / Reconcile managed review labels (advisory)",
    ]);
  });

  it.each(["templates/delivery-caller.yml", ".github/workflows/self-delivery.yml"])("rejects forwarding labeled/unlabeled through %s even though every job skips", async path => {
    for (const action of labelActions) {
      const { workflows, required } = await fixtures();
      workflows.get(path).on.pull_request_target.types.push(action);
      expect(violations(workflows, required)).toContain(`${path}: ${DELIVERY_CHECK}`);
    }
  });

  it("detects skipped gates and test jobs introduced directly or through nested workflow calls", async () => {
    for (const name of ["Delivery check", "CI required", "Delivery tooling tests"]) {
      const { workflows, required } = await fixtures();
      workflows.get(".github/workflows/review-labels.yml").jobs.unsafe = { name, if: false, "runs-on": "ubuntu-latest", steps: [] };
      expect(violations(workflows, required)).toContain(`templates/review-labels-caller.yml: review-labels / ${name}`);
    }
    const { workflows, required } = await fixtures();
    workflows.set(".github/workflows/nested.yml", { jobs: { tests: { uses: "./.github/workflows/test.yml", if: false } } });
    workflows.get(".github/workflows/review-labels.yml").jobs.unsafe = { uses: "./.github/workflows/nested.yml", if: false };
    expect(violations(workflows, required)).toContain("templates/review-labels-caller.yml: review-labels / unsafe / tests / Delivery tooling tests");
  });

  it("fails closed on unresolved calls, dynamic check names, and default label-definition subscriptions", async () => {
    for (const unsafe of [{ uses: "unknown/repository/.github/workflows/unknown.yml@main" }, { name: "${{ matrix.check }}", steps: [] }]) {
      const { workflows, required } = await fixtures();
      workflows.get(".github/workflows/review-labels.yml").jobs.unsafe = unsafe;
      expect(() => violations(workflows, required)).toThrow(/unresolved|dynamic/);
    }
    for (const on of ["label", ["label"], { label: null }]) {
      const { workflows, required } = await fixtures();
      workflows.set("unsafe.yml", { on, jobs: { gate: { name: "CI required", if: false, steps: [] } } });
      expect(violations(workflows, required)).toContain("unsafe.yml: CI required");
    }
  });

  it("cannot replace a failed required result with a skipped label-event result", async () => {
    const { workflows, required } = await fixtures();
    const conclusions = new Map([[DELIVERY_CHECK, "failure"], ["CI required", "failure"]]);
    for (const [path, workflow] of workflows) {
      if (receivesLabels(workflow)) for (const check of publishedChecks(workflows, path)) conclusions.set(check, "skipped");
    }
    expect(conclusions.get(DELIVERY_CHECK)).toBe("failure");
    expect(conclusions.get("CI required")).toBe("failure");
    expect(violations(workflows, required)).toEqual([]);
  });

  it("ships a separate minimal labeled-only caller and a matching trusted local self-caller", async () => {
    const template = await read("templates/review-labels-caller.yml");
    const own = await read(".github/workflows/self-review-labels.yml");
    expect(template.on).toEqual({ pull_request_target: { types: ["labeled"] } });
    expect(template.permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(Object.keys(template.jobs)).toEqual(["review-labels"]);
    expect(template.jobs["review-labels"].uses).toBe("timurproko/MyWorkflows/.github/workflows/review-labels.yml@main");
    expect(template.jobs["review-labels"].secrets).toEqual({
      app_id: "${{ vars.DELIVERY_BOT_APP_ID }}", app_private_key: "${{ secrets.DELIVERY_BOT_PRIVATE_KEY }}",
    });
    const { name: ignoredName, ...settings } = own;
    const { name: templateName, ...templateSettings } = template;
    expect(settings).toEqual({ ...templateSettings, jobs: {
      "review-labels": { ...template.jobs["review-labels"], uses: "./.github/workflows/review-labels.yml" },
    } });
    const reusable = await read(".github/workflows/review-labels.yml");
    expect(Object.keys(reusable.on)).toEqual(["workflow_call"]);
    expect(Object.keys(reusable.jobs)).toEqual(["review-label-reconciliation"]);
    expect(reusable.on.workflow_call.inputs.tools_ref.default).toBe("main");
    expect(reusable.jobs["review-label-reconciliation"].name).toBe("Reconcile managed review labels (advisory)");
  });
});

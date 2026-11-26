import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const load = async (path: string) => (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
const sharedPath = ".github/workflows/delivery.yml";
const labelsPath = ".github/workflows/review-labels.yml";

function job(workflow: string, name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`Missing job ${name}`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/\n  [a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

// These fixture conditions use the JS-compatible subset of GitHub expressions.
// Evaluate the actual job guard, not a separately maintained model of its behavior.
function enabled(section: string, action: string, eventName = "pull_request_target", overrides = {}): boolean {
  const lines = section.split("\n");
  const index = lines.findIndex(line => line.startsWith("    if: "));
  if (index < 0) throw new Error("Expected an explicit job event guard");
  let expression = lines[index].slice("    if: ".length);
  if (expression === ">-") {
    expression = "";
    for (const line of lines.slice(index + 1)) {
      if (!line.startsWith("      ")) break;
      expression += ` ${line.trim()}`;
    }
  }
  return Boolean(runInNewContext(expression, {
    inputs: {},
    github: {
      event_name: eventName,
      event: {
        action, repository: { default_branch: "main" },
        pull_request: { state: "open", draft: false, merged: false, base: { ref: "main" }, user: { login: "maintainer" } },
      },
      ...overrides,
    },
  }));
}

describe("advisory label-sync scheduling", () => {
  it("serializes repository-wide work with a multi-pending queue, not pending replacement", async () => {
    const workflow = await load(sharedPath);
    const section = job(workflow, "label-sync");
    const concurrency = section.match(/^    concurrency:\n((?:      .*\n)+)/m)?.[1];
    expect(concurrency).toBeDefined();
    expect(concurrency).toMatch(/^      group: delivery-label-sync$/m);
    expect(concurrency).toMatch(/^      queue: max$/m);
    expect(concurrency).toMatch(/^      cancel-in-progress: false$/m);
    expect(concurrency).not.toContain("pull_request.number");
    expect(workflow).not.toMatch(/^concurrency:/m);
  });

  it("keeps sync isolated, advisory, least-privileged and out of every required job dependency", async () => {
    const workflow = await load(sharedPath);
    const section = job(workflow, "label-sync");
    expect(section).toContain("    continue-on-error: true");
    expect(section).not.toMatch(/^    needs:/m);
    expect(section).toContain("permission-pull-requests: write");
    expect(section).not.toMatch(/permission-(contents|issues|workflows): write/);
    expect(section).toContain("vars.DELIVERY_LABELS_ENABLED != 'false'");
    expect(section).toContain("github.event_name == 'workflow_dispatch' && inputs.dry_run");
    for (const name of ["finalize", "check", "refresh", "branch-cleanup", "review-label-cleanup"]) {
      expect(job(workflow, name)).not.toMatch(/^    needs:.*label-sync/m);
    }
    const protection = JSON.parse(await load(".github/protection.json"));
    expect(JSON.stringify(protection)).not.toContain("Sync the base labels");
  });
});

describe("label-only delivery events", () => {
  it.each(["labeled", "unlabeled"])("skips every existing delivery job on %s for both PR event types", async action => {
    const workflow = await load(sharedPath);
    for (const eventName of ["pull_request", "pull_request_target"]) {
      for (const name of ["finalize", "check", "refresh", "branch-cleanup", "label-sync", "review-label-cleanup", "diagnostics"]) {
        expect(enabled(job(workflow, name), action, eventName), name).toBe(false);
      }
      expect(enabled(job(await load(labelsPath), "review-label-reconciliation"), action, eventName)).toBe(action === "labeled");
    }
  });

  it.each(["opened", "synchronize", "reopened", "ready_for_review", "edited"])("retains readiness/check/sync on %s", async action => {
    const workflow = await load(sharedPath);
    for (const name of ["finalize", "check", "label-sync", "diagnostics"]) expect(enabled(job(workflow, name), action), name).toBe(true);
  });

  it("retains closure cleanup, merged refresh, manual reconciliation and forwarded workflow completion", async () => {
    const workflow = await load(sharedPath);
    for (const name of ["refresh", "branch-cleanup", "label-sync", "review-label-cleanup", "diagnostics"]) {
      expect(enabled(job(workflow, name), "closed", "pull_request_target", { event: {
        action: "closed", repository: { default_branch: "main" }, pull_request: { state: "closed", merged: true, base: { ref: "main" } },
      } }), name).toBe(true);
    }
    for (const name of ["finalize", "label-sync"]) expect(enabled(job(workflow, name), "", "workflow_dispatch"), name).toBe(true);
    expect(enabled(job(workflow, "refresh"), "completed", "workflow_run")).toBe(true);
    expect(enabled(job(workflow, "check"), "closed")).toBe(false);
  });

  it("keeps policy/base-health diagnostics advisory, read-only and independent of merge gates", async () => {
    const workflow = await load(sharedPath);
    const section = job(workflow, "diagnostics");
    expect(section).toContain("continue-on-error: true");
    expect(section).toContain("contents: read");
    expect(section).toContain("GITHUB_TOKEN: ${{ github.token }}");
    expect(section).toContain("ref: ${{ inputs.tools_ref }}");
    expect(section).not.toMatch(/app_private_key|permission-.*: write|actions: write|needs:/);
    for (const name of ["finalize", "check", "refresh"]) expect(job(workflow, name)).not.toMatch(/needs:.*diagnostics/);
    expect(enabled(section, "closed")).toBe(false);
    expect(enabled(section, "", "workflow_dispatch")).toBe(true);
    expect(enabled(section, "completed", "workflow_run")).toBe(true);
    expect(await load(".github/protection.json")).not.toContain("default-branch health");
    expect(job(workflow, "check")).toContain("npm ci --ignore-scripts --omit=dev");
    expect(job(workflow, "refresh")).toContain("npm ci --ignore-scripts --omit=dev");
  });

  it("keeps delivery callers free of label actions so they cannot publish skipped required checks",  async () => {
    for (const path of ["templates/delivery-caller.yml", ".github/workflows/self-delivery.yml"]) {
      const workflow = await load(path);
      const types = workflow.match(/pull_request_target:\n    types: \[([^\]]+)\]/)?.[1].split(",").map(type => type.trim());
      expect(types).toEqual(["opened", "synchronize", "ready_for_review", "converted_to_draft", "reopened", "edited", "closed"]);
      expect(workflow).not.toMatch(/^concurrency:/m);
    }
    // Default pull_request actions are opened, synchronize and reopened, not labeled/unlabeled.
    expect(await load(".github/workflows/test.yml")).toMatch(/  pull_request:\n  push:/);
  });

  it("isolates the advisory reconciliation job with trusted tooling and a scoped token", async () => {
    const workflow = await load(sharedPath);
    const labels = await load(labelsPath);
    const section = job(labels, "review-label-reconciliation");
    expect(workflow).not.toContain("review-label-reconciliation:");
    expect(workflow).not.toContain("review-labels.yml");
    expect(labels.match(/^  [a-z][\w-]*:/gm)).toEqual(["  workflow_call:", "  contents:", "  review-label-reconciliation:"]);
    expect(section).toContain("    continue-on-error: true");
    expect(section).not.toMatch(/^    needs:/m);
    expect(section).toContain("group: delivery-review-label-reconciliation-${{ github.repository }}-${{ github.event.pull_request.number }}");
    expect(section).toContain("queue: max");
    expect(section).toContain("cancel-in-progress: false");
    expect(section).toContain("repository: timurproko/MyWorkflows");
    expect(section).toContain("ref: ${{ inputs.tools_ref }}");
    expect(section).toContain("persist-credentials: false");
    expect(section).toContain("if: vars.DELIVERY_LABELS_ENABLED != 'false'");
    expect(section).toContain("permission-pull-requests: write");
    expect(section).not.toMatch(/permission-(contents|issues|workflows): write/);
    expect(section).toContain("GH_TOKEN: ${{ steps.review-labels-app.outputs.token }}");
    expect(section).toContain("LABELS_APP_TOKEN: ${{ steps.review-labels-app.outputs.token }}");
    expect(section).toContain("LABELS_OPERATION: reconcile");
    expect(section).not.toMatch(/github.token|head.sha|user.login|sender.login/);
    for (const name of ["finalize", "check", "refresh", "branch-cleanup", "label-sync", "review-label-cleanup"]) {
      expect(job(workflow, name)).not.toMatch(/^    needs:.*review-label-reconciliation/m);
    }
    expect(await load(".github/protection.json")).not.toContain("Reconcile managed review labels (advisory)");
  });

  it("reconciles only open additions, not closure, merges, dispatch, or other PR actions", async () => {
    const section = job(await load(labelsPath), "review-label-reconciliation");
    for (const action of ["opened", "synchronize", "closed", "reopened", "edited", "unlabeled"]) expect(enabled(section, action)).toBe(false);
    for (const eventName of ["workflow_dispatch", "workflow_run", "label", "push"]) expect(enabled(section, "labeled", eventName)).toBe(false);
    for (const pull of [{ state: "closed", merged: false }, { state: "closed", merged: true }, { state: "open", merged: true }]) {
      expect(enabled(section, "labeled", "pull_request_target", { event: { action: "labeled", pull_request: pull } })).toBe(false);
    }
  });

  it("preserves separate repository label-definition events", async () => {
    const reference = await load(".github/workflows/reference-labels.yml");
    expect(reference).toContain("  label:\n    types: [edited, created, deleted]");
    expect(reference).toContain("github.event_name == 'label' || inputs.apply");
  });
});

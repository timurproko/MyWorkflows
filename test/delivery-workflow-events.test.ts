import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const load = async (path: string) => (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
const sharedPath = ".github/workflows/delivery.yml";

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
        pull_request: { draft: false, merged: true, base: { ref: "main" }, user: { login: "maintainer" } },
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
  it.each(["labeled", "unlabeled"])("skips every shared job on %s even with a nonstandard caller", async action => {
    const workflow = await load(sharedPath);
    for (const name of ["finalize", "check", "refresh", "branch-cleanup", "label-sync", "review-label-cleanup"]) {
      expect(enabled(job(workflow, name), action), name).toBe(false);
    }
  });

  it.each(["opened", "synchronize", "reopened", "ready_for_review", "edited"])("retains readiness/check/sync on %s", async action => {
    const workflow = await load(sharedPath);
    for (const name of ["finalize", "check", "label-sync"]) expect(enabled(job(workflow, name), action), name).toBe(true);
  });

  it("retains closure cleanup, merged refresh, manual reconciliation and forwarded workflow completion", async () => {
    const workflow = await load(sharedPath);
    for (const name of ["refresh", "branch-cleanup", "label-sync", "review-label-cleanup"]) {
      expect(enabled(job(workflow, name), "closed"), name).toBe(true);
    }
    for (const name of ["finalize", "label-sync"]) expect(enabled(job(workflow, name), "", "workflow_dispatch"), name).toBe(true);
    expect(enabled(job(workflow, "refresh"), "completed", "workflow_run")).toBe(true);
    expect(enabled(job(workflow, "check"), "closed")).toBe(false);
  });

  it("keeps assignment events out of the template and self-caller before workflow concurrency is considered", async () => {
    for (const path of ["templates/delivery-caller.yml", ".github/workflows/self-delivery.yml"]) {
      const workflow = await load(path);
      const types = workflow.match(/pull_request_target:\n    types: \[([^\]]+)\]/)?.[1].split(",").map(type => type.trim());
      expect(types).toEqual(["opened", "synchronize", "ready_for_review", "converted_to_draft", "reopened", "edited", "closed"]);
      expect(workflow).not.toMatch(/^concurrency:/m);
    }
    // Default pull_request actions are opened, synchronize and reopened, not labeled/unlabeled.
    expect(await load(".github/workflows/test.yml")).toMatch(/  pull_request:\n  push:/);
  });

  it("preserves separate repository label-definition events", async () => {
    const reference = await load(".github/workflows/reference-labels.yml");
    expect(reference).toContain("  label:\n    types: [edited, created, deleted]");
    expect(reference).toContain("github.event_name == 'label' || inputs.apply");
  });
});

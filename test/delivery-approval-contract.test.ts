import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
const text = async (path: string) => (await readFile(path, "utf8")).replace(/\s+/g, " ");

describe("published approval delivery contract", () => {
  it("keeps dispatch inputs and forwarding aligned with both actual caller workflows", async () => {
    const shared = parse(await readFile(".github/workflows/delivery.yml", "utf8"));
    for (const path of ["templates/delivery-caller.yml", ".github/workflows/self-delivery.yml"]) {
      const caller = parse(await readFile(path, "utf8"));
      expect(Object.keys(caller.on.workflow_dispatch.inputs)).toEqual(["pr", "approved_head", "dry_run"]);
      expect(caller.on.workflow_dispatch.inputs.dry_run.default).toBe(true);
      expect(caller.jobs.delivery.with.approved_head).toBe("${{ inputs.approved_head }}");
      for (const key of ["pr", "approved_head", "dry_run"]) expect(shared.on.workflow_call.inputs[key].type).toBe(caller.on.workflow_dispatch.inputs[key].type);
    }
  });
  it("defines filenames, authorization, refusal results and open-draft migration for the later crew task", async () => {
    const docs = await text("docs/delivery-approval.md");
    for (const term of [".github/workflows/delivery.yml", ".github/workflows/self-delivery.yml", "workflow_call", "default branch", "approved_head", "dry_run", "Actions write", "signed-in credential", "approval-head-mismatch", "approval-head-required", "approval-head-invalid", "nonzero", "no branch/body/readiness writes", "queued", "first-parent", "1,000", "author.login", "committer.login", "merge-tree --write-tree", "reviewedHead", "finalizedHead", "Already-complete", "Already-ready", "not grandfathered", "tools_ref", "No crew reviewer", "partial", "not a credential"]) expect(docs.toLowerCase(), term).toContain(term.toLowerCase());
    expect(docs).toContain("**no Automation section**");
    expect(docs).toContain("no atomic compare-and-promote");
  });
  it("requires workers and reviewers to test once, approval before promotion and delta repairs on ready PRs", async () => {
    const skill = await text("skills/change-delivery/SKILL.md");
    expect(skill).toContain("suite once on the head you hand off; CI confirms it");
    expect(skill).toContain("reviewer checks out that exact head, builds and runs the project's full local test suite once");
    for (const term of ["commands, results and what was checked", "Agents never mark ready", "Too-early", "delta review"]) {
      const all = `${skill} ${await text("docs/delivery-approval.md")}`;
      expect(all.toLowerCase()).toContain(term.toLowerCase());
    }
    expect(skill).not.toContain("Do not loop broad local suites");
    expect(skill).toContain("finalizes **on the draft**");
    for (const path of ["README.md", "docs/delivery-labels.md", "skills/change-delivery/SKILL.md"]) {
      const source = await text(path);
      expect(source).toContain("without waiting for CI");
      expect(source).toContain("Approved stays as the record");
      expect(source).not.toContain("Review ✓");
    }
  });
});

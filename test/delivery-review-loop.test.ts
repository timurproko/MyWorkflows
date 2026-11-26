import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
const text = async (path: string) => (await readFile(path, "utf8")).replace(/\s+/g, " ");

describe("bounded delivery review loop", () => {
  it("keeps ordinary completion-based delivery without approval-dispatch plumbing", async () => {
    for (const path of ["templates/delivery-caller.yml", ".github/workflows/self-delivery.yml"]) {
      const caller = parse(await readFile(path, "utf8"));
      expect(Object.keys(caller.on.workflow_dispatch.inputs)).toEqual(["pr", "dry_run"]);
      expect(Object.keys(caller.jobs.delivery.with)).toEqual(["pr", "dry_run"]);
    }
    const shared = parse(await readFile(".github/workflows/delivery.yml", "utf8"));
    expect(Object.keys(shared.on.workflow_call.inputs)).toEqual(["pr", "dry_run", "tools_ref"]);
    for (const path of ["scripts/openspec-finalization-publication.mjs", "scripts/publish-openspec-finalization.mjs", "scripts/openspec-archive-policy.mjs"]) {
      expect(await text(path)).not.toMatch(/approved_head|approvedHead|reviewedHead|approvalRequested/);
    }
    for (const path of ["docs/delivery-approval.md", "scripts/delivery-approval.mjs"]) {
      await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("requires targeted testing, immediate pushed reports and a bounded combined fix round", async () => {
    const skill = await text("skills/change-delivery/SKILL.md");
    for (const term of ["One concern per pull request", "run only the tests for what you touched", "No full local test suite",
      "Report immediately after pushing", "CI and the review start together", "One combined fix round", "CI failures and review findings together",
      "BLOCKING", "FOLLOW-UP", "Only blocking findings cause another round", "second review covers only the fix",
      "After two rounds the person decides", "Agents never mark a pull request ready"]) {
      expect(skill.toLowerCase(), term).toContain(term.toLowerCase());
    }
    expect(skill).not.toContain("suite once on the head you hand off");
    expect(skill).not.toContain("hand off after approval/publication when final-head CI is green");
    for (const path of ["README.md", "docs/delivery-labels.md", "skills/change-delivery/SKILL.md"]) {
      const guidance = await text(path);
      expect(guidance).toContain("the review approved that commit and CI is green on that same commit");
      expect(guidance).toContain("Approved stays as the record");
      expect(guidance).not.toMatch(/without waiting for CI|approved_head|reviewedHead|delivery-approval\.md/);
    }
  });

  it("documents why non-strict checks preserve required gates without repeated base-merge CI", async () => {
    for (const path of ["README.md", "docs/protection-migration.md"]) {
      const docs = await text(path);
      for (const term of ["strict_required_status_checks_policy: false", "several agents", "CI required", "delivery / Delivery check", "default branch", "pass separately and break together"]) {
        expect(docs, term).toContain(term);
      }
    }
  });
});

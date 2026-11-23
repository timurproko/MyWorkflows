import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadBaseLabels } from "../scripts/repository-labels.mjs";

const file = (path: string) => readFile(path, "utf8");

describe("label adoption and separate review-runner contract", () => {
  it("documents the exact manifest key/name and direct API operations", async () => {
    const manifest = await loadBaseLabels();
    const docs = await file("docs/delivery-labels.md");
    const skill = await file("skills/change-delivery/SKILL.md");
    expect(docs).toContain("`under-review`");
    expect(docs).toContain(manifest.labels["under-review"].name);
    expect(docs).toContain(manifest.labels["under-review"].color);
    expect(docs).toContain("empty description");
    expect(docs).toContain('`POST /repos/{owner}/{repo}/issues/{pr}/labels` with `{"labels":["🤖 Under review"]}`');
    expect(docs).toContain("%F0%9F%A4%96%20Under%20review");
    expect(skill).toContain("signed-in credential");
    expect(skill).toContain("APPROVE");
    expect(skill).toContain("CHANGES NEEDED");
    expect(skill).toMatch(/stop, finish, observed\s+death or abandonment/);
    expect(skill).toContain("advisory");
    expect(skill).toMatch(/confirm access and absence/i);
  });

  it("states the gate, permission alternatives and non-instant synchronization cadence", async () => {
    const docs = await file("docs/delivery-labels.md");
    const readme = await file("README.md");
    for (const text of [docs, readme]) {
      expect(text).toContain("DELIVERY_LABELS_ENABLED");
      expect(text).toContain("Pull requests write");
      expect(text).toMatch(/no added Issues/i);
      expect(text).toContain("idle");
      expect(text).toMatch(/separate (?:crew )?task|separate work/);
    }
    expect(docs).toContain("No label job is a prerequisite");
    expect(docs).toMatch(/no time-based/i);
    expect(docs).toContain("historical PRs");
    expect(docs).toContain("Pruning additionally needs visibility of both issues and PRs");
  });

  it("documents separate pruning consent and keeps automation incapable of invoking it", async () => {
    const docs = await file("docs/delivery-labels.md");
    expect(docs).toContain("--apply --prune-unused-defaults");
    expect(docs).toContain("quiet maintenance window");
    expect(docs).toContain("Deleting a label deletes its assignments everywhere");
    for (const path of ["scripts/run-label-automation.mjs", ".github/workflows/delivery.yml"]) {
      const source = await file(path);
      expect(source).not.toContain("pruneDefaultLabels");
      expect(source).not.toContain("prune-unused-defaults");
      expect(source).not.toContain("permission-issues");
    }
    const caller = await file("templates/delivery-caller.yml");
    expect(caller).not.toMatch(/schedule:|review-id|review-start|review-finish|DELIVERY_LABELS_ENABLED/);
  });
});

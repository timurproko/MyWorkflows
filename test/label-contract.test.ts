import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadBaseLabels } from "../scripts/repository-labels.mjs";

const file = (path: string) => readFile(path, "utf8");

describe("label adoption and separate review-runner contract", () => {
  it("documents every exact manifest definition and direct API operations", async () => {
    const manifest = await loadBaseLabels();
    const docs = await file("docs/delivery-labels.md");
    const skill = await file("skills/change-delivery/SKILL.md");
    for (const path of ["docs/delivery-labels.md", "README.md", "skills/change-delivery/SKILL.md"]) {
      const text = await file(path);
      for (const [key, label] of Object.entries(manifest.labels) as [string, { name: string; color: string }][]) {
        expect(text).toContain(`\`${key}\``);
        expect(text).toContain(label.name);
        expect(text).toContain(`\`${label.color}\``);
      }
      expect(text).toContain("empty description");
      expect(text).toContain("U+1F916");
      expect(text).toContain("one ordinary space");
      expect(text).toContain("variation selector");
    }
    expect(docs).toContain('`POST /repos/{owner}/{repo}/issues/{pr}/labels` with `{"labels":["🤖 Under review"]}`');
    for (const label of Object.values(manifest.labels) as { name: string }[]) {
      expect(docs).toContain(`\`POST /repos/{owner}/{repo}/issues/{pr}/labels\` with \`${JSON.stringify({ labels: [label.name] })}\``);
      expect(docs).toContain(`DELETE /repos/{owner}/{repo}/issues/{pr}/labels/${encodeURIComponent(label.name)}`);
    }
    expect(skill).toContain("signed-in credential");
    expect(skill).toContain("APPROVE");
    expect(skill).toContain("CHANGES NEEDED");
    expect(skill).toMatch(/stop, finish, observed\s+death or abandonment/);
    expect(skill).toContain("advisory");
    expect(skill).toMatch(/confirm access and absence/i);
  });

  it("keeps the runner verdict lifecycle and persistent closure record consistent", async () => {
    for (const path of ["docs/delivery-labels.md", "README.md", "skills/change-delivery/SKILL.md"]) {
      const text = (await file(path)).replace(/\s+/g, " ");
      expect(text).toMatch(/At review start,.*?add[s]? Under review and remove[s]? any previous verdict label/);
      expect(text).toContain("before launching the reviewer");
      expect(text).toMatch(/On `APPROVE`, (?:it )?removes? Under review and adds? Approved/);
      expect(text).toMatch(/on `CHANGES NEEDED`, (?:it )?removes? Under review and adds? Changes needed/);
      expect(text).toContain("Verdicts are mutually exclusive");
      expect(text).toContain("without inventing a verdict");
      expect(text).toMatch(/removes ONLY Under review/);
      expect(text).toContain("Approved and Changes needed survive closure as a review record");
      expect(text).toMatch(/[Aa]ll three labels are (?:\*\*)?advisory/);
      expect(text.toLowerCase()).toContain("absence is not approval");
      expect(text).toContain("later commits were reviewed");
      expect(text).toMatch(/crew PR #7/);
    }
  });

  it("states default-on opt-out semantics, permissions and non-instant synchronization cadence", async () => {
    const docs = await file("docs/delivery-labels.md");
    const readme = await file("README.md");
    const skill = await file("skills/change-delivery/SKILL.md");
    for (const text of [docs, readme, skill]) {
      expect(text).toContain("enabled by default");
      expect(text).toContain("DELIVERY_LABELS_ENABLED=false");
      expect(text).toContain("case-insensitive, without whitespace");
      expect(text).toContain("Unset, empty, `true` and any other value");
      expect(text).toContain("opt-out");
      expect(text).toContain("Manual dry runs stay read-only");
      expect(text).not.toMatch(/disabled by default|default-disabled|pending maintainer enablement|after enablement/i);
    }
    for (const text of [docs, readme]) {
      expect(text).toContain("Pull requests write");
      expect(text).toMatch(/no added Issues/i);
      expect(text).toContain("idle");
      expect(text).toMatch(/separate (?:crew )?task|separate work/);
    }
    expect(docs).toContain("` false ` does not");
    expect(docs).toContain("No label job is a prerequisite");
    expect(docs).toMatch(/no time-based/i);
    expect(docs).toContain("historical PRs");
    expect(docs).toContain("Pruning additionally needs visibility of both issues and PRs");
  });

  it("documents aligned version pins and each known consumer's adoption path", async () => {
    const docs = await file("docs/delivery-labels.md");
    for (const path of ["docs/delivery-labels.md", "README.md", "skills/change-delivery/SKILL.md"]) {
      const text = await file(path);
      expect(text).toMatch(/workflow\s+reference/);
      expect(text).toContain("matching `tools_ref`");
      expect(text).toContain("tracking `main`");
    }
    expect(docs).toContain("`tools_ref` defaults to `main`");
    expect(docs).toContain("A workflow pin alone does not pin scripts");
    expect(docs).toContain("pin tooling to the same old revision");
    for (const consumer of ["a1", "crew", "herdr-app", "xrbuild", "private workspace", "MyWorkflows"]) {
      expect(docs).toContain(consumer);
    }
    expect(docs).toContain("None of these six consumers needs an update");
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

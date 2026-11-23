import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadBaseLabels } from "../scripts/repository-labels.mjs";
import bootstrap from "./fixtures/bootstrap-labels.json";
const file = (path: string) => readFile(path, "utf8");
const guidance = ["README.md", "docs/delivery-labels.md", "skills/change-delivery/SKILL.md"];

describe("stable reference-driven label and runner contract", () => {
  it("documents fixed bootstrap examples separately from the mutable published palette", async () => {
    const manifest = await loadBaseLabels();
    expect(Object.keys(manifest.labels)).toEqual(["under-review", "review-approved", "review-changes-needed"]);
    for (const path of guidance) {
      const text = await file(path);
      for (const [key, label] of Object.entries(bootstrap.labels) as [string, any][]) {
        expect(text).toContain(`\`${key}\``);
        expect(text).toContain(label.name);
        expect(text).toContain(`\`${label.color}\``);
        for (const name of label.previousNames) expect(text).toContain(name);
      }
      for (const term of ["empty description", "U+1F916", "one ordinary space", "variation selector", "previousNames", "version", "GitHub", "node id"]) expect(text).toContain(term);
      expect(text).toMatch(/(?:stable|permanently stable)/);
      expect(text).toMatch(/(?:omit|remove) the robot prefix/);
    }
  });
  it("documents default-branch runtime resolution, warned fallback and crew's bounded single-read exception", async () => {
    for (const path of guidance) {
      const text = (await file(path)).replace(/\s+/g, " ");
      expect(text).toContain("contents/labels/base.json");
      expect(text).toContain("application/vnd.github.raw+json");
      expect(text).toMatch(/[Oo]mitting `ref` resolves the default branch/);
      expect(text).toMatch(/(?:explicit|explicitly)/i);
      expect(text).toMatch(/(?:two-second timeout)/);
      expect(text).toMatch(/(?:warn|warned|warns)/i);
      expect(text).toMatch(/(?:silently|silent fallback)/);
    }
    const docs = await file("docs/delivery-labels.md");
    expect(docs).toContain("https://api.github.com/repos/timurproko/MyWorkflows/contents/labels/base.json");
    expect(docs).toContain("A runner **MAY use built-in defaults");
    expect(docs).toContain("may leave those assignments untouched");
    expect(docs).toContain("exactly one contents API read");
  });
  it("keeps role-based lifecycle, legacy cleanup and crew PR 7 limitations consistent", async () => {
    for (const path of guidance) {
      const text = (await file(path)).replace(/\s+/g, " ");
      for (const term of ["At review start", "before launching the reviewer", "APPROVE", "CHANGES NEEDED", "Verdicts are mutually exclusive", "without inventing a verdict", "current/historical", "advisory", "absence is not approval", "later commits were reviewed", "crew PR #7"]) expect(text).toContain(term);
      expect(text).toMatch(/stop, finish, observed death or abandonment/);
      expect(text).toContain("signed-in credential");
      expect(text).toMatch(/(?:heartbeat|lease)/);
    }
    const docs = await file("docs/delivery-labels.md");
    expect(docs).toMatch(/confirm access and absence/i);
    expect(docs).toContain("no time-based crash-expiry guarantee");
    expect(docs).toContain("historical PRs");
    expect(docs).toContain("DELETE /repos/{owner}/{repo}/issues/{pr}/labels/{URL-encoded-resolved-name}");
  });
  it("publishes clear-on-close for every role and report-first separately authorized historical recovery", async () => {
    for (const path of guidance) {
      const text = (await file(path)).replace(/\s+/g, " ");
      expect(text).toContain("Closed/merged cleanup removes all three managed roles'");
      expect(text).toContain("current/historical assignments, including both verdicts");
      expect(text).toContain("until the next review sets one");
      expect(text).toContain("delivery labels-sweep --repo owner/name");
      expect(text).toContain("read-only");
      expect(text).toContain("--apply");
      expect(text).toContain("separate named-repository authorization");
      expect(text).toContain("fresh report");
      expect(text).toMatch(/pag[i]?nat/);
      expect(text).not.toMatch(/clears only `under-review`|removes only `under-review`|preserves both verdict keys|both verdict keys' current\/historical assignments survive/);
    }
    const docs = await file("docs/delivery-labels.md");
    for (const term of ["explicit manual", "No verdict is added", "no definition is deleted", "before **each** removal", "all three roles' current/historical names", "not a frozen repository transaction", "earlier PRs may already have been cleaned", "final state read and DELETE", "not fetched by this local command"]) {
      expect(docs.toLowerCase()).toContain(term.toLowerCase());
    }
    for (const name of ["base-labels", "verdict-labels", "label-rename", "labels-default-on"]) {
      const historical = await file(`docs/plans/${name}.md`);
      expect(historical).toContain("Historical plan:");
      expect(historical).toContain("superseded by [labels-clear-on-close]");
      expect(historical).toContain("current runner contract");
    }
    for (const name of await readdir(".github/workflows")) {
      expect(await file(`.github/workflows/${name}`)).not.toMatch(/labels-sweep|review-label-sweep/);
    }
    expect(await file("templates/delivery-caller.yml")).not.toMatch(/labels-sweep|review-label-sweep/);
  });
  it("documents protected reference publication, deletions, delay, safety limits and manual recovery", async () => {
    const docs = await file("docs/delivery-labels.md");
    for (const term of ["changes.name.from", "Created", "Deleted", "never deletes", "person merges", "pending", "delivery labels-reference --apply", "never labels or main", "last source read and PATCH", "exact reversion", "intermediate names", "idle", "workflow reference and matching `tools_ref`", "`tools_ref` defaults to `main`", "A workflow pin alone does not pin scripts", "pin tooling to the same old revision"]) expect(docs).toContain(term);
    for (const path of guidance) {
      const text = (await file(path)).replace(/\s+/g, " ");
      expect(text).toContain("enabled by default");
      expect(text).toContain("DELIVERY_LABELS_ENABLED=false");
      expect(text).toContain("case-insensitive, without whitespace");
      expect(text).toContain("Unset, empty, `true` and any other value");
      expect(text).toContain("Manual dry runs stay read-only");
      expect(text).toContain("tracking `main`");
      expect(text).toContain("matching `tools_ref`");
      expect(text).toContain("Pull requests write");
      expect(text).toMatch(/no added Issues/i);
    }
    expect(docs).toContain("` false ` does not");
    expect(docs).toContain("No label job is a prerequisite");
  });
  it("keeps display-name literals out of runtime scripts and default pruning separate", async () => {
    for (const path of ["scripts/repository-labels.mjs", "scripts/review-label-cleanup.mjs", "scripts/review-label-sweep.mjs", "scripts/run-label-automation.mjs", "scripts/reference-labels.mjs", ".github/workflows/delivery.yml", ".github/workflows/reference-labels.yml"]) {
      const source = await file(path);
      for (const label of Object.values(bootstrap.labels) as any[]) {
        for (const name of [label.name, ...label.previousNames]) expect(source).not.toContain(name);
      }
      if (!path.endsWith("repository-labels.mjs")) expect(source).not.toMatch(/pruneDefaultLabels|prune-unused-defaults|permission-issues/);
    }
    const docs = await file("docs/delivery-labels.md");
    expect(docs).toContain("--apply --prune-unused-defaults");
    expect(docs).toContain("quiet maintenance window");
    expect(docs).toContain("Deleting a label deletes its assignments everywhere");
    expect(docs).toContain("Pruning additionally needs visibility of both issues and PRs");
    expect(docs).toContain("excluded");
    const caller = await file("templates/delivery-caller.yml");
    expect(caller).not.toMatch(/schedule:|review-id|review-start|review-finish|DELIVERY_LABELS_ENABLED/);
  });
});

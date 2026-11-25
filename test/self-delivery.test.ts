import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DELIVERY_CHECK, buildEventPolicy, buildRuleset, validateDeclarations } from "../scripts/repository-protection.mjs";

/** A workflow file without its comment lines and its display name. */
const settings = (text: string) => text.replace(/\r\n/g, "\n").split("\n")
  .filter(line => !line.startsWith("#") && !line.startsWith("name: ")).join("\n").trim();

describe("this repository's own delivery", () => {
  it("calls the reusable workflow with the events, permissions and credentials of the caller template", async () => {
    const template = settings(await readFile("templates/delivery-caller.yml", "utf8"));
    const own = settings(await readFile(".github/workflows/self-delivery.yml", "utf8"));
    expect(own).toBe(template.replace("timurproko/MyWorkflows/.github/workflows/delivery.yml@main", "./.github/workflows/delivery.yml"));
  });

  it("skips the credentialed job for Dependabot and still reports the delivery check", async () => {
    const workflow = await readFile(".github/workflows/delivery.yml", "utf8");
    const job = (from: string, to: string) => workflow.slice(workflow.indexOf(`\n  ${from}:`), workflow.indexOf(`\n  ${to}:`));
    expect(job("finalize", "check")).toContain("github.event.pull_request.user.login != 'dependabot[bot]'");
    expect(job("check", "refresh")).not.toContain("dependabot");
  });

  it("protects main with the delivery check, squash merges only, and lets the caller's events run", async () => {
    const declared = validateDeclarations(JSON.parse(await readFile(".github/protection.json", "utf8")), "main") as any[];
    const rules = buildRuleset(declared.find(item => item.kind === "default-branch"), "main").rules;
    expect(rules.find(rule => rule.type === "required_status_checks").parameters.required_status_checks.map((check: any) => check.context))
      .toEqual(["Delivery tooling tests", DELIVERY_CHECK]);
    expect(rules.find(rule => rule.type === "pull_request").parameters.allowed_merge_methods).toEqual(["squash"]);
    const policy = buildEventPolicy(declared.find(item => item.kind === "workflow-events"));
    expect(policy.conditions.workflow_path.include).toEqual([".github/workflows/self-delivery.yml", ".github/workflows/self-review-labels.yml"]);
    expect(policy.rules[0].parameters.allowed_events).toEqual(["pull_request_target", "workflow_dispatch"]);
  });
});

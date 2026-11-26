import { describe, expect, it } from "vitest";
import { inspectDeliveryBody } from "../scripts/check-delivery-body.mjs";
import { inspectPlainBody, promotePlainDraft } from "../scripts/plain-delivery.mjs";

const head = "b".repeat(40);
const base = "a".repeat(40);
const target = "c".repeat(40);
const body = ({ first = "x", second = "x", acceptance = "## Acceptance\n\n- Using the example preserves the updated observable behavior.\n" } = {}) =>
  `## Proposal\n\nDeliver the example behavior.\n\n## Implementation\n\n- [${first}] Implement the updated example behavior and its fixture.\n- [${second}] Reconcile the example documentation with the new behavior.\n\n${acceptance}`;

function setup({ pullBody = body(), pull = {}, ancestry = true, association = { blocked: false }, changed = false }: Record<string, any> = {}) {
  const snapshot = { number: 4, state: "open", draft: true, node_id: "PR_node", body: pullBody,
    base: { ref: "develop", sha: base, repo: { full_name: "owner/repo" } },
    head: { ref: "feat/example", sha: head, repo: { full_name: "owner/repo" } }, ...pull };
  const ready: unknown[] = [];
  const reader = { repository: "owner/repo", prefix: "/repos/owner/repo",
    get: async (path: string) => path.includes("/git/ref/") ? { object: { sha: target } } : changed ? { ...snapshot, body: `${pullBody}\nedited` } : snapshot,
    ancestor: async () => { if (!ancestry) throw Object.assign(new Error("ancestry"), { archiveCode: "commit-ancestry" }); } };
  const publisher = { ready: async (...args: unknown[]) => { ready.push(args); } };
  const run = () => promotePlainDraft({ reader, publisher, pull: snapshot, number: 4, inspectUnassociated: async () => association });
  return { run, ready };
}

describe("plain delivery body", () => {
  it("accepts a body without an Automation section and reports completion", () => {
    expect(inspectPlainBody(body())).toEqual({ ok: true, complete: true, linked: false });
    expect(inspectPlainBody(body({ second: " ", acceptance: "" }))).toEqual({ ok: true, complete: false, linked: false });
    expect(inspectPlainBody(body({ second: " " }), { final: true })).toEqual({ ok: true, complete: false, linked: false });
    expect(inspectDeliveryBody(body())).toEqual({ ok: true, complete: true, linked: false });
  });

  it("applies the same layout and wording rules as a linked delivery", () => {
    expect(inspectPlainBody(body({ acceptance: "" }))).toMatchObject({ ok: false, reason: "draft-acceptance-layout-sections" });
    expect(inspectPlainBody(`intro\n\n${body()}`)).toMatchObject({ ok: false, reason: "draft-acceptance-layout-phase" });
    expect(inspectPlainBody(body().replace("Reconcile the example documentation with the new behavior.", "Run the focused example tests and confirm they pass.")))
      .toMatchObject({ ok: false, reason: "draft-implementation-progress-validation" });
    expect(inspectPlainBody(`${body()}\n## Automation\n\nnothing\n`)).toMatchObject({ ok: false, reason: "draft-acceptance-layout-sections" });
  });
});

describe("plain draft promotion", () => {
  it("marks a complete, current, same-repository draft ready", async () => {
    const { run, ready } = setup();
    await expect(run()).resolves.toMatchObject({ disposition: "promoted", head, promoted: true });
    expect(ready).toEqual([[4, "PR_node"]]);
  });

  it("leaves an ordinary or unfinished draft alone quietly", async () => {
    for (const [pullBody, reason] of [["Just a description.", "unassociated"], [body({ second: " " }), "draft"], ["## Implementation\n\nProse only.\n", "draft"]] as const) {
      const { run, ready } = setup({ pullBody });
      await expect(run()).resolves.toMatchObject({ disposition: "skipped", reason });
      expect(ready).toEqual([]);
    }
  });

  it("blocks a fully ticked draft that is not deliverable, and says why", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ pullBody: body({ acceptance: "" }) }, "draft-acceptance-layout-sections"],
      [{ association: { blocked: true, reason: "missing-implementation-association", changes: ["example"] } }, "draft-missing-implementation-association"],
      [{ ancestry: false }, "draft-delivery-target-stale"],
    ];
    for (const [options, reason] of cases) {
      const { run, ready } = setup(options);
      await expect(run()).resolves.toMatchObject({ disposition: "blocked", reason });
      expect(ready).toEqual([]);
    }
  });

  it("never promotes a fork, another base, or a draft that changed meanwhile", async () => {
    for (const pull of [{ head: { ref: "feat/example", sha: head, repo: { full_name: "fork/repo" } } },
      { base: { ref: "release", sha: base, repo: { full_name: "owner/repo" } } }]) {
      const { run, ready } = setup({ pull });
      await expect(run()).resolves.toMatchObject({ disposition: "skipped", reason: "draft-ineligible-identity" });
      expect(ready).toEqual([]);
    }
    const { run, ready } = setup({ changed: true });
    await expect(run()).resolves.toMatchObject({ disposition: "retry", reason: "draft-changed-before-ready" });
    expect(ready).toEqual([]);
  });
});

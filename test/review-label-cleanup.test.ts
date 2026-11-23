import { readFile } from "node:fs/promises";
import definitions from "../labels/base.json";
import { describe, expect, it, vi } from "vitest";
import { cleanupReviewLabel } from "../scripts/review-label-cleanup.mjs";
import { automationMain, runLabelAutomation } from "../scripts/run-label-automation.mjs";

const repository = "owner/repository";
const name = definitions.labels["under-review"].name;
const oldName = definitions.labels["under-review"].previousNames[0];
const event = (merged = true, target = repository) => ({ action: "closed", number: 14, repository: { full_name: target },
  pull_request: { number: 14, state: "closed", merged, base: { ref: "non-default-target", repo: { full_name: target } }, user: { login: "dependabot[bot]" } } });
const environment = (extra = {}) => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request_target", GITHUB_REPOSITORY: repository,
  DELIVERY_LABELS_ENABLED: "true", LABELS_APP_TOKEN: "app", GH_TOKEN: "app", LABELS_OPERATION: "cleanup", ...extra });

function fake({ target = repository, states = ["closed"], labels = [name, "keep-me"], deleteStatus = 0, inaccessibleAfterDelete = false, removeOn404 = true, removableNames = [name, oldName] } = {}) {
  let reads = 0, attemptedDelete = false;
  const applied = [...labels];
  const api = vi.fn(async (method: string, path: string) => {
    if (method === "GET" && path === `repos/${target}/pulls/14`) {
      if (attemptedDelete && inaccessibleAfterDelete) throw Object.assign(new Error("not found"), { status: 404 });
      return { number: 14, state: states[Math.min(reads++, states.length - 1)], base: { repo: { full_name: target } } };
    }
    if (method === "GET" && path.includes("/issues/14/labels?")) {
      const page = Number(new URL(`https://api.github.com/${path}`).searchParams.get("page"));
      return applied.slice((page - 1) * 100, page * 100).map(name => ({ name }));
    }
    if (method === "DELETE") {
      attemptedDelete = true;
      const removed = decodeURIComponent(path.split("/").at(-1)!);
      expect(removableNames).toContain(removed);
      expect(path).toBe(`repos/${target}/issues/14/labels/${encodeURIComponent(removed)}`);
      if (!deleteStatus || (deleteStatus === 404 && removeOn404)) {
        const index = applied.indexOf(removed);
        if (index >= 0) applied.splice(index, 1);
      }
      if (deleteStatus) throw Object.assign(new Error("delete failed"), { status: deleteStatus });
      return [];
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  return { api, applied };
}

describe("closed-PR advisory review-label cleanup", () => {
  it.each(["owner/repo.name", "owner/.hidden"])("cleans dotted repositories directly and through the workflow runner: %s", async repository => {
    for (const merged of [true, false]) {
      for (const automated of [false, true]) {
        const { api, applied } = fake({ target: repository });
        const cleanup = () => automated
          ? runLabelAutomation({ environment: environment({ GITHUB_REPOSITORY: repository }), event: event(merged, repository), api, report: vi.fn() })
          : cleanupReviewLabel({ repository, event: event(merged, repository), api });
        expect(await cleanup()).toEqual({ number: 14, disposition: "removed" });
        expect(await cleanup()).toEqual({ number: 14, disposition: "absent" });
        expect(applied).toEqual(["keep-me"]);
        expect(api.mock.calls.every(([, path]) => path.startsWith(`repos/${repository}/`))).toBe(true);
        expect(api.mock.calls.filter(([method]) => method !== "GET")).toEqual([
          ["DELETE", `repos/${repository}/issues/14/labels/${encodeURIComponent(name)}`],
        ]);
      }
    }
  });

  it.each(["owner/.", "owner/..", "owner/repo/extra", "https://github.com/owner/repo"])("rejects malformed cleanup repository context before requests: %s", async repository => {
    const api = vi.fn();
    await expect(cleanupReviewLabel({ repository, event: event(true, repository), api })).rejects.toThrow("owner/name");
    await expect(runLabelAutomation({ environment: environment({ GITHUB_REPOSITORY: repository }), event: event(true, repository), api })).rejects.toThrow("owner/name");
    expect(api).not.toHaveBeenCalled();
  });

  it.each([true, false])("clears merged=%s closures including non-default targets and any author", async merged => {
    const { api, applied } = fake();
    expect(await cleanupReviewLabel({ repository, event: event(merged), api })).toEqual({ number: 14, disposition: "removed" });
    expect(applied).toEqual(["keep-me"]);
    expect(api.mock.calls.filter(([method]) => method !== "GET")).toHaveLength(1);
  });

  it.each([
    { verdicts: ["🤖 Approved"] },
    { verdicts: ["🤖 Rework"] },
    { verdicts: ["🤖 Changes needed"] },
    { verdicts: ["🤖 Approved", "🤖 Rework", "🤖 Changes needed"] },
  ])("preserves verdict record $verdicts on every closure path", async ({ verdicts }) => {
    for (const merged of [true, false]) {
      for (const underReview of [true, false]) {
        for (const automated of [true, false]) {
          const retained = [...verdicts, "keep-me"];
          const { api, applied } = fake({ labels: [...(underReview ? [name] : []), ...retained] });
          const cleanup = () => automated
            ? runLabelAutomation({ environment: environment({ DELIVERY_LABELS_ENABLED: undefined }), event: event(merged), api, report: vi.fn() })
            : cleanupReviewLabel({ repository, event: event(merged), api });
          expect(await cleanup()).toEqual({ number: 14, disposition: underReview ? "removed" : "absent" });
          expect(applied).toEqual(retained);
          expect(await cleanup()).toEqual({ number: 14, disposition: "absent" });
          expect(applied).toEqual(retained);
          // No verdict removal/addition, repository-definition deletion or unrelated assignment change.
          expect(api.mock.calls.filter(([method]) => method !== "GET")).toEqual(underReview ? [
            ["DELETE", `repos/${repository}/issues/14/labels/${encodeURIComponent(name)}`],
          ] : []);
        }
      }
    }
  });

  it.each([[oldName], [name, oldName]])("clears current and legacy review names together without touching any verdict", async (...reviewNames) => {
    const verdicts = ["🤖 Approved", "🤖 Rework", "🤖 Changes needed"];
    for (const merged of [true, false]) {
      const { api, applied } = fake({ labels: [...reviewNames, ...verdicts] });
      expect((await cleanupReviewLabel({ repository, event: event(merged), api })).disposition).toBe("removed");
      expect(applied).toEqual(verdicts);
      expect((await cleanupReviewLabel({ repository, event: event(merged), api })).disposition).toBe("absent");
    }
  });

  it("resolves arbitrary future current and historical names by key and preserves historical verdicts", async () => {
    const reviewNames = ["Reading", "Earlier reading", "Oldest reading"];
    const verdicts = ["Good", "Previously good", "Revise", "Previously revise"];
    const manifest = { version: 1, labels: {
      "under-review": { name: reviewNames[0], previousNames: reviewNames.slice(1), color: "840479", description: "" },
      "review-approved": { name: verdicts[0], previousNames: [verdicts[1]], color: "1a7f37", description: "" },
      "review-changes-needed": { name: verdicts[2], previousNames: [verdicts[3]], color: "9a6700", description: "" },
    } };
    const { api, applied } = fake({ labels: [...reviewNames, ...verdicts, "other"], removableNames: reviewNames });
    await cleanupReviewLabel({ repository, event: event(), api, manifest });
    expect(applied).toEqual([...verdicts, "other"]);
    const reopened = fake({ labels: [name, oldName], states: ["closed", "closed", "open"] });
    expect((await cleanupReviewLabel({ repository, event: event(), api: reopened.api })).disposition).toBe("reopened");
    expect(reopened.applied).toEqual([oldName]);
  });

  it("is idempotent on duplicate close events and missing assignments", async () => {
    const { api, applied } = fake();
    await cleanupReviewLabel({ repository, event: event(), api });
    expect(await cleanupReviewLabel({ repository, event: event(), api })).toEqual({ number: 14, disposition: "absent" });
    expect(applied).toEqual(["keep-me"]);
    expect(api.mock.calls.filter(([method]) => method === "DELETE")).toHaveLength(1);
  });

  it("paginates PR assignments and removes only the exact managed name", async () => {
    const labels = [...Array.from({ length: 100 }, (_, n) => `custom-${n}`), name];
    const { api, applied } = fake({ labels });
    await cleanupReviewLabel({ repository, event: event(), api });
    expect(applied).toHaveLength(100);
    expect(api.mock.calls.some(([, path]) => path.endsWith("page=2"))).toBe(true);
    const other = fake({ labels: [name.toLowerCase(), "Under review"] });
    expect((await cleanupReviewLabel({ repository, event: event(), api: other.api })).disposition).toBe("absent");
  });

  it.each([["open"], ["closed", "open"]])("leaves a reopened PR's new review alone: %j", async (...states) => {
    const source = fake({ states: states as string[] });
    expect((await cleanupReviewLabel({ repository, event: event(), api: source.api })).disposition).toBe("reopened");
    expect(source.api.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
  });

  it.each([true, false])("rescans current and historical names when sync renames an assignment before DELETE, merged=%s", async merged => {
    for (const reopened of [false, true]) {
      const source = fake({ labels: [oldName, "🤖 Approved", "🤖 Rework"], states: ["closed", "closed", reopened ? "open" : "closed"] });
      const api = vi.fn(async (method: string, path: string) => {
        if (method === "DELETE" && path.endsWith(encodeURIComponent(oldName))) {
          // Independent sync PATCH renames the definition and its assignment after the old-name read.
          source.applied[source.applied.indexOf(oldName)] = name;
          throw Object.assign(new Error("old definition name no longer exists"), { status: 404 });
        }
        return source.api(method, path);
      });
      expect((await cleanupReviewLabel({ repository, event: event(merged), api })).disposition).toBe(reopened ? "reopened" : "removed");
      expect(source.applied).toEqual([...(reopened ? [name] : []), "🤖 Approved", "🤖 Rework"]);
      expect(api.mock.calls.filter(([method]) => method === "DELETE").map(([, path]) => decodeURIComponent(path.split("/").at(-1)!))).toEqual(reopened ? [oldName] : [oldName, name]);
    }
  });

  it("confirms access and absence before treating DELETE 404 as idempotent", async () => {
    const source = fake({ deleteStatus: 404 });
    expect((await cleanupReviewLabel({ repository, event: event(), api: source.api })).disposition).toBe("absent");
    for (const options of [{ inaccessibleAfterDelete: true }, { removeOn404: false }]) {
      const denied = fake({ deleteStatus: 404, ...options });
      await expect(cleanupReviewLabel({ repository, event: event(), api: denied.api })).rejects.toMatchObject({ status: 404 });
    }
  });

  it.each([401, 403, 500])("surfaces API failures without a credential fallback: %s", async status => {
    const { api } = fake({ deleteStatus: status });
    await expect(cleanupReviewLabel({ repository, event: event(), api })).rejects.toMatchObject({ status });
    expect(api.mock.calls.filter(([method]) => method === "DELETE")).toHaveLength(1);
  });

  it.each([null, {}, { ...event(), action: "reopened" }, { ...event(), number: 20 },
    { ...event(), repository: { full_name: "someone/else" } }, { ...event(), pull_request: undefined }])("rejects malformed/foreign/non-PR events before any request: %j", async value => {
    const api = vi.fn();
    await expect(cleanupReviewLabel({ repository, event: value, api })).rejects.toThrow("matching closed");
    expect(api).not.toHaveBeenCalled();
  });

  it("refuses invalid current PR metadata and malformed label listings", async () => {
    await expect(cleanupReviewLabel({ repository, event: event(), api: async () => ({ number: 15 }) })).rejects.toThrow("identity");
    const current = fake();
    await expect(cleanupReviewLabel({ repository, event: event(), api: (method, path) => path.includes("labels?") ? Promise.resolve(null) : current.api(method, path) })).rejects.toThrow("listing");
  });

  it.each([undefined, "", "true", "TRUE", "1", "no", " false "])("cleans up by default unless explicitly opted out: %s", async enabled => {
    const { api, applied } = fake();
    expect(await runLabelAutomation({ environment: environment({ DELIVERY_LABELS_ENABLED: enabled }), event: event(), api, report: vi.fn() })).toEqual({ number: 14, disposition: "removed" });
    expect(applied).toEqual(["keep-me"]);
  });

  it.each(["false", "False", "FALSE"])("opts out before reading event/API or requiring a writer: %s", async enabled => {
    const api = vi.fn();
    const report = vi.fn();
    expect(await runLabelAutomation({ environment: environment({ DELIVERY_LABELS_ENABLED: enabled, LABELS_APP_TOKEN: "", GH_TOKEN: "" }), api, report })).toEqual({ disposition: "disabled" });
    expect(api).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.stringContaining("explicit DELIVERY_LABELS_ENABLED=false opt-out"));
  });

  it("rejects dispatch cleanup and default-on cleanup without the separate App writer", async () => {
    const api = vi.fn();
    await expect(runLabelAutomation({ environment: environment({ GITHUB_EVENT_NAME: "workflow_dispatch" }), api })).rejects.toThrow("invalid internal");
    for (const extra of [{ LABELS_APP_TOKEN: "", GH_TOKEN: "read-only" }, { GH_TOKEN: "read-only" }]) {
      const report = vi.fn();
      expect(await automationMain({ environment: environment({ DELIVERY_LABELS_ENABLED: undefined, ...extra }), event: event(), api, report })).toBe(1);
      expect(report).toHaveBeenCalledWith(expect.stringContaining("::warning::"));
    }
    expect(api).not.toHaveBeenCalled();
  });

  it("runs enabled cleanup and emits a visible nonblocking warning on failures", async () => {
    const source = fake();
    const report = vi.fn();
    expect(await automationMain({ environment: environment(), event: event(), api: source.api, report })).toBe(0);
    expect(report).toHaveBeenCalledWith("Review-in-progress closed-PR cleanup: removed.");
    const denied = fake({ deleteStatus: 403 });
    expect(await automationMain({ environment: environment(), event: event(), api: denied.api, report })).toBe(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("::warning::Delivery label automation failed (HTTP 403)"));
  });

  it("uses a separate isolated job on existing closure events without caller or merge-policy changes", async () => {
    const workflow = await readFile(".github/workflows/delivery.yml", "utf8");
    const cleanup = workflow.slice(workflow.indexOf("\n  review-label-cleanup:"));
    expect(cleanup).toContain("github.event_name == 'pull_request_target' && github.event.action == 'closed'");
    expect(cleanup).toContain("continue-on-error: true");
    expect(cleanup).toContain("if: vars.DELIVERY_LABELS_ENABLED != 'false'\n");
    expect(cleanup).toMatch(/\n    continue-on-error: true\n/);
    expect(cleanup).not.toContain("vars.DELIVERY_LABELS_ENABLED == 'true'");
    expect(cleanup).toContain("permission-pull-requests: write");
    expect(cleanup).toContain("ref: ${{ inputs.tools_ref }}");
    expect(cleanup).not.toMatch(/needs:|permission-issues:|base.ref|user.login|merged ==|GITHUB_TOKEN/);
    expect(cleanup).toContain("GH_TOKEN: ${{ steps.cleanup-app.outputs.token }}");
    const existing = workflow.slice(0, workflow.indexOf("\n  label-sync:"));
    expect(existing).not.toMatch(/needs:.*label|DELIVERY_LABELS_ENABLED|LABELS_OPERATION/);
  });
});

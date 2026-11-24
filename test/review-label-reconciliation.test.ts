import { describe, expect, it, vi } from "vitest";
import definitions from "./fixtures/bootstrap-labels.json";
import { latestReviewAssignment, reconcileReviewLabels } from "../scripts/review-label-reconciliation.mjs";
import { automationMain, runLabelAutomation } from "../scripts/run-label-automation.mjs";

const repository = "owner/.repository";
const review = definitions.labels["under-review"].name;
const approved = definitions.labels["review-approved"].name;
const rework = definitions.labels["review-changes-needed"].name;
const previous = definitions.labels["under-review"].previousNames[0];
const names = [review, approved, rework, previous];
const event = (name = review, actor = "person") => ({ action: "labeled", number: 61, repository: { full_name: repository }, label: { name }, sender: { login: actor },
  pull_request: { number: 61, state: "open", merged: false, labels: [{ name: "stale-webhook" }], base: { repo: { full_name: repository } } } });
const addition = (name: string, id: number, created_at = "2026-06-10T12:00:00Z", kind = "labeled") => ({ event: kind, id, created_at, label: { name } });
function fake({ labels = [review, rework, "keep"], events = [addition(review, 10), addition(rework, 20)], states = ["open"], deleteStatus = 0, removeOn404 = true, deniedAfterDelete = false } = {}) {
  const assigned = [...labels];
  let reads = 0, attempted = false;
  const api = vi.fn(async (method: string, path: string) => {
    if (path === `repos/${repository}/pulls/61` && method === "GET") {
      if (attempted && deniedAfterDelete) throw Object.assign(new Error("denied"), { status: 404 });
      return { number: 61, state: states[Math.min(reads++, states.length - 1)], base: { repo: { full_name: repository } } };
    }
    if (method === "GET" && /\/(labels|events)\?/.test(path)) {
      const page = Number(new URL(`https://api.github.com/${path}`).searchParams.get("page"));
      return (path.includes("/labels?") ? assigned.map(name => ({ name })) : events).slice((page - 1) * 100, page * 100);
    }
    if (method === "DELETE") {
      attempted = true;
      const name = decodeURIComponent(path.split("/").at(-1)!);
      expect(names).toContain(name);
      expect(path).toBe(`repos/${repository}/issues/61/labels/${encodeURIComponent(name)}`);
      if (!deleteStatus || (deleteStatus === 404 && removeOn404)) assigned.splice(assigned.indexOf(name), 1);
      if (deleteStatus) throw Object.assign(new Error("delete failed"), { status: deleteStatus });
      return [];
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  return { api, assigned, events };
}
const reconcile = (options = {}) => reconcileReviewLabels({ repository, event: event(), manifest: structuredClone(definitions), enabled: "true", ...options });
const writes = api => api.mock.calls.filter(([method]) => method !== "GET");
const environment = (extra = {}) => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request_target", GITHUB_REPOSITORY: repository,
  LABELS_APP_TOKEN: "app", GH_TOKEN: "app", LABELS_OPERATION: "reconcile", ...extra });
const automate = (options = {}) => runLabelAutomation({ environment: environment(), event: event(), manifest: structuredClone(definitions), report: vi.fn(), ...options });

describe("guarded review-label automation runner", () => {
  it.each(["pull_request", "pull_request_target"])("accepts a labeled %s event and emits an advisory summary", async eventName => {
    const source = fake();
    const report = vi.fn();
    expect((await automate({ ...source, report, environment: environment({ GITHUB_EVENT_NAME: eventName }) })).disposition).toBe("reconciled");
    expect(report).toHaveBeenCalledWith("Managed review-label open-PR reconciliation: reconciled.");
  });

  it.each(["false", "False", "FALSE"])("opts out before event reads, API requests or requiring a token: %s", async value => {
    const api = vi.fn();
    expect(await automate({ api, event: undefined, environment: environment({ DELIVERY_LABELS_ENABLED: value, GH_TOKEN: undefined, LABELS_APP_TOKEN: undefined }) }))
      .toEqual({ disposition: "disabled" });
    expect(api).not.toHaveBeenCalled();
  });

  it.each([{}, { GH_TOKEN: "caller" }, { GH_TOKEN: "", LABELS_APP_TOKEN: "" }])("rejects missing or fallback write credentials %j", async overrides => {
    const api = vi.fn();
    await expect(automate({ api, environment: environment({ LABELS_APP_TOKEN: undefined, ...overrides }) })).rejects.toThrow("separate delivery App token");
    expect(api).not.toHaveBeenCalled();
  });

  it("recognizes unmanaged names without any label API reads/writes", async () => {
    const api = vi.fn();
    expect((await automate({ api, event: event("unrelated") })).disposition).toBe("unmanaged");
    expect(api).not.toHaveBeenCalled();
  });

  it.each(["workflow_dispatch", "workflow_run", "label", "push"])("rejects reconciliation on %s", async eventName => {
    const api = vi.fn();
    await expect(automate({ api, environment: environment({ GITHUB_EVENT_NAME: eventName }) })).rejects.toThrow(/event|operation/);
    expect(api).not.toHaveBeenCalled();
  });

  it("rejects non-Actions context and never expands sync/cleanup to pull_request", async () => {
    for (const extra of [{ GITHUB_ACTIONS: "false" }, { GITHUB_EVENT_NAME: "pull_request", LABELS_OPERATION: "sync" }, { GITHUB_EVENT_NAME: "pull_request", LABELS_OPERATION: "cleanup" }]) {
      const api = vi.fn();
      await expect(automate({ api, environment: environment(extra) })).rejects.toThrow("trusted delivery event");
      expect(api).not.toHaveBeenCalled();
    }
  });

  it("reports write denial as a warning independently of code delivery", async () => {
    const source = fake({ deleteStatus: 403 });
    const report = vi.fn();
    expect(await automationMain({ ...source, environment: environment(), event: event(), manifest: definitions, report })).toBe(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("::warning::Delivery label automation failed (HTTP 403)"));
    expect(report).toHaveBeenCalledWith(expect.stringContaining("No fallback credential was used for writes"));
  });
});

describe("latest managed review-label reconciliation", () => {
  it.each(names)("keeps a single added name %s without adding or deleting anything", async name => {
    const source = fake({ labels: [name, "keep"] });
    expect(await reconcile({ ...source, event: event(name) })).toMatchObject({ disposition: "unchanged", kept: name });
    expect(writes(source.api)).toEqual([]);
  });

  it.each([[review, rework], [rework, review]])("uses timestamp history, not queued order %j", async (first, second) => {
    // The older event has a larger id; timestamps take precedence over id/run order.
    const source = fake({ events: [addition(rework, 10, "2026-06-10T12:00:20Z"), addition(review, 20)] });
    for (const name of [first, second]) await reconcile({ ...source, event: event(name) });
    expect(source.assigned).toEqual([rework, "keep"]);
    expect(writes(source.api)).toEqual([["DELETE", `repos/${repository}/issues/61/labels/${encodeURIComponent(review)}`]]);
  });

  it.each([[review, rework], [rework, review]])("breaks identical timestamp ties by event id independently of job order %j", async (first, second) => {
    const source = fake({ events: [addition(rework, 20), addition(review, 10)] });
    for (const name of [first, second]) await reconcile({ ...source, event: event(name) });
    expect(source.assigned).toEqual([rework, "keep"]);
  });

  it.each(["person", "crew[bot]", "delivery[bot]"])("treats actor %s equally and keeps the newly added historical name", async actor => {
    const source = fake({ labels: [previous, approved, rework, "keep"], events: [addition(approved, 10), addition(rework, 20), addition(previous, 30)] });
    await reconcile({ ...source, event: event(previous, actor) });
    expect(source.assigned).toEqual([previous, "keep"]);
    expect(writes(source.api)).toHaveLength(2);
  });

  it("uses stable manifest roles with arbitrary future names and ignores unrelated roles", async () => {
    const manifest = structuredClone(definitions);
    manifest.labels["under-review"].name = "Reading";
    manifest.labels["review-approved"].name = "Good";
    manifest.labels["review-changes-needed"].name = "Revise";
    manifest.labels.custom = { name: "Custom", color: "123456", description: "", previousNames: [] };
    expect(latestReviewAssignment(["Reading", "Revise"], [addition("Reading", 10), addition("Revise", 20), addition("Custom", 30)], manifest).name).toBe("Revise");
  });

  it("handles an assignment renamed from a historical definition without inventing an add", async () => {
    const source = fake({ events: [addition(previous, 30), addition(rework, 20)] });
    expect((await reconcile(source)).kept).toBe(review);
    expect(source.assigned).toEqual([review, "keep"]);
  });

  it("never resurrects a newer label removed by a person", async () => {
    const source = fake({ labels: [review, approved, "keep"], events: [addition(review, 10), addition(approved, 20), addition(rework, 30), addition(rework, 40, undefined, "unlabeled")] });
    await reconcile({ ...source, event: event(rework) });
    expect(source.assigned).toEqual([approved, "keep"]);
  });

  it.each(["closed", "merged"])("does nothing for %s webhook PRs", async state => {
    const source = fake();
    const incoming = event();
    incoming.pull_request.state = state === "closed" ? "closed" : "open";
    incoming.pull_request.merged = state === "merged";
    expect((await reconcile({ ...source, event: incoming })).disposition).toBe("closed");
    expect(source.api).not.toHaveBeenCalled();
  });

  it.each([["closed"], ["open", "closed"], ["open", "open", "closed"], ["open", "open", "open", "closed"]])("stops on current closure %j", async (...states) => {
    const source = fake({ states });
    expect((await reconcile(source)).disposition).toBe("closed");
    expect(writes(source.api)).toEqual([]);
  });

  it.each(["false", "False", "FALSE"])("opts out before even validating event or reading the API: %s", async enabled => {
    const api = vi.fn();
    expect(await reconcile({ enabled, api, event: null })).toEqual({ disposition: "disabled" });
    expect(api).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "true", " false "])("stays enabled for %s", async enabled => {
    const source = fake();
    await reconcile({ ...source, enabled });
    expect(source.assigned).toEqual([rework, "keep"]);
  });

  it("ignores unmanaged additions before API access", async () => {
    const api = vi.fn();
    expect((await reconcile({ api, event: event("unrelated") })).disposition).toBe("unmanaged");
    expect(api).not.toHaveBeenCalled();
  });

  it("paginates both assignments and event history", async () => {
    const source = fake({ labels: [...Array.from({ length: 100 }, (_, i) => `other-${i}`), review, rework],
      events: [...Array.from({ length: 100 }, () => ({ event: "commented" })), addition(review, 10), addition(rework, 20)] });
    await reconcile(source);
    expect(source.assigned).toHaveLength(101);
    expect(source.api.mock.calls.some(([, path]) => path.includes("events?") && path.endsWith("page=2"))).toBe(true);
    expect(source.api.mock.calls.some(([, path]) => path.includes("labels?") && path.endsWith("page=2"))).toBe(true);
  });

  it("rereads history before deleting and lets a new addition supersede its snapshot", async () => {
    const source = fake();
    let reads = 0;
    const api = vi.fn(async (method, path) => {
      if (path.includes("/events?") && ++reads === 2) source.events.push(addition(review, 30));
      return source.api(method, path);
    });
    await reconcile({ api });
    expect(source.assigned).toEqual([review, "keep"]);
  });

  it.each([false, true])("confirms access and exact absence after DELETE 404, removed=%s", async removeOn404 => {
    const source = fake({ deleteStatus: 404, removeOn404 });
    if (removeOn404) expect((await reconcile(source)).kept).toBe(rework);
    else await expect(reconcile(source)).rejects.toMatchObject({ status: 404 });
    const denied = fake({ deleteStatus: 404, deniedAfterDelete: true });
    await expect(reconcile(denied)).rejects.toMatchObject({ status: 404 });
  });

  it.each([401, 403, 429, 500])("surfaces write/read errors without a credential fallback: %s", async status => {
    const source = fake({ deleteStatus: status });
    await expect(reconcile(source)).rejects.toMatchObject({ status });
    expect(writes(source.api)).toHaveLength(1);
    const api = vi.fn(async () => { throw Object.assign(new Error("denied"), { status }); });
    await expect(reconcile({ api })).rejects.toMatchObject({ status });
    expect(writes(api)).toEqual([]);
  });

  it.each([[], [addition(review, 10)], [addition(review, 10), addition(rework, 20, undefined, "unlabeled")],
    [addition(review, 10), addition(rework, 20, "bad")], [addition(review, 10), addition(rework, 10)],
    [addition(review, 10), { ...addition(rework, 20), id: Number.MAX_SAFE_INTEGER + 1 }]].map(events => ({ events })))("fails closed on incomplete/invalid event history $events", async ({ events }) => {
    const source = fake({ events });
    await expect(reconcile(source)).rejects.toThrow(/history|ordering/);
    expect(writes(source.api)).toEqual([]);
  });

  it.each([null, {}, { ...event(), action: "unlabeled" }, { ...event(), number: 62 }, { ...event(), repository: { full_name: "foreign/repo" } }])("rejects invalid event identity %j", async incoming => {
    const api = vi.fn();
    await expect(reconcile({ api, event: incoming })).rejects.toThrow("matching labeled");
    expect(api).not.toHaveBeenCalled();
  });

  it("rejects invalid current identity and malformed API listings", async () => {
    await expect(reconcile({ api: async () => ({ number: 62 }) })).rejects.toThrow("identity");
    for (const resource of ["labels", "events"]) {
      const source = fake();
      const api = async (method, path) => path.includes(`/${resource}?`) ? null : source.api(method, path);
      await expect(reconcile({ api })).rejects.toThrow("listing");
      expect(writes(source.api)).toEqual([]);
    }
  });

  it("bounds concurrent assignment churn rather than falsely claiming success", async () => {
    const source = fake();
    const api = vi.fn(async (method, path) => {
      if (method === "DELETE") return []; // Another controller keeps readding the removed name.
      return source.api(method, path);
    });
    await expect(reconcile({ api })).rejects.toThrow("kept changing");
    expect(writes(api).length).toBeLessThan(25);
  });
});

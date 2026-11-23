import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  classifyRefreshCandidate,
  decideRefresh,
  interpretBranchUpdate,
  refreshReadyPullRequests,
  type RefreshRequester,
} from "../scripts/ready-pull-request-refresh.mjs";

const execFileAsync = promisify(execFile);
const repository = "timurproko/a1";
const target = "d".repeat(40);
const sha = (value: number): string => value.toString(16).padStart(40, "0");
const workflowRefusal = "refusing to allow a GitHub App to create or update workflow `.github/workflows/delivery.yml` without `workflows` permission";
const integrationRefusal = "Resource not accessible by integration";

interface FakePull {
  number: number;
  state?: string;
  draft?: boolean;
  base?: string;
  baseRepository?: string;
  headRepository?: string | null;
  head: string;
  author?: string;
  title?: string;
  behind?: number;
  conflict?: boolean;
  raceTo?: string;
  updateStatus?: number;
  updateMessage?: unknown;
  updateHeaders?: Record<string, string>;
  readStatus?: number;
}

function metadata(pull: FakePull): Record<string, unknown> {
  return {
    number: pull.number,
    user: { login: pull.author ?? "maintainer" },
    title: pull.title ?? "A change",
    state: pull.state ?? "open",
    draft: pull.draft ?? false,
    base: { ref: pull.base ?? "develop", repo: { full_name: pull.baseRepository ?? repository } },
    head: { sha: pull.head, repo: pull.headRepository === null ? null : { full_name: pull.headRepository ?? repository } },
  };
}

class FakeGitHub {
  readonly calls: string[] = [];
  readonly updates: Array<{ number: number; expected: unknown }> = [];
  private readonly pulls: Map<number, FakePull>;
  private revision = 1000;

  constructor(pulls: readonly FakePull[]) {
    this.pulls = new Map(pulls.map(pull => [pull.number, { ...pull }]));
  }

  readonly request: RefreshRequester = async (path, options = {}) => {
    const method = options.method ?? "GET";
    const expected = options.expected ?? [200];
    this.calls.push(`${method} ${path}`);
    const response = this.respond(method, path, options.body);
    if (!expected.includes(response.status)) throw Object.assign(new Error(`${method} ${path} returned ${response.status}`), { status: response.status });
    return response;
  };

  private respond(method: string, path: string, body: unknown): { status: number; body?: any; headers?: Record<string, string> } {
    const prefix = `/repos/${repository}`;
    const listing = new RegExp(`^${prefix}/pulls\\?state=open&base=develop&per_page=100&page=(\\d+)$`).exec(path);
    if (listing) {
      const page = Number(listing[1]);
      return { status: 200, body: [...this.pulls.values()].slice((page - 1) * 100, page * 100).map(pull => ({ number: pull.number })) };
    }
    if (path === `${prefix}/git/ref/heads/develop`) return { status: 200, body: { object: { sha: target } } };
    const compare = new RegExp(`^${prefix}/compare/${target}\\.\\.\\.([0-9a-f]{40})\\?per_page=1$`).exec(path);
    if (compare) {
      const pull = [...this.pulls.values()].find(candidate => candidate.head === compare[1]);
      return { status: 200, body: { behind_by: pull?.behind ?? 0 } };
    }
    const update = new RegExp(`^${prefix}/pulls/(\\d+)/update-branch$`).exec(path);
    if (update && method === "PUT") {
      const pull = this.pulls.get(Number(update[1]))!;
      const expectedHead = (body as { expected_head_sha?: unknown }).expected_head_sha;
      this.updates.push({ number: pull.number, expected: expectedHead });
      if (pull.updateStatus) return { status: pull.updateStatus, body: { message: pull.updateMessage ?? "Server Error" }, headers: pull.updateHeaders };
      if (pull.raceTo) {
        pull.head = pull.raceTo;
        return { status: 422, body: { message: "expected head sha didn't match current head ref." } };
      }
      if (expectedHead !== pull.head) return { status: 422, body: { message: "expected head sha didn't match current head ref." } };
      if (pull.conflict) return { status: 422, body: { message: "merge conflict between base and head" } };
      pull.head = sha(this.revision += 1);
      pull.behind = 0;
      return { status: 202, body: { message: "Updating pull request branch.", url: "https://github.com/" } };
    }
    const read = new RegExp(`^${prefix}/pulls/(\\d+)$`).exec(path);
    if (read) {
      const pull = this.pulls.get(Number(read[1]));
      if (!pull) return { status: 404, body: { message: "Not Found" } };
      if (pull.readStatus) return { status: pull.readStatus, body: { message: "unavailable" } };
      return { status: 200, body: metadata(pull) };
    }
    return { status: 404, body: { message: "Not Found" } };
  }
}

describe("ready pull-request refresh classification", () => {
  it.each([
    ["draft", { draft: true }, "skipped"],
    ["closed", { state: "closed" }, "skipped"],
    ["other base", { base: "master" }, "skipped"],
    ["fork", { headRepository: "someone/fork" }, "skipped"],
    ["deleted fork", { headRepository: null }, "skipped"],
    ["foreign base repository", { baseRepository: "someone/a1" }, "skipped"],
    ["Dependabot", { author: "dependabot[bot]" }, "skipped"],
    ["other bot", { author: "openspec-ci[bot]" }, "eligible"],
    ["Dependabot-like title", { title: "chore: bump actions/create-github-app-token" }, "eligible"],
    ["same-repository ready", {}, "eligible"],
  ])("classifies a %s pull request explicitly", (_label, override, disposition) => {
    expect(classifyRefreshCandidate(metadata({ number: 7, head: sha(1), ...override }), repository).disposition).toBe(disposition);
  });

  it("fails visibly on malformed identity instead of skipping it", () => {
    expect(classifyRefreshCandidate(null, repository)).toMatchObject({ disposition: "failed", reason: expect.stringContaining("number") });
    expect(classifyRefreshCandidate(metadata({ number: 7, head: "short" }), repository)).toMatchObject({ disposition: "failed" });
    expect(classifyRefreshCandidate({ ...metadata({ number: 7, head: sha(1) }), draft: "no" } as never, repository)).toMatchObject({ disposition: "failed" });
  });

  it("updates only heads that lack the current target", () => {
    const eligible = classifyRefreshCandidate(metadata({ number: 7, head: sha(1) }), repository);
    expect(decideRefresh(eligible, { behind_by: 0 }, target).disposition).toBe("current");
    expect(decideRefresh(eligible, { behind_by: 3 }, target)).toMatchObject({ disposition: "update", behindBy: 3, targetSha: target });
    expect(decideRefresh(eligible, { behind_by: "3" }, target).disposition).toBe("failed");
    expect(decideRefresh(eligible, undefined, target).disposition).toBe("failed");
  });

  it("bounds every update-branch response", () => {
    const decision = { disposition: "update" as const, number: 7, headSha: sha(1) };
    expect(interpretBranchUpdate(decision, { status: 202, body: {} }).disposition).toBe("updated");
    expect(interpretBranchUpdate(decision, { status: 422, body: { message: "expected head sha didn't match current head ref." } }).disposition).toBe("deferred");
    expect(interpretBranchUpdate(decision, { status: 422, body: { message: "There are no new commits on the base branch." } }).disposition).toBe("current");
    expect(interpretBranchUpdate(decision, { status: 422, body: { message: "merge conflict between base and head" } }).disposition).toBe("blocked");
    expect(interpretBranchUpdate(decision, { status: 422, body: { message: "Validation Failed" } }).disposition).toBe("failed");
    expect(interpretBranchUpdate(decision, { status: 422 }).disposition).toBe("failed");
    expect(interpretBranchUpdate(decision, { status: 403 }).disposition).toBe("failed");
    expect(interpretBranchUpdate(decision, { status: 403, body: { message: integrationRefusal } })).toMatchObject({ disposition: "skipped", permissionDenied: true });
  });
});

describe("ready pull-request refresh reconciliation", () => {
  it("updates every stale ready branch with its observed expected head and leaves controls unchanged", async () => {
    const github = new FakeGitHub([
      { number: 1, head: sha(1), behind: 2 },
      { number: 2, head: sha(2), behind: 1 },
      { number: 3, head: sha(3), behind: 0 },
      { number: 4, head: sha(4), behind: 5, draft: true },
      { number: 5, head: sha(5), behind: 5, headRepository: "someone/fork" },
      { number: 6, head: sha(6), behind: 5, conflict: true },
    ]);
    const results = await refreshReadyPullRequests({ repository, request: github.request });
    expect(results.map(result => [result.number, result.disposition])).toEqual([
      [1, "updated"], [2, "updated"], [3, "current"], [4, "skipped"], [5, "skipped"], [6, "blocked"],
    ]);
    expect(github.updates).toEqual([
      { number: 1, expected: sha(1) }, { number: 2, expected: sha(2) }, { number: 6, expected: sha(6) },
    ]);
    expect(github.calls.filter(call => call.startsWith("PUT")).every(call => call.endsWith("/update-branch"))).toBe(true);
    expect(github.calls.some(call => /merge|auto_merge|dispatches|check-runs|statuses|reviews/.test(call))).toBe(false);
  });

  it("leaves Dependabot rebasing to Dependabot regardless of title, without excluding other bots", async () => {
    const github = new FakeGitHub([
      { number: 1, head: sha(1), behind: 2, author: "dependabot[bot]", title: "An ordinary change" },
      { number: 2, head: sha(2), behind: 2, author: "openspec-ci[bot]", title: "chore: bump a dependency" },
      { number: 3, head: sha(3), behind: 2, title: "chore: bump actions/create-github-app-token" },
    ]);
    const results = await refreshReadyPullRequests({ repository, request: github.request });
    expect(results.map(result => result.disposition)).toEqual(["skipped", "updated", "updated"]);
    expect(results[0]).toMatchObject({ number: 1, reason: "Dependabot owns rebasing this pull request" });
    expect(github.calls.some(call => call.includes(`...${sha(1)}`))).toBe(false);
    expect(github.calls.filter(call => call.includes("/git/ref/"))).toHaveLength(2);
    expect(github.updates).toEqual([{ number: 2, expected: sha(2) }, { number: 3, expected: sha(3) }]);
  });

  it("is idempotent across duplicate triggers", async () => {
    const github = new FakeGitHub([{ number: 1, head: sha(1), behind: 2 }, { number: 2, head: sha(2), behind: 0 }]);
    await refreshReadyPullRequests({ repository, request: github.request });
    const second = await refreshReadyPullRequests({ repository, request: github.request });
    expect(second.map(result => result.disposition)).toEqual(["current", "current"]);
    expect(github.updates).toHaveLength(1);
  });

  it("defers a candidate whose head changed and continues with independent candidates", async () => {
    const github = new FakeGitHub([
      { number: 1, head: sha(1), behind: 2, raceTo: sha(99) },
      { number: 2, head: sha(2), behind: 1 },
    ]);
    const results = await refreshReadyPullRequests({ repository, request: github.request });
    expect(results.map(result => result.disposition)).toEqual(["deferred", "updated"]);
    expect(results[0]).toMatchObject({ headSha: sha(1), reason: expect.stringContaining("head changed") });
  });

  it("pages the complete open set", async () => {
    const pulls = Array.from({ length: 205 }, (_, index) => ({ number: index + 1, head: sha(index + 1), behind: index === 204 ? 1 : 0 }));
    const github = new FakeGitHub(pulls);
    const results = await refreshReadyPullRequests({ repository, request: github.request });
    expect(results).toHaveLength(205);
    expect(github.calls.filter(call => call.includes("state=open"))).toHaveLength(3);
    expect(github.updates).toEqual([{ number: 205, expected: sha(205) }]);
  });

  it("reports operational candidate failures without hiding them or stopping independent candidates", async () => {
    const github = new FakeGitHub([
      { number: 1, head: sha(1), behind: 2, updateStatus: 500 },
      { number: 2, head: sha(2), behind: 1, readStatus: 502 },
      { number: 3, head: sha(3), behind: 1 },
    ]);
    const results = await refreshReadyPullRequests({ repository, request: github.request });
    expect(results.map(result => result.disposition)).toEqual(["failed", "failed", "updated"]);
  });

  it("skips mutation permission refusals between independent updates and retains each reason", async () => {
    const github = new FakeGitHub([
      { number: 1, head: sha(1), behind: 1 },
      { number: 2, head: sha(2), behind: 1, updateStatus: 403, updateMessage: workflowRefusal },
      { number: 3, head: sha(3), behind: 1 },
      { number: 4, head: sha(4), behind: 1, updateStatus: 403, updateMessage: integrationRefusal },
      { number: 5, head: sha(5), behind: 1 },
    ]);
    const results = await refreshReadyPullRequests({ repository, request: github.request });
    expect(results.map(result => result.disposition)).toEqual(["updated", "skipped", "updated", "skipped", "updated"]);
    expect(results[1]).toMatchObject({ number: 2, headSha: sha(2), permissionDenied: true, reason: expect.stringContaining(workflowRefusal) });
    expect(results[3]).toMatchObject({ number: 4, permissionDenied: true, reason: expect.stringContaining(integrationRefusal) });
    expect(github.updates).toEqual([1, 2, 3, 4, 5].map(number => ({ number, expected: sha(number) })));
  });

  it.each([
    ["unknown refusal", "Forbidden", undefined],
    ["primary rate limit", "API rate limit exceeded", { "x-ratelimit-remaining": "0" }],
    ["secondary rate limit", "You have exceeded a secondary rate limit", { "retry-after": "60" }],
    ["abuse limit", "You have triggered an abuse detection mechanism", undefined],
    ["permission message with exhausted quota", integrationRefusal, { "x-ratelimit-remaining": "0" }],
    ["permission message with retry delay", workflowRefusal, { "retry-after": "60" }],
    ["malformed message", 403, undefined],
  ])("fails a %s without blocking independent PRs", async (_label, updateMessage, updateHeaders) => {
    const github = new FakeGitHub([
      { number: 1, head: sha(1), behind: 1, updateStatus: 403, updateMessage, updateHeaders },
      { number: 2, head: sha(2), behind: 1 },
    ]);
    const results = await refreshReadyPullRequests({ repository, request: github.request });
    expect(results.map(result => result.disposition)).toEqual(["failed", "updated"]);
    expect(results[0]).not.toHaveProperty("permissionDenied");
  });

  it("aborts on rejected credentials instead of reporting a refresh", async () => {
    const github = new FakeGitHub([{ number: 1, head: sha(1), behind: 2, updateStatus: 401 }, { number: 2, head: sha(2), behind: 1 }]);
    await expect(refreshReadyPullRequests({ repository, request: github.request })).rejects.toMatchObject({ status: 401 });
    expect(github.updates.map(update => update.number)).toEqual([1]);
  });

  it.each(["listing", "pull read", "target read", "comparison"])("still aborts a 403 on %s", async stage => {
    const github = new FakeGitHub([{ number: 1, head: sha(1), behind: 1 }, { number: 2, head: sha(2), behind: 1 }]);
    const request: RefreshRequester = async (path, options) => {
      if ((stage === "listing" && path.includes("state=open"))
        || (stage === "pull read" && path.endsWith("/pulls/1"))
        || (stage === "target read" && path.includes("/git/ref/"))
        || (stage === "comparison" && path.includes("/compare/"))) {
        throw Object.assign(new Error(integrationRefusal), { status: 403 });
      }
      return github.request(path, options);
    };
    await expect(refreshReadyPullRequests({ repository, request })).rejects.toMatchObject({ status: 403 });
    expect(github.updates).toEqual([]);
  });
});

describe("ready pull-request refresh command", () => {
  it("requires the App token and never falls back to GITHUB_TOKEN", async () => {
    await expect(runCommand({ GITHUB_TOKEN: "workflow-token" }, [])).rejects.toThrow(/App token/);
  });

  it("refuses a malformed repository identity", async () => {
    await expect(runCommand({ BRANCH_REFRESH_TOKEN: "app", GITHUB_REPOSITORY: "someone/a1/extra" }, [])).rejects.toThrow(/valid repository identity/);
  });

  it("warns and summarizes permission-denied PRs, refreshes siblings and exits successfully", async () => {
    const result = await runCommand({ BRANCH_REFRESH_TOKEN: "app" }, [
      { number: 1, head: sha(1), behind: 1 },
      { number: 2, head: sha(2), behind: 1, updateStatus: 403, updateMessage: workflowRefusal },
      { number: 3, head: sha(3), behind: 1 },
    ]);
    expect(result.stdout).toContain(`::warning::Ready pull-request refresh: skipped ${repository}#2: update-branch permission refused (HTTP 403): ${workflowRefusal}`);
    expect(result.stdout).toContain('"disposition":"updated","pullRequest":3');
    expect(result.summary).toContain(`Warning: "Ready pull-request refresh: skipped ${repository}#2`);
    expect(result.summary).toContain(workflowRefusal);
    expect(result.authorization).toEqual(["Bearer app"]);
  });

  it("succeeds when all PRs are skipped and escapes annotation message data", async () => {
    const message = workflowRefusal.replace("delivery.yml", "100%25.yml") + "\n";
    const result = await runCommand({ BRANCH_REFRESH_TOKEN: "app" }, [
      { number: 1, head: sha(1), behind: 1, author: "dependabot[bot]" },
      { number: 2, head: sha(2), behind: 1, updateStatus: 403, updateMessage: message },
      { number: 3, head: sha(3), behind: 1, updateStatus: 403, updateMessage: integrationRefusal },
    ]);
    expect(result.stdout).not.toContain('"disposition":"updated"');
    const warnings = result.stdout.split(/\r?\n/).filter(line => line.startsWith("::warning::"));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("100%2525.yml");
    expect(warnings[0]).toContain("%0A");
  });

  it.each([
    ["Forbidden", undefined],
    [integrationRefusal, { "x-ratelimit-remaining": "0" }],
    [workflowRefusal, { "retry-after": "60" }],
  ])("exits nonzero for unexpected or rate-limited 403 responses", async (updateMessage, updateHeaders) => {
    await expect(runCommand({ BRANCH_REFRESH_TOKEN: "app" }, [
      { number: 1, head: sha(1), behind: 1, updateStatus: 403, updateMessage, updateHeaders },
    ])).rejects.toThrow(/branch refresh failed for #1/);
  });

  it("does not treat malformed permission-response JSON as a successful skip", async () => {
    await expect(runCommand({ BRANCH_REFRESH_TOKEN: "app" }, [
      { number: 1, head: sha(1), behind: 1, updateStatus: 403, updateMessage: integrationRefusal },
      { number: 2, head: sha(2), behind: 1 },
    ], true)).rejects.toMatchObject({
      stdout: expect.stringContaining("returned malformed JSON"),
      stderr: expect.stringContaining("branch refresh failed for #1, #2"),
    });
  });

  it("reports each candidate and fails when a candidate failed", async () => {
    const success = await runCommand({ BRANCH_REFRESH_TOKEN: "app" }, [{ number: 1, head: sha(1), behind: 1 }, { number: 2, head: sha(2), behind: 0, draft: true }]);
    expect(success.stdout).toContain('"disposition":"updated","pullRequest":1');
    expect(success.stdout).toContain('"disposition":"skipped","pullRequest":2');
    expect(success.authorization).toEqual(["Bearer app"]);
    await expect(runCommand({ BRANCH_REFRESH_TOKEN: "app" }, [{ number: 1, head: sha(1), behind: 1, updateStatus: 500 }])).rejects.toThrow(/branch refresh failed for #1/);
  });
});

async function runCommand(
  environment: Record<string, string>,
  pulls: readonly FakePull[],
  malformedUpdateResponse = false,
): Promise<{ readonly stdout: string; readonly authorization: string[]; readonly summary: string }> {
  const github = new FakeGitHub(pulls);
  const authorization: string[] = [];
  const server = createServer((request, response) => {
    authorization.push(String(request.headers.authorization));
    let text = "";
    request.on("data", chunk => { text += chunk; });
    request.on("end", () => {
      github.request(request.url ?? "", { method: request.method ?? "GET", body: text ? JSON.parse(text) : undefined, expected: [200, 202, 401, 403, 404, 422, 500, 502] })
        .then(result => {
          response.writeHead(result.status, { "content-type": "application/json", ...result.headers });
          response.end(malformedUpdateResponse && request.method === "PUT" ? "{broken" : JSON.stringify(result.body ?? {}));
        });
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GITHUB_|GH_|BRANCH_REFRESH_)/.test(key)));
  await mkdir(".artifacts", { recursive: true });
  const directory = await mkdtemp(resolve(".artifacts/refresh-command-"));
  const summary = resolve(directory, "summary.md");
  try {
    const result = await execFileAsync(process.execPath, ["scripts/refresh-ready-pull-requests.mjs"], {
      env: { ...inherited, GITHUB_REPOSITORY: repository, GITHUB_API_URL: `http://127.0.0.1:${address.port}`, GITHUB_STEP_SUMMARY: summary, ...environment },
    });
    return { stdout: result.stdout, authorization: [...new Set(authorization)], summary: await readFile(summary, "utf8") };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

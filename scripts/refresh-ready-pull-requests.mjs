import { appendFile } from "node:fs/promises";
import { refreshReadyPullRequests } from "./ready-pull-request-refresh.mjs";
import { targetBranch } from "./delivery-target.mjs";
import { createArchivePublisher } from "./openspec-archive-publication.mjs";
import { createArchiveReader } from "./openspec-archive-github.mjs";
import { reconcileFinalization } from "./openspec-finalization-publication.mjs";
import { resolve } from "node:path";

// Security: only the event-producing App token may update branches; GITHUB_TOKEN is never a fallback because its pushes start no CI.
const token = process.env.BRANCH_REFRESH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
if (!token || !repository) throw new Error("the branch-refresh App token and GitHub repository are required");
// Security: the App token is minted for the calling repository only, so that repository is the governed one.
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error(`repository ${repository} is not a valid repository identity`);

let results;
let publisher;
const deadline = Date.now() + 9 * 60 * 1000;
try {
  results = await refreshReadyPullRequests({ repository, request, reconcileLinked: async number => {
    publisher ??= await createArchivePublisher({ repository, appId: process.env.DELIVERY_BOT_APP_ID,
      privateKey: process.env.DELIVERY_BOT_PRIVATE_KEY, deadline });
    const reader = createArchiveReader({ repository, token, apiUrl, deadline });
    return await reconcileFinalization({ reader, publisher, number, deadline, toolRoot: resolve("node_modules/@fission-ai/openspec") });
  } });
} catch (error) {
  await report(`Ready pull-request refresh failed before completing the pass: ${error?.message ?? error}`);
  throw error;
} finally { await publisher?.close(); }
if (results.length === 0) await report(`Ready pull-request refresh: no open pull requests target ${targetBranch()}.`);
for (const result of results) {
  const evidence = {
    disposition: result.disposition,
    pullRequest: result.number ?? null,
    headSha: result.headSha ?? null,
    targetSha: result.targetSha ?? null,
    reason: result.reason ?? null,
  };
  if (result.permissionDenied) {
    const message = `Ready pull-request refresh: skipped ${repository}#${result.number}: ${result.reason}`;
    // API messages are annotation data, not workflow commands or annotation properties.
    console.log(`::warning::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `- Warning: ${JSON.stringify(message)}\n`);
  }
  await report(`Ready pull-request refresh: ${JSON.stringify(evidence)}`);
}
const failed = results.filter(result => result.disposition === "failed");
if (failed.length > 0) throw new Error(`branch refresh failed for ${failed.map(result => `#${result.number ?? "unknown"}`).join(", ")}`);

async function request(path, { method = "GET", body, expected = [200] } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "delivery-ready-pull-request-refresh",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!expected.includes(response.status)) {
    const error = new Error(`GitHub REST ${method} ${path} returned ${response.status}: ${text.slice(0, 240)}`);
    error.status = response.status;
    throw error;
  }
  try {
    return {
      status: response.status,
      body: text ? JSON.parse(text) : undefined,
      headers: {
        "x-ratelimit-remaining": response.headers.get("x-ratelimit-remaining"),
        "retry-after": response.headers.get("retry-after"),
      },
    };
  } catch {
    throw new Error(`GitHub REST ${method} ${path} returned malformed JSON`);
  }
}

async function report(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `- ${message}\n`);
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DELIVERY_CHECK, loadProtection } from "./repository-protection.mjs";

const execute = promisify(execFile);
const identity = repository => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("repository must be owner/name");
};
const errorText = error => `HTTP ${error.status ?? "unknown"}: ${String(error.message).slice(0, 300)}`;

/** GET-only transport. There is deliberately no method/body argument or live apply implementation. */
export async function diagnosticGet(path) {
  if (!/^repos\/[\w.-]+\/[\w.-]+(?:\/|$)/.test(path) || /[\r\n]/.test(path)) throw new Error("diagnostic API scope");
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    const response = await fetch(`https://api.github.com/${path}`, { redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" } });
    if (!response.ok) throw Object.assign(new Error("diagnostic read refused"), { status: response.status });
    const text = await response.text();
    if (text.length > 16 * 1024 * 1024) throw new Error("diagnostic response too large");
    return JSON.parse(text);
  }
  try {
    const { stdout } = await execute("gh", ["api", "--method", "GET", path], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    return JSON.parse(stdout);
  } catch (error) {
    error.status = Number(error.stderr?.match(/\(HTTP (\d{3})\)/)?.[1]) || undefined;
    throw error;
  }
}

async function pages(get, path, field = null) {
  const result = [];
  for (let page = 1; page <= 10; page++) {
    const response = await get(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const batch = field ? response?.[field] : response;
    if (!Array.isArray(batch) || batch.length > 100) throw new Error(`malformed diagnostic page: ${path}`);
    result.push(...batch);
    if (batch.length < 100) {
      if (field && Number.isSafeInteger(response.total_count) && response.total_count > result.length) throw new Error("incomplete diagnostic listing");
      return result;
    }
  }
  throw new Error("diagnostic pagination limit");
}

async function context(repository, get) {
  identity(repository);
  const repo = await get(`repos/${repository}`);
  if (typeof repo.default_branch !== "string" || !repo.default_branch) throw new Error("missing default branch");
  return { repository, branch: repo.default_branch, prefix: `repos/${repository}` };
}
async function expectedChecks(repository, branch, get) {
  const configuration = await loadProtection({ repository, defaultBranch: branch, api: async (method, path) => {
    if (method !== "GET") throw new Error("read-only diagnostic");
    return await get(path);
  } });
  const declaration = configuration.declarations.find(item => item.kind === "default-branch");
  return { ...configuration, checks: [...new Set([...(declaration.checks ?? []), ...(declaration.delivery === false ? [] : [DELIVERY_CHECK])])] };
}

/** Effective/inherited rules plus classic protection, not merely the desired managed ruleset.
 * Proposed changes are field-level dry-run records tied to the observed source. Never create full PUT payloads.
 */
export async function fastMergeReport({ repository, get = diagnosticGet }) {
  const result = { repository, readOnly: true, status: "aligned", branch: null, expectedChecks: [], requiredChecks: [], rules: [], classic: null,
    proposedChanges: [], drift: [], unknown: [] };
  try {
    const { branch, prefix } = await context(repository, get);
    result.branch = branch;
    try {
      const configuration = await expectedChecks(repository, branch, get);
      result.expectedChecks = configuration.checks;
    } catch (error) { result.unknown.push(`desired checks: ${errorText(error)}`); }
    try {
      const rules = await pages(get, `${prefix}/rules/branches/${encodeURIComponent(branch)}`);
      result.rules = rules;
      for (const rule of rules) {
        if (typeof rule?.type !== "string") throw new Error("malformed effective rule");
        if (rule.type === "merge_queue") result.drift.push("active merge queue intentionally creates integration runs; separate policy decision required");
        if (rule.type !== "required_status_checks") continue;
        const parameters = rule.parameters;
        if (typeof parameters?.strict_required_status_checks_policy !== "boolean" || !Array.isArray(parameters.required_status_checks)
          || parameters.required_status_checks.some(check => typeof check.context !== "string")) throw new Error("malformed effective checks");
        result.requiredChecks.push(...parameters.required_status_checks);
        if (parameters.strict_required_status_checks_policy) {
          result.drift.push(`strict required checks from ${rule.ruleset_source ?? "unknown source"} ruleset ${rule.ruleset_id ?? "unknown"}`);
          if (rule.ruleset_source_type === "Repository" && rule.ruleset_source === repository && Number.isSafeInteger(rule.ruleset_id)) {
            const full = await get(`${prefix}/rulesets/${rule.ruleset_id}`);
            if (full.id !== rule.ruleset_id || !Array.isArray(full.rules)) throw new Error("ruleset identity changed");
            full.rules.forEach((entry, index) => {
              if (entry.type === "required_status_checks" && entry.parameters?.strict_required_status_checks_policy === true) {
                result.proposedChanges.push({ repository, branch, rulesetId: full.id, observedUpdatedAt: full.updated_at ?? null,
                  path: `/rules/${index}/parameters/strict_required_status_checks_policy`, before: true, after: false,
                  preserves: "every other field, including required checks and integration pins", requires: "explicit named-repository approval and fresh read; no apply command exists here" });
              }
            });
          } else result.unknown.push("inherited/unidentified strict rule: owner-level inspection required before proposing an exact change");
        }
      }
    } catch (error) { result.unknown.push(`effective protection: ${errorText(error)}`); }
    try {
      const classic = await get(`${prefix}/branches/${encodeURIComponent(branch)}/protection`);
      result.classic = classic;
      if (classic.required_status_checks) {
        const checks = classic.required_status_checks;
        if (typeof checks.strict !== "boolean" || !Array.isArray(checks.contexts)) throw new Error("malformed classic protection");
        result.requiredChecks.push(...checks.contexts.map(context => ({ context,
          ...(checks.checks?.find(check => check.context === context)?.app_id != null ? { integration_id: checks.checks.find(check => check.context === context).app_id } : {}) })));
        if (checks.strict) {
          result.drift.push("classic required checks are strict");
          result.proposedChanges.push({ repository, branch, source: "classic protection", path: "/required_status_checks/strict", before: true, after: false,
            preserves: "all contexts, App pins and other protection fields", requires: "explicit named-repository approval and fresh read; no apply command exists here" });
        }
      }
    } catch (error) { if (error.status !== 404) result.unknown.push(`classic protection: ${errorText(error)}`); }
    const present = new Set(result.requiredChecks.map(check => check.context));
    for (const check of result.expectedChecks) if (!present.has(check)) result.drift.push(`missing required check: ${check}`);
  } catch (error) { result.unknown.push(errorText(error)); }
  result.status = result.unknown.length ? "unknown" : result.drift.length ? "drift" : "aligned";
  return result;
}

/** Require product test evidence for the exact default head, on a push run. Older green, PR merge refs,
 * advisory workflows and skipped required jobs cannot certify the integrated default branch.
 */
export async function baseHealthReport({ repository, get = diagnosticGet }) {
  const result = { repository, status: "unknown", branch: null, head: null, checks: [], unknown: [] };
  try {
    const { branch, prefix } = await context(repository, get);
    result.branch = branch;
    const configuration = await expectedChecks(repository, branch, get);
    result.head = configuration.commit;
    if (!/^[0-9a-f]{40}$/.test(result.head ?? "")) throw new Error("default head identity missing");
    const checks = configuration.checks.filter(name => name !== DELIVERY_CHECK);
    if (!checks.length) throw new Error("no product test gates configured");
    const runs = await pages(get, `${prefix}/actions/runs?head_sha=${result.head}&event=push`, "workflow_runs");
    const latest = new Map();
    for (const run of runs.sort((a, b) => b.id - a.id)) {
      if (run.event !== "push" || run.head_sha !== result.head || run.head_branch !== branch) continue;
      if (!Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.workflow_id)) throw new Error("malformed run identity");
      if (!latest.has(run.workflow_id)) latest.set(run.workflow_id, run);
    }
    const jobs = [];
    for (const run of latest.values()) {
      const listing = await pages(get, `${prefix}/actions/runs/${run.id}/jobs?filter=latest`, "jobs");
      for (const job of listing) if (checks.includes(job.name)) {
        if (job.head_sha !== result.head) throw new Error("job head differs from default-head run");
        jobs.push({ name: job.name, status: job.status, conclusion: job.conclusion, run: run.id,
          url: `https://github.com/${repository}/actions/runs/${run.id}` });
      }
    }
    result.checks = checks.map(name => {
      const matches = jobs.filter(job => job.name === name);
      if (matches.length !== 1) return { name, status: "missing", reason: matches.length ? "ambiguous product gate" : "no current default-head push evidence" };
      const job = matches[0];
      return { ...job, status: job.status !== "completed" ? "pending" : job.conclusion === "success" ? "passing"
        : ["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"].includes(job.conclusion) ? "failing" : "missing" };
    });
    const statuses = result.checks.map(check => check.status);
    result.status = statuses.includes("failing") ? "failing" : statuses.includes("pending") ? "pending" : statuses.includes("missing") ? "missing" : "passing";
    // Ref movement during evidence collection is unknown, never a certificate for a newer commit.
    const current = await get(`${prefix}/branches/${encodeURIComponent(branch)}`);
    if (current.commit?.sha !== result.head) throw new Error("default head advanced during health inspection");
  } catch (error) { result.status = "unknown"; result.unknown.push(errorText(error)); }
  return result;
}

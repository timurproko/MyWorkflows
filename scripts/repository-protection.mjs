import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const DELIVERY_CHECK = "delivery / Delivery check";
// GitHub's built-in repository admin role; "pull_request" lets an admin merge any pull request but never push directly.
const ADMIN_BYPASS = Object.freeze({ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" });
const DEFAULT_BRANCH = "~DEFAULT_BRANCH";
export const PROTECTION_FILE = ".github/protection.json";
export const DEFAULT_DECLARATIONS = [
  { kind: "default-branch", checks: ["CI required"], mergeMethods: ["squash"], linearHistory: true },
  { kind: "workflow-events", workflows: [".github/workflows/delivery.yml"], events: ["pull_request_target", "workflow_dispatch"] },
];

const fields = {
  "default-branch": ["checks", "mergeMethods", "linearHistory", "delivery"],
  branch: ["branch"],
  "release-tags": ["pattern", "bypassApps"],
  "workflow-events": ["workflows", "events"],
};
const text = value => typeof value === "string" && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
const missing = error => error.status === 404;

/** A file replaces the defaults, so omissions keep the original declaration/builder semantics. */
export function validateDeclarations(declarations, defaultBranch) {
  const invalid = reason => { throw new Error(`invalid ${PROTECTION_FILE}: ${reason}`); };
  if (!Array.isArray(declarations)) invalid("expected an array of declarations");
  const seen = new Set();
  for (const item of declarations) {
    if (!item || typeof item !== "object" || !Object.hasOwn(fields, item.kind)) invalid("unknown declaration kind");
    if (Object.keys(item).some(key => key !== "kind" && !fields[item.kind].includes(key))) invalid(`unknown field in ${item.kind}`);
    const key = item.kind === "branch" ? `branch:${item.branch}` : item.kind;
    if (seen.has(key)) invalid(`duplicate ${key}`);
    seen.add(key);
    if (item.kind === "default-branch") {
      if (item.checks !== undefined && !strings(item.checks)) invalid("checks must be unique nonempty strings");
      if (item.mergeMethods !== undefined && (!strings(item.mergeMethods) || !item.mergeMethods.length || item.mergeMethods.some(method => !["merge", "squash", "rebase"].includes(method)))) invalid("invalid mergeMethods");
      for (const field of ["linearHistory", "delivery"]) if (item[field] !== undefined && typeof item[field] !== "boolean") invalid(`${field} must be boolean`);
    } else if (item.kind === "branch") {
      if (!text(item.branch) || item.branch === defaultBranch || item.branch.startsWith("refs/") || /[\s~^:?*\[\\]/.test(item.branch) || item.branch.includes("..")) invalid("branch must name a non-default branch");
    } else if (item.kind === "release-tags") {
      if (item.pattern !== undefined && !text(item.pattern)) invalid("pattern must be a nonempty string");
      if (item.bypassApps !== undefined && (!Array.isArray(item.bypassApps) || item.bypassApps.some(id => !Number.isSafeInteger(id) || id <= 0))) invalid("bypassApps must contain positive App IDs");
    } else {
      if (!strings(item.workflows) || !item.workflows.length || item.workflows.some(path => !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path))) invalid("workflows must name workflow YAML files");
      if (!strings(item.events) || !item.events.length || item.events.some(event => !/^[a-z_]+$/.test(event))) invalid("events must name workflow events");
    }
  }
  for (const kind of ["default-branch", "workflow-events"]) if (!seen.has(kind)) invalid(`missing ${kind}`);
  return declarations;
}

/** Only a missing file selects defaults; remote errors and invalid files fail closed. */
export async function loadProtection({ repository, defaultBranch, api = defaultApi }) {
  const branch = await api("GET", `repos/${repository}/branches/${encodeURIComponent(defaultBranch)}`);
  const commit = branch?.commit?.sha;
  if (!text(commit)) throw new Error(`could not resolve the default branch of ${repository}`);
  let file;
  try {
    file = await api("GET", `repos/${repository}/contents/${PROTECTION_FILE}?ref=${encodeURIComponent(commit)}`);
  } catch (error) {
    if (!missing(error)) throw error;
    return { declarations: structuredClone(DEFAULT_DECLARATIONS), source: "built-in defaults", commit };
  }
  if (file?.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") throw new Error(`could not read ${PROTECTION_FILE}`);
  let declarations;
  try { declarations = JSON.parse(Buffer.from(file.content, "base64").toString("utf8")); }
  catch { throw new Error(`invalid JSON in ${PROTECTION_FILE}`); }
  return { declarations: validateDeclarations(declarations, defaultBranch), source: PROTECTION_FILE, commit };
}

/**
 * Build one GitHub ruleset from its declaration. Three kinds exist:
 * `default-branch` (pull request, tests and the delivery check), `branch` (a branch only automation
 * advances: no deletion, no force push) and `release-tags` (tags only the release App may move).
 */
export function buildRuleset(declaration, defaultBranch) {
  const base = { enforcement: "active" };
  if (declaration.kind === "default-branch") {
    const checks = [...new Set([...(declaration.checks ?? []), ...(declaration.delivery === false ? [] : [DELIVERY_CHECK])])];
    return { ...base, name: `protect-${defaultBranch}`, target: "branch",
      bypass_actors: [{ ...ADMIN_BYPASS }],
      conditions: { ref_name: { include: [DEFAULT_BRANCH], exclude: [] } },
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        ...(declaration.linearHistory ? [{ type: "required_linear_history" }] : []),
        { type: "pull_request", parameters: {
          required_approving_review_count: 0, dismiss_stale_reviews_on_push: true, require_code_owner_review: false,
          require_last_push_approval: false, required_review_thread_resolution: true,
          allowed_merge_methods: declaration.mergeMethods ?? ["squash"],
        } },
        { type: "required_status_checks", parameters: {
          // Parallel agents must not rerun every PR's full CI whenever another PR merges.
          strict_required_status_checks_policy: false, do_not_enforce_on_create: false,
          required_status_checks: checks.map(context => ({ context })),
        } },
      ] };
  }
  if (declaration.kind === "branch") {
    return { ...base, name: `protect-${declaration.branch}`, target: "branch", bypass_actors: [],
      conditions: { ref_name: { include: [`refs/heads/${declaration.branch}`], exclude: [] } },
      rules: [{ type: "deletion" }, { type: "non_fast_forward" }] };
  }
  if (declaration.kind === "release-tags") {
    return { ...base, name: "protect-release-tags", target: "tag",
      bypass_actors: (declaration.bypassApps ?? []).map(actor_id => ({ actor_id, actor_type: "Integration", bypass_mode: "always" })),
      conditions: { ref_name: { include: [`refs/tags/${declaration.pattern ?? "v*"}`], exclude: [] } },
      rules: [{ type: "deletion" }, { type: "non_fast_forward" }] };
  }
  throw new Error(`unknown ruleset kind: ${declaration.kind}`);
}

/**
 * GitHub blocks `pull_request_target` in public repositories unless an Actions policy allows it. This builds the
 * policy that lets exactly the declared workflow files run on exactly the declared events.
 */
export function buildEventPolicy(declaration) {
  return {
    name: "allow-delivery-events",
    enforcement: "active",
    conditions: { workflow_path: { include: [...declaration.workflows].sort(), exclude: [] } },
    rules: [{ type: "restrict_action_events", parameters: { allowed_events: [...declaration.events].sort() } }],
  };
}

/** Differences between a live Actions policy and the desired one; empty when they agree. */
export function describePolicyChanges(existing, desired) {
  if (!existing) return ["create it"];
  const paths = policy => [...(policy.conditions?.workflow_path?.include ?? [])].sort().join(", ") || "all workflows";
  const events = policy => [...(policy.rules?.find(rule => rule.type === "restrict_action_events")?.parameters?.allowed_events ?? [])].sort().join(", ") || "none";
  const changes = [];
  if (existing.enforcement !== desired.enforcement) changes.push(`enforcement ${existing.enforcement} -> ${desired.enforcement}`);
  if (paths(existing) !== paths(desired)) changes.push(`workflows ${paths(existing)} -> ${paths(desired)}`);
  const excluded = policy => [...(policy.conditions?.workflow_path?.exclude ?? [])].sort().join(", ") || "none";
  if (excluded(existing) !== excluded(desired)) changes.push(`excluded workflows ${excluded(existing)} -> ${excluded(desired)}`);
  const types = policy => (policy.rules ?? []).map(rule => rule.type).sort().join(", ");
  if (types(existing) !== types(desired)) changes.push(`rules ${types(existing)} -> ${types(desired)}`);
  if (events(existing) !== events(desired)) changes.push(`events ${events(existing)} -> ${events(desired)}`);
  return changes;
}

const refs = (ruleset, defaultBranch) => (ruleset?.conditions?.ref_name?.include ?? [])
  .map(ref => ref === DEFAULT_BRANCH ? `refs/heads/${defaultBranch}` : ref).sort().join(",");

const sameRefs = (existing, desired, defaultBranch) => existing.target === desired.target && refs(existing, defaultBranch) === refs(desired, defaultBranch);
const sameName = (existing, desired) => existing.target === desired.target && existing.name === desired.name;

/** Prefer the ruleset governing the same refs, falling back to its desired name. */
export function findLiveRuleset(live, desired, defaultBranch) {
  return live.find(ruleset => sameRefs(ruleset, desired, defaultBranch))
    ?? live.find(ruleset => sameName(ruleset, desired)) ?? null;
}

/** Reserve all exact-ref matches before any name fallback; one live ID has exactly one owner. */
function assignLiveRulesets(live, desiredRulesets, defaultBranch) {
  const remaining = new Map(live.map(ruleset => [ruleset.id, ruleset]));
  const assigned = new Map();
  for (const matches of [sameRefs, sameName]) {
    for (const desired of desiredRulesets) {
      if (assigned.has(desired)) continue;
      const existing = [...remaining.values()].find(ruleset => matches(ruleset, desired, defaultBranch));
      if (existing) {
        assigned.set(desired, existing);
        remaining.delete(existing.id);
      }
    }
  }
  return desiredRulesets.map(desired => ({ desired, existing: assigned.get(desired) ?? null }));
}

const contexts = parameters => (parameters?.required_status_checks ?? []).map(check => check.context);
const shown = (key, value) => key === "required_status_checks" ? contexts({ [key]: value }).join(", ") || "none" : JSON.stringify(value);

/** Human-readable differences between a live ruleset and the desired one; empty when they agree. */
export function describeChanges(existing, desired, defaultBranch) {
  if (!existing) return ["create it"];
  const changes = [];
  if (existing.name !== desired.name) changes.push(`rename from ${existing.name}`);
  if (existing.enforcement !== desired.enforcement) changes.push(`enforcement ${existing.enforcement} -> ${desired.enforcement}`);
  const bypass = list => (list ?? []).map(actor => `${actor.actor_type}:${actor.actor_id}:${actor.bypass_mode}`).sort().join(", ") || "none";
  if (bypass(existing.bypass_actors) !== bypass(desired.bypass_actors)) changes.push(`bypass ${bypass(existing.bypass_actors)} -> ${bypass(desired.bypass_actors)}`);
  if (refs(existing, defaultBranch) !== refs(desired, defaultBranch)) changes.push(`refs ${refs(existing, defaultBranch)} -> ${refs(desired, defaultBranch)}`);
  const excluded = ruleset => [...(ruleset.conditions?.ref_name?.exclude ?? [])].sort().join(", ") || "none";
  if (excluded(existing) !== excluded(desired)) changes.push(`excluded refs ${excluded(existing)} -> ${excluded(desired)}`);
  const types = list => (list ?? []).map(item => item.type).sort().join(", ");
  if (types(existing.rules) !== types(desired.rules)) changes.push(`rules ${types(existing.rules) || "none"} -> ${types(desired.rules)}`);
  for (const wanted of desired.rules) {
    const live = existing.rules?.find(item => item.type === wanted.type)?.parameters ?? {};
    for (const [key, value] of Object.entries(wanted.parameters ?? {})) {
      if (shown(key, live[key]) !== shown(key, value)) changes.push(`${wanted.type}.${key}: ${shown(key, live[key])} -> ${shown(key, value)}`);
    }
  }
  return changes;
}

// Rationale: GitHub pins a required check to the app that reports it; keep that pin when the check stays.
function keepCheckSources(desired, existing) {
  const pinned = new Map((existing?.rules?.find(item => item.type === "required_status_checks")?.parameters?.required_status_checks ?? [])
    .filter(check => check.integration_id != null).map(check => [check.context, check.integration_id]));
  return { ...desired, rules: desired.rules.map(rule => rule.type !== "required_status_checks" ? rule : { ...rule, parameters: {
    ...rule.parameters,
    required_status_checks: rule.parameters.required_status_checks.map(check => pinned.has(check.context) ? { ...check, integration_id: pinned.get(check.context) } : check),
  } }) };
}

/** Read every page so a later existing policy cannot be mistaken for missing protection. */
async function readPages(api, path, key) {
  const all = [];
  for (let page = 1; ; page++) {
    const response = await api("GET", `${path}?per_page=100&page=${page}`);
    const items = key ? response?.[key] : response;
    if (!Array.isArray(items)) throw new Error(`invalid response from ${path}`);
    all.push(...items);
    if (key && response.total_count > all.length) {
      if (!items.length) throw new Error(`incomplete response from ${path}`);
    } else if (items.length < 100) return all;
  }
}

async function readRulesets(api, repository) {
  const live = [];
  for (const entry of await readPages(api, `repos/${repository}/rulesets`)) live.push(await api("GET", `repos/${repository}/rulesets/${entry.id}`));
  return live;
}

/** Compare everything before writing anything. Existing live protection needs explicit consent to change. */
export async function protectRepository({ repository, apply = false, allowRuleChanges = false, api = defaultApi, declarations }) {
  if (allowRuleChanges && !apply) throw new Error("--allow-rule-changes requires --apply");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("repository must be owner/name");
  const defaultBranch = (await api("GET", `repos/${repository}`)).default_branch;
  const configuration = declarations
    ? { declarations: validateDeclarations(declarations, defaultBranch), source: "provided declarations", commit: null }
    : await loadProtection({ repository, defaultBranch, api });
  const declared = configuration.declarations;
  const live = await readRulesets(api, repository);
  const policies = await readPages(api, `repos/${repository}/actions/policies`, "policies");
  const managed = new Set();
  const operations = [];
  const eventDeclaration = declared.find(item => item.kind === "workflow-events");
  const desiredPolicy = buildEventPolicy(eventDeclaration);
  // Protocol: the list omits conditions and rules; read the matching policy in full.
  const listed = policies.find(policy => policy.name === desiredPolicy.name);
  const existingPolicy = listed ? await api("GET", `repos/${repository}/actions/policies/${listed.id}`) : null;
  operations.push({ name: `Actions policy ${desiredPolicy.name}`, existing: existingPolicy, desired: desiredPolicy,
    path: `repos/${repository}/actions/policies`, changes: describePolicyChanges(existingPolicy, desiredPolicy) });
  const desiredRulesets = declared.filter(item => item.kind !== "workflow-events").map(declaration => buildRuleset(declaration, defaultBranch));
  for (const { desired, existing } of assignLiveRulesets(live, desiredRulesets, defaultBranch)) {
    if (existing) managed.add(existing.id);
    operations.push({ name: desired.name, existing, desired: keepCheckSources(desired, existing),
      path: `repos/${repository}/rulesets`, changes: describeChanges(existing, desired, defaultBranch) });
  }
  const notes = [
    ...live.filter(ruleset => !managed.has(ruleset.id)).map(ruleset => `ruleset ${ruleset.name} is not declared and was left alone`),
    ...policies.filter(policy => policy.id !== listed?.id).map(policy => `Actions policy ${policy.name} is not declared and was left alone`),
  ];
  const classic = [];
  for (const declaration of declared.filter(item => ["default-branch", "branch"].includes(item.kind))) {
    const branch = declaration.kind === "default-branch" ? defaultBranch : declaration.branch;
    const path = `repos/${repository}/branches/${encodeURIComponent(branch)}/protection`;
    try { await api("GET", path); }
    catch (error) { if (missing(error)) continue; throw error; }
    classic.push({ branch, path, desired: buildRuleset(declaration, defaultBranch) });
  }
  const conflicts = [
    ...operations.filter(operation => operation.existing && operation.changes.length).map(operation => operation.name),
    ...classic.map(item => `classic protection on ${item.branch}`),
  ];
  const blocked = conflicts.length > 0 && !allowRuleChanges;
  if (apply && !blocked) {
    for (const operation of operations.filter(operation => operation.changes.length)) {
      const { existing, desired, path } = operation;
      await api(existing ? "PUT" : "POST", existing ? `${path}/${existing.id}` : path, desired);
    }
  }
  // Even with consent, classic protection is removed only after a fresh read confirms a matching active ruleset.
  for (const { branch, path, desired } of classic) {
    if (!apply || blocked) { notes.push(`classic protection on ${branch} would be removed only with --apply --allow-rule-changes`); continue; }
    const installed = findLiveRuleset(await readRulesets(api, repository), desired, defaultBranch);
    if (installed?.enforcement === "active" && describeChanges(installed, desired, defaultBranch).length === 0) {
      await api("DELETE", path);
      notes.push(`removed the classic branch protection rule on ${branch}; ${desired.name} protects it`);
    } else notes.push(`kept the classic branch protection rule on ${branch}: ${desired.name} is not confirmed active`);
  }
  return { repository, rulesets: operations.map(({ name, changes }) => ({ name, changes })),
    applied: apply && !blocked, blocked, conflicts, notes, configuration };
}

export function formatProtection(result) {
  const pending = result.rulesets.some(ruleset => ruleset.changes.length > 0);
  return [
    `${result.repository}`,
    `  configuration: ${result.configuration.source}${result.configuration.commit ? ` at ${result.configuration.commit}` : ""}`,
    ...result.rulesets.flatMap(ruleset => ruleset.changes.length === 0
      ? [`  ${ruleset.name}: matches`]
      : [`  ${ruleset.name}: ${result.blocked ? "blocked" : result.applied ? "updated" : "would create"}`, ...ruleset.changes.map(change => `    - ${change}`)]),
    ...result.notes.map(note => `  note: ${note}`),
    ...(result.blocked ? [
      `Live protection differs: ${result.conflicts.join(", ")}.`,
      "Nothing was changed. Add or correct .github/protection.json on the default branch to preserve live rules.",
      "Deliberate live changes require both --apply and --allow-rule-changes.",
    ] : pending && !result.applied ? ["Nothing was changed. Run again with --apply to install missing protection."] : []),
  ].join("\n");
}

async function defaultApi(method, path, body) {
  // Protocol: the Actions policies endpoints are served from this API version onwards.
  const version = path.includes("/actions/policies") ? ["-H", "X-GitHub-Api-Version: 2026-03-10"] : [];
  const child = run("gh", ["api", "-X", method, ...version, path, ...(body ? ["--input", "-"] : [])], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (body) child.child.stdin.end(JSON.stringify(body));
  try {
    const { stdout } = await child;
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch (error) {
    error.status = Number(error.stderr?.match(/\(HTTP (\d{3})\)/)?.[1]) || undefined;
    throw error;
  }
}

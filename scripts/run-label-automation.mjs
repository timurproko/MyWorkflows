import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { labelApi, syncLabels, validateRepository } from "./repository-labels.mjs";
import { cleanupReviewLabel } from "./review-label-cleanup.mjs";

export async function runLabelAutomation({ environment = process.env, api = labelApi, report = console.log, event } = {}) {
  if (environment.GITHUB_ACTIONS !== "true" || !["pull_request_target", "workflow_dispatch", "workflow_run"].includes(environment.GITHUB_EVENT_NAME)) {
    throw new Error("label automation requires a trusted delivery event");
  }
  const operation = environment.LABELS_OPERATION ?? "sync";
  if (!["sync", "cleanup"].includes(operation) || (operation === "cleanup" && environment.GITHUB_EVENT_NAME !== "pull_request_target")) {
    throw new Error("invalid internal label operation for this event");
  }
  const dryRun = operation === "sync" && environment.GITHUB_EVENT_NAME === "workflow_dispatch" && environment.LABELS_DRY_RUN === "true";
  // Match Actions' case-insensitive string comparison; do not trim whitespace.
  if (environment.DELIVERY_LABELS_ENABLED?.toLowerCase() === "false" && !dryRun) {
    report("Delivery labels are disabled by explicit DELIVERY_LABELS_ENABLED=false opt-out. Nothing was changed.");
    return { disposition: "disabled" };
  }
  const repository = validateRepository(environment.GITHUB_REPOSITORY);
  if (!dryRun && (!environment.LABELS_APP_TOKEN || environment.GH_TOKEN !== environment.LABELS_APP_TOKEN)) {
    throw new Error("label writes require the separate delivery App token with Pull requests write");
  }
  if (operation === "cleanup") {
    event ??= JSON.parse(await readFile(environment.GITHUB_EVENT_PATH, "utf8"));
    const result = await cleanupReviewLabel({ repository, event, api });
    report(`Review-in-progress closed-PR cleanup: ${result.disposition}.`);
    return result;
  }
  const result = await syncLabels({ repository, apply: !dryRun, api });
  // Names/descriptions from the API are data, not workflow commands or summary markup.
  report(`Base labels ${dryRun ? "report" : "sync"}: ${result.labels.filter(label => label.action === "create").length} create, ${result.labels.filter(label => label.action === "update").length} update, ${result.labels.filter(label => label.action === "rename").length} rename, ${result.preserved.length} unmanaged labels preserved. No labels deleted.`);
  // JSON escaping plus Markdown/HTML escaping keeps arbitrary UI names inert in logs and summaries.
  const data = value => JSON.stringify(value).replace(/[<>&`*_[\]#!|]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  for (const label of result.labels.filter(label => label.action === "rename")) {
    report(`Managed label ${label.key}: ${dryRun ? "planned rename" : "renamed"} ${data(label.previousName)} to ${data(label.name)}.`);
  }
  for (const conflict of result.conflicts ?? []) report(`Managed label ${conflict.key}: retained current and previous definitions ${data(conflict)}; no automatic deletion.`);
  for (const label of result.labels.filter(label => label.action === "reference-drift")) report(`Managed label ${label.key}: reference drift; reconcile UI changes before applying this definition.`);
  return result;
}

export async function automationMain(options = {}) {
  const environment = options.environment ?? process.env;
  const report = options.report ?? (message => console.log(message));
  const messages = [];
  try {
    await runLabelAutomation({ ...options, environment, report: message => { messages.push(message); report(message); } });
    return 0;
  } catch (error) {
    const message = `Delivery label automation failed${error.status ? ` (HTTP ${error.status})` : ""}; check trusted inputs, App secrets and repository Pull requests write access. Promotion/finalization are independent. No fallback credential was used for writes.`;
    messages.push(message);
    report(`::warning::${message}`);
    return 1;
  } finally {
    if (environment.GITHUB_STEP_SUMMARY) await appendFile(environment.GITHUB_STEP_SUMMARY, `## Delivery labels\n${messages.map(message => `- ${message}`).join("\n")}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await automationMain();
}

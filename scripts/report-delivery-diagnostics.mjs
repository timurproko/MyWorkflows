import { appendFile } from "node:fs/promises";
import { baseHealthReport, fastMergeReport } from "./delivery-diagnostics.mjs";

const repository = process.env.GITHUB_REPOSITORY;
const [policy, health] = await Promise.all([fastMergeReport({ repository }), baseHealthReport({ repository })]);
const summary = `## Fast-merge policy and default-branch test health (advisory)\n\nNo settings were changed. Unknown/missing evidence is not green CI.\n\n\`\`\`json\n${JSON.stringify({ policy, health }, null, 2)}\n\`\`\`\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
for (const [name, report, ok] of [["Fast-merge protection", policy, "aligned"], ["Default-branch tests", health, "passing"]]) {
  if (report.status !== ok) console.log(`::warning::${name}: ${report.status}. See the advisory job summary for exact head, evidence and read-only proposals.`);
}

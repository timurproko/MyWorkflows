// Run the unmodified full suite against exactly the data a reference PR publishes.
// Isolated source copies avoid racing tests or editing the agent's published palette.
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { labelMetadata } from "../scripts/repository-labels.mjs";
import { reconcileReferenceManifest } from "../scripts/reference-labels.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bootstrap = JSON.parse(await readFile(join(root, "test/fixtures/bootstrap-labels.json"), "utf8"));
const live = Object.values(bootstrap.labels).map(label => ({ ...labelMetadata(label), id: label.reference.id, node_id: label.reference.nodeId }));
const snapshot = reconcileReferenceManifest({ manifest: bootstrap, live }).manifest;
const edited = live.map((label, index) => ({ ...label, name: ["Reading", "Accepted", "Revise"][index],
  color: ["123abc", "abc123", "234bcd"][index], description: `Reference description ${index}` }));
const renamed = reconcileReferenceManifest({ manifest: snapshot, live: edited }).manifest;
const variants = [["snapshot-refresh", snapshot], ["ui-rename-metadata", renamed]];
const artifacts = join(root, ".artifacts");
await mkdir(artifacts, { recursive: true });
let failed = false;
for (const [name, manifest] of variants) {
  const copy = await mkdtemp(join(artifacts, `palette-${name}-`));
  for (const entry of await readdir(root)) {
    if (![".git", ".artifacts", "node_modules"].includes(entry)) await cp(join(root, entry), join(copy, entry), { recursive: true });
  }
  await symlink(join(root, "node_modules"), join(copy, "node_modules"), "junction");
  await writeFile(join(copy, "labels/base.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run"],
      { cwd: copy, timeout: 180_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    await writeFile(join(artifacts, `palette-${name}.log`), stdout + stderr);
    console.log(`Generated ${name}: full suite passed without guidance, fixture or test edits.`);
  } catch (error) {
    await writeFile(join(artifacts, `palette-${name}.log`), (error.stdout ?? "") + (error.stderr ?? ""));
    console.error(`Generated ${name}: full suite failed; see .artifacts/palette-${name}.log`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GITHUB_DEFAULT_LABELS } from "../scripts/prune-default-labels.mjs";
import definitions from "../labels/base.json";

const execute = promisify(execFile);
const label = { ...GITHUB_DEFAULT_LABELS[1], default: true, id: 1 };
const managedBug = Object.values(definitions.labels).some(label => [label.name, ...label.previousNames, label.reference.name].some(name => name.normalize("NFC").toLowerCase() === "bug"));
// Exercise the real bin entry point, replacing every subprocess before importing it.
// No gh executable, credential or network request is used, even if a test regresses.
const cli = `
  import childProcess from "node:child_process";
  import { syncBuiltinESMExports } from "node:module";
  import { promisify } from "node:util";
  const stub = () => { throw new Error("unexpected subprocess"); };
  stub[promisify.custom] = async (command, args) => {
    if (command !== "gh" || args[0] !== "api" || args[args.indexOf("-X") + 1] !== "GET") throw new Error("unexpected subprocess or write");
    const path = args.at(-1);
    console.error("REQUEST " + path);
    return { stdout: JSON.stringify(path.includes("/issues?") || !process.argv.includes("--prune-unused-defaults") ? [] : [${JSON.stringify(label)}]) };
  };
  childProcess.execFile = stub;
  syncBuiltinESMExports();
  process.argv = [process.execPath, "bin/delivery.mjs", "labels", ...process.argv.slice(1)];
  await import("./bin/delivery.mjs");
`;
// The eval module resolves imports from cwd, not this test file.
const run = (args: string[]) => execute(process.execPath, ["--input-type=module", "-e", cli, "--", ...args]);

describe("delivery labels CLI", () => {
  it.each(["owner/repo.name", "owner/.hidden"])("accepts dotted identities for both report modes and repo flag forms: %s", async repository => {
    for (const repoArgs of [["--repo", repository], [`--repo=${repository}`]]) {
      for (const prune of [false, true]) {
        const { stdout, stderr } = await run([...repoArgs, ...(prune ? ["--prune-unused-defaults"] : [])]);
        const result = JSON.parse(stdout);
        expect(result).toMatchObject({ repository, applied: false });
        if (prune) expect(result.labels).toEqual(managedBug ? [] : [{ name: "bug", action: "would-delete", issues: 0, pullRequests: 0 }]);
        else {
          expect(result.labels).toEqual(Object.entries(definitions.labels).map(([key, label]) => ({ key, name: label.name, action: "create" })));
        }
        expect(stderr.trim().split(/\r?\n/)).toEqual([
          `REQUEST repos/${repository}/labels?per_page=100&page=1`,
          ...(prune && !managedBug ? [`REQUEST repos/${repository}/issues?state=all&labels=bug&per_page=100&page=1`] : []),
        ]);
      }
    }
  });

  it.each([[], ["--repo"], ["--repo", "owner"], ["--repo", "owner/repo/extra"], ["--repo", "owner/.hidden", "--unknown"]])(
    "rejects malformed arguments before any API request: %j", async (...args) => {
      await expect(run(args as string[])).rejects.toMatchObject({ code: 2, stdout: "", stderr: expect.stringMatching(/^delivery labels failed:/) });
    });
});

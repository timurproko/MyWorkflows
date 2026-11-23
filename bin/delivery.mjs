#!/usr/bin/env node
// The local command agents and maintainers use. Every subcommand works from any repository checkout.
import { parseArgs } from "node:util";

const USAGE = `Usage: delivery <command>

  check-body --body-file <path> [--final]   Validate a pull-request body before pushing it
  check-body --pr <number> [--final]        Validate the current body of a pull request
  start <type>/<short-name> [--base <branch>]
                                            Start, or return to, one task's checkout and print its path: a slot
                                            from the treehouse pool when pooled worktrees are on, else
                                            .worktrees/<short-name>, on a branch cut from origin's default
                                            branch, or from --base
  start --detach <name> [--base <branch>]   The same for a checkout without a branch, for reading only.
                                            --json prints path, branch, created and pooled as one JSON line
  cleanup [--apply] [--path <worktree>]     Report, or with --apply remove, merged clean worktrees; a pool slot
                                            is returned to its pool instead
  finish <worktree> [--force]               Remove one task's worktree and its merged branch; the worktree is
                                            named by path, by its folder under .worktrees/, or by its branch.
                                            --force also discards its uncommitted, untracked and ignored
                                            files, never commits that are not merged
  guard [<command>...]                      Refuse, with exit code 2, a shell command that creates a worktree
                                            with Git; an agent's pre-command hook runs it, with the command
                                            as arguments or as the hook's JSON on standard input
  pool [on|off] [--json]                    Show, or set, whether this machine uses pooled worktrees; they
                                            need treehouse installed
  protect [--repo <owner/name>] [--apply]   Compare defaults or the repository's .github/protection.json;
                                            --apply installs missing protection. Changing existing rules
                                            also requires --allow-rule-changes
  labels --repo <owner/name> [--apply]      Report the central base-label diff; --apply explicitly upserts it
                                            --prune-unused-defaults reports only unused, unmodified GitHub
                                            defaults; with --apply deletes them instead of syncing labels
  instructions [--apply]                    Report agent instruction files that differ from the shared template;
                                            --apply writes AGENTS.md and CLAUDE.md
  openspec <arguments>                      Run OpenSpec at the version the shared workflow pins, for example
                                            delivery openspec validate --all --strict
  install [--dev]                           Download the shared workflow to ~/.workflow and link
                                            its skill and this command from there; --dev links this checkout
  update                                    Fast-forward ~/.workflow now (otherwise hourly)
  bootstrap                                 Make ~/.workflow present and current, quietly and without ever
                                            failing; for a repository's install script or Git hook
`;

const [command, ...args] = process.argv.slice(2);

try {
  // Rationale: the guard runs before every shell command of an agent, so it does nothing but read its input.
  if (command && command !== "install" && command !== "update" && command !== "bootstrap" && command !== "guard") {
    const { refreshManagedCopy } = await import("../scripts/managed-copy.mjs");
    const note = await refreshManagedCopy();
    if (note) console.error(note);
  }
  if (command === "check-body") {
    const { main } = await import("../scripts/check-delivery-body.mjs");
    const result = await main(args);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else if (command === "cleanup") {
    const { values } = parseArgs({ args, options: { apply: { type: "boolean" }, path: { type: "string" } } });
    const { cleanupWorktrees, formatReport } = await import("../scripts/worktree-cleanup.mjs");
    console.log(formatReport(await cleanupWorktrees({ apply: Boolean(values.apply), only: values.path ?? null })));
    // Worktrees made by hand are never cleaned up unasked; they are named so somebody replaces them.
    const { misplacedReport } = await import("../scripts/worktree-guard.mjs");
    for (const line of await misplacedReport()) console.log(line);
  } else if (command === "start") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { base: { type: "string" }, detach: { type: "string" }, json: { type: "boolean" } } });
    if (positionals.length !== (values.detach ? 0 : 1)) throw new Error("name exactly one branch as type/short-description, or one checkout with --detach");
    const { startWorktree } = await import("../scripts/worktree-pool.mjs");
    const started = await startWorktree({ branch: positionals[0] ?? null, detach: values.detach ?? null, base: values.base ?? null });
    // The path alone on stdout, so a script can take it; the rest is for a reader.
    console.error(`${started.created ? "started" : "continuing"} ${started.branch ?? `${values.detach} (no branch)`} in ${started.pooled ? "a pool slot" : "a worktree"}`);
    const { misplacedReport } = await import("../scripts/worktree-guard.mjs");
    for (const line of await misplacedReport()) console.error(line);
    const path = started.path.replaceAll("\\", "/");
    // --json is for a tool that hands its task checkouts to this command and must know whether the checkout is new.
    console.log(values.json ? JSON.stringify({ path, branch: started.branch, created: started.created, pooled: started.pooled }) : path);
  } else if (command === "guard") {
    const { readFileSync } = await import("node:fs");
    const { guard } = await import("../scripts/worktree-guard.mjs");
    let input = "";
    if (!args.length && !process.stdin.isTTY) { try { input = readFileSync(0, "utf8"); } catch { /* no input: nothing to refuse */ } }
    const refused = guard({ args, input });
    // Exit code 2 is what a pre-command hook reads as "do not run this"; the text goes to the agent.
    if (refused) { console.error(refused); process.exitCode = 2; }
  } else if (command === "pool") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { json: { type: "boolean" } } });
    const { formatPool, poolState, writePoolSetting } = await import("../scripts/worktree-pool.mjs");
    if (positionals.length > 1 || (positionals[0] && !["on", "off"].includes(positionals[0]))) throw new Error("use `delivery pool`, `delivery pool on` or `delivery pool off`");
    if (positionals[0]) await writePoolSetting(positionals[0] === "on");
    const state = await poolState();
    console.log(values.json ? JSON.stringify(state) : formatPool(state));
  } else if (command === "finish") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { force: { type: "boolean" } } });
    if (positionals.length !== 1) throw new Error("name exactly one worktree: its path, its folder under .worktrees/, or its branch");
    const { finishWorktree, formatFinish } = await import("../scripts/worktree-cleanup.mjs");
    const result = await finishWorktree({ target: positionals[0], force: Boolean(values.force) });
    console.log(formatFinish(result));
    if (!result.removed || result.failure) process.exitCode = 1;
  } else if (command === "protect") {
    const { values } = parseArgs({ args, options: { repo: { type: "string" }, apply: { type: "boolean" }, "allow-rule-changes": { type: "boolean" } } });
    const { formatProtection, protectRepository } = await import("../scripts/repository-protection.mjs");
    let repository = values.repo;
    if (!repository) {
      const { execFileSync } = await import("node:child_process");
      repository = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" }).trim();
    }
    const result = await protectRepository({ repository, apply: Boolean(values.apply), allowRuleChanges: Boolean(values["allow-rule-changes"]) });
    console.log(formatProtection(result));
    if (result.blocked) process.exitCode = 1;
  } else if (command === "labels") {
    const { labelsMain } = await import("../scripts/repository-labels.mjs");
    console.log(JSON.stringify(await labelsMain(args), null, 2));
  } else if (command === "instructions") {
    const { values } = parseArgs({ args, options: { apply: { type: "boolean" } } });
    const { inspectCheckout, LEFT_FOR_REVIEW } = await import("../scripts/repository-instructions.mjs");
    const result = await inspectCheckout({ apply: Boolean(values.apply) });
    for (const line of result.lines) console.log(line);
    if (result.ok) console.log(result.lines.length ? "Agent instructions now match the shared template." : "Agent instructions match the shared template.");
    else { console.log(LEFT_FOR_REVIEW); process.exitCode = 1; }
  } else if (command === "openspec") {
    const { runOpenspec } = await import("../scripts/openspec-version.mjs");
    process.exitCode = await runOpenspec(args);
  } else if (command === "install") {
    const { values } = parseArgs({ args, options: { dev: { type: "boolean" } } });
    const { installEverything } = await import("../scripts/install.mjs");
    for (const line of await installEverything({ dev: Boolean(values.dev) })) console.log(line);
  } else if (command === "bootstrap") {
    const { bootstrap } = await import("../scripts/bootstrap.mjs");
    for (const line of await bootstrap()) console.error(line);
  } else if (command === "update") {
    const { refreshManagedCopy } = await import("../scripts/managed-copy.mjs");
    console.log(await refreshManagedCopy({ force: true }));
  } else {
    console.log(USAGE);
    if (command && command !== "help" && command !== "--help") process.exitCode = 2;
  }
} catch (error) {
  console.error(`delivery ${command} failed: ${error.message}`);
  process.exitCode = 2;
}

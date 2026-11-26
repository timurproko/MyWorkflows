import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { archiveFailure, assertRepositoryPath, SHA } from "./openspec-archive-policy.mjs";

const execute = promisify(execFile);
const MAX_FILE = 8 * 1024 * 1024;

/** Bounded data-only OpenSpec snapshot for the shared impact classifier. Reject links/submodules. */
export async function gitOpenSpecSnapshot({ cwd, sha, env = process.env, gitImpl = execute }) {
  if (!SHA.test(sha ?? "")) throw archiveFailure("commit-identity");
  const listing = await gitImpl("git", ["ls-tree", "-r", "-z", sha, "--", "openspec"], { cwd, env, maxBuffer: MAX_FILE });
  const entries = new Map();
  for (const line of listing.stdout.split("\0").filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match) throw archiveFailure("unsafe-openspec-tree");
    assertRepositoryPath(match[3]);
    entries.set(match[3], match[2]);
  }
  if (entries.size > 20_000) throw archiveFailure("repository-tree");
  let size = 0;
  const cache = new Map();
  return { entries, async blob(path) {
    if (!entries.has(path)) return null;
    if (!cache.has(path)) {
      const result = await gitImpl("git", ["show", `${sha}:${path}`], { cwd, env, encoding: "buffer", maxBuffer: MAX_FILE });
      const bytes = Buffer.from(result.stdout);
      if ((size += bytes.length) > 32 * 1024 * 1024) throw archiveFailure("spec-blob-size");
      cache.set(path, bytes);
    }
    return cache.get(path);
  } };
}

/** Read every canonical `openspec/specs/**` blob of one commit, keyed by repository path. */
export async function readCanonicalSpecs({ cwd, sha, env = process.env, gitImpl = execute }) {
  if (!SHA.test(sha ?? "")) throw archiveFailure("delivery-target-identity");
  const listing = await gitImpl("git", ["ls-tree", "-r", "-z", "--name-only", sha, "--", "openspec/specs"], { cwd, env, maxBuffer: MAX_FILE });
  const specs = new Map();
  for (const path of listing.stdout.split("\0").filter(Boolean)) {
    const blob = await gitImpl("git", ["show", `${sha}:${path}`], { cwd, env, encoding: "buffer", maxBuffer: MAX_FILE });
    specs.set(path, Buffer.from(blob.stdout));
  }
  return specs;
}

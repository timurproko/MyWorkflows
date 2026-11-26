import { archiveFailure, SHA } from "./openspec-archive-policy.mjs";
import { targetBranch } from "./delivery-target.mjs";

/** Approval follows the first-parent delivery chain, not the human history brought by a clean base merge. */
export async function assertApprovalCovers({ reader, publisher, git, approvedHead, head, target, change = null }) {
  if (!SHA.test(approvedHead ?? "")) throw archiveFailure("approval-head-invalid");
  if (approvedHead === head) return;
  const mismatch = () => { throw archiveFailure("approval-head-mismatch"); };
  const chain = (await git(["rev-list", "--first-parent", "--max-count=1001", head])).split("\n");
  const index = chain.indexOf(approvedHead);
  if (index < 0 || index > 1000) mismatch();
  for (const sha of chain.slice(0, index).reverse()) {
    const commit = await reader.get(`${reader.prefix}/commits/${sha}`);
    if (commit.sha !== sha || commit.author?.login !== publisher.actor || commit.committer?.login !== publisher.actor) mismatch();
    const parents = (await git(["rev-list", "--parents", "-n", "1", sha])).split(" ").slice(1);
    if (parents.length === 2) {
      if (await git(["merge-base", "--is-ancestor", parents[1], target], { allowFailure: true }) === null) mismatch();
      const tree = await git(["merge-tree", "--write-tree", parents[0], parents[1]], { allowFailure: true });
      if (!SHA.test(tree ?? "") || tree !== await git(["rev-parse", `${sha}^{tree}`])) mismatch();
    } else if (parents.length === 1 && change) {
      const subject = await git(["show", "-s", "--format=%s", sha]);
      if (!["finalize", "refinalize"].some(verb => subject === `docs(openspec): ${verb} ${change}`)) mismatch();
      const paths = (await git(["diff", "--name-only", "--no-renames", "-z", parents[0], sha])).split("\0").filter(Boolean);
      const archive = new RegExp(`^openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${change}/`);
      if (!paths.length || paths.some(path => !path.startsWith(`openspec/changes/${change}/`)
        && !archive.test(path) && !path.startsWith("openspec/specs/"))) mismatch();
    } else mismatch();
  }
}

/** Final snapshot comparison intentionally checks body/base identity as well as the exact branch head. */
export function sameDeliverySnapshot(current, expected, repository, head = expected.head?.sha, body = expected.body) {
  return current?.number === expected.number && current.state === "open" && current.draft === expected.draft
    && current.node_id === expected.node_id && current.body === body
    && current.base?.ref === targetBranch() && current.base?.ref === expected.base?.ref
    && current.base?.repo?.full_name === repository && current.base?.sha === expected.base?.sha
    && current.head?.ref === expected.head?.ref && current.head?.sha === head && current.head?.repo?.full_name === repository;
}

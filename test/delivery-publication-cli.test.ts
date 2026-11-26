import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../scripts/publish-openspec-finalization.mjs";

const head = "a".repeat(40);
afterEach(() => vi.unstubAllGlobals());
describe("trusted approval publication CLI", () => {
  it("refuses approval input outside workflow_dispatch even during a dry run", async () => {
    await expect(main(["--pr", "7", "--approved-head", head, "--dry-run"], { GITHUB_EVENT_NAME: "pull_request_target" }))
      .rejects.toThrow("approval-dispatch-required");
  });
  it("audits a draft without minting an App token or writing anything", async () => {
    const fetch = vi.fn(async (url: string, options: any) => {
      expect(url).toBe("https://api.github.com/repos/owner/repo/pulls/7");
      expect(options.method).toBeUndefined();
      return new Response(JSON.stringify({ number: 7, state: "open", draft: true, body: '```openspec-implementation\n{"version":3,"change":"example"}\n```',
        base: { ref: "develop", repo: { full_name: "owner/repo" } }, head: { sha: head, ref: "feature/example", repo: { full_name: "owner/repo" } } }));
    });
    vi.stubGlobal("fetch", fetch);
    const env = { GITHUB_REPOSITORY: "owner/repo", GITHUB_EVENT_NAME: "workflow_dispatch" };
    await expect(main(["--pr", "7", "--dry-run"], env)).resolves.toMatchObject({ disposition: "waiting", reason: "awaiting-approval" });
    await expect(main(["--pr", "7", "--approved-head", head, "--dry-run"], env)).resolves.toMatchObject({ disposition: "would-reconcile", approvedHead: head, reason: "audit-only-approval-not-verified" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The function against a local libSQL file instead of Turso.
const dir = mkdtempSync(join(tmpdir(), "hs-"));
process.env.TURSODB_TURSO_DATABASE_URL = `file:${join(dir, "hs.db")}`;
const { GET, POST } = await import("../../api/high-scores");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const post = (body: unknown) => POST(new Request("http://x/api/high-scores", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("/api/high-scores", () => {
  it("starts empty", async () => {
    expect(await (await GET()).json()).toEqual({ scores: [] });
  });

  it("keeps the top three, ties below earlier scores, and says where a score went", async () => {
    expect(await (await post({ initials: "aaa", score: 300, difficulty: "easy" })).json()).toMatchObject({ rank: 0 });
    await post({ initials: "BBB", score: 500, difficulty: "hard" });
    await post({ initials: "CCC", score: 200, difficulty: "medium" });
    const tie = await (await post({ initials: "DDD", score: 300, difficulty: "medium" })).json();
    expect(tie.rank).toBe(2);
    expect(tie.scores.map((s: { initials: string }) => s.initials)).toEqual(["BBB", "AAA", "DDD"]);
    expect((await (await post({ initials: "EEE", score: 10, difficulty: "easy" })).json()).rank).toBe(-1);
    expect((await (await GET()).json()).scores).toHaveLength(3);
  });

  it("rejects bad entries", async () => {
    for (const bad of ["not json", { initials: "", score: 10, difficulty: "easy" }, { initials: "XX", score: 99999, difficulty: "easy" }, { initials: "XX", score: 10, difficulty: "insane" }]) {
      expect((await post(bad)).status).toBe(400);
    }
  });
});

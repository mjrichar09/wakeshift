// Batting game high scores in Turso (libSQL). Vercel runs this as a serverless function;
// the browser never sees the database token.
//   GET  /api/high-scores -> { scores: HighScore[] }  (the top 3)
//   POST /api/high-scores { initials, score, difficulty } -> { scores, rank }
// Env: TURSO_DATABASE_URL (libsql://…) and TURSO_AUTH_TOKEN.

import { createClient, type Client } from "@libsql/client";
import { HIGH_SCORES, asHighScore, asHighScores } from "../src/game/highScores.js";

let db: Client | null = null;
let ready: Promise<unknown> | null = null;

/** The client, with the table created on first use. */
async function client() {
  if (!db) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set");
    db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    ready = db.batch(
      [
        `CREATE TABLE IF NOT EXISTS high_scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          initials TEXT NOT NULL,
          score INTEGER NOT NULL,
          difficulty TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        "CREATE INDEX IF NOT EXISTS high_scores_rank ON high_scores (score DESC, id ASC)",
      ],
      "write",
    );
  }
  await ready;
  return db;
}

/** Best first; ties keep the earlier score above. */
async function top(c: Client) {
  const r = await c.execute({ sql: "SELECT id, initials, score, difficulty FROM high_scores ORDER BY score DESC, id ASC LIMIT ?", args: [HIGH_SCORES] });
  return { ids: r.rows.map((row) => Number(row.id)), scores: asHighScores(r.rows.map((row) => ({ ...row, score: Number(row.score) }))) };
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET() {
  try {
    return json({ scores: (await top(await client())).scores });
  } catch (e) {
    console.error(e);
    return json({ error: "High scores are unavailable" }, 503);
  }
}

export async function POST(req: Request) {
  let entry;
  try {
    entry = asHighScore(await req.json());
  } catch {
    entry = null;
  }
  if (!entry) return json({ error: "Expected { initials, score, difficulty }" }, 400);
  try {
    const c = await client();
    const ins = await c.execute({ sql: "INSERT INTO high_scores (initials, score, difficulty) VALUES (?, ?, ?)", args: [entry.initials, entry.score, entry.difficulty] });
    const { ids, scores } = await top(c);
    return json({ scores, rank: ids.indexOf(Number(ins.lastInsertRowid)) });
  } catch (e) {
    console.error(e);
    return json({ error: "High scores are unavailable" }, 503);
  }
}

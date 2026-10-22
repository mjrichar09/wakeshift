// High-score rules (pure, tested), shared by the game and the /api/high-scores function, so
// this file must not import three.js or the scene.

export const HIGH_SCORES = 3;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Level = (typeof DIFFICULTIES)[number];
/** Ten pitches, all barrelled for home runs at real time (100 × 2.5 × 1.3): nothing above this is a real round. */
export const MAX_SCORE = 3250;

export interface HighScore {
  initials: string;
  score: number;
  difficulty: Level;
}

/** Up to three letters or digits, upper case. */
export function cleanInitials(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
}

/** A round makes the list when it scores and beats the last place (or the list has room). */
export function makesHighScores(list: HighScore[], score: number) {
  return score > 0 && (list.length < HIGH_SCORES || score > list[list.length - 1].score);
}

/** The list with the new entry in place (ties go below earlier scores), and where it went. */
export function addHighScore(list: HighScore[], e: HighScore): { list: HighScore[]; rank: number } {
  const next = [...list];
  let rank = next.findIndex((x) => e.score > x.score);
  if (rank < 0) rank = next.length;
  next.splice(rank, 0, e);
  return { list: next.slice(0, HIGH_SCORES), rank: rank < HIGH_SCORES ? rank : -1 };
}

/** An entry from outside (storage, a request, a response), or null when it isn't one. */
export function asHighScore(x: unknown): HighScore | null {
  const v = x as Partial<HighScore> | null;
  if (!v || typeof v.initials !== "string" || !Number.isInteger(v.score) || !DIFFICULTIES.includes(v.difficulty as Level)) return null;
  const initials = cleanInitials(v.initials);
  const score = v.score as number;
  if (!initials || score < 0 || score > MAX_SCORE) return null;
  return { initials, score, difficulty: v.difficulty as Level };
}

/** A list from outside, dropping anything malformed, best first. */
export function asHighScores(v: unknown): HighScore[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(asHighScore)
    .filter((x): x is HighScore => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, HIGH_SCORES);
}

/** Stored JSON back to a list. */
export function parseHighScores(raw: string | null): HighScore[] {
  try {
    return asHighScores(JSON.parse(raw ?? "[]"));
  } catch {
    return [];
  }
}

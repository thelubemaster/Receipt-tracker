import type { AiId } from './aiRoster'
import { AI_ROSTER, getAi } from './aiRoster'
import { getLeaderboard, saveLeaderboard } from './db'

export interface AiStats {
  aiId: AiId
  /** Times this AI participated in a scan */
  scans: number
  /** Times the user crowned this AI “best” for a scan */
  wins: number
  /** 1–5 star ratings count */
  ratingCount: number
  ratingSum: number
  lastUsedAt: string | null
}

export type LeaderboardMap = Record<AiId, AiStats>

export function emptyStats(aiId: AiId): AiStats {
  return {
    aiId,
    scans: 0,
    wins: 0,
    ratingCount: 0,
    ratingSum: 0,
    lastUsedAt: null,
  }
}

export function defaultLeaderboard(): LeaderboardMap {
  const map = {} as LeaderboardMap
  for (const a of AI_ROSTER) {
    map[a.id] = emptyStats(a.id)
  }
  return map
}

export function normalizeLeaderboard(raw: Partial<LeaderboardMap> | null | undefined): LeaderboardMap {
  const base = defaultLeaderboard()
  if (!raw) return base
  for (const a of AI_ROSTER) {
    const s = raw[a.id]
    if (s) {
      base[a.id] = {
        aiId: a.id,
        scans: s.scans ?? 0,
        wins: s.wins ?? 0,
        ratingCount: s.ratingCount ?? 0,
        ratingSum: s.ratingSum ?? 0,
        lastUsedAt: s.lastUsedAt ?? null,
      }
    }
  }
  return base
}

export function avgRating(s: AiStats): number | null {
  if (!s.ratingCount) return null
  return Math.round((s.ratingSum / s.ratingCount) * 10) / 10
}

/** Sort score: wins*10 + avgRating*2 + scans*0.1 */
export function leaderboardScore(s: AiStats): number {
  const avg = avgRating(s) ?? 0
  return s.wins * 10 + avg * 2 + s.scans * 0.1
}

export interface RankedAi {
  rank: number
  profile: ReturnType<typeof getAi>
  stats: AiStats
  score: number
  avgRating: number | null
}

export function rankLeaderboard(board: LeaderboardMap): RankedAi[] {
  const rows = AI_ROSTER.map((p) => {
    const stats = board[p.id] ?? emptyStats(p.id)
    return {
      rank: 0,
      profile: p,
      stats,
      score: leaderboardScore(stats),
      avgRating: avgRating(stats),
    }
  }).sort((a, b) => b.score - a.score || b.stats.wins - a.stats.wins)

  return rows.map((r, i) => ({ ...r, rank: i + 1 }))
}

export async function recordScanParticipation(aiIds: AiId[]): Promise<LeaderboardMap> {
  const board = normalizeLeaderboard(await getLeaderboard())
  const now = new Date().toISOString()
  for (const id of aiIds) {
    const s = board[id] ?? emptyStats(id)
    s.scans += 1
    s.lastUsedAt = now
    board[id] = s
  }
  await saveLeaderboard(board)
  return board
}

export async function recordAiWin(aiId: AiId, stars: number = 5): Promise<LeaderboardMap> {
  const board = normalizeLeaderboard(await getLeaderboard())
  const s = board[aiId] ?? emptyStats(aiId)
  s.wins += 1
  const clamped = Math.min(5, Math.max(1, Math.round(stars)))
  s.ratingCount += 1
  s.ratingSum += clamped
  board[aiId] = s
  await saveLeaderboard(board)
  return board
}

export async function recordTeamRatings(
  picks: { aiId: AiId; stars: number }[],
): Promise<LeaderboardMap> {
  const board = normalizeLeaderboard(await getLeaderboard())
  for (const { aiId, stars } of picks) {
    const s = board[aiId] ?? emptyStats(aiId)
    s.wins += 1
    const clamped = Math.min(5, Math.max(1, Math.round(stars)))
    s.ratingCount += 1
    s.ratingSum += clamped
    board[aiId] = s
  }
  await saveLeaderboard(board)
  return board
}

import type { Match, Mmr } from './types';
export type RecordStats = { wins: number; losses: number; draws: number; rr: number | null } | { error: string };
export function calculateStats(start: number, matches: Match[], mmr: Mmr[], complete: boolean, now = Date.now()): RecordStats {
  if (!complete) return { error: 'Stream record unavailable: incomplete match history.' };
  const unique = new Map<string, Match>();
  for (const m of matches) {
    const old = unique.get(m.id);
    if (old && JSON.stringify(old) !== JSON.stringify(m)) return { error: 'Stream record unavailable: conflicting match history.' };
    unique.set(m.id, m);
  }
  const selected = [...unique.values()].filter(m => m.competitive && m.completed && m.end > start && m.end <= now);
  if (selected.some(m => m.outcome === 'unknown')) return { error: 'Stream record unavailable: unresolved match outcome (possible remake).' };
  let wins = 0, losses = 0, draws = 0, rr = 0, available = true;
  for (const m of selected) {
    if (m.outcome === 'win') wins++; else if (m.outcome === 'loss') losses++; else draws++;
    const entries = mmr.filter(e => e.id === m.id);
    const delta = entries[0]?.delta;
    if (delta == null || entries.some(e => e.delta !== delta)) available = false; else rr += delta;
  }
  return { wins, losses, draws, rr: available ? rr : null };
}
export function calculate(start: number, matches: Match[], mmr: Mmr[], complete: boolean, now = Date.now()): string {
  const stats = calculateStats(start, matches, mmr, complete, now);
  if ('error' in stats) return stats.error;
  return `Stream Record: ${stats.wins}W-${stats.losses}L${stats.draws ? `-${stats.draws}D` : ''} | ${stats.rr === null ? 'RR unavailable' : `${stats.rr > 0 ? '+' : ''}${stats.rr} RR`}`;
}
export function formatStreamRecord(username: string, stats: RecordStats): string {
  if ('error' in stats) return `${username}: ${stats.error}`;
  const record = `${stats.wins}W-${stats.losses}L${stats.draws ? `-${stats.draws}D` : ''}`;
  if (stats.rr === null) return `${username} is currently going ${record} since the stream started (RR unavailable)`;
  const direction = stats.rr > 0 ? 'up' : stats.rr < 0 ? 'down' : 'even';
  return `${username} is currently ${direction} ${Math.abs(stats.rr)}R (going ${record}) since the stream started`;
}

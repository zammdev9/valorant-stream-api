import type { ValorantProvider } from './types';
import { calculateStats, formatStreamRecord } from './record-calculator';
export async function record(active: { start: number } | null, provider: ValorantProvider, username = 'Streamer') {
  if (!active) return 'Streamer is currently offline.';
  const h = await provider.history(active.start); return formatStreamRecord(username, calculateStats(active.start, h.matches, h.mmr, h.complete));
}

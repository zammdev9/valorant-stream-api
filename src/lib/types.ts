export type Match = { id: string; start: number; end: number; completed: boolean; competitive: boolean; outcome: 'win' | 'loss' | 'draw' | 'unknown' };
export type Mmr = { id: string; start: number; delta: number | null };
export interface ValorantProvider {
  history(start: number): Promise<{ matches: Match[]; mmr: Mmr[]; complete: boolean }>;
  rank(): Promise<{ name: string; rr: number; placements: number }>;
}

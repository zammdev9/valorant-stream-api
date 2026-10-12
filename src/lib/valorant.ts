import { z } from 'zod';
import type { Config } from './config';
import type { Match, Mmr, ValorantProvider } from './types';
import { cache } from './cache';
import { json } from './http';
import { henrikBudget } from './henrik-budget';
const integer = z.number().int();
const team = z.object({ team_id: z.string(), won: z.boolean(), rounds: z.object({ won: integer.nonnegative(), lost: integer.nonnegative() }) });
const matchSchema = z.object({ metadata: z.object({ match_id: z.string().min(1), started_at: z.iso.datetime(), game_length_in_ms: integer.nonnegative(), is_completed: z.boolean(), queue: z.object({ id: z.string() }) }), players: z.array(z.object({ puuid: z.string(), team_id: z.string() })), teams: z.array(team) });
const historySchema = z.object({ status: z.literal(200), data: z.array(matchSchema) });
const mmrSchema = z.object({ status: z.literal(200), data: z.object({ account: z.object({ puuid: z.string() }), history: z.array(z.object({ match_id: z.string(), date: z.iso.datetime(), last_change: integer, tier: z.object({ id: integer }), is_placement_match: z.boolean().nullish(), queue_id: z.string().nullish() })) }) });
const REFRESH = 120000;
const DAY = 86400000;
const PAGE_SIZE = 3;
type RawMatch = z.infer<typeof matchSchema>;
type Update = z.infer<typeof mmrSchema>['data']['history'][number];
type Ledger = { expires: number; matches: Map<string, RawMatch>; updates: Map<string, Update>; covered: Set<string>; scan?: { head: string; next: number; visited: Set<string> } };
const ledgers = new Map<string, Ledger>();
function ledger(key: string): Ledger {
  for (const [k, value] of ledgers) if (value.expires <= Date.now()) ledgers.delete(k);
  let result = ledgers.get(key);
  if (!result) { result = { expires: Date.now() + DAY, matches: new Map(), updates: new Map(), covered: new Set() }; ledgers.set(key, result); }
  return result;
}
function normalize(m: RawMatch, id: string): Match {
  const player = m.players.find(p => p.puuid === id);
  const own = m.teams.find(t => t.team_id === player?.team_id);
  const other = m.teams.find(t => t.team_id !== player?.team_id);
  let outcome: Match['outcome'] = 'unknown';
  if (own && other && m.teams.length === 2) {
    if (own.won !== other.won) outcome = own.won ? 'win' : 'loss';
    else if (!own.won && own.rounds.won === other.rounds.won && own.rounds.won >= 12) outcome = 'draw';
  }
  return { id: m.metadata.match_id, start: Date.parse(m.metadata.started_at), end: Date.parse(m.metadata.started_at) + m.metadata.game_length_in_ms, completed: m.metadata.is_completed, competitive: m.metadata.queue.id === 'competitive', outcome };
}
function coverage(matches: Match[], updates: Update[], start: number) {
  const anchors = matches.filter(m => m.competitive && m.completed && m.end <= start && updates.some(e => e.match_id === m.id));
  const cutoff = anchors.length ? Math.max(...anchors.map(m => m.start)) : Infinity;
  const ids = new Set(matches.filter(m => m.competitive && m.completed).map(m => m.id));
  return { anchored: anchors.length > 0, missing: updates.filter(e => Date.parse(e.date) >= cutoff && !ids.has(e.match_id)) };
}
export class HenrikProvider implements ValorantProvider {
  constructor(private c: Config, private session: string) {}
  private get(path: string, cost = 3) {
    return henrikBudget(this.c.HENRIK_API_KEY).run(cost, observe => json(`https://api.henrikdev.xyz/valorant/${path}`, { headers: { Authorization: this.c.HENRIK_API_KEY } }, observe));
  }
  private async identity() {
    const account = await cache.get(`account:${JSON.stringify([this.c.VALORANT_NAME,this.c.VALORANT_TAG])}`, 3600000, async () => z.object({ status: z.literal(200), data: z.object({ puuid: z.string().min(1) }) }).parse(await this.get(`v2/account/${encodeURIComponent(this.c.VALORANT_NAME)}/${encodeURIComponent(this.c.VALORANT_TAG)}`)).data);
    // Account metadata does not override the region explicitly requested in the URL.
    return account.puuid;
  }
  async rank() {
    const id = await this.identity();
    return cache.get(`rank:${this.c.VALORANT_REGION}:${this.c.VALORANT_PLATFORM}:${id}`, REFRESH, async () => {
      const data = z.object({ status: z.literal(200), data: z.object({ account: z.object({ puuid: z.string() }), current: z.object({ tier: z.object({ name: z.string().min(1) }), rr: integer, games_needed_for_rating: integer.nonnegative() }) }) }).parse(await this.get(`v3/by-puuid/mmr/${this.c.VALORANT_REGION}/${this.c.VALORANT_PLATFORM}/${encodeURIComponent(id)}`)).data;
      if (data.account.puuid !== id) throw new Error('identity');
      return { name: data.current.tier.name, rr: data.current.rr, placements: data.current.games_needed_for_rating };
    });
  }
  async history(start: number) {
    const id = await this.identity(); const base = `${this.c.VALORANT_REGION}/${this.c.VALORANT_PLATFORM}/${encodeURIComponent(id)}`;
    const key = `${base}:${this.session}:${start}`;
    return cache.get(`history:${key}`, REFRESH, async () => {
      // Fetch updates first: if they are unavailable we cannot establish coverage,
      // so do not spend quota downloading full-match pages.
      const fresh = await cache.get(`mmr:${key}`, REFRESH, async () => {
        const data = mmrSchema.parse(await this.get(`v2/by-puuid/mmr-history/${base}`)).data;
        if (data.account.puuid !== id) throw new Error('identity'); return data.history;
      });
      const retained = await cache.get(`completed:${base}`, DAY, async () => new Map<string, RawMatch>());
      const session = ledger(key);
      for (const e of fresh) session.updates.set(e.match_id, e);
      const updates = [...session.updates.values()];
      const save = (m: RawMatch) => {
        if (!m.players.some(p => p.puuid === id)) throw new Error('identity');
        session.matches.set(m.metadata.match_id, m);
        if (m.metadata.is_completed) {
          retained.set(m.metadata.match_id, m);
          if (retained.size > 500) retained.delete(retained.keys().next().value!);
        }
      };
      // Reuse only details linked to this session's live update IDs.
      for (const e of updates) { const m = retained.get(e.match_id); if (m) session.matches.set(e.match_id, m); }
      const normalized = () => [...session.matches.values()].map(m => normalize(m, id));
      let complete = false;
      for (let offset = 0; offset < 100;) {
        // Always read the front page on refresh to discover newly completed games,
        // including outcomes with delayed/missing MMR updates.
        const pageKey = offset === 0 ? `front:${key}` : `page:${key}:${session.scan?.head}:${offset}`;
        const page = await cache.get(pageKey, REFRESH, async () => historySchema.parse(await this.get(`v4/by-puuid/matches/${base}?mode=competitive&size=${PAGE_SIZE}&start=${offset}`, PAGE_SIZE + 2)).data);
        if (offset === 0) {
          const head = JSON.stringify(page.map(m => m.metadata.match_id).sort());
          // Resume a quota-interrupted scan only if the live head is unchanged.
          // If new matches shift offsets, start a new traversal from the front.
          if (session.scan?.head !== head) session.scan = { head, next: PAGE_SIZE, visited: new Set() };
        }
        const scan = session.scan!;
        for (const m of page) scan.visited.add(m.metadata.match_id);
        for (const m of page) save(m);
        let proof = coverage(normalized(), updates, start);
        const boundary = [...scan.visited].some(matchId => {
          const m = normalize(session.matches.get(matchId)!, id);
          return m.completed && m.competitive && (session.covered.has(matchId) || (m.end <= start && updates.some(e => e.match_id === matchId)));
        });
        if (boundary && proof.anchored) {
          // The update IDs tell us exactly which details are missing. Download only
          // those matches, rather than traversing pages of already known matches.
          for (const e of proof.missing) {
            const m = z.object({ status: z.literal(200), data: matchSchema }).parse(await this.get(`v4/match/${this.c.VALORANT_REGION}/${encodeURIComponent(e.match_id)}`, 2)).data;
            if (m.metadata.match_id !== e.match_id) throw new Error('match identity');
            save(m);
          }
          proof = coverage(normalized(), updates, start);
          complete = proof.anchored && proof.missing.length === 0;
          if (complete) { for (const m of normalized()) if (m.completed) session.covered.add(m.id); session.scan = undefined; }
          break;
        }
        // Without a pre-stream update, further pagination cannot certify coverage.
        if (page.length < PAGE_SIZE || !updates.some(e => Date.parse(e.date) <= start)) break;
        offset = offset === 0 ? scan.next : offset + PAGE_SIZE;
        scan.next = offset;
      }
      const mmr: Mmr[] = updates.map(e => ({ id: e.match_id, start: Date.parse(e.date), delta: e.is_placement_match === false && e.tier.id > 0 ? e.last_change : null }));
      return { matches: normalized(), mmr, complete };
    });
  }
}

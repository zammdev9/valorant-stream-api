import { describe, it, expect } from 'vitest';
import { calculate, calculateStats, formatStreamRecord } from '../src/lib/record-calculator';
import { record } from '../src/lib/service';
import type { Match, Mmr, ValorantProvider } from '../src/lib/types';
const start = 1000, now = 10000;
const match = (id = 'a', outcome: Match['outcome'] = 'win', end = 2000): Match => ({ id, outcome, start: end - 1500, end, completed: true, competitive: true });
const rr = (id = 'a', delta: number | null = 20): Mmr => ({ id, delta, start: 500 });
const calc = (matches: Match[], mmr: Mmr[] = [], complete = true) => calculate(start, matches, mmr, complete, now);
describe('stream calculation', () => {
  it('empty record', () => expect(calc([])).toBe('Stream Record: 0W-0L | 0 RR'));
  it('one win', () => expect(calc([match()], [rr()])).toBe('Stream Record: 1W-0L | +20 RR'));
  it('one loss', () => expect(calc([match('a','loss')], [rr('a',-21)])).toBe('Stream Record: 0W-1L | -21 RR'));
  it.each([74,-43,0])('sums actual deltas %s across promotion/demotion', delta => expect(calc([match('a'),match('b','loss')], [rr('a',100),rr('b',delta-100)])).toBe(`Stream Record: 1W-1L | ${delta>0?'+':''}${delta} RR`));
  it('result independent of RR sign', () => expect(calc([match()], [rr('a',-5)])).toContain('1W-0L | -5'));
  it('excludes earlier games and exact boundary', () => expect(calc([match('a','win',999),match('b','loss',1000)])).toContain('0W-0L | 0'));
  it('includes game starting before stream and finishing after', () => expect(calc([match()], [rr()])).toContain('1W-0L'));
  it('deduplicates', () => expect(calc([match(),match()], [rr(),rr()])).toContain('1W-0L | +20'));
  it('rejects conflicting duplicates', () => expect(calc([match(),match('a','loss')])).toContain('conflicting'));
  it('missing MMR preserves verified W/L', () => expect(calc([match()])).toContain('1W-0L | RR unavailable'));
  it('placements/reset do not invent zero RR', () => expect(calc([match()], [rr('a',null)])).toContain('RR unavailable'));
  it('draws', () => expect(calc([match('a','draw')], [rr('a',0)])).toBe('Stream Record: 0W-0L-1D | 0 RR'));
  it('ambiguous remake is unavailable', () => expect(calc([match('a','unknown')])).toContain('possible remake'));
  it('incomplete history', () => expect(calc([],[],false)).toContain('incomplete'));
  it('out of order', () => expect(calc([match('b','loss',3000),match()], [rr('a',25),rr('b',-20)])).toContain('1W-1L | +5'));
  it('excludes incomplete/noncompetitive/future games', () => expect(calc([{...match(),completed:false},{...match('b'),competitive:false},match('c','win',11000)])).toContain('0W-0L'));
  it('offline does not fetch', async () => expect(await record(null, { history: () => { throw Error('called'); } } as unknown as ValorantProvider)).toBe('Streamer is currently offline.'));
  it('restart uses new boundary', () => expect(calculate(3000,[match()], [rr()],true,now)).toContain('0W-0L'));
});
describe('bot record wording', () => {
  it.each([
    [74, 'streamer is currently up 74R (going 1W-1L) since the stream started'],
    [-43, 'streamer is currently down 43R (going 1W-1L) since the stream started'],
    [0, 'streamer is currently even 0R (going 1W-1L) since the stream started'],
  ])('formats net RR %s without inventing result direction', (delta, expected) => {
    const stats = calculateStats(start, [match(),match('b','loss')], [rr('a',100),rr('b',delta-100)],true,now);
    expect(formatStreamRecord('streamer',stats)).toBe(expected);
  });
  it('keeps unknown RR explicit',()=> expect(formatStreamRecord('friend',calculateStats(start,[match()],[],true,now))).toBe('friend is currently going 1W-0L since the stream started (RR unavailable)'));
  it('includes draws without treating them as losses',()=> expect(formatStreamRecord('friend',calculateStats(start,[match('a','draw')],[rr('a',0)],true,now))).toBe('friend is currently even 0R (going 0W-0L-1D) since the stream started'));
  it('does not format incomplete data as a record',()=> expect(formatStreamRecord('friend',calculateStats(start,[],[],false,now))).toBe('friend: Stream record unavailable: incomplete match history.'));
});

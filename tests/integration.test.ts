import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { command } from '../src/lib/public-api';
import { HenrikProvider } from '../src/lib/valorant';
import { stream } from '../src/lib/twitch';
import { Cache } from '../src/lib/cache';
const cfg = { HENRIK_API_KEY: 'private', TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'secret', TWITCH_USERNAME: 'streamer', VALORANT_REGION: 'na' as const, VALORANT_NAME: 'name', VALORANT_TAG: 'tag', VALORANT_PLATFORM: 'pc' as const };
let key = 0;
beforeEach(() => { cfg.HENRIK_API_KEY = `private-test-${++key}`; });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
it('missing credentials returns sanitized plain text', async () => {
  vi.stubEnv('HENRIK_API_KEY',''); const r = await command('record', { name: 'name', tag: 'tag', region: 'na', twitch: 'streamer' }); expect(r.status).toBe(503); expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8'); expect(await r.text()).toBe('Stats are temporarily unavailable. Please try again shortly.'); expect(r.headers.get('x-statistics-error')).toBe('configuration');
});
it('Twitch outage propagates without invented statistics', async () => { vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('secret'))); await expect(stream({...cfg,TWITCH_USERNAME:'outage'})).rejects.toThrow('upstream'); });
it('Henrik outage propagates', async () => { vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:500}))); await expect(new HenrikProvider({...cfg,VALORANT_NAME:'outage'},'a').rank()).rejects.toThrow('upstream'); });
it('coalesces concurrent requests and evicts failures', async () => { const c = new Cache(); const load = vi.fn(async()=>42); expect(await Promise.all([c.get('a',60000,load),c.get('a',60000,load)])).toEqual([42,42]); expect(load).toHaveBeenCalledTimes(1); await expect(c.get('b',10,async()=>{throw Error('x')})).rejects.toThrow(); expect(await c.get('b',10,load)).toBe(42); });
it('avoids pointless pagination when MMR has no pre-stream anchor', async () => {
  const calls: string[] = [];
  const m = (i:number) => ({metadata:{match_id:`m${i}`,started_at:'2026-10-12T10:00:00Z',game_length_in_ms:1000,is_completed:true,queue:{id:'competitive'}},players:[{puuid:'p',team_id:'Blue'}],teams:[{team_id:'Blue',won:true,rounds:{won:13,lost:4}},{team_id:'Red',won:false,rounds:{won:4,lost:13}}]});
  vi.stubGlobal('fetch', vi.fn(async(url:string)=> { calls.push(url); const data = url.includes('/account/') ? {puuid:'p',region:'na'} : url.includes('/mmr-history/') ? {account:{puuid:'p'},history:[]} : url.includes('start=0') ? Array.from({length:3},(_,i)=>m(i)) : []; return Response.json({status:200,data}); }));
  const h = await new HenrikProvider({...cfg,VALORANT_NAME:'pagination'},'session').history(Date.parse('2026-10-12T09:00:00Z'));
  expect(calls.filter(u=>u.includes('/matches/'))).toHaveLength(1); expect(h.complete).toBe(false); expect(h.matches).toHaveLength(3);
});
it('reuses token, refreshes on expiry, and detects a stream restart after TTL', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  let grants = 0, session = 1;
  const c = {...cfg,TWITCH_CLIENT_ID:'expiry-test',TWITCH_USERNAME:'restart'};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> {
    if (url.includes('oauth2/token')) { grants++; return Response.json({access_token:`token${grants}`,expires_in:120}); }
    return Response.json({data:[{id:`s${session}`,user_login:'restart',started_at:session===1?'2026-10-12T10:00:00Z':'2026-10-12T12:00:00Z'}]});
  }));
  expect((await stream(c))?.id).toBe('s1');
  session=2; vi.advanceTimersByTime(31000);
  expect((await stream(c))?.id).toBe('s2'); expect(grants).toBe(1);
  vi.advanceTimersByTime(90000); await stream(c); expect(grants).toBe(2);
});
it('401 reacquires an app token exactly once', async () => {
  let calls = 0;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> {
    if(url.includes('oauth2/token')) return Response.json({access_token:'token',expires_in:3600});
    calls++; return calls===1?new Response('{}',{status:401}):Response.json({data:[]});
  }));
  expect(await stream({...cfg,TWITCH_CLIENT_ID:'retry',TWITCH_USERNAME:'retry'})).toBeNull(); expect(calls).toBe(2);
});
it('rank uses current endpoint and does not read historical ranks', async () => {
  const c={...cfg,VALORANT_NAME:'current-rank'};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json({status:200,data:url.includes('/account/')?{puuid:'rank-p',region:'na'}:{account:{puuid:'rank-p'},current:{tier:{name:'Ascendant 2'},rr:67,games_needed_for_rating:0}}})));
  expect(await new HenrikProvider(c,'rank').rank()).toEqual({name:'Ascendant 2',rr:67,placements:0});
});
it('independent update IDs reveal omitted full match details', async () => {
  const start=Date.parse('2026-10-12T09:00:00Z');
  const anchor={metadata:{match_id:'anchor',started_at:'2026-10-12T08:00:00Z',game_length_in_ms:1000,is_completed:true,queue:{id:'competitive'}},players:[{puuid:'coverage-p',team_id:'Blue'}],teams:[{team_id:'Blue',won:true,rounds:{won:13,lost:4}},{team_id:'Red',won:false,rounds:{won:4,lost:13}}]};
  let missing=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> {
    if(url.includes('/v4/match/')) return new Response('{}',{status:404});
    const data=url.includes('/account/')?{puuid:'coverage-p',region:'na'}:url.includes('/mmr-history/')?{account:{puuid:'coverage-p'},history:[{match_id:'anchor',date:'2026-10-12T08:00:00Z',last_change:20,tier:{id:20},is_placement_match:false},...(missing?[{match_id:'omitted',date:'2026-10-12T10:00:00Z',last_change:10,tier:{id:20},is_placement_match:false}]:[])]}:[anchor];
    return Response.json({status:200,data});
  }));
  expect((await new HenrikProvider({...cfg,VALORANT_NAME:'coverage'},'complete').history(start)).complete).toBe(true);
  missing=true;
  await expect(new HenrikProvider({...cfg,VALORANT_NAME:'coverage'},'missing').history(start)).rejects.toThrow('upstream');
});

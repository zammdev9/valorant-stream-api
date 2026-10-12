import { beforeEach, afterEach, expect, it, vi } from 'vitest';
let HenrikProvider: typeof import('../src/lib/valorant')['HenrikProvider'];
beforeEach(async () => { vi.resetModules(); HenrikProvider = (await import('../src/lib/valorant')).HenrikProvider; });
import { calculate } from '../src/lib/record-calculator';
const start=Date.parse('2026-10-12T09:00:00Z');
const cfg = (name:string) => ({HENRIK_API_KEY:name,TWITCH_CLIENT_ID:'id',TWITCH_CLIENT_SECRET:'secret',TWITCH_USERNAME:'streamer',VALORANT_REGION:'na' as const,VALORANT_PLATFORM:'pc' as const,VALORANT_NAME:name,VALORANT_TAG:'tag'});
const m=(id:string,hour=10)=>({metadata:{match_id:id,started_at:`2026-10-12T${hour.toString().padStart(2,'0')}:00:00Z`,game_length_in_ms:1000,is_completed:true,queue:{id:'competitive'}},players:[{puuid:'player',team_id:'Blue'}],teams:[{team_id:'Blue',won:true,rounds:{won:13,lost:4}},{team_id:'Red',won:false,rounds:{won:4,lost:13}}]});
const u=(id:string,hour=10)=>({match_id:id,date:`2026-10-12T${hour.toString().padStart(2,'0')}:00:00Z`,last_change:20,tier:{id:20},is_placement_match:false});
afterEach(()=> { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('stops after a full front page when coverage is verified, and reuses data for two minutes',async()=> {
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> { calls.push(url); const data=url.includes('/account/')?{puuid:'player',region:'na'}:url.includes('/mmr-history/')?{account:{puuid:'player'},history:[u('anchor',8),u('one'),u('two',11)]}:[m('two',11),m('anchor',8),m('one')]; return Response.json({status:200,data}); }));
  const p=new HenrikProvider(cfg('early-stop'),'a');
  expect((await p.history(start)).complete).toBe(true); await p.history(start);
  expect(calls).toHaveLength(3); expect(calls.filter(x=>x.includes('/matches/'))).toHaveLength(1);
});
it('retains completed games and RR when they fall out of the live window',async()=> {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T14:00:00Z')); let refresh=false;
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> { calls.push(url); const data=url.includes('/account/')?{puuid:'player',region:'na'}:url.includes('/mmr-history/')?{account:{puuid:'player'},history:refresh?[u('two',11)]:[u('anchor',8),u('one')]}:refresh?[m('two',11),m('one')]:[m('anchor',8),m('one')]; return Response.json({status:200,data}); }));
  const p=new HenrikProvider(cfg('retain'),'a'); await p.history(start); refresh=true; vi.advanceTimersByTime(120001);
  const h=await p.history(start); expect(h.complete).toBe(true); expect(calculate(start,h.matches,h.mmr,h.complete)).toBe('Stream Record: 2W-0L | +40 RR');
  expect(calls.filter(x=>x.includes('/v4/match/'))).toHaveLength(0);
});
it('verifies a pre-stream start that finishes during the stream before accepting an older anchor',async()=> {
  const calls:string[]=[]; const overlap={...m('overlap',8),metadata:{...m('overlap',8).metadata,game_length_in_ms:4000000}};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> { calls.push(url); const data=url.includes('/account/')?{puuid:'player',region:'na'}:url.includes('/mmr-history/')?{account:{puuid:'player'},history:[u('overlap',8),u('older',7),u('one')]}:[m('one'),overlap,m('older',7)]; return Response.json({status:200,data}); }));
  const h=await new HenrikProvider(cfg('targeted'),'a').history(start); expect(h.complete).toBe(true);
  expect(calculate(start,h.matches,h.mmr,true,Date.parse('2026-10-12T14:00:00Z'))).toContain('2W-0L | +40');
  expect(calls.filter(x=>x.includes('/matches/'))).toHaveLength(1); expect(calls.filter(x=>x.includes('/v4/match/'))).toHaveLength(0);
});
it('backfill stops at quota and resumes with retained details without publishing a partial record',async()=> {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T14:00:00Z')); const calls:string[]=[];
  const updates=[u('anchor',8),...Array.from({length:20},(_,i)=>u(`id${i}`))];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> { calls.push(url); const data=url.includes('/account/')?{puuid:'player',region:'na'}:url.includes('/mmr-history/')?{account:{puuid:'player'},history:updates}:url.includes('/v4/match/')?m(url.split('/').at(-1)!):[m('anchor',8)]; return Response.json({status:200,data}); }));
  const p=new HenrikProvider(cfg('backfill'),'a'); await expect(p.history(start)).rejects.toMatchObject({status:429});
  const before=calls.filter(x=>x.includes('/v4/match/')).length; expect(before).toBe(8); // 3+3+5+8*2=27
  vi.advanceTimersByTime(60001); expect((await p.history(start)).complete).toBe(true);
  expect(calls.filter(x=>x.includes('/v4/match/'))).toHaveLength(20);
});
it('scans to a live boundary on cold start so games missing MMR beyond the front page are counted',async()=> {
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> {
    calls.push(url);
    const data=url.includes('/account/')?{puuid:'player',region:'na'}:url.includes('/mmr-history/')?{account:{puuid:'player'},history:[u('anchor',8),u('one'),u('two'),u('three')]}:
      url.includes('start=0')?[m('one'),m('two'),m('three')]:[m('missing'),m('anchor',8)];
    return Response.json({status:200,data});
  }));
  const h=await new HenrikProvider(cfg('cold-boundary'),'a').history(start);
  expect(h.complete).toBe(true); expect(calculate(start,h.matches,h.mmr,h.complete,Date.parse('2026-10-12T14:00:00Z'))).toBe('Stream Record: 4W-0L | RR unavailable');
  expect(calls.filter(x=>x.includes('/matches/'))).toHaveLength(2);
});
it('resumes a quota-interrupted live pagination scan without downloading its prefix again',async()=> {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T14:00:00Z'));
  const calls:string[]=[]; const games=[...Array.from({length:24},(_,i)=>m(`g${i}`)),m('anchor',8)];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> {
    calls.push(url);
    const offset=Number(new URL(url).searchParams.get('start'));
    const data=url.includes('/account/')?{puuid:'player',region:'na'}:url.includes('/mmr-history/')?{account:{puuid:'player'},history:[...Array.from({length:24},(_,i)=>u(`g${i}`)),u('anchor',8)]}:games.slice(offset,offset+3);
    return Response.json({status:200,data});
  }));
  const p=new HenrikProvider(cfg('resume-pages'),'a'); await expect(p.history(start)).rejects.toMatchObject({status:429});
  expect(calls.filter(x=>x.includes('/matches/'))).toHaveLength(4);
  vi.advanceTimersByTime(60001); const h=await p.history(start); expect(h.complete).toBe(true);
  expect(calls.filter(x=>x.includes('/matches/'))).toHaveLength(9);
  expect(calculate(start,h.matches,h.mmr,h.complete)).toBe('Stream Record: 24W-0L | +480 RR');
});
it('new stream reuses match details but filters its own time boundary',async()=> {
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> { calls.push(url); const data=url.includes('/account/')?{puuid:'player',region:'na'}:url.includes('/mmr-history/')?{account:{puuid:'player'},history:[u('anchor',8),u('one')]}:[m('anchor',8),m('one')]; return Response.json({status:200,data}); }));
  const c=cfg('new-session'); await new HenrikProvider(c,'old').history(start);
  const boundary=Date.parse('2026-10-12T11:00:00Z'); const h=await new HenrikProvider(c,'new').history(boundary);
  expect(calculate(boundary,h.matches,h.mmr,h.complete)).toBe('Stream Record: 0W-0L | 0 RR');
});

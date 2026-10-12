import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseInput, pathInput, queryInput } from '../src/lib/request-input';
let paths: typeof import('../src/app/api/[command]/[...segments]/route');
let rank: typeof import('../src/app/api/rank/route');
let record: typeof import('../src/app/api/record/route');
beforeEach(async()=> {
  vi.resetModules();
  vi.stubEnv('HENRIK_API_KEY','route-test-key');
  vi.stubEnv('TWITCH_CLIENT_ID','client'); vi.stubEnv('TWITCH_CLIENT_SECRET','secret');
  paths=await import('../src/app/api/[command]/[...segments]/route');
  rank=await import('../src/app/api/rank/route'); record=await import('../src/app/api/record/route');
});
afterEach(()=> {vi.unstubAllGlobals();vi.unstubAllEnvs();});
const request=(suffix:string)=>new Request(`https://example.com${suffix}`);
const call=(kind:string,segments:string[],query='')=>paths.GET(request(`/api/${kind}/example${query}`),{params:Promise.resolve({command:kind,segments})});
function mockRank(region='na') {
  return vi.fn(async(url:string)=>Response.json({status:200,data:url.includes('/account/')?{puuid:url.includes('Other')?'other':'player',region}:{account:{puuid:url.includes('other')?'other':'player'},current:{tier:{name:url.includes('other')?'Gold 1':'Ascendant 2'},rr:67,games_needed_for_rating:0}}}));
}
it('path command supports the four-segment structure with PC default',async()=> {
  const fetch=mockRank(); vi.stubGlobal('fetch',fetch);
  const r=await call('rank',['My Name','1234','na','Streamer']);
  expect(r.status).toBe(200);expect(await r.text()).toBe('Current Rank: Ascendant 2 | 67 RR');
  expect(fetch.mock.calls[0][0]).toContain('/account/My%20Name/1234');
  expect(fetch.mock.calls[1][0]).toContain('/mmr/na/pc/player');
});
it('supplies platform in the path query and optionally prefixes bot output',async()=> {
  const fetch=mockRank('eu'); vi.stubGlobal('fetch',fetch);
  const r=await call('rank',['My Name','1234','eu','Streamer'],'?platform=console&showUser=true');
  expect(await r.text()).toBe('streamer: Current Rank: Ascendant 2 | 67 RR');
  expect(fetch.mock.calls[1][0]).toContain('/mmr/eu/console/player');
});
it('supports explicit platform before Twitch username in a five-segment path',async()=> {
  const fetch=mockRank(); vi.stubGlobal('fetch',fetch);
  const r=await call('rank',['My Name','1234','NA','CONSOLE','Streamer']);
  expect(r.status).toBe(200);expect(fetch.mock.calls[1][0]).toContain('/mmr/na/console/player');
});
it('rank accepts no Twitch username or Twitch credentials',async()=> {
  vi.stubEnv('TWITCH_CLIENT_ID','');vi.stubEnv('TWITCH_CLIENT_SECRET','');vi.stubGlobal('fetch',mockRank());
  expect((await call('rank',['My Name','1234','na'])).status).toBe(200);
});
it('query routes use URL identity instead of environment defaults',async()=> {
  vi.stubEnv('VALORANT_NAME','Env Player');vi.stubEnv('VALORANT_TAG','EnvTag');
  const fetch=mockRank('br');vi.stubGlobal('fetch',fetch);
  const r=await rank.GET(request('/api/rank?name=Other&tag=TAG&region=br&platform=console'));
  expect(await r.text()).toBe('Current Rank: Gold 1 | 67 RR');
  expect(fetch.mock.calls[0][0]).toContain('/account/Other/TAG');
});
it('different player URLs have separate caches while output variants reuse provider data',async()=> {
  const fetch=mockRank();vi.stubGlobal('fetch',fetch);
  await call('rank',['First','TAG','na','streamer']);
  const other=await call('rank',['Other','TAG','na','streamer']);expect(await other.text()).toContain('Gold 1');
  const prefixed=await call('rank',['First','TAG','na','streamer'],'?showUser=true');expect(await prefixed.text()).toContain('streamer:');
  expect(fetch).toHaveBeenCalledTimes(4);
});
it('uses the URL region even when account metadata reports a different region',async()=> {
  const fetch=mockRank('kr');vi.stubGlobal('fetch',fetch);
  const response=await call('rank',['ENVY Eggsterr','NJLTC','na','eggsterr']);
  expect(response.status).toBe(200);expect(await response.text()).toContain('Ascendant 2');
  expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][0]).toContain('/mmr/na/pc/player');
});
it('keeps distinct Riot IDs separate when the corrected name adds a letter',async()=> {
  const fetch=mockRank('kr');vi.stubGlobal('fetch',fetch);
  await call('rank',['ENVY Eggster','NJLTC','na','eggsterr']);
  await call('rank',['ENVY Eggsterr','NJLTC','na','eggsterr']);
  const lookups=fetch.mock.calls.filter(([url])=>url.includes('/account/')).map(([url])=>url);
  expect(lookups).toHaveLength(2);
  expect(lookups[0]).toContain('/account/ENVY%20Eggster/NJLTC');
  expect(lookups[1]).toContain('/account/ENVY%20Eggsterr/NJLTC');
});
it('record uses URL Twitch username and returns prefixed offline status without Henrik calls',async()=> {
  const urls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> {urls.push(url);return Response.json(url.includes('oauth2/token')?{access_token:'token',expires_in:3600}:{data:[]});}));
  const r=await call('record',['My Name','1234','na','URLStreamer'],'?showUser=true');
  expect(await r.text()).toBe('urlstreamer: Streamer is currently offline.');
  expect(urls[1]).toContain('user_login=urlstreamer');expect(urls.some(u=>u.includes('henrikdev'))).toBe(false);
});
it('live record uses the requested sentence and does not duplicate the username with showUser',async()=> {
  const match=(id:string,hour:string)=>({metadata:{match_id:id,started_at:`2020-01-01T${hour}:00:00Z`,game_length_in_ms:60000,is_completed:true,queue:{id:'competitive'}},players:[{puuid:'player',team_id:'Blue'}],teams:[{team_id:'Blue',won:true,rounds:{won:13,lost:4}},{team_id:'Red',won:false,rounds:{won:4,lost:13}}]});
  const update=(id:string,hour:string,delta:number)=>({match_id:id,date:`2020-01-01T${hour}:00:00Z`,last_change:delta,tier:{id:20},is_placement_match:false});
  const fetch=vi.fn(async(url:string)=> {
    if(url.includes('oauth2/token')) return Response.json({access_token:'token',expires_in:3600});
    if(url.includes('helix/streams')) return Response.json({data:[{id:'active',started_at:'2020-01-01T10:00:00Z',user_login:'streamer'}]});
    const data=url.includes('/account/')?{puuid:'player',region:'kr'}:url.includes('/mmr-history/')?{account:{puuid:'player'},history:[update('anchor','09',20),update('win','11',-43)]}:[match('win','11'),match('anchor','09')];
    return Response.json({status:200,data});
  });
  vi.stubGlobal('fetch',fetch);
  for(const query of ['','?showUser=true']) {
    const response=await call('record',['Name','TAG','na','Streamer'],query);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('streamer is currently down 43R (going 1W-0L) since the stream started');
  }
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(fetch.mock.calls.filter(([url])=>url.includes('/mmr-history/')||url.includes('/matches/')).every(([url])=>url.includes('/na/pc/'))).toBe(true);
});
it.each([
  ['record',['Name','TAG','na'],''],
  ['rank',['Name','TAG','invalid','streamer'],''],
  ['rank',['Name','TAG','na','streamer'],'?platform=mobile'],
  ['rank',['Name','TAG','na','bad user'],''],
  ['rank',['Name','TAG','na'],'?showUser=true'],
  ['rank',['Name','TAG','na','streamer'],'?showUser=maybe'],
  ['rank',['Name/Other','TAG','na','streamer'],''],
  ['unknown',['Name','TAG','na','streamer'],''],
  ['rank',['Name','TAG'],''],
])('rejects invalid URL input before contacting providers: %s %s %s',async(kind,segments,query)=> {
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const r=await call(kind,segments,query);expect(r.status).toBe(400);expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8');expect(fetch).not.toHaveBeenCalled();
});
it('query record requires a Twitch username in the URL',async()=> {
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const r=await record.GET(request('/api/record?name=Name&tag=TAG&region=na'));
  expect(r.status).toBe(400);expect(await r.text()).toContain('Twitch username is required');expect(fetch).not.toHaveBeenCalled();
});
it('query parsing decodes Unicode, spaces, and percent signs exactly once',()=> {
  const input=queryInput(request('/api/rank?name=%E7%8E%A9%E5%AE%B6%20%2520&tag=TAG&region=na'));
  expect(parseInput('rank',input).player.VALORANT_NAME).toBe('玩家 %20');
  expect(pathInput(request('/x?platform=console&twitch=streamer'),['Name','TAG','na']).platform).toBe('console');
});

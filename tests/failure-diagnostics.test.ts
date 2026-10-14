import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let command: typeof import('../src/lib/public-api')['command'];
const input = { name: 'ghostie', tag: '8888', region: 'na' };
beforeEach(async()=> {
  vi.resetModules();vi.stubEnv('HENRIK_API_KEY','private-diagnostic-key');
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  command=(await import('../src/lib/public-api')).command;
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it.each([
  ['http_503',()=>Promise.resolve(new Response('private-provider-body',{status:503}))],
  ['invalid_response',()=>Promise.resolve(Response.json({status:200,data:{}}))],
  ['network',()=>Promise.reject(new Error('private-network-error'))],
  ['timeout',()=>Promise.reject(new DOMException('private-timeout-error','TimeoutError'))],
  ['http_401',()=>Promise.resolve(new Response('private-provider-body',{status:401}))],
] as const)('identifies Henrik %s in diagnostics while showing a friendly message',async(reason,load)=> {
  vi.stubGlobal('fetch',vi.fn(load));const response=await command('rank',input);const body=await response.text();
  expect(response.status).toBe(503);expect(body).toBe('Stats are temporarily unavailable. Please try again shortly.');
  expect(response.headers.get('x-statistics-error')).toBe(`henrik_${reason}`);
  expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
  const log=JSON.parse(vi.mocked(console.warn).mock.calls[0][0]);
  expect(log.requestId).toBe(response.headers.get('x-request-id'));expect(log.code).toBe(`henrik_${reason}`);
  expect(JSON.stringify(log)+body).not.toContain('private-');expect(JSON.stringify(log)).not.toContain('Authorization');
});
it('keeps upstream rate-limit cooldowns and retry headers consistent across repeated requests',async()=> {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  const retry=new Date(Date.now()+90000).toUTCString();
  const fetch=vi.fn(async()=>new Response('private-provider-body',{status:429,headers:{'Retry-After':retry}}));vi.stubGlobal('fetch',fetch);
  for(let attempt=0;attempt<2;attempt++) {
    const r=await command('rank',input);expect(r.status).toBe(429);expect(r.headers.get('retry-after')).toBe('90');
    expect(await r.text()).toBe('Stats are temporarily unavailable. Please try again in 90 seconds.');
    expect(r.headers.get('x-statistics-error')).toBe(attempt===0?'henrik_rate_limit':'henrik_quota_guard');
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('identifies Twitch failure before issuing any Henrik requests',async()=> {
  vi.stubEnv('TWITCH_CLIENT_ID','private-client');vi.stubEnv('TWITCH_CLIENT_SECRET','private-secret');
  const fetch=vi.fn(async()=>new Response('private-body',{status:502}));vi.stubGlobal('fetch',fetch);
  const r=await command('record',{...input,twitch:'amandatsukii'});
  expect(r.status).toBe(503);expect(r.headers.get('x-statistics-error')).toBe('twitch_http_502');expect(await r.text()).toBe('Stats are temporarily unavailable. Please try again shortly.');
  expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0]).toBeDefined();
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-');
});

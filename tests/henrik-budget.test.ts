import { afterEach, expect, it, vi } from 'vitest';
import { HenrikBudget } from '../src/lib/henrik-budget';
afterEach(() => vi.useRealTimers());
it('reserves background costs and refuses to exceed 27 units per rolling minute', async () => {
  vi.useFakeTimers();
  const b = new HenrikBudget(); const load = vi.fn(async()=>1);
  for(let i=0;i<5;i++) await b.run(5,load);
  await expect(b.run(3,load)).rejects.toMatchObject({status:429});
  expect(load).toHaveBeenCalledTimes(5);
  vi.advanceTimersByTime(60001); expect(await b.run(5,load)).toBe(1);
});
it('backs off before a request would consume the provider reserve', async () => {
  vi.useFakeTimers();
  const b=new HenrikBudget();
  await b.run(3,async observe=>observe(new Headers({'X-RateLimit-Remaining':'7','X-RateLimit-Reset':'20'}),200));
  const load=vi.fn(async()=>1);
  await expect(b.run(5,load)).rejects.toMatchObject({status:429}); expect(load).not.toHaveBeenCalled();
  vi.advanceTimersByTime(20001); expect(await b.run(5,load)).toBe(1);
});
it('serializes concurrent requests so remaining quota is not oversubscribed', async () => {
  const b=new HenrikBudget(); const calls: string[]=[];
  const first=b.run(3,async observe=> { calls.push('first'); await Promise.resolve(); observe(new Headers({'X-RateLimit-Remaining':'3'}),200); });
  const second=b.run(3,async()=> { calls.push('second'); });
  await first; await expect(second).rejects.toMatchObject({status:429}); expect(calls).toEqual(['first']);
});
it.each(['90',new Date(Date.now()+90000).toUTCString()])('honors 429 Retry-After %s',async retry=> {
  vi.useFakeTimers();
  const b=new HenrikBudget();
  await b.run(3,async observe=>observe(new Headers({'Retry-After':retry}),429));
  vi.advanceTimersByTime(60001);
  const load=vi.fn(async()=>1); await expect(b.run(3,load)).rejects.toMatchObject({status:429}); expect(load).not.toHaveBeenCalled();
  vi.advanceTimersByTime(31000); expect(await b.run(3,load)).toBe(1);
});
it('counts failed upstream attempts against the local budget', async()=> {
  const b=new HenrikBudget(); const load=vi.fn(async()=>{throw Error('outage')});
  for(let i=0;i<9;i++) await expect(b.run(3,load)).rejects.toThrow('outage');
  await expect(b.run(3,load)).rejects.toMatchObject({status:429}); expect(load).toHaveBeenCalledTimes(9);
});
it('reports the wait until enough reservations expire for the blocked operation',async()=> {
  vi.useFakeTimers();const b=new HenrikBudget();
  for(let i=0;i<5;i++) { await b.run(5,async()=>1); if(i<4) vi.advanceTimersByTime(10000); }
  await expect(b.run(12,async()=>1)).rejects.toMatchObject({status:429,details:{operation:'quota_guard',retryAfterSeconds:30}});
  vi.advanceTimersByTime(30000);expect(await b.run(12,async()=>42)).toBe(42);
});

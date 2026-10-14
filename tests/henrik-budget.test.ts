import { afterEach, expect, it, vi } from 'vitest';
import { HenrikBudget } from '../src/lib/henrik-budget';
afterEach(() => vi.useRealTimers());
it('falls back to conservative background estimates when quota headers are missing', async () => {
  vi.useFakeTimers();
  const b = new HenrikBudget(); const load = vi.fn(async()=>1);
  for(let i=0;i<5;i++) await b.run(5,load);
  await expect(b.run(3,load)).rejects.toMatchObject({status:429});
  expect(load).toHaveBeenCalledTimes(5);
  vi.advanceTimersByTime(60001); expect(await b.run(5,load)).toBe(1);
});
it('uses reported remaining quota instead of rejecting a hypothetical worst-case cost', async () => {
  vi.useFakeTimers();
  const b=new HenrikBudget();
  await b.run(3,async observe=>observe(new Headers({'X-RateLimit-Remaining':'7','X-RateLimit-Reset':'20'}),200));
  const load=vi.fn(async(observe:(headers:Headers,status:number)=>void)=> {
    observe(new Headers({'X-RateLimit-Remaining':'6','X-RateLimit-Reset':'20'}),200);return 1;
  });
  expect(await b.run(12,load)).toBe(1);expect(load).toHaveBeenCalledTimes(1);
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
it('allows a cold backfill whose estimates exceed 27 when actual quota remains available',async()=> {
  const b=new HenrikBudget();const observedRemaining=[29,28,25,22,19];let calls=0;
  for(const estimate of [3,3,12,12,7]) await b.run(estimate,async observe=> {
    observe(new Headers({'X-RateLimit-Remaining':String(observedRemaining[calls++]),'X-RateLimit-Reset':'45'}),200);
  });
  expect(calls).toBe(5);
});
it('still caps actual outgoing calls when a provider keeps reporting ample quota',async()=> {
  const b=new HenrikBudget();const load=vi.fn(async(observe:(headers:Headers,status:number)=>void)=> {
    observe(new Headers({'X-RateLimit-Remaining':'29','X-RateLimit-Reset':'60'}),200);return 1;
  });
  for(let i=0;i<27;i++) await b.run(12,load);
  await expect(b.run(12,load)).rejects.toMatchObject({status:429,details:{operation:'quota_guard'}});
  expect(load).toHaveBeenCalledTimes(27);
});
it('backs off at the reported reserve and resumes when the provider window resets',async()=> {
  vi.useFakeTimers();const b=new HenrikBudget();
  await b.run(3,async observe=>observe(new Headers({'X-RateLimit-Remaining':'3','X-RateLimit-Reset':'20'}),200));
  const load=vi.fn(async()=>1);await expect(b.run(3,load)).rejects.toMatchObject({status:429,details:{retryAfterSeconds:20}});
  expect(load).not.toHaveBeenCalled();vi.advanceTimersByTime(20001);expect(await b.run(3,load)).toBe(1);
});

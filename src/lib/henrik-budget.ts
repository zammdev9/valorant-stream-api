import { UpstreamError } from './http';

const WINDOW = 60000;
const LIMIT = 27; // Leave three units of headroom below the 30/minute plan.
type Reservation = { at: number; cost: number };

// Serialize Henrik requests so each response's quota headers govern the next call.
// This is an instance-local guard; the provider enforces the global key limit.
export class HenrikBudget {
  private reservations: Reservation[] = [];
  private remaining: number | undefined;
  private resetAt = 0;
  private pausedUntil = 0;
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(cost: number, load: (observe: (headers: Headers, status: number) => void) => Promise<T>): Promise<T> {
    const work = this.tail.then(async () => {
      const now = Date.now();
      this.reservations = this.reservations.filter(r => r.at + WINDOW > now);
      if (now >= this.resetAt) this.remaining = undefined;
      const spent = this.reservations.reduce((sum, r) => sum + r.cost, 0);
      if (now < this.pausedUntil || spent + cost > LIMIT || (this.remaining !== undefined && this.remaining < cost + 3)) {
        throw new UpstreamError(429);
      }
      // Reserve before fetch, including failed calls. Never assume a cache hit upstream.
      this.reservations.push({ at: now, cost });
      if (this.remaining !== undefined) this.remaining -= cost;
      return load((headers, status) => this.observe(headers, status));
    });
    this.tail = work.catch(() => undefined);
    return work;
  }

  private observe(headers: Headers, status: number) {
    const raw = headers.get('X-RateLimit-Remaining');
    const remaining = raw === null ? NaN : Number(raw);
    const reset = Number(headers.get('X-RateLimit-Reset'));
    if (Number.isFinite(remaining) && remaining >= 0) {
      this.remaining = remaining;
      this.resetAt = Date.now() + (Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000;
    }
    if (status === 429) {
      const retry = headers.get('Retry-After');
      const seconds = retry === null ? NaN : Number(retry);
      const date = retry === null ? NaN : Date.parse(retry);
      const until = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000
        : Number.isFinite(date) && date > Date.now() ? date
        : Date.now() + (Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000;
      this.pausedUntil = Math.max(this.pausedUntil, until);
    }
  }
}

const budgets = new Map<string, HenrikBudget>();
export function henrikBudget(key: string) {
  let budget = budgets.get(key);
  if (!budget) { budget = new HenrikBudget(); budgets.set(key, budget); }
  return budget;
}

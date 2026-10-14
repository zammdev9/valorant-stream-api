import { UpstreamError, retrySeconds } from './http';

const WINDOW = 60000;
const LIMIT = 27; // Leave three requests of headroom below the 30/minute plan.
type Reservation = { at: number; cost: number };

// Serialize Henrik requests so each response's quota headers govern the next call.
// This is an instance-local guard; the provider enforces the global key limit.
export class HenrikBudget {
  private reservations: Reservation[] = [];
  private remaining: number | undefined;
  private resetAt = 0;
  private pausedUntil = 0;
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(estimatedCost: number, load: (observe: (headers: Headers, status: number) => void) => Promise<T>): Promise<T> {
    const work = this.tail.then(async () => {
      const now = Date.now();
      this.reservations = this.reservations.filter(r => r.at + WINDOW > now);
      if (now >= this.resetAt) this.remaining = undefined;
      const spent = this.reservations.reduce((sum, r) => sum + r.cost, 0);
      // Valid provider headers account for actual background work. Do not count
      // hypothetical uncached match downloads again after that reconciliation.
      const admissionCost = this.remaining === undefined ? estimatedCost : 1;
      if (now < this.pausedUntil || spent + admissionCost > LIMIT || (this.remaining !== undefined && this.remaining <= 3)) {
        let afterExpiry = spent, reservationWait = 0;
        for (const reservation of this.reservations) {
          if (afterExpiry + admissionCost <= LIMIT) break;
          afterExpiry -= reservation.cost; reservationWait = reservation.at + WINDOW;
        }
        const waitUntil = Math.max(this.pausedUntil, this.remaining !== undefined && this.remaining <= 3 ? this.resetAt : 0, reservationWait);
        throw new UpstreamError(429, { provider: 'henrik', operation: 'quota_guard', reason: 'rate_limit', retryAfterSeconds: Math.max(1, Math.ceil((waitUntil - now) / 1000)) });
      }
      // Reserve worst-case usage until a response supplies authoritative headers.
      // Missing headers and failed requests retain this conservative fallback.
      this.reservations.push({ at: now, cost: estimatedCost });
      if (this.remaining !== undefined) this.remaining = Math.max(0, this.remaining - estimatedCost);
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
      // All preceding requests have finished because this queue is serialized.
      // The provider's remaining count covers their background costs; the local
      // rolling window now only needs to count their actual outgoing API calls.
      for (const reservation of this.reservations) reservation.cost = 1;
    }
    if (status === 429) {
      const until = Date.now() + retrySeconds(headers) * 1000;
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

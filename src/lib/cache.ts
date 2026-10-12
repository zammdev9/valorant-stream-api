type Entry = { expires: number; value: Promise<unknown> };
export class Cache {
  private entries = new Map<string, Entry>();
  async get<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const old = this.entries.get(key); if (old && old.expires > Date.now()) return old.value as Promise<T>;
    for (const [k, e] of this.entries) if (e.expires <= Date.now()) this.entries.delete(k);
    const value = Promise.resolve().then(load); const entry = { expires: Date.now() + ttl, value }; this.entries.set(key, entry);
    try { return await value; } catch (error) { if (this.entries.get(key) === entry) this.entries.delete(key); throw error; }
  }
  delete(key: string) { this.entries.delete(key); }
}
export const cache = new Cache();

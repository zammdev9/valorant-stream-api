export class UpstreamError extends Error { constructor(public status = 503) { super('upstream'); } }
// Never propagate upstream bodies: they may contain credentials or private details.
const cooldown = new Map<string, number>();
export async function json(url: string, init?: RequestInit, observe?: (headers: Headers, status: number) => void): Promise<unknown> {
  const host = new URL(url).host;
  if ((cooldown.get(host) ?? 0) > Date.now()) throw new UpstreamError(429);
  let response: Response;
  try { response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000) }); } catch { throw new UpstreamError(); }
  observe?.(response.headers, response.status);
  if (response.status === 429) {
    const raw = response.headers.get('Retry-After') ?? response.headers.get('X-RateLimit-Reset');
    const seconds = Number(raw);
    const date = raw === null ? NaN : Date.parse(raw);
    cooldown.set(host, Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : Number.isFinite(date) && date > Date.now() ? date : Date.now() + 60000);
  }
  if (!response.ok) throw new UpstreamError(response.status);
  try { return await response.json(); } catch { throw new UpstreamError(); }
}

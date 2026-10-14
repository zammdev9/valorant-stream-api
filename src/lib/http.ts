export type UpstreamDetails = {
  provider?: 'henrik' | 'twitch';
  operation?: string;
  reason?: 'rate_limit' | 'http' | 'timeout' | 'network' | 'invalid_response' | 'unexpected';
  retryAfterSeconds?: number;
};
export class UpstreamError extends Error { constructor(public status = 503, public details: UpstreamDetails = {}) { super('upstream'); } }
export function retrySeconds(headers: Headers, now = Date.now()): number {
  for (const raw of [headers.get('Retry-After'), headers.get('X-RateLimit-Reset')]) {
    if (raw === null) continue;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
    const date = Date.parse(raw);
    if (!Number.isFinite(seconds) && Number.isFinite(date) && date > now) return Math.ceil((date - now) / 1000);
  }
  return 60;
}
// Never propagate upstream bodies: they may contain credentials or private details.
const cooldown = new Map<string, number>();
export async function json(url: string, init?: RequestInit, observe?: (headers: Headers, status: number) => void): Promise<unknown> {
  const parsed = new URL(url); const host = parsed.host;
  const provider = host === 'api.henrikdev.xyz' ? 'henrik' : host === 'id.twitch.tv' || host === 'api.twitch.tv' ? 'twitch' : undefined;
  const operation = parsed.pathname.includes('/account/') ? 'account' : parsed.pathname.includes('/mmr-history/') ? 'mmr_history' : parsed.pathname.includes('/matches/') ? 'match_history' : parsed.pathname.includes('/match/') ? 'match_detail' : parsed.pathname.includes('/mmr/') ? 'current_rank' : parsed.pathname.includes('/token') ? 'token' : 'stream_status';
  const details: UpstreamDetails = { provider, operation };
  if ((cooldown.get(host) ?? 0) > Date.now()) throw new UpstreamError(429, { ...details, reason: 'rate_limit', retryAfterSeconds: Math.ceil((cooldown.get(host)! - Date.now()) / 1000) });
  let response: Response;
  try { response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000) }); }
  catch (e) { throw new UpstreamError(503, { ...details, reason: e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network' }); }
  observe?.(response.headers, response.status);
  if (response.status === 429) {
    const retryAfterSeconds = retrySeconds(response.headers);
    cooldown.set(host, Date.now() + retryAfterSeconds * 1000);
    throw new UpstreamError(429, { ...details, reason: 'rate_limit', retryAfterSeconds });
  }
  if (!response.ok) throw new UpstreamError(response.status, { ...details, reason: 'http' });
  try { return await response.json(); } catch (e) { throw new UpstreamError(503, { ...details, reason: e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'invalid_response' }); }
}

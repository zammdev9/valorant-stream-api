import { config } from './config';
import { cache } from './cache';
import { HenrikProvider } from './valorant';
import { stream } from './twitch';
import { record } from './service';
import { UpstreamError } from './http';
import { InputError, parseInput, type CommandInput } from './request-input';
import { ZodError } from 'zod';
async function dependency<T>(provider: 'henrik' | 'twitch', operation: string, load: () => Promise<T>): Promise<T> {
  try { return await load(); }
  catch (e) {
    if (e instanceof UpstreamError) throw new UpstreamError(e.status, { provider, operation, ...e.details });
    throw new UpstreamError(503, { provider, operation, reason: e instanceof ZodError || e instanceof Error && ['identity','match identity'].includes(e.message) ? 'invalid_response' : 'unexpected' });
  }
}
export function inputError(e: InputError) { return new Response(e.message, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' } }); }
export async function command(kind: 'record' | 'rank', input: CommandInput): Promise<Response> {
  let text: string; let status = 200; let retryAfter = 60;
  let errorHeaders: Record<string, string> = {};
  try {
    const { player, showUser } = parseInput(kind, input);
    const c = config(player, kind);
    const key = JSON.stringify([kind,c.TWITCH_USERNAME,c.VALORANT_REGION,c.VALORANT_PLATFORM,c.VALORANT_NAME,c.VALORANT_TAG]);
    text = await cache.get(`command:${key}`, 10000, async () => {
      if (kind === 'rank') { const r = await dependency('henrik', 'current_rank', () => new HenrikProvider(c, 'rank').rank()); return r.placements > 0 ? `Current Rank: Unranked | ${r.placements} placement matches remaining` : `Current Rank: ${r.name} | ${r.rr} RR`; }
      const active = await dependency('twitch', 'stream_status', () => stream(c));
      return dependency('henrik', 'stream_history', () => record(active, new HenrikProvider(c, active?.id ?? 'offline'), c.TWITCH_USERNAME));
    });
    if (showUser && (kind === 'rank' || text === 'Streamer is currently offline.')) text = `${c.TWITCH_USERNAME}: ${text}`;
  } catch (e) {
    if (e instanceof InputError) return inputError(e);
    status = e instanceof UpstreamError && e.status === 429 ? 429 : 503;
    text = 'Stats are temporarily unavailable. Please try again shortly.';
    const requestId = crypto.randomUUID();
    let code = e instanceof Error && e.message === 'configuration' ? 'configuration' : 'unexpected';
    if (e instanceof UpstreamError) {
      const { provider, reason, operation } = e.details;
      code = `${provider ?? 'upstream'}_${operation === 'quota_guard' ? 'quota_guard' : reason === 'http' ? `http_${e.status}` : reason ?? 'unexpected'}`;
      retryAfter = e.details.retryAfterSeconds ?? 60;
      if (status === 429) text = `Stats are temporarily unavailable. Please try again in ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}.`;
      else if (provider === 'henrik' && reason === 'http' && e.status === 404) text = "Couldn't load stats for this player. Please check the player name, tag, and region.";
    }
    errorHeaders = { 'X-Request-Id': requestId, 'X-Statistics-Error': code };
    // Log only our classifications, never raw errors, URLs, bodies or credentials.
    console.warn(JSON.stringify({ event: 'statistics_request_failed', requestId, command: kind, code, ...(e instanceof UpstreamError ? { operation: e.details.operation, upstreamStatus: e.status } : {}) }));
  }
  // Vercel's CDN absorbs repeated bot requests across instances. Errors stay uncached.
  const cdnTtl = kind === 'rank' ? 120 : 10;
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': status === 200 ? `public, s-maxage=${cdnTtl}` : 'no-store',
    ...(status !== 200 ? { 'Retry-After': String(retryAfter), ...errorHeaders } : {}) } });
}

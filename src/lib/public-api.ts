import { config } from './config';
import { cache } from './cache';
import { HenrikProvider } from './valorant';
import { stream } from './twitch';
import { record } from './service';
import { UpstreamError } from './http';
import { InputError, parseInput, type CommandInput } from './request-input';
export function inputError(e: InputError) { return new Response(e.message, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' } }); }
export async function command(kind: 'record' | 'rank', input: CommandInput): Promise<Response> {
  let text: string; let status = 200;
  try {
    const { player, showUser } = parseInput(kind, input);
    const c = config(player, kind);
    const key = JSON.stringify([kind,c.TWITCH_USERNAME,c.VALORANT_REGION,c.VALORANT_PLATFORM,c.VALORANT_NAME,c.VALORANT_TAG]);
    text = await cache.get(`command:${key}`, 10000, async () => {
      if (kind === 'rank') { const r = await new HenrikProvider(c, 'rank').rank(); return r.placements > 0 ? `Current Rank: Unranked | ${r.placements} placement matches remaining` : `Current Rank: ${r.name} | ${r.rr} RR`; }
      const active = await stream(c); return record(active, new HenrikProvider(c, active?.id ?? 'offline'), c.TWITCH_USERNAME);
    });
    if (showUser && (kind === 'rank' || text === 'Streamer is currently offline.')) text = `${c.TWITCH_USERNAME}: ${text}`;
  } catch (e) {
    if (e instanceof InputError) return inputError(e);
    status = e instanceof UpstreamError && e.status === 429 ? 429 : 503;
    text = e instanceof Error && e.message === 'configuration' ? 'Statistics unavailable: server configuration is incomplete.' : 'Statistics temporarily unavailable. Please try again later.';
  }
  // Vercel's CDN absorbs repeated bot requests across instances. Errors stay uncached.
  const cdnTtl = kind === 'rank' ? 120 : 10;
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': status === 200 ? `public, s-maxage=${cdnTtl}` : 'no-store',
    ...(status !== 200 ? { 'Retry-After': '60' } : {}) } });
}

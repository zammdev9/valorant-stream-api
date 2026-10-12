import { z } from 'zod';
import { cache } from './cache';
import type { Config } from './config';
import { json, UpstreamError } from './http';
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
const streamSchema = z.object({ data: z.array(z.object({ id: z.string(), started_at: z.iso.datetime(), user_login: z.string() })).max(1) });
export async function stream(c: Config) {
  const key = `token:${c.TWITCH_CLIENT_ID}`;
  const getToken = () => cache.get(key, 86400000, async () => {
    const token = tokenSchema.parse(await json('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: c.TWITCH_CLIENT_ID, client_secret: c.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }) }));
    return { value: token.access_token, expires: Date.now() + token.expires_in * 1000 - 10000 };
  });
  return cache.get(`stream:${c.TWITCH_USERNAME}`, 30000, async () => {
    let token = await getToken(); if (token.expires <= Date.now()) { cache.delete(key); token = await getToken(); }
    const load = () => json(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(c.TWITCH_USERNAME)}`, { headers: { Authorization: `Bearer ${token.value}`, 'Client-Id': c.TWITCH_CLIENT_ID } });
    let data: unknown;
    try { data = await load(); } catch (e) { if (!(e instanceof UpstreamError) || e.status !== 401) throw e; cache.delete(key); token = await getToken(); data = await load(); }
    const s = streamSchema.parse(data).data[0];
    if (s && s.user_login.toLowerCase() !== c.TWITCH_USERNAME.toLowerCase()) throw new UpstreamError();
    return s ? { id: s.id, start: Date.parse(s.started_at) } : null;
  });
}

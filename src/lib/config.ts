import { z } from 'zod';
const identity = z.string().trim().min(1).max(64).regex(/^[^\\/?#\u0000-\u001f\u007f]+$/);
export const playerSchema = z.object({
  VALORANT_NAME: identity, VALORANT_TAG: identity,
  VALORANT_REGION: z.enum(['na','eu','ap','kr','latam','br']),
  VALORANT_PLATFORM: z.enum(['pc','console']).default('pc'),
  TWITCH_USERNAME: z.string().regex(/^[a-zA-Z0-9_]{1,25}$/).transform(s => s.toLowerCase()).optional(),
});
export type Player = z.infer<typeof playerSchema>;
const secrets = z.object({
  HENRIK_API_KEY: z.string().trim().min(1),
  TWITCH_CLIENT_ID: z.string().trim().optional().default(''),
  TWITCH_CLIENT_SECRET: z.string().trim().optional().default(''),
});
export type Config = Omit<Player, 'TWITCH_USERNAME'> & z.infer<typeof secrets> & { TWITCH_USERNAME: string };
export function config(player: Player, kind: 'record' | 'rank'): Config {
  const parsed = secrets.safeParse(process.env);
  if (!parsed.success || (kind === 'record' && (!parsed.data.TWITCH_CLIENT_ID || !parsed.data.TWITCH_CLIENT_SECRET))) throw new Error('configuration');
  return { ...parsed.data, ...player, TWITCH_USERNAME: player.TWITCH_USERNAME ?? '' };
}

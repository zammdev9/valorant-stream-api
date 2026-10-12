import { playerSchema } from './config';
export class InputError extends Error { constructor(message: string) { super(message); } }
export type CommandInput = { name?: string; tag?: string; region?: string; platform?: string; twitch?: string; showUser?: string };
export function parseInput(kind: 'rank' | 'record', input: CommandInput) {
  const parsed = playerSchema.safeParse({ VALORANT_NAME: input.name, VALORANT_TAG: input.tag,
    VALORANT_REGION: input.region?.toLowerCase(), VALORANT_PLATFORM: input.platform?.toLowerCase(), TWITCH_USERNAME: input.twitch });
  if (!parsed.success) throw new InputError('Invalid request: supply name, tag, region, and optional platform (pc or console) and Twitch username in the URL.');
  if (kind === 'record' && !parsed.data.TWITCH_USERNAME) throw new InputError('Invalid request: Twitch username is required for the stream record.');
  if (input.showUser !== undefined && !['true','false','1','0'].includes(input.showUser)) throw new InputError('Invalid request: showUser must be true or false.');
  const showUser = input.showUser === 'true' || input.showUser === '1';
  if (showUser && !parsed.data.TWITCH_USERNAME) throw new InputError('Invalid request: showUser requires a Twitch username.');
  return { player: parsed.data, showUser };
}
export function queryInput(request: Request): CommandInput {
  const query = new URL(request.url).searchParams;
  const get = (key: string) => query.get(key) ?? undefined;
  return { name: get('name') ?? get('user'), tag: get('tag'), region: get('region'), platform: get('platform'), twitch: get('twitch'), showUser: get('showUser') };
}
export function pathInput(request: Request, segments: string[]): CommandInput {
  if (segments.length < 3 || segments.length > 5) throw new InputError('Invalid request: use /api/rank|record/name/tag/region[/twitch] or /name/tag/region/platform/twitch.');
  const query = queryInput(request);
  return { ...query, name: segments[0], tag: segments[1], region: segments[2],
    platform: segments.length === 5 ? segments[3] : query.platform,
    twitch: segments.length === 5 ? segments[4] : segments[3] ?? query.twitch };
}

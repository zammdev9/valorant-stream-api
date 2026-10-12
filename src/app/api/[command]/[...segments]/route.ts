import { command as run, inputError } from '../../../../lib/public-api';
import { InputError, pathInput } from '../../../../lib/request-input';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ command: string; segments: string[] }> }) {
  const params = await context.params;
  if (params.command !== 'rank' && params.command !== 'record') return inputError(new InputError('Invalid command: use rank or record.'));
  try { return await run(params.command, pathInput(request, params.segments)); }
  catch (e) { if (e instanceof InputError) return inputError(e); throw e; }
}

import { command } from '../../../lib/public-api';
import { queryInput } from '../../../lib/request-input';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export function GET(request: Request) { return command('record', queryInput(request)); }

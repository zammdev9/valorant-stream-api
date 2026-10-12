import { command } from '../../../lib/public-api';
import { queryInput } from '../../../lib/request-input';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export function GET(request: Request) { return command('rank', queryInput(request)); }

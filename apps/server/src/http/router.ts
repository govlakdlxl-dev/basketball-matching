import { ApiError, readBearer, requireActor } from './auth';
import { createDatabase } from '../infra/database';
import type { Env } from '../infra/database';
import { createAccounts } from '../features/accounts/handlers';

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 65536) throw new ApiError('INVALID_INPUT', 400);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NOT_OBJECT');
    return value as Record<string, unknown>;
  } catch { throw new ApiError('INVALID_INPUT', 400); }
}

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith('/api/me') || path.startsWith('/api/teams') || path.startsWith('/api/operator')) {
    readBearer(request);
    const database = createDatabase(env);
    const actor = await requireActor(request, database);
    const accounts = createAccounts(database);
    const json = (value: unknown) => Response.json(value ?? null, { headers: { 'cache-control': 'no-store' } });
    if (path === '/api/me' && request.method === 'GET') return json(await accounts.getProfile(actor));
    if (path === '/api/me/teams' && request.method === 'GET') return json(await accounts.getMyTeams(actor));
    if (path === '/api/me/preferences' && request.method === 'GET') return json(await accounts.getPreferences(actor));
    if (path === '/api/me/preferences' && request.method === 'PUT') return json(await accounts.savePreferences(actor, await readBody(request)));
    if (path === '/api/teams' && request.method === 'POST') return json(await accounts.createTeam(actor, await readBody(request)));
    const review = path.match(/^\/api\/operator\/teams\/([^/]+)\/review$/);
    if (review && request.method === 'POST') return json(await accounts.reviewTeam(actor, { ...await readBody(request), teamId: review[1] }));
    const members = path.match(/^\/api\/teams\/([^/]+)\/members$/);
    if (members && request.method === 'POST') return json(await accounts.updateTeamMember(actor, { ...await readBody(request), teamId: members[1] }));
  }
  return Response.json({ code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.' }, { status: 404 });
}

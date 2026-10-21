import type { AuthActor } from '@basket/core/contracts';
import type { Database } from '../infra/database';

export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

export function readBearer(request: Request): string {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  if (!match?.[1] || match[1].length > 16000) throw new ApiError('UNAUTHORIZED', 401);
  return match[1];
}

export async function requireActor(request: Request, database?: Database): Promise<AuthActor> {
  const token = readBearer(request);
  if (!database) throw new ApiError('CONFIG_REQUIRED', 503);
  const { data, error } = await database.client.auth.getUser(token);
  if (error || !data.user) throw new ApiError('UNAUTHORIZED', 401);
  const profile = await database.client.from('profiles').select('id').eq('auth_id', data.user.id).is('deleted_at', null).maybeSingle();
  if (profile.error || !profile.data) throw new ApiError('UNAUTHORIZED', 401);
  return { userId: profile.data.id as string };
}

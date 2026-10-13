import { createClient } from '@supabase/supabase-js';
import { ApiError } from '../http/auth';

export type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ALLOWED_ORIGINS?: string;
  KAKAO_REST_KEY?: string;
  KAKAO_MOBILITY_REST_KEY?: string;
};

export function createDatabase(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new ApiError('CONFIG_REQUIRED', 503);
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    client,
    async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const { data, error } = await client.rpc(name, args);
      if (error) {
        const status: Record<string, number> = { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID_INPUT: 400, INVALID_PREFERENCES: 400, REQUEST_ID_CONFLICT: 409 };
        if (status[error.message]) throw new ApiError(error.message, status[error.message]!);
        throw new ApiError('SERVICE_UNAVAILABLE', 503);
      }
      return data as T;
    },
  };
}
export type Database = ReturnType<typeof createDatabase>;

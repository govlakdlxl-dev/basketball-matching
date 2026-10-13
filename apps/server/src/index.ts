import { ApiError } from './http/auth';
import { routeRequest } from './http/router';
import type { Env } from './infra/database';

export default {
  async fetch(request: Request, env: Env = {}) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/api/clock') {
      return Response.json({ now: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
    }
    try { return await routeRequest(request, env); } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
      return Response.json({ code, message: status === 401 ? '로그인 후 이용해 주세요.' : '요청을 처리하지 못했습니다.' }, { status, headers: { 'cache-control': 'no-store' } });
    }
  },
};

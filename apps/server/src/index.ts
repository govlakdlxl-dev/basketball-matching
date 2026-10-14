import { ApiError } from './http/auth';
import { routeRequest } from './http/router';
import type { Env } from './infra/database';
import {createDatabase} from './infra/database';
import {createPaymentWorker,configuredTestPg} from './features/payments/worker';
import {createRefundWorker} from './features/refunds/worker';
import {createNotificationTick} from './jobs/notifications';
import {configuredPushPort} from './features/notifications/ports/configured';
import {DisabledAlimtalkAdapter} from './features/notifications/ports/disabled-alimtalk';

export default {
  async fetch(request: Request, env: Env = {},context?:{waitUntil(promise:Promise<unknown>):void}) {
    const origin=request.headers.get('origin'),allowed=(env.ALLOWED_ORIGINS || '').split(',').map(value=>value.trim()).filter(value=>value && value!=='*');
    if(origin && !allowed.includes(origin)) return Response.json({code:'ORIGIN_NOT_ALLOWED',message:'허용되지 않은 연결입니다.'},{status:403});
    const cors=(response:Response)=>{
      if(origin) {response.headers.set('access-control-allow-origin',origin);response.headers.set('vary','Origin');}
      return response;
    };
    if(request.method==='OPTIONS') {
      if(!origin) return new Response(null,{status:403});
      return cors(new Response(null,{status:204,headers:{'access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS','access-control-allow-headers':'authorization,content-type','access-control-max-age':'600'}}));
    }
    try {
      if (request.method === 'GET' && new URL(request.url).pathname === '/api/clock') return cors(Response.json({ now: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } }));
      return cors(await routeRequest(request, env,context));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
      return cors(Response.json({ code, message: status === 401 ? '로그인 후 이용해 주세요.' : '요청을 처리하지 못했습니다.' }, { status, headers: { 'cache-control': 'no-store' } }));
    }
  },
  async scheduled(_controller:unknown,env:Env){const database=createDatabase(env);
   const stages:[string,()=>Promise<unknown>][]=[['expire',()=>database.rpc('api_expire_unpaid')],['payment',()=>createPaymentWorker(database,configuredTestPg(database,env)).runPaymentTick()],['refund',()=>createRefundWorker(database,configuredTestPg(database,env)).runRefundTick()],['notifications',()=>createNotificationTick(database,configuredPushPort(database,env),new DisabledAlimtalkAdapter()).runNotificationTick(new Date().toISOString(),crypto.randomUUID())]];
   for(const [stage,run] of stages){let status='completed',counts:unknown={};try{counts=await run();}catch{status='failed';}try{await database.rpc('api_record_job_run',{p_stage:stage,p_status:status,p_counts:counts??{}});}catch{/* 다음 tick에서 상태를 다시 확인합니다. */}}
  },
};

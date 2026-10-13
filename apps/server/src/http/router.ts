import { ApiError, readBearer, requireActor } from './auth';
import { createDatabase } from '../infra/database';
import type { Env } from '../infra/database';
import { createAccounts } from '../features/accounts/handlers';
import { createFacilities } from '../features/facilities/handlers';
import { searchPlaces } from '../features/facilities/kakao-local';
import {createMatchCommands} from '../features/matches/commands';
import {createMatchQueries} from '../features/matches/queries';
import {createApplicationCommands} from '../features/applications/commands';
import {createOperations} from '../features/operations/commands';
import {createPaymentCommands} from '../features/payments/commands';
import {createPaymentQueries} from '../features/payments/queries';
import {createPaymentWorker,configuredTestPg} from '../features/payments/worker';
import {createRefundQueries} from '../features/refunds/queries';
import {createRefundWorker} from '../features/refunds/worker';
import {createCheckout} from '../features/payments/checkout';

// 기본 호출 제한은 로컬·단일 Worker 검증용. 운영은 공유 제한을 연결해야 합니다.
const calls=new Map<string,{until:number;count:number}>();
function limit(request:Request) {
 const now=Date.now(),key=request.headers.get('cf-connecting-ip') || 'local';
 for(const [id,value] of calls) if(value.until<now) calls.delete(id);
 const bucket=calls.get(key) || {until:now+60000,count:0};
 if(++bucket.count>30) throw new ApiError('RATE_LIMITED',429);
 calls.set(key,bucket);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if(!request.body) throw new ApiError('INVALID_INPUT',400);
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  while(true) {
    const chunk=await reader.read();if(chunk.done) break;
    length+=chunk.value.byteLength;
    if(length>65536) {await reader.cancel();throw new ApiError('INVALID_INPUT',400);}
    chunks.push(chunk.value);
  }
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder().decode(bytes);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NOT_OBJECT');
    return value as Record<string, unknown>;
  } catch { throw new ApiError('INVALID_INPUT', 400); }
}

export async function routeRequest(request: Request, env: Env,context?:{waitUntil(promise:Promise<unknown>):void}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if(request.method==='POST'&&['/api/payments/return','/api/payments/checkout-data','/api/payments/checkout-status'].includes(path)){
    const database=createDatabase(env),checkout=createCheckout(database,env),input=await readBody(request);
    const headers={'cache-control':'no-store','referrer-policy':'no-referrer'};
    if(path.endsWith('/return')){const receipt=await checkout.receive(input);if(context){const adapter=configuredTestPg(database,env);if(adapter)context.waitUntil(createPaymentWorker(database,adapter).processApproval(receipt.attemptId));}return Response.json(receipt,{headers});}
    return Response.json(path.endsWith('/checkout-data')?await checkout.data(input):await checkout.status(input),{headers});
  }
  if(path==='/api/matches' && request.method==='GET') return Response.json(await createMatchQueries(createDatabase(env)).list(),{headers:{'cache-control':'no-store'}});
  const publicMatch=path.match(/^\/api\/matches\/([^/]+)$/);
  if(publicMatch && request.method==='GET') return Response.json(await createMatchQueries(createDatabase(env)).get(publicMatch[1]),{headers:{'cache-control':'no-store'}});
  if(path==='/api/facilities' && request.method==='GET') return Response.json(await createFacilities(createDatabase(env),env).list(),{headers:{'cache-control':'no-store'}});
  if(path==='/api/places' && request.method==='GET') {limit(request);return Response.json(await searchPlaces(url.searchParams.get('q') || '',env.KAKAO_REST_KEY),{headers:{'cache-control':'no-store'}});}
  if(path==='/api/routes' && request.method==='POST') {limit(request);return Response.json(await createFacilities(createDatabase(env),env).estimate(await readBody(request)),{headers:{'cache-control':'no-store'}});}
  if(path==='/api/facilities' && request.method==='POST') {
   readBearer(request);const database=createDatabase(env);const actor=await requireActor(request,database);
   return Response.json(await createFacilities(database,env).save(actor,await readBody(request)),{headers:{'cache-control':'no-store'}});
  }
  if (path.startsWith('/api/me') || path.startsWith('/api/teams') || path.startsWith('/api/operator') || path.startsWith('/api/matches') || path.startsWith('/api/applications') || path.startsWith('/api/test-orders') || path==='/api/issues') {
    readBearer(request);
    const database = createDatabase(env);
    const actor = await requireActor(request, database);
    const accounts = createAccounts(database);
    const queries=createMatchQueries(database),matchCommands=createMatchCommands(database),applications=createApplicationCommands(database);
    const operations=createOperations(database);
    const json = (value: unknown) => Response.json(value ?? null, { headers: { 'cache-control': 'no-store' } });
    if(path==='/api/test-orders'&&request.method==='POST')return json(await createPaymentCommands(database).createTestOrder(actor,await readBody(request)));
    const approval=path.match(/^\/api\/test-orders\/([^/]+)\/approval$/);
    if(approval&&request.method==='POST'){
      const receipt=await createPaymentCommands(database).acceptApproval(actor,{...await readBody(request),orderId:approval[1]});
      if(context){const adapter=configuredTestPg(database,env);if(adapter)context.waitUntil(createPaymentWorker(database,adapter).processApproval(receipt.attemptId));}
      return json(receipt);
    }
    const reconcile=path.match(/^\/api\/test-orders\/([^/]+)\/reconcile$/);
    if(reconcile&&request.method==='POST'){
      const own=await createPaymentQueries(database).getTestOrder(actor,reconcile[1]);
      await createPaymentWorker(database,configuredTestPg(database,env)).reconcilePayment(own.id);
      return json(await createPaymentQueries(database).getTestOrder(actor,own.id));
    }
    const order=path.match(/^\/api\/test-orders\/([^/]+)$/);
    if(order&&request.method==='GET')return json(await createPaymentQueries(database).getTestOrder(actor,order[1]));
    const refund=path.match(/^\/api\/test-orders\/([^/]+)\/refund$/);
    if(refund&&request.method==='GET')return json(await createRefundQueries(database).getRefundRecord(actor,refund[1]));
    const refundReconcile=path.match(/^\/api\/test-orders\/([^/]+)\/refund\/reconcile$/);
    if(refundReconcile&&request.method==='POST'){const own=await createPaymentQueries(database).getTestOrder(actor,refundReconcile[1]);return json(await createRefundWorker(database,configuredTestPg(database,env)).processNextRefund(own.id));}
    const checkout=path.match(/^\/api\/test-orders\/([^/]+)\/checkout$/);
    if(checkout&&request.method==='POST')return json(await createCheckout(database,env).create(actor,{...await readBody(request),orderId:checkout[1]}));
    if(path==='/api/me/test-orders'&&request.method==='GET')return json(await database.rpc('api_my_test_orders',{p_actor:actor.userId}));
    if (path === '/api/me' && request.method === 'GET') return json(await accounts.getProfile(actor));
    if(path==='/api/me/applications' && request.method==='GET') return json(await queries.myApplications(actor));
    if(path==='/api/me/hosting' && request.method==='GET') return json(await queries.myHosting(actor));
    if(path==='/api/me/format-notices' && request.method==='GET') return json(await operations.myFormatNotices(actor));
    if(path==='/api/operator/dashboard' && request.method==='GET') return json(await operations.dashboard(actor));
    if(path==='/api/operator/test-ledger'&&request.method==='GET')return json(await database.rpc('api_operator_test_ledger',{p_actor:actor.userId}));
    if(path==='/api/me/deletion' && request.method==='POST') return json(await operations.requestAccountDeletion(actor));
    if(path==='/api/issues' && request.method==='POST') return json(await operations.reportIssue(actor,await readBody(request)));
    const matchOperation=path.match(/^\/api\/matches\/([^/]+)\/(cancel|format-notices|proceeding)$/);
    if(matchOperation && request.method==='POST') {
      const input={...await readBody(request),matchId:matchOperation[1]};
      const result=await (matchOperation[2]==='cancel'?operations.cancelMatch(actor,input):matchOperation[2]==='format-notices'?operations.announceFormatChange(actor,input):operations.reportProceeding(actor,input));
      if(matchOperation[2]==='cancel'&&context){const adapter=configuredTestPg(database,env);if(adapter)context.waitUntil(createRefundWorker(database,adapter).runRefundTick());}return json(result);
    }
    const appOperation=path.match(/^\/api\/applications\/([^/]+)\/(cancel|format-acknowledgement)$/);
    if(appOperation && request.method==='POST') {const input={...await readBody(request),applicationId:appOperation[1]},result=await (appOperation[2]==='cancel'?operations.cancelApplication(actor,input):operations.acknowledgeFormat(actor,input));if(appOperation[2]==='cancel'&&context){const adapter=configuredTestPg(database,env);if(adapter)context.waitUntil(createRefundWorker(database,adapter).runRefundTick());}return json(result);}
    const moderation=path.match(/^\/api\/operator\/matches\/([^/]+)\/moderation$/);
    if(moderation && request.method==='POST') return json(await operations.moderateMatch(actor,{...await readBody(request),matchId:moderation[1]}));
    if(path==='/api/matches' && request.method==='POST') return json(await matchCommands.publishMatch(actor,await readBody(request)));
    const submission=path.match(/^\/api\/matches\/([^/]+)\/applications$/);
    if(submission && request.method==='POST') return json(await applications.submitApplication(actor,{...await readBody(request),matchId:submission[1]}));
    if(submission && request.method==='GET') return json(await queries.teamApplications(actor,submission[1]));
    const transition=path.match(/^\/api\/applications\/([^/]+)\/(accept|reject)$/);
    if(transition && request.method==='POST') {
      const input={...await readBody(request),applicationId:transition[1]};
      return json(await (transition[2]==='accept'?applications.acceptApplication(actor,input):applications.rejectApplication(actor,input)));
    }
    const paymentContext=path.match(/^\/api\/applications\/([^/]+)\/payment-context$/);
    if(paymentContext && request.method==='GET') return json(await queries.getPaymentContext(actor,paymentContext[1]));
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

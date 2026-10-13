import { ApiError, readBearer, requireActor } from './auth';
import { createDatabase } from '../infra/database';
import type { Env } from '../infra/database';
import { createAccounts } from '../features/accounts/handlers';
import { createFacilities } from '../features/facilities/handlers';
import { searchPlaces } from '../features/facilities/kakao-local';
import {createMatchCommands} from '../features/matches/commands';
import {createMatchQueries} from '../features/matches/queries';
import {createApplicationCommands} from '../features/applications/commands';

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

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
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
  if (path.startsWith('/api/me') || path.startsWith('/api/teams') || path.startsWith('/api/operator') || path.startsWith('/api/matches') || path.startsWith('/api/applications')) {
    readBearer(request);
    const database = createDatabase(env);
    const actor = await requireActor(request, database);
    const accounts = createAccounts(database);
    const queries=createMatchQueries(database),matchCommands=createMatchCommands(database),applications=createApplicationCommands(database);
    const json = (value: unknown) => Response.json(value ?? null, { headers: { 'cache-control': 'no-store' } });
    if (path === '/api/me' && request.method === 'GET') return json(await accounts.getProfile(actor));
    if(path==='/api/me/applications' && request.method==='GET') return json(await queries.myApplications(actor));
    if(path==='/api/me/hosting' && request.method==='GET') return json(await queries.myHosting(actor));
    if(path==='/api/matches' && request.method==='POST') return json(await matchCommands.publishMatch(actor,await readBody(request)));
    const submission=path.match(/^\/api\/matches\/([^/]+)\/applications$/);
    if(submission && request.method==='POST') return json(await applications.submitApplication(actor,{...await readBody(request),matchId:submission[1]}));
    if(submission && request.method==='GET') return json(await queries.teamApplications(actor,submission[1]));
    const transition=path.match(/^\/api\/applications\/([^/]+)\/(accept|reject)$/);
    if(transition && request.method==='POST') {
      const input={...await readBody(request),applicationId:transition[1]};
      return json(await (transition[2]==='accept'?applications.acceptApplication(actor,input):applications.rejectApplication(actor,input)));
    }
    const context=path.match(/^\/api\/applications\/([^/]+)\/payment-context$/);
    if(context && request.method==='GET') return json(await queries.getPaymentContext(actor,context[1]));
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

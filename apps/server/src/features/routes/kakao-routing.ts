import type { RouteEstimate } from '@basket/core/search';
import type { Point } from '@basket/core/contracts';
import type { Env } from '../../infra/database';
export function parseRoute(value:unknown,mode:'subway'|'car',queriedAt:string):RouteEstimate {
 const unknown:RouteEstimate={status:'unknown',reason:'NO_ROUTE'};
 if(!value || typeof value!=='object') return unknown;
 const body=value as {status?:unknown;routes?:unknown};
 if(!Array.isArray(body.routes) || (mode==='subway' && body.status!=='OK')) return unknown;
 const durations:number[]=[];
 for(const item of body.routes) {
  if(!item || typeof item!=='object') continue;
  const r=item as {properties?:{type?:unknown;totalTime?:unknown};steps?:{properties?:{type?:unknown}}[];summary?:{duration?:unknown};result_code?:unknown};
  if(mode==='subway') {
   if(r.properties?.type!=='SUBWAY' || !Array.isArray(r.steps) || !r.steps.some(s=>s?.properties?.type==='SUBWAY') || r.steps.some(s=>!['SUBWAY','WALKING'].includes(String(s?.properties?.type)))) continue;
  } else if(r.result_code!==0) continue;
  const duration=mode==='subway' ? r.properties?.totalTime:r.summary?.duration;
  if(typeof duration==='number' && Number.isSafeInteger(duration) && duration>=0) durations.push(duration);
 }
 return durations.length ? {status:'available',durationSeconds:Math.min(...durations),queriedAt,basis:'query_time',mode,provider:'kakao'}:unknown;
}
export async function estimateKakaoRoute(env:Env,origin:Point,destination:Point,mode:'subway'|'car'):Promise<RouteEstimate> {
 const key=mode==='car' ? env.KAKAO_MOBILITY_REST_KEY:env.KAKAO_REST_KEY;
 if(!key) return {status:'unknown',reason:'CONFIG_REQUIRED'};
 const url=new URL(mode==='car' ? 'https://apis-navi.kakaomobility.com/v1/directions':'https://dapi.kakao.com/v2/routing/publictraffic');
 if(mode==='car') {url.searchParams.set('origin',`${origin.lng},${origin.lat}`);url.searchParams.set('destination',`${destination.lng},${destination.lat}`);url.searchParams.set('summary','true');}
 else for(const [key,value] of Object.entries({start_x:origin.lng,start_y:origin.lat,end_x:destination.lng,end_y:destination.lat})) url.searchParams.set(key,String(value));
 try {const queriedAt=new Date().toISOString();const response=await fetch(url,{headers:{authorization:`KakaoAK ${key}`},signal:AbortSignal.timeout(5000)});return response.ok ? parseRoute(await response.json(),mode,queriedAt):{status:'unknown',reason:'PROVIDER_UNAVAILABLE'};}
 catch {return {status:'unknown',reason:'PROVIDER_UNAVAILABLE'};}
}

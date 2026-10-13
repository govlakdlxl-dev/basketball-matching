import type { AuthActor, Facility, Point } from '@basket/core/contracts';
import { isPoint } from '@basket/core/preferences';
import type { RouteEstimate } from '@basket/core/search';
import type { Database, Env } from '../../infra/database';
import { textField } from '../accounts/handlers';
import { ApiError } from '../../http/auth';
import { estimateKakaoRoute } from '../routes/kakao-routing';
export type PublicFacility = Omit<Facility,'registeredBy'>;
export function createFacilities(database:Database,env:Env) {
 return {
  list():Promise<PublicFacility[]> {return database.rpc('api_list_facilities');},
  save(actor:AuthActor,input:Record<string,unknown>):Promise<PublicFacility> {
   if(!isPoint(input.point) || !['seoul','incheon'].includes(String(input.region)) || !['operator','map_search','manual_pin'].includes(String(input.registration))) throw new ApiError('INVALID_INPUT',400);
   let sourceUrl:string|null=null;
   if(input.sourceUrl!=null) {sourceUrl=textField(input.sourceUrl,2000);try {const url=new URL(sourceUrl);if(url.protocol!=='https:' || url.username || url.password) throw new Error();} catch {throw new ApiError('INVALID_INPUT',400);}}
   const value={name:textField(input.name,160),address:textField(input.address,300),point:input.point,region:input.region,registration:input.registration,sourceUrl,evidence:textField(input.evidence)};
   return database.rpc('api_save_facility',{p_actor:actor.userId,p_input:value,p_request_id:textField(input.requestId,128)});
  },
  async estimate(input:Record<string,unknown>):Promise<RouteEstimate> {
   if(!isPoint(input.origin) || !['subway','car'].includes(String(input.mode))) throw new ApiError('INVALID_INPUT',400);
   const id=textField(input.facilityId,128);
   if(!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('INVALID_INPUT',400);
   const {data,error}=await database.client.from('facilities').select('latitude,longitude').eq('id',id).maybeSingle();
   if(error) throw new ApiError('SERVICE_UNAVAILABLE',503);if(!data) throw new ApiError('NOT_FOUND',404);
   return estimateKakaoRoute(env,input.origin as Point,{lat:data.latitude as number,lng:data.longitude as number},input.mode as 'subway'|'car');
  },
 };
}

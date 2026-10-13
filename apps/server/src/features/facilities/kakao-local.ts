import type { PlaceCandidate } from '@basket/core/contracts';
import { isPoint } from '@basket/core/preferences';
import { ApiError } from '../../http/auth';
export async function searchPlaces(query:string,key:string|undefined):Promise<PlaceCandidate[]> {
 if(query.trim().length<2 || query.length>80) throw new ApiError('INVALID_INPUT',400);
 if(!key) throw new ApiError('CONFIG_REQUIRED',503);
 const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');url.searchParams.set('query',query.trim());url.searchParams.set('size','10');
 try {
  const response=await fetch(url,{headers:{authorization:`KakaoAK ${key}`},signal:AbortSignal.timeout(5000)});
  if(!response.ok) throw new Error();
  const body=await response.json() as {documents?:Record<string,unknown>[]};
  if(!Array.isArray(body.documents)) throw new Error();
  return body.documents.flatMap(d=>{
   const point={lat:Number(d.y),lng:Number(d.x)};
   const address=d.road_address_name || d.address_name;
   return isPoint(point) && typeof d.id==='string' && typeof d.place_name==='string' && typeof address==='string' ? [{providerId:d.id,name:d.place_name,address,point}]:[];
  });
 } catch {throw new ApiError('PROVIDER_UNAVAILABLE',503);}
}

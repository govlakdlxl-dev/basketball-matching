import type {MatchSummary} from '@basket/core/contracts';
import {matchesPreferences} from '@basket/core/search';
import type {RouteEstimate} from '@basket/core/search';
import type {Preferences} from '@basket/core/preferences';
import {api} from '../auth/session';
export async function classifyMatches(matches:MatchSummary[],prefs:Preferences,hasOrigin:boolean) {
 const cache=new Map<string,Promise<RouteEstimate>>();
 const rows:{match:MatchSummary;route:RouteEstimate;status:'matched'|'unknown'}[]=[];
 for(const match of matches) {
  const searchable={startsAt:match.startsAt,endsAt:match.endsAt,recruitmentStatus:match.recruitmentStatus,positionsAvailable:(['guard','forward','center'] as const).filter(pos=>match.roster.positionSlots[pos].available>0)};
  const unavailable:RouteEstimate={status:'unknown',reason:hasOrigin?'NO_ROUTE':'ORIGIN_REQUIRED'};
  if(matchesPreferences(searchable,prefs,unavailable)==='unmatched') continue;
  let route:RouteEstimate=unavailable;
  if(hasOrigin) {
   const key=match.facilityId;
   if(!cache.has(key)) cache.set(key,api<RouteEstimate>('/routes','POST',{origin:prefs.origin,facilityId:match.facilityId,mode:prefs.mode}).catch(()=>({status:'unknown',reason:'PROVIDER_UNAVAILABLE'} as const)));
   route=await cache.get(key)!;
  }
  const status=matchesPreferences(searchable,prefs,route);if(status!=='unmatched') rows.push({match,route,status});
 }
 return rows;
}

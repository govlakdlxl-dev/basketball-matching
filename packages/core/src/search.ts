import type { Position, UtcInstant } from './contracts';
import type { Preferences } from './preferences';
import { parseInstant } from './time';
export type SearchableMatch = {startsAt:UtcInstant;endsAt:UtcInstant;recruitmentStatus:'open'|'closed'|'cancelled';positionsAvailable:Position[]};
export type RouteEstimate = {status:'available';durationSeconds:number;queriedAt:UtcInstant;basis:'query_time';mode:'subway'|'car';provider:string} | {status:'unknown';reason:string};
export function matchesPreferences(match: SearchableMatch,prefs:Preferences,route:RouteEstimate):'matched'|'unmatched'|'unknown' {
 if(match.recruitmentStatus!=='open' || (prefs.position && !match.positionsAvailable.includes(prefs.position))) return 'unmatched';
 let start:Date,end:Date;
 try { start=new Date(parseInstant(match.startsAt));end=new Date(parseInstant(match.endsAt)); } catch {return 'unknown';}
 const parts=(date:Date)=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 const a=parts(start),b=parts(end); const date=`${a.year}-${a.month}-${a.day}`,endDate=`${b.year}-${b.month}-${b.day}`;
 const day=new Date(`${date}T00:00:00Z`).getUTCDay() || 7, startMinute=Number(a.hour)*60+Number(a.minute), endMinute=Number(b.hour)*60+Number(b.minute);
 if(date<prefs.dateFrom || date>prefs.dateTo || !prefs.weekdays.includes(day) || startMinute<prefs.earliestStartMinute || startMinute>prefs.latestStartMinute) return 'unmatched';
 if(prefs.latestEndMinute!==null && (endDate!==date || endMinute>prefs.latestEndMinute)) return 'unmatched';
 if(route.status==='unknown' || route.mode!==prefs.mode || !Number.isSafeInteger(route.durationSeconds) || route.durationSeconds<0) return 'unknown';
 return route.durationSeconds<=prefs.maxMinutes*60 ? 'matched':'unmatched';
}

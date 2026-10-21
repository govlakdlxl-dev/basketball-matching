import type {MatchInput} from './contracts';
import {parseInstant} from './time';
import {assertWon} from './money';
export function validateMatchInput(input:unknown):MatchInput {
 if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('INVALID_MATCH');
 const m=input as MatchInput;
 const count=(n:unknown)=>typeof n==='number' && Number.isSafeInteger(n) && n>=0 && n<=2147483647;
 if(!/^[0-9a-f-]{36}$/i.test(m.teamId) || !/^[0-9a-f-]{36}$/i.test(m.facilityId)) throw new Error('INVALID_MATCH');
 if(parseInstant(m.startsAt)>=parseInstant(m.endsAt) || ![3,4,5].includes(m.playersPerTeam) || !count(m.teamCount) || m.teamCount<2 || !count(m.existingPlanned)) throw new Error('INVALID_MATCH');
 if(!m.guestSlots || typeof m.guestSlots!=='object' || ['guard','forward','center'].some(k=>!count(m.guestSlots[k as keyof typeof m.guestSlots]))) throw new Error('INVALID_MATCH');
 const target=m.guestSlots.guard+m.guestSlots.forward+m.guestSlots.center;
 if(target<1 || !Number.isSafeInteger(target+m.existingPlanned) || target+m.existingPlanned<m.playersPerTeam*m.teamCount) throw new Error('INVALID_MATCH');
 assertWon(m.baseFeeKrw);
 if(!['test-A-v1','test-B-v1'].includes(m.policy?.version)) throw new Error('INVALID_MATCH');
 for(const name of ['meetingPoint','rotationDescription','guestComposition','captainCoordination','reservationNote'] as const) if(typeof m[name]!=='string' || !m[name].trim() || m[name].length>1000) throw new Error('INVALID_MATCH');
 if(m.expectedPlayingMinutes!==null && !count(m.expectedPlayingMinutes)) throw new Error('INVALID_MATCH');
 return {teamId:m.teamId,facilityId:m.facilityId,startsAt:m.startsAt,endsAt:m.endsAt,playersPerTeam:m.playersPerTeam,teamCount:m.teamCount,existingPlanned:m.existingPlanned,guestSlots:{guard:m.guestSlots.guard,forward:m.guestSlots.forward,center:m.guestSlots.center},baseFeeKrw:m.baseFeeKrw,policy:{version:m.policy.version},meetingPoint:m.meetingPoint.trim(),rotationDescription:m.rotationDescription.trim(),guestComposition:m.guestComposition.trim(),captainCoordination:m.captainCoordination.trim(),reservationNote:m.reservationNote.trim(),expectedPlayingMinutes:m.expectedPlayingMinutes};
}

import {test,expect} from 'vitest';
import {matchesPreferences} from '../src/search';
import type {Preferences} from '../src/preferences';
test('모든 포지션이 찬 경기는 포지션 무관 검색에도 모집 가능한 결과가 아니다',()=>{
 const prefs:Preferences={origin:{lat:37,lng:127},mode:'subway',maxMinutes:30,dateFrom:'2026-10-14',dateTo:'2026-10-20',weekdays:[1,2,3,4,5,6,7],earliestStartMinute:0,latestStartMinute:1439,latestEndMinute:null,position:null};
 expect(matchesPreferences({startsAt:'2026-10-15T11:00:00Z',endsAt:'2026-10-15T13:00:00Z',recruitmentStatus:'open',positionsAvailable:[]},prefs,{status:'available',durationSeconds:300,queriedAt:'2026-10-15T01:00:00Z',mode:'subway',basis:'query_time',provider:'kakao'})).toBe('unmatched');
});

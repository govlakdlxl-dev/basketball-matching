import { expect, test } from 'vitest';
import { matchesPreferences } from '@basket/core/search';
import type { RouteEstimate, SearchableMatch } from '@basket/core/search';
import type { Preferences } from '@basket/core/preferences';
import { validateMapEvent } from '../../apps/web/src/features/map/protocol';
import { parseRoute } from '../../apps/server/src/features/routes/kakao-routing';

const prefs:Preferences={origin:{lat:37,lng:127},mode:'subway',maxMinutes:30,dateFrom:'2026-10-14',dateTo:'2026-10-21',weekdays:[1,2,3,4,5],earliestStartMinute:1080,latestStartMinute:1380,latestEndMinute:null,position:'guard'};
const match:SearchableMatch={startsAt:'2026-10-14T11:00:00Z',endsAt:'2026-10-14T13:00:00Z',recruitmentStatus:'open',positionsAvailable:['guard']};
const route:RouteEstimate={status:'available',durationSeconds:1800,queriedAt:'2026-10-14T01:00:00Z',mode:'subway',basis:'query_time',provider:'kakao'};
test('총 이동 시간은 초 단위로 경계를 비교한다',()=>{
 expect(matchesPreferences(match,prefs,route)).toBe('matched');
 expect(matchesPreferences(match,prefs,{...route,durationSeconds:1801})).toBe('unmatched');
});
test('더 멀리 가는 설정에도 가까운 경기가 포함된다',()=>expect(matchesPreferences(match,{...prefs,maxMinutes:60},{...route,durationSeconds:600})).toBe('matched'));
test('경로 미확인은 조건 충족으로 표시하지 않는다',()=>expect(matchesPreferences(match,prefs,{status:'unknown',reason:'NO_ROUTE'})).toBe('unknown'));
test('한국 시간의 날짜·요일·시작 및 종료 조건을 함께 적용한다',()=>{
 expect(matchesPreferences({...match,startsAt:'2026-10-14T00:00:00Z'},prefs,route)).toBe('unmatched');
 expect(matchesPreferences({...match,positionsAvailable:['center']},prefs,route)).toBe('unmatched');
 expect(matchesPreferences(match,{...prefs,latestEndMinute:21*60},route)).toBe('unmatched');
 expect(matchesPreferences({...match,recruitmentStatus:'closed'},prefs,route)).toBe('unmatched');
});
test('자동차 시간을 지하철 결과로 재사용하지 않는다',()=>expect(matchesPreferences(match,prefs,{...route,mode:'car'})).toBe('unknown'));
test('지하철 응답의 총 시간은 도보를 다시 더하지 않는다',()=>{
 expect(parseRoute({status:'OK',routes:[{properties:{type:'SUBWAY',totalTime:1800},steps:[{properties:{type:'WALKING',time:100}},{properties:{type:'SUBWAY',time:1600}},{properties:{type:'WALKING',time:100}}]}]},'subway',route.queriedAt)).toEqual(route);
});
test('버스 구간이 있으면 지하철 조건에 맞는 경로로 인정하지 않는다',()=>expect(parseRoute({status:'OK',routes:[{properties:{type:'BUS',totalTime:1000},steps:[{properties:{type:'BUS'}}]}]},'subway',route.queriedAt).status).toBe('unknown'));
test('응답 오류·빈 경로·비정상 시간은 미확인이다',()=>{
 for(const value of [null,{}, {routes:[]},{status:'OK',routes:[{properties:{type:'SUBWAY',totalTime:-1},steps:[{properties:{type:'SUBWAY'}}]}]}]) expect(parseRoute(value,'subway',route.queriedAt).status).toBe('unknown');
});
test('자동차 duration은 초 단위로 처리한다',()=>expect(parseRoute({routes:[{result_code:0,summary:{duration:900}}]},'car',route.queriedAt)).toMatchObject({status:'available',durationSeconds:900,mode:'car'}));
const source={}; const trust={origin:'https://map.basket.test',expectedOrigin:'https://map.basket.test',source,expectedSource:source,nonce:'test-frame-nonce'};
test('지도 응답은 정확한 origin·source·nonce가 모두 일치해야 한다',()=>{
 const value={type:'point_selected',nonce:trust.nonce,point:{lat:37.5,lng:127}};
 expect(validateMapEvent(value,trust)).toEqual(value);
 for(const context of [{...trust,origin:'https://map.basket.test.evil.test'},{...trust,source:{}},{...trust,nonce:'different'},{...trust,expectedSource:null}]) expect(validateMapEvent(value,context)).toBeNull();
});
test('지도 좌표·자료 타입·임의 명령을 검증한다',()=>{
 for(const value of [{type:'point_selected',nonce:trust.nonce,point:{lat:91,lng:127}},{type:'execute',nonce:trust.nonce,code:'alert(1)'},{type:'ready',nonce:trust.nonce,token:'secret'},null]) expect(validateMapEvent(value,trust)).toBeNull();
});
